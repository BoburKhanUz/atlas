package session

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"lookly/internal/apierr"
	"lookly/internal/auth"
	"lookly/internal/platform"
	"lookly/internal/store"
)

// The protocol, one transaction per request:
//
//	BEGIN (READ COMMITTED)
//	SET LOCAL lock_timeout = 5s, statement_timeout = 10s
//	t := atlas_now()                       -- request time, read BEFORE any lock wait
//	R0 := session by token hash (no lock)  -- finds the family
//	F  := SessionFamily FOR UPDATE         -- lock order: family first …
//	R  := Session FOR UPDATE               -- … then the session (then its successor)
//	Classify(t, F, R) and act; COMMIT
//
// Every refresh, grace replay and revocation of a family takes the family
// lock first, so they are serialised per family and never deadlock each
// other (only a password reset locks several families, all of one user, in
// id order). All times come from the database clock. A family revocation
// also stamps revokedAt on every live session of the family and clears the
// stored successor ciphertexts.
//
// A refusal that changes data (reuse, expiry) commits; lock or pool
// timeouts and deadlocks become SESSION_BUSY after a rollback, with no side
// effects.

const (
	// AbsoluteTTL: a family created by a sign-in can never be refreshed past
	// its creation plus 90 days.
	AbsoluteTTL = 90 * 24 * time.Hour

	// RefreshTokenMaxLength is the longest refresh token looked up at all.
	RefreshTokenMaxLength = 128

	// DeviceNameMax and userAgentMax bound what is stored about the client,
	// counted as the Next.js API counted them (UTF-16 units).
	DeviceNameMax = 100
	userAgentMax  = 200

	// DefaultLockTimeout and DefaultStatementTimeout bound each wait inside
	// the transaction; DefaultAcquireTimeout the wait for a connection.
	DefaultLockTimeout      = 5 * time.Second
	DefaultStatementTimeout = 10 * time.Second
	DefaultAcquireTimeout   = 5 * time.Second

	// transactionTimeout bounds starting and committing a transaction (the
	// wait for a connection has its own, shorter limit). The statements
	// inside run on the request's context, each under the statement and
	// lock timeouts.
	transactionTimeout = 20 * time.Second
)

// ClientType is how a client holds its tokens. It is fixed per family at
// sign-in; a token presented in the other mode is refused.
type ClientType string

const (
	Web    ClientType = "web"    // HttpOnly cookies
	Mobile ClientType = "mobile" // tokens in JSON bodies
)

// Reasons a family ends, as stored in SessionFamily.revokeReason.
const (
	reasonLogout        = "logout"
	reasonReuse         = "reuse"
	reasonExpired       = "expired"
	reasonPasswordReset = "password_reset"
)

// User is the account a session belongs to.
type User struct {
	ID    string
	Email string
	Name  *string
}

// Issued is a session's tokens and their limits.
type Issued struct {
	SessionID string
	FamilyID  string
	// IssuedAt is the database time of the request; cookie lifetimes are
	// relative to it.
	IssuedAt              time.Time
	AccessToken           string
	AccessTokenExpiresAt  time.Time
	RefreshToken          string
	RefreshTokenExpiresAt time.Time
	// SessionExpiresAt is the family's absolute limit.
	SessionExpiresAt time.Time
}

// Refreshed is the result of a successful refresh.
type Refreshed struct {
	User   User
	Issued Issued
	// Replay: the presented token had been rotated moments ago; the same
	// successor was returned and nothing was rotated.
	Replay bool
}

// Config is what a Service needs besides the database.
type Config struct {
	Tokens     auth.Tokens
	Keys       Keys
	AccessTTL  time.Duration
	RefreshTTL time.Duration
	Log        *slog.Logger
}

// Service runs the session protocol.
type Service struct {
	pool             *pgxpool.Pool
	cfg              Config
	lockTimeout      time.Duration
	statementTimeout time.Duration
	acquireTimeout   time.Duration
	now              func() time.Time
}

// Option configures a Service.
type Option func(*Service)

