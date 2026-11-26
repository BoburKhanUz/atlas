// Package accounts is registration, sign-in and the signed-in user: the
// account side of auth, on top of the session protocol and the rate limiter.
package accounts

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/netip"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"lookly/internal/apierr"
	"lookly/internal/auth"
	"lookly/internal/legal"
	"lookly/internal/platform"
	"lookly/internal/ratelimit"
	"lookly/internal/session"
	"lookly/internal/store"
)

// The limits (docs/plan/B2.md). Sign-in counts failed attempts: an attempt
// is counted before the password is checked and given back when it succeeds.
// Registration counts every attempt with a valid request, successful or not.
var (
	LoginPerAccount    = ratelimit.Rule{Name: "login:account", Limit: 10, Window: 15 * time.Minute}
	LoginPerAddress    = ratelimit.Rule{Name: "login:address", Limit: 50, Window: 15 * time.Minute}
	RegisterPerAddress = ratelimit.Rule{Name: "register:address", Limit: 10, Window: time.Hour}
	// RegisterShared applies when the client's address is not known (no
	// trusted proxy): one bucket for everybody, as the Next.js API had.
	RegisterShared = ratelimit.Rule{Name: "register:shared", Limit: 100, Window: time.Hour}
)

// Messages of the account operations (the Next.js API's).
const (
	// MsgInvalidCredentials answers a wrong email and a wrong password alike.
	MsgInvalidCredentials = "Email yoki parol noto‘g‘ri"
	msgEmailTaken         = "Bu email allaqachon ro‘yxatdan o‘tgan"
	// MsgUserNotFound answers for an account that is gone.
	MsgUserNotFound = "Foydalanuvchi topilmadi"
	// MsgPasswordTooLong: bcrypt reads 72 bytes; a longer password would be
	// cut silently, so it is refused when it is set.
	MsgPasswordTooLong = "Parol juda uzun. Qisqaroq parol tanlang: lotin harflarida ko‘pi bilan 72 ta, kirill harflarida 36 ta belgi."
)

// Hasher hashes and verifies passwords (auth.Bcrypt on the server).
type Hasher interface {
	Hash(plain string) (string, error)
	Verify(plain, hash string) bool
	NeedsRehash(hash string) bool
	// Decoys returns hashes of a password nobody knows, one of the current
	// cost and one of the cost the old server's hashes have.
	Decoys() (current, legacy string, err error)
}

// Queue takes the account operations' background work (the job queue).
type Queue interface {
	// ResetMail queues the making and sending of a password reset link for
	// the user; userID is "" when the address has no account (the job then
	// does nothing: the request costs the same either way).
	ResetMail(ctx context.Context, userID string) error
	// PurgeImagesTx queues, inside tx, the removal of everything stored for
	// the user: the job exists if and only if tx commits.
	PurgeImagesTx(ctx context.Context, tx pgx.Tx, userID string) error
}

// Config is what the account service is built from.
type Config struct {
	Pool     *pgxpool.Pool
	Sessions *session.Service
	Limiter  *ratelimit.Limiter
	Consent  *legal.Service
	Hasher   Hasher
	Log      *slog.Logger
	Queue    Queue
	// MailEnabled: e-mail can be sent. Without it a password reset cannot
	// be asked for.
	MailEnabled bool
}

// Service is the account use cases.
type Service struct {
	pool        *pgxpool.Pool
	sessions    *session.Service
	limiter     *ratelimit.Limiter
	consent     *legal.Service
	hasher      Hasher
	log         *slog.Logger
	queue       Queue
	mailEnabled bool

	decoyOnce                 sync.Once
	decoyCurrent, decoyLegacy string
}

// New returns a Service. It starts hashing the decoy passwords in the
// background, so that the server does not wait for them to start and the
// first sign-in rarely does.
func New(c Config) *Service {
	s := &Service{
		pool: c.Pool, sessions: c.Sessions, limiter: c.Limiter, consent: c.Consent, hasher: c.Hasher, log: c.Log,
		queue: c.Queue, mailEnabled: c.MailEnabled,
	}
	go s.decoys() // short and bounded: two hashes, then it ends
	return s
}

// decoys are the hashes a failed sign-in is also compared with. Every failed
// attempt costs one comparison at the current cost and one at the legacy
// cost: the account's own hash is one of the two, a decoy the other, and
// for an unknown email both are decoys. So the time an answer takes says
// neither whether the email is registered nor how old its hash is.
func (s *Service) decoys() (current, legacy string) {
	s.decoyOnce.Do(func() {
		var err error
		s.decoyCurrent, s.decoyLegacy, err = s.hasher.Decoys()
		if err != nil {
			// A random password always hashes; if it ever does not, failed
			// sign-ins are not equally slow.
			s.log.Error("the decoy passwords could not be hashed", "err", err.Error())
		}
	})
	return s.decoyCurrent, s.decoyLegacy
}

