package accounts

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"lookly/internal/apierr"
	"lookly/internal/auth"
	"lookly/internal/ratelimit"
	"lookly/internal/session"
	"lookly/internal/store"
)

// Password reset by an e-mailed link (docs/plan/B3.md).
//
//   - A request gets the same answer after the same work whether or not the
//     address has an account: one look-up and one queued job either way.
//     The job makes the link and sends it (ResetMailer).
//   - The link carries a 256-bit random token; only its SHA-256 hash is
//     stored. It works once, for ResetTokenTTL. A new link, once sent, ends
//     the user's earlier ones.
//   - The reset is one session-protocol transaction: the user's session
//     families are locked, then the user's row and the token's; the new
//     password hash is set, the user's links are deleted and every live
//     family is revoked, so every device signs in again.

// ResetTokenTTL is how long a reset link works.
const ResetTokenTTL = 60 * time.Minute

// The limits. Only requests with a valid body are counted. Behind the
// trusted proxy they are per client address; without it one bucket is
// shared by everybody, as the Next.js API had (there on top of the others).
var (
	// ResetRequestPerMailbox is counted for every address alike, so the
	// limit says nothing about accounts.
	ResetRequestPerMailbox = ratelimit.Rule{Name: "password-forgot:mailbox", Limit: 3, Window: time.Hour}
	ResetRequestPerAddress = ratelimit.Rule{Name: "password-forgot:address", Limit: 10, Window: time.Hour}
	ResetRequestShared     = ratelimit.Rule{Name: "password-forgot:shared", Limit: 200, Window: time.Hour}
	// ResetPerAddress also bounds the hashing a reset costs: the new
	// password is hashed before the token is looked at.
	ResetPerAddress = ratelimit.Rule{Name: "password-reset:address", Limit: 20, Window: time.Hour}
	ResetShared     = ratelimit.Rule{Name: "password-reset:shared", Limit: 300, Window: time.Hour}
)

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

// RequestPasswordReset queues a reset link for the account of the address,
// if there is one. The caller learns nothing about that.
func (s *Service) RequestPasswordReset(ctx context.Context, email string, c Client) error {
	if !s.mailEnabled {
		return apierr.New(apierr.PasswordResetUnavailable)
	}
	email = normalizeEmail(email)
	if err := s.take(ctx, perClient(c, ResetRequestPerAddress, ResetRequestShared), ResetRequestPerMailbox.For(email)); err != nil {
		return err
	}
	userID := ""
	switch row, err := store.New(s.pool).UserByEmail(ctx, email); {
	case err == nil:
		userID = row.ID
	case !errors.Is(err, pgx.ErrNoRows):
		return fmt.Errorf("look up the user: %w", err)
	}
	if err := s.queue.ResetMail(ctx, userID); err != nil {
		return fmt.Errorf("queue the reset mail: %w", err)
	}
	return nil
}

var errResetTokenInvalid = errors.New("accounts: reset token unknown, used or expired")

// ResetPassword sets a new password with a reset token and signs every
// device out. An unknown, used or expired token is RESET_TOKEN_INVALID and
// changes nothing.
func (s *Service) ResetPassword(ctx context.Context, token, newPassword string, c Client) error {
	if len(newPassword) > auth.MaxPasswordBytes {
		return passwordTooLong()
	}
	if err := s.take(ctx, perClient(c, ResetPerAddress, ResetShared)); err != nil {
		return err
	}
	// Hashed before the transaction (it is slow), also for a bad token.
	hash, err := s.hasher.Hash(newPassword)
	if err != nil {
		return fmt.Errorf("hash the password: %w", err)
	}
	tokenHash := auth.HashToken(token)
	var userID string
	var families int
	err = s.sessions.InTransaction(ctx, func(tx pgx.Tx, t time.Time) error {
		q := store.New(tx)
		id, err := q.ResetTokenUser(ctx, tokenHash)
		if errors.Is(err, pgx.ErrNoRows) {
			return errResetTokenInvalid
		} else if err != nil {
			return fmt.Errorf("find the reset token: %w", err)
		}
		// Families first, then the user's row (session.LockUserFamilies).
		if err := session.LockUserFamilies(ctx, tx, id); err != nil {
			return err
		}
		if _, err := q.LockUser(ctx, id); errors.Is(err, pgx.ErrNoRows) {
			return errResetTokenInvalid // the account was deleted meanwhile
		} else if err != nil {
			return fmt.Errorf("lock the user: %w", err)
		}
		// Under the user's lock: a reset that ran in between used the token up.
		expiresAt, err := q.LockResetToken(ctx, tokenHash)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && !expiresAt.After(t)) {
			return errResetTokenInvalid
		} else if err != nil {
			return fmt.Errorf("lock the reset token: %w", err)
		}
		if err := q.SetPasswordHash(ctx, store.SetPasswordHashParams{ID: id, PasswordHash: hash}); err != nil {
			return fmt.Errorf("set the password: %w", err)
		}
		if err := q.DeleteResetTokensOfUser(ctx, id); err != nil {
			return fmt.Errorf("delete the user's reset tokens: %w", err)
		}
		userID = id
		families, err = session.RevokeUserFamilies(ctx, tx, id, t)
		return err
	})
	if errors.Is(err, errResetTokenInvalid) {
		return apierr.New(apierr.ResetTokenInvalid)
	}
	if err != nil {
		return err
	}
	s.log.InfoContext(ctx, "password reset completed", "userId", userID, "families", families)
	return nil
}
