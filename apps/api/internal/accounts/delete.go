package accounts

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"lookly/internal/apierr"
	"lookly/internal/session"
	"lookly/internal/store"
)

var errNoSuchUser = errors.New("accounts: no such user")

// DeleteAccount deletes the user and everything the user owns, at once and
// for good (docs/plan/B3.md): one session-protocol transaction that
//
//   - locks the user's session families first, as every transaction that
//     touches sessions does, so a refresh in flight finishes before it
//     rather than deadlocking with it;
//   - queues the job that removes the user's images, so that job exists if
//     and only if the deletion commits;
//   - deletes the user's row; the schema's cascades remove the rest.
//
// The user's sessions are among what is removed: every token of the account
// stops working with the commit.
func (s *Service) DeleteAccount(ctx context.Context, userID string) error {
	err := s.sessions.InTransaction(ctx, func(tx pgx.Tx, _ time.Time) error {
		if err := session.LockUserFamilies(ctx, tx, userID); err != nil {
			return err
		}
		if err := s.queue.PurgeImagesTx(ctx, tx, userID); err != nil {
			return fmt.Errorf("queue the removal of the images: %w", err)
		}
		deleted, err := store.New(tx).DeleteUser(ctx, userID)
		if err != nil {
			return fmt.Errorf("delete the user: %w", err)
		}
		if deleted == 0 {
			return errNoSuchUser // rolls the queued job back
		}
		return nil
	})
	if errors.Is(err, errNoSuchUser) {
		return apierr.With(apierr.NotFound, MsgUserNotFound)
	}
	if err != nil {
		return err
	}
	s.log.InfoContext(ctx, "account deleted", "userId", userID)
	return nil
}