// WithLockTimeout replaces DefaultLockTimeout (tests use a short one).
func WithLockTimeout(d time.Duration) Option { return func(s *Service) { s.lockTimeout = d } }

// WithAcquireTimeout replaces DefaultAcquireTimeout (tests use a short one).
func WithAcquireTimeout(d time.Duration) Option { return func(s *Service) { s.acquireTimeout = d } }

// New returns a Service over the pool.
func New(pool *pgxpool.Pool, cfg Config, opts ...Option) *Service {
	s := &Service{
		pool:             pool,
		cfg:              cfg,
		lockTimeout:      DefaultLockTimeout,
		statementTimeout: DefaultStatementTimeout,
		acquireTimeout:   DefaultAcquireTimeout,
		now:              time.Now,
	}
	for _, o := range opts {
		o(s)
	}
	return s
}

// StartOptions describe the client that signs in.
type StartOptions struct {
	ClientType ClientType
	UserAgent  string
	DeviceName string // stored for mobile clients only
}

// Start creates a new family and its first session (sign-in, registration).
func (s *Service) Start(ctx context.Context, user User, o StartOptions) (Issued, error) {
	refreshToken := auth.NewRefreshToken()
	var issued Issued
	err := s.InTransaction(ctx, func(tx pgx.Tx, t time.Time) error {
		q := store.New(tx)
		absolute := t.Add(AbsoluteTTL)
		familyID, sessionID := platform.NewID(), platform.NewID()
		if err := q.CreateSessionFamily(ctx, store.CreateSessionFamilyParams{
			ID: familyID, UserId: user.ID, ClientType: string(o.ClientType), CreatedAt: t, AbsoluteExpiresAt: absolute,
		}); err != nil {
			return fmt.Errorf("create session family: %w", err)
		}
		expiresAt := earlier(t.Add(s.cfg.RefreshTTL), absolute)
		var deviceName *string
		if o.ClientType == Mobile {
			deviceName = clip(o.DeviceName, DeviceNameMax)
		}
		if err := q.CreateSession(ctx, store.CreateSessionParams{
			ID: sessionID, UserID: user.ID, FamilyID: familyID, TokenHash: auth.HashToken(refreshToken),
			At: t, ExpiresAt: expiresAt, UserAgent: clip(o.UserAgent, userAgentMax), DeviceName: deviceName,
		}); err != nil {
			return fmt.Errorf("create session: %w", err)
		}
		accessToken, accessExpiresAt := s.mintAccess(user, sessionID, t, absolute)
		issued = Issued{
			SessionID: sessionID, FamilyID: familyID, IssuedAt: t,
			AccessToken: accessToken, AccessTokenExpiresAt: accessExpiresAt,
			RefreshToken: refreshToken, RefreshTokenExpiresAt: expiresAt,
			SessionExpiresAt: absolute,
		}
		return nil
	})
	if err != nil {
		return Issued{}, err
	}
	return issued, nil
}

// RefreshOptions describe the client that refreshes.
type RefreshOptions struct {
	ClientType ClientType
	UserAgent  string
}