// Client is what is known about who is asking.
type Client struct {
	Type       session.ClientType
	UserAgent  string
	DeviceName string
	// Addr is the client's address when it can be trusted (HasAddr).
	Addr    netip.Addr
	HasAddr bool
}

// addressSubject names an address's rate-limit bucket: the address itself
// for IPv4, its /64 network for IPv6 (one customer line holds 2^64 of them).
func addressSubject(addr netip.Addr) string {
	if addr.Is6() && !addr.Is4In6() {
		if prefix, err := addr.Prefix(64); err == nil {
			return prefix.String()
		}
	}
	return addr.String()
}

// perClient is the bucket of the caller: its address when that is known,
// the shared bucket otherwise.
func perClient(c Client, perAddress, shared ratelimit.Rule) ratelimit.Hit {
	if c.HasAddr {
		return perAddress.For(addressSubject(c.Addr))
	}
	return shared.For("all")
}

func (s *Service) take(ctx context.Context, hits ...ratelimit.Hit) error {
	decision, err := s.limiter.Take(ctx, hits...)
	if err != nil {
		return err
	}
	if !decision.Allowed {
		return apierr.TooManyAttempts(decision.RetryAfter)
	}
	return nil
}

// normalizeEmail is how an email is stored and looked up.
func normalizeEmail(email string) string { return strings.ToLower(strings.TrimSpace(email)) }

// RegisterInput is a validated registration request.
type RegisterInput struct {
	Email        string
	Password     string
	Name         *string
	LegalVersion string // the accepted version (the current one: validated by the caller)
	AgeConfirmed bool
}

// Register creates an account (user, profile, preferences and the consent,
// in one transaction) and signs it in.
func (s *Service) Register(ctx context.Context, in RegisterInput, c Client) (session.User, session.Issued, error) {
	// Before anything is counted or looked up: this is a rule about the
	// request, like the ones the body was already checked against.
	if len(in.Password) > auth.MaxPasswordBytes {
		return session.User{}, session.Issued{}, passwordTooLong()
	}
	if err := s.take(ctx, perClient(c, RegisterPerAddress, RegisterShared)); err != nil {
		return session.User{}, session.Issued{}, err
	}

	// Whether the email is taken is decided by the database alone (the
	// unique index), not by a look-up first: two registrations at once
	// cannot both pass, and a taken email costs the same work as a new one.
	email := normalizeEmail(in.Email)
	hash, err := s.hasher.Hash(in.Password)
	if err != nil {
		return session.User{}, session.Issued{}, fmt.Errorf("hash the password: %w", err)
	}

	user := session.User{ID: platform.NewID(), Email: email, Name: storable(in.Name)}
	err = pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		q := store.New(tx)
		if err := q.CreateUser(ctx, store.CreateUserParams{ID: user.ID, Email: email, Name: user.Name, PasswordHash: hash}); err != nil {
			return fmt.Errorf("create the user: %w", err)
		}
		if err := q.CreateUserProfile(ctx, store.CreateUserProfileParams{ID: platform.NewID(), UserID: user.ID}); err != nil {
			return fmt.Errorf("create the profile: %w", err)
		}
		if err := q.CreateUserPreferences(ctx, store.CreateUserPreferencesParams{ID: platform.NewID(), UserID: user.ID}); err != nil {
			return fmt.Errorf("create the preferences: %w", err)
		}
		if err := q.CreateLegalConsent(ctx, store.CreateLegalConsentParams{
			ID: platform.NewID(), UserID: user.ID, Version: in.LegalVersion, AgeConfirmed: in.AgeConfirmed,
		}); err != nil {
			return fmt.Errorf("record the consent: %w", err)
		}
		return nil
	})
	if err != nil {
		// The email is taken, whether long ago or by a registration running
		// at the same moment.
		var pg *pgconn.PgError
		if errors.As(err, &pg) && pg.Code == "23505" && pg.ConstraintName == "User_email_key" {
			return session.User{}, session.Issued{}, apierr.With(apierr.Conflict, msgEmailTaken)
		}
		return session.User{}, session.Issued{}, err
	}

	issued, err := s.sessions.Start(ctx, user, session.StartOptions{ClientType: c.Type, UserAgent: c.UserAgent, DeviceName: c.DeviceName})
	if err != nil {
		return session.User{}, session.Issued{}, err
	}
	return user, issued, nil
}

// LoginInput is a validated sign-in request.
type LoginInput struct {
	Email    string
	Password string
}

