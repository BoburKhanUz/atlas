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
// Registration counts every attempt that reaches this service.
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
	msgInvalidCredentials = "Email yoki parol noto‘g‘ri"
	msgEmailTaken         = "Bu email allaqachon ro‘yxatdan o‘tgan"
	msgUserNotFound       = "Foydalanuvchi topilmadi"
	// MsgPasswordTooLong: bcrypt reads 72 bytes; a longer password would be
	// cut silently, so it is refused when it is set.
	MsgPasswordTooLong = "Parol juda uzun. Qisqaroq parol tanlang: lotin harflarida ko‘pi bilan 72 ta, kirill harflarida 36 ta belgi."
)

// Hasher hashes and verifies passwords (auth.Bcrypt on the server).
type Hasher interface {
	Hash(plain string) (string, error)
	Verify(plain, hash string) bool
	NeedsRehash(hash string) bool
}

// Service is the account use cases.
type Service struct {
	pool     *pgxpool.Pool
	sessions *session.Service
	limiter  *ratelimit.Limiter
	consent  *legal.Service
	hasher   Hasher
	log      *slog.Logger

	decoyOnce sync.Once
	decoyHash string
}

// New returns a Service. It starts hashing a random password in the
// background (the decoy for unknown emails), so that the server does not
// wait for it to start and the first sign-in rarely does.
func New(pool *pgxpool.Pool, sessions *session.Service, limiter *ratelimit.Limiter, consent *legal.Service, hasher Hasher, log *slog.Logger) *Service {
	s := &Service{pool: pool, sessions: sessions, limiter: limiter, consent: consent, hasher: hasher, log: log}
	go s.decoy()
	return s
}

// decoy is the hash an unknown email's password is compared with, so that
// the answer takes the work of a wrong password: a real hash of the current
// cost, of a password nobody knows.
func (s *Service) decoy() string {
	s.decoyOnce.Do(func() {
		hash, err := s.hasher.Hash(auth.NewRefreshToken())
		if err != nil {
			// A random 43-character password always hashes; if it ever does
			// not, unknown emails answer faster than wrong passwords.
			s.log.Error("the decoy password could not be hashed", "err", err.Error())
		}
		s.decoyHash = hash
	})
	return s.decoyHash
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
	hit := RegisterShared.For("all")
	if c.HasAddr {
		hit = RegisterPerAddress.For(addressSubject(c.Addr))
	}
	decision, err := s.limiter.Take(ctx, hit)
	if err != nil {
		return session.User{}, session.Issued{}, err
	}
	if !decision.Allowed {
		return session.User{}, session.Issued{}, apierr.TooManyAttempts(decision.RetryAfter)
	}

	// Whether the email is taken is decided by the database alone (the
	// unique index), not by a look-up first: two registrations at once
	// cannot both pass, and a taken email costs the same work as a new one.
	email := normalizeEmail(in.Email)
	hash, err := s.hasher.Hash(in.Password)
	if err != nil {
		return session.User{}, session.Issued{}, fmt.Errorf("hash the password: %w", err)
	}

	user := session.User{ID: platform.NewID(), Email: email, Name: in.Name}
	err = pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		q := store.New(tx)
		if err := q.CreateUser(ctx, store.CreateUserParams{ID: user.ID, Email: email, Name: in.Name, PasswordHash: hash}); err != nil {
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
	decision, err := s.limiter.Take(ctx, hits...)
	if err != nil {
		return session.User{}, session.Issued{}, err
	}
	if !decision.Allowed {
		return session.User{}, session.Issued{}, apierr.TooManyAttempts(decision.RetryAfter)
	}

	q := store.New(s.pool)
	row, err := q.UserByEmail(ctx, email)
	if errors.Is(err, pgx.ErrNoRows) {
		s.hasher.Verify(in.Password, s.decoy()) // the work of a wrong password
		return session.User{}, session.Issued{}, apierr.With(apierr.Unauthorized, msgInvalidCredentials)
	} else if err != nil {
		return session.User{}, session.Issued{}, fmt.Errorf("look up the user: %w", err)
	}
	if !s.hasher.Verify(in.Password, row.PasswordHash) {
		return session.User{}, session.Issued{}, apierr.With(apierr.Unauthorized, msgInvalidCredentials)
	}

	// The attempt succeeded: it is not counted. Earlier failures stay.
	if err := s.limiter.Refund(ctx, hits...); err != nil {
		s.log.WarnContext(ctx, "sign-in: the attempt could not be given back to the rate limiter", "err", err.Error())
	}
	s.strengthen(ctx, row.ID, in.Password, row.PasswordHash)

	user := session.User{ID: row.ID, Email: row.Email, Name: row.Name}
	issued, err := s.sessions.Start(ctx, user, session.StartOptions{ClientType: c.Type, UserAgent: c.UserAgent, DeviceName: c.DeviceName})
	if err != nil {
		return session.User{}, session.Issued{}, err
	}
	return user, issued, nil
}

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

// Me returns the user of an authenticated request.
func (s *Service) Me(ctx context.Context, userID string) (Me, error) {
	row, err := store.New(s.pool).UserByID(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Me{}, apierr.With(apierr.NotFound, msgUserNotFound)
	} else if err != nil {
		return Me{}, fmt.Errorf("load the user: %w", err)
	}
	required, err := s.consent.ConsentRequired(ctx, row.ID)
	if err != nil {
		return Me{}, err
	}
	return Me{ID: row.ID, Email: row.Email, Name: row.Name, CreatedAt: row.CreatedAt, ConsentRequired: required}, nil
}

func passwordTooLong() *apierr.Error {
	return apierr.Validation(MsgPasswordTooLong, apierr.Detail{Path: "password", Message: MsgPasswordTooLong})
}