// Refresh exchanges a refresh token: a rotation, a grace replay, or a
// refusal (an *apierr.Error with one of the session codes).
func (s *Service) Refresh(ctx context.Context, refreshToken string, o RefreshOptions) (Refreshed, error) {
	if refreshToken == "" || len(refreshToken) > RefreshTokenMaxLength {
		return Refreshed{}, apierr.New(apierr.InvalidToken)
	}
	tokenHash := auth.HashToken(refreshToken)

	var result Refreshed
	var refusal apierr.Code
	err := s.InTransaction(ctx, func(tx pgx.Tx, t time.Time) error {
		q := store.New(tx)
		found, err := q.FindSessionByTokenHash(ctx, tokenHash)
		if errors.Is(err, pgx.ErrNoRows) {
			refusal = apierr.InvalidToken
			return nil
		} else if err != nil {
			return fmt.Errorf("find session: %w", err)
		}

		// The family first, always; then the session. Either can be gone by
		// now (an account deletion, the cleanup): then the token is unknown.
		family, err := q.LockSessionFamily(ctx, found.FamilyId)
		if errors.Is(err, pgx.ErrNoRows) {
			refusal = apierr.InvalidToken
			return nil
		} else if err != nil {
			return fmt.Errorf("lock session family: %w", err)
		}
		current, err := q.LockSession(ctx, found.ID)
		if errors.Is(err, pgx.ErrNoRows) {
			refusal = apierr.InvalidToken
			return nil
		} else if err != nil {
			return fmt.Errorf("lock session: %w", err)
		}

		var legacyCutoverAt *time.Time
		if (current.RotatedAtSource != nil && *current.RotatedAtSource == "legacy") || (current.ReplacedById != nil && current.RotatedAt == nil) {
			at, err := q.LegacyCutoverAt(ctx)
			if err == nil {
				legacyCutoverAt = &at
			} else if !errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("read the legacy cutover marker: %w", err)
			}
		}

		decision := Classify(Refresh{
			At:     t,
			Family: FamilyState{RevokedAt: family.RevokedAt, AbsoluteExpiresAt: family.AbsoluteExpiresAt, ClientType: family.ClientType},
			Session: SessionState{
				RevokedAt: current.RevokedAt, ReplacedByID: current.ReplacedById, ExpiresAt: current.ExpiresAt,
				RotatedAt: current.RotatedAt, RotatedAtSource: current.RotatedAtSource,
			},
			ClientType:      string(o.ClientType),
			LegacyCutoverAt: legacyCutoverAt,
		})
		ids := []any{"userId", current.UserId, "familyId", family.ID, "sessionId", current.ID}

		switch decision.Kind {
		case Revoked:
			refusal = apierr.SessionRevoked
		case ClientMismatch:
			s.cfg.Log.WarnContext(ctx, "refresh token used with the wrong client type", append(ids, "clientType", string(o.ClientType))...)
			refusal = apierr.ClientMismatch
		case Expired:
			refusal = apierr.SessionExpired
			return revokeFamily(ctx, q, family.ID, t, reasonExpired)
		case Race:
			refusal = apierr.SessionRace
		case Reuse:
			refusal = apierr.RefreshReused
			if err := revokeFamily(ctx, q, family.ID, t, reasonReuse); err != nil {
				return err
			}
			s.cfg.Log.WarnContext(ctx, "refresh token reuse detected; session family revoked", ids...)
		case Grace:
			result, refusal, err = s.graceReplay(ctx, q, t, family, current)
			return err
		case Rotate:
			result, refusal, err = s.rotate(ctx, q, t, family, current, o.UserAgent)
			return err
		default:
			return fmt.Errorf("unknown refresh decision %q", decision.Kind)
		}
		return nil
	})
	if err != nil {
		return Refreshed{}, err
	}
	if refusal != "" {
		return Refreshed{}, apierr.New(refusal)
	}
	return result, nil
}

func (s *Service) rotate(ctx context.Context, q *store.Queries, t time.Time, family store.LockSessionFamilyRow, current store.LockSessionRow, userAgent string) (Refreshed, apierr.Code, error) {
	user, found, err := loadUser(ctx, q, current.UserId)
	if err != nil || !found {
		return Refreshed{}, apierr.InvalidToken, err
	}
	nextToken, nextID := auth.NewRefreshToken(), platform.NewID()
	expiresAt := earlier(t.Add(s.cfg.RefreshTTL), family.AbsoluteExpiresAt)
	agent := clip(userAgent, userAgentMax)
	if agent == nil {
		agent = current.UserAgent
	}
	if err := q.CreateSession(ctx, store.CreateSessionParams{
		ID: nextID, UserID: current.UserId, FamilyID: family.ID, TokenHash: auth.HashToken(nextToken),
		At: t, ExpiresAt: expiresAt, UserAgent: agent, DeviceName: current.DeviceName,
	}); err != nil {
		return Refreshed{}, "", fmt.Errorf("create successor session: %w", err)
	}
	if err := q.MarkSessionRotated(ctx, store.MarkSessionRotatedParams{
		ID: current.ID, At: t, SuccessorID: nextID,
		SuccessorTokenEnc: EncryptSuccessor(nextToken, SuccessorAAD(current.ID, nextID), s.cfg.Keys),
	}); err != nil {
		return Refreshed{}, "", fmt.Errorf("mark session rotated: %w", err)
	}
	accessToken, accessExpiresAt := s.mintAccess(user, nextID, t, family.AbsoluteExpiresAt)
	return Refreshed{
		User: user,
		Issued: Issued{
			SessionID: nextID, FamilyID: family.ID, IssuedAt: t,
			AccessToken: accessToken, AccessTokenExpiresAt: accessExpiresAt,
			RefreshToken: nextToken, RefreshTokenExpiresAt: expiresAt,
			SessionExpiresAt: family.AbsoluteExpiresAt,
		},
	}, "", nil
}