// Login signs a user in. A wrong email and a wrong password give the same
// answer after the same work.
func (s *Service) Login(ctx context.Context, in LoginInput, c Client) (session.User, session.Issued, error) {
	email := normalizeEmail(in.Email)
	hits := []ratelimit.Hit{LoginPerAccount.For(email)}
	if c.HasAddr {
		hits = append(hits, LoginPerAddress.For(addressSubject(c.Addr)))
	}
	if err := s.take(ctx, hits...); err != nil {
		return session.User{}, session.Issued{}, err
	}

	q := store.New(s.pool)
	row, err := q.UserByEmail(ctx, email)
	decoyCurrent, decoyLegacy := s.decoys()
	if errors.Is(err, pgx.ErrNoRows) {
		s.hasher.Verify(in.Password, decoyCurrent)
		s.hasher.Verify(in.Password, decoyLegacy)
		return session.User{}, session.Issued{}, apierr.With(apierr.Unauthorized, MsgInvalidCredentials)
	} else if err != nil {
		return session.User{}, session.Issued{}, fmt.Errorf("look up the user: %w", err)
	}
	if !s.hasher.Verify(in.Password, row.PasswordHash) {
		// The other half of a failure's work (see decoys).
		if s.hasher.NeedsRehash(row.PasswordHash) {
			s.hasher.Verify(in.Password, decoyCurrent)
		} else {
			s.hasher.Verify(in.Password, decoyLegacy)
		}
		return session.User{}, session.Issued{}, apierr.With(apierr.Unauthorized, MsgInvalidCredentials)
	}

	// The attempt succeeded: it is not counted. Earlier failures stay.
	if err := s.limiter.Refund(ctx, hits...); err != nil {
		s.log.WarnContext(ctx, "sign-in: the attempt could not be given back to the rate limiter", "err", err.Error())
	}
	s.strengthen(ctx, row.ID, in.Password, row.PasswordHash)

	user := session.User{ID: row.ID, Email: row.Email, Name: row.Name}
	issued, err := s.sessions.Start(ctx, user, session.StartOptions{ClientType: c.Type, UserAgent: c.UserAgent, DeviceName: c.DeviceName})
	if err != nil {
		// The account was deleted after its password was checked: the new
		// session has no user to belong to. There is no such account.
		var pg *pgconn.PgError
		if errors.As(err, &pg) && pg.Code == foreignKeyViolation {
			return session.User{}, session.Issued{}, apierr.With(apierr.Unauthorized, MsgInvalidCredentials)
		}
		return session.User{}, session.Issued{}, err
	}
	return user, issued, nil
}

// foreignKeyViolation is PostgreSQL's code for a row that references a row
// that does not exist.
const foreignKeyViolation = "23503"

// strengthen replaces a hash weaker than the current cost by a new hash of
// the password just verified. It never fails the sign-in: the old hash
// keeps working.
func (s *Service) strengthen(ctx context.Context, userID, password, oldHash string) {
	if !s.hasher.NeedsRehash(oldHash) {
		return
	}
	newHash, err := s.hasher.Hash(password)
	if err != nil {
		// A password over 72 bytes, set under the old server, cannot be
		// hashed again: it stays as it is until it is changed. That is
		// expected; anything else is worth a warning.
		if !errors.Is(err, auth.ErrPasswordTooLong) {
			s.log.WarnContext(ctx, "sign-in: the password could not be hashed again", "userId", userID, "err", err.Error())
		}
		return
	}
	if _, err := store.New(s.pool).ReplacePasswordHash(ctx, store.ReplacePasswordHashParams{ID: userID, OldHash: oldHash, NewHash: newHash}); err != nil {
		s.log.WarnContext(ctx, "sign-in: the stronger password hash could not be stored", "userId", userID, "err", err.Error())
	}
}

// Me is the signed-in user.
type Me struct {
	ID        string
	Email     string
	Name      *string
	CreatedAt time.Time
	// ConsentRequired: the legal texts changed; the user must accept them
	// before using the app.
	ConsentRequired bool
}

// Exists reports whether the account is there.
func (s *Service) Exists(ctx context.Context, userID string) (bool, error) {
	_, err := store.New(s.pool).UserByID(ctx, userID)
	switch {
	case err == nil:
		return true, nil
	case errors.Is(err, pgx.ErrNoRows):
		return false, nil
	default:
		return false, fmt.Errorf("look up the user: %w", err)
	}
}

// Me returns the user of an authenticated request.
func (s *Service) Me(ctx context.Context, userID string) (Me, error) {
	row, err := store.New(s.pool).UserByID(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Me{}, apierr.With(apierr.NotFound, MsgUserNotFound)
	} else if err != nil {
		return Me{}, fmt.Errorf("load the user: %w", err)
	}
	required, err := s.consent.ConsentRequired(ctx, row.ID)
	if err != nil {
		return Me{}, err
	}
	return Me{ID: row.ID, Email: row.Email, Name: row.Name, CreatedAt: row.CreatedAt, ConsentRequired: required}, nil
}

// storable is a name as it can be stored: PostgreSQL refuses the NUL
// character in text, so it is removed (as the session protocol removes it
// from the device name). Nothing left: no name.
func storable(name *string) *string {
	if name == nil {
		return nil
	}
	cleaned := platform.StripNUL(*name)
	if cleaned == "" {
		return nil
	}
	return &cleaned
}

func passwordTooLong() *apierr.Error {
	return apierr.Validation(MsgPasswordTooLong, apierr.Detail{Path: "password", Message: MsgPasswordTooLong})
}