// graceReplay: the presented token was rotated at most 60 s ago (a
// concurrent request, or a lost response being retried). It returns the SAME
// successor refresh token and a new access token, but only if the successor
// is still the live tail of this family and the stored ciphertext decrypts
// to a token whose hash is the successor's. Otherwise: a race, with no
// tokens and nothing revoked.
func (s *Service) graceReplay(ctx context.Context, q *store.Queries, t time.Time, family store.LockSessionFamilyRow, current store.LockSessionRow) (Refreshed, apierr.Code, error) {
	if current.ReplacedById == nil || current.SuccessorTokenEnc == nil {
		return Refreshed{}, apierr.SessionRace, nil
	}
	successor, err := q.LockSession(ctx, *current.ReplacedById)
	if errors.Is(err, pgx.ErrNoRows) {
		return Refreshed{}, apierr.SessionRace, nil
	} else if err != nil {
		return Refreshed{}, "", fmt.Errorf("lock successor session: %w", err)
	}
	if successor.FamilyId != family.ID || successor.UserId != current.UserId ||
		successor.RevokedAt != nil || successor.ReplacedById != nil || !t.Before(successor.ExpiresAt) {
		return Refreshed{}, apierr.SessionRace, nil
	}
	token, ok := DecryptSuccessor(*current.SuccessorTokenEnc, SuccessorAAD(current.ID, successor.ID), s.cfg.Keys)
	if !ok || auth.HashToken(token) != successor.TokenHash {
		s.cfg.Log.WarnContext(ctx, "grace replay: successor token could not be recovered", "familyId", family.ID, "sessionId", current.ID)
		return Refreshed{}, apierr.SessionRace, nil
	}
	user, found, err := loadUser(ctx, q, current.UserId)
	if err != nil || !found {
		return Refreshed{}, apierr.InvalidToken, err
	}
	accessToken, accessExpiresAt := s.mintAccess(user, successor.ID, t, family.AbsoluteExpiresAt)
	return Refreshed{
		User:   user,
		Replay: true,
		Issued: Issued{
			SessionID: successor.ID, FamilyID: family.ID, IssuedAt: t,
			AccessToken: accessToken, AccessTokenExpiresAt: accessExpiresAt,
			RefreshToken: token, RefreshTokenExpiresAt: successor.ExpiresAt,
			SessionExpiresAt: family.AbsoluteExpiresAt,
		},
	}, "", nil
}

// EndOptions identify the session to end: by its refresh token, or by an
// access token's session id together with its user.
type EndOptions struct {
	RefreshToken string
	SID          string
	UserID       string
}

// End revokes the whole family of a session (sign-out). It is idempotent,
// and nothing to end is not an error.
func (s *Service) End(ctx context.Context, o EndOptions) error {
	return s.InTransaction(ctx, func(tx pgx.Tx, t time.Time) error {
		q := store.New(tx)
		familyID := ""
		if o.RefreshToken != "" && len(o.RefreshToken) <= RefreshTokenMaxLength {
			found, err := q.FindSessionByTokenHash(ctx, auth.HashToken(o.RefreshToken))
			if err == nil {
				familyID = found.FamilyId
			} else if !errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("find session: %w", err)
			}
		}
		if familyID == "" && o.SID != "" && o.UserID != "" {
			found, err := q.FindSessionFamilyOfUser(ctx, store.FindSessionFamilyOfUserParams{ID: o.SID, UserId: o.UserID})
			if err == nil {
				familyID = found
			} else if !errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("find session by id: %w", err)
			}
		}
		if familyID == "" {
			return nil
		}
		if _, err := q.LockSessionFamily(ctx, familyID); errors.Is(err, pgx.ErrNoRows) {
			return nil
		} else if err != nil {
			return fmt.Errorf("lock session family: %w", err)
		}
		return revokeFamily(ctx, q, familyID, t, reasonLogout)
	})
}

// Alive reports whether an access token's session still stands: its family
// is not revoked, and the session is live or was only rotated (a rotated
// session's access token stays good until it expires). Checked on every
// authenticated request, so a sign-out, a detected reuse or a password reset
// takes effect at once and not when the access token expires.
func (s *Service) Alive(ctx context.Context, sessionID, userID string) (bool, error) {
	if sessionID == "" || userID == "" {
		return false, nil
	}
	alive, err := store.New(s.pool).SessionIsAlive(ctx, store.SessionIsAliveParams{ID: sessionID, UserID: userID})
	if err != nil {
		return false, fmt.Errorf("check the session: %w", err)
	}
	return alive, nil
}

// InTransaction runs fn in one session-protocol transaction: read
// committed, with the lock and statement timeouts, and the request time t
// from the database clock. When the store is too busy (a lock, statement or
// pool timeout, a deadlock) everything is rolled back and the error is
// SESSION_BUSY.
func (s *Service) InTransaction(ctx context.Context, fn func(tx pgx.Tx, t time.Time) error) error {
	err := s.transaction(ctx, fn)
	if err == nil {
		return nil
	}
	// A request that was cancelled, or ran out of its own time, is not
	// "busy": the caller gets the context's error.
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if isBusy(err) {
		s.cfg.Log.WarnContext(ctx, "session operation busy", "err", describeBusy(err))
		return apierr.Busy()
	}
	return err
}

func (s *Service) transaction(ctx context.Context, fn func(tx pgx.Tx, t time.Time) error) error {
	txCtx, cancel := context.WithTimeout(ctx, transactionTimeout)
	defer cancel()

	acquireCtx, cancelAcquire := context.WithTimeout(txCtx, s.acquireTimeout)
	conn, err := s.pool.Acquire(acquireCtx)
	cancelAcquire()
	if err != nil {
		// Out of time here means the pool is exhausted: busy, as a lock wait is.
		return fmt.Errorf("acquire a database connection: %w", err)
	}
	defer conn.Release()

	return pgx.BeginTxFunc(txCtx, conn, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		// SET LOCAL takes no parameters; the values are durations we format.
		if _, err := tx.Exec(txCtx, fmt.Sprintf("SET LOCAL lock_timeout = '%dms'", s.lockTimeout.Milliseconds())); err != nil {
			return fmt.Errorf("set lock timeout: %w", err)
		}
		if _, err := tx.Exec(txCtx, fmt.Sprintf("SET LOCAL statement_timeout = '%dms'", s.statementTimeout.Milliseconds())); err != nil {
			return fmt.Errorf("set statement timeout: %w", err)
		}
		t, err := store.New(tx).SessionNow(txCtx)
		if err != nil {
			return fmt.Errorf("read the database clock: %w", err)
		}
		return fn(tx, t.UTC())
	})
}

// LockUserFamilies locks every session family of a user, in id order,
// inside the caller's InTransaction. A transaction that changes all of a
// user's sessions (a password reset, the account's deletion) takes these
// locks before it locks the user's row: a refresh takes its family's lock
// first too, so the two cannot deadlock.
func LockUserFamilies(ctx context.Context, tx pgx.Tx, userID string) error {
	if _, err := store.New(tx).LockSessionFamiliesOfUser(ctx, userID); err != nil {
		return fmt.Errorf("lock the user's session families: %w", err)
	}
	return nil
}

// RevokeUserFamilies revokes every live family of a user (a password
// reset), inside the caller's InTransaction. The families are locked in id
// order, so two such calls for one user never deadlock. It returns how many
// were revoked.
func RevokeUserFamilies(ctx context.Context, tx pgx.Tx, userID string, t time.Time) (int, error) {
	q := store.New(tx)
	families, err := q.LockLiveSessionFamiliesOfUser(ctx, userID)
	if err != nil {
		return 0, fmt.Errorf("lock the user's session families: %w", err)
	}
	for _, id := range families {
		if err := revokeFamily(ctx, q, id, t, reasonPasswordReset); err != nil {
			return 0, err
		}
	}
	return len(families), nil
}

// revokeFamily revokes a family whose lock the caller holds, stamps every
// live session in it and clears its successor ciphertexts.
func revokeFamily(ctx context.Context, q *store.Queries, familyID string, t time.Time, reason string) error {
	if err := q.RevokeSessionFamily(ctx, store.RevokeSessionFamilyParams{ID: familyID, At: t, Reason: reason}); err != nil {
		return fmt.Errorf("revoke session family: %w", err)
	}
	if err := q.RevokeSessionsOfFamily(ctx, store.RevokeSessionsOfFamilyParams{FamilyID: familyID, At: t}); err != nil {
		return fmt.Errorf("revoke the family's sessions: %w", err)
	}
	if err := q.ClearSuccessorCiphertextsOfFamily(ctx, familyID); err != nil {
		return fmt.Errorf("clear the family's successor ciphertexts: %w", err)
	}
	return nil
}

func loadUser(ctx context.Context, q *store.Queries, userID string) (User, bool, error) {
	row, err := q.SessionUser(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, false, nil
	} else if err != nil {
		return User{}, false, fmt.Errorf("load the session's user: %w", err)
	}
	return User{ID: row.ID, Email: row.Email, Name: row.Name}, true, nil
}

// mintAccess signs an access token for the session, valid for the access
// lifetime from the request time but never past the family's limit. The
// returned expiry is in whole seconds, as the token carries it.
func (s *Service) mintAccess(user User, sessionID string, t, absoluteExpiresAt time.Time) (string, time.Time) {
	expiresAt := earlier(t.Add(s.cfg.AccessTTL), absoluteExpiresAt)
	token := s.cfg.Tokens.Sign(auth.Claims{Sub: user.ID, Email: user.Email, SID: sessionID}, s.now(), expiresAt)
	return token, expiresAt.Truncate(time.Second)
}

func earlier(a, b time.Time) time.Time {
	if b.Before(a) {
		return b
	}
	return a
}

// clip prepares a client-supplied text for storage: valid UTF-8 without
// NUL (PostgreSQL refuses both), at most max UTF-16 units as the Next.js API
// counted, never cutting a character in half. Nothing left: nil (NULL).
func clip(value string, max int) *string {
	value = strings.ReplaceAll(strings.ToValidUTF8(value, string(utf8.RuneError)), "\x00", "")
	units, end := 0, len(value)
	for i, r := range value {
		n := 1
		if r > 0xFFFF {
			n = 2
		}
		if units+n > max {
			end = i
			break
		}
		units += n
	}
	value = value[:end]
	if value == "" {
		return nil
	}
	return &value
}

// busyStates are the PostgreSQL errors that mean "try again": lock not
// available, query cancelled (the statement timeout), deadlock detected and
// serialization failure.
var busyStates = map[string]bool{"55P03": true, "57014": true, "40P01": true, "40001": true}

func isBusy(err error) bool {
	// Our own limits ran out: no free connection, or the whole transaction
	// took too long. (The request's own deadline is handled by the caller.)
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	var pg *pgconn.PgError
	return errors.As(err, &pg) && busyStates[pg.Code]
}

// describeBusy names the cause for the log without the statement or its values.
func describeBusy(err error) string {
	var pg *pgconn.PgError
	if errors.As(err, &pg) {
		return "SQLSTATE " + pg.Code
	}
	return "timed out waiting for a connection or for the transaction"
}
