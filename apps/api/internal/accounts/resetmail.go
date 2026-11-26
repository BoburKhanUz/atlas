package accounts

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"lookly/internal/auth"
	"lookly/internal/mail"
	"lookly/internal/platform"
	"lookly/internal/store"
)

// ResetRequestMaxAge: a request for a link that waited longer than this in
// the queue is dropped. The user has asked again by then, or gone.
const ResetRequestMaxAge = 30 * time.Minute

// ResetLink is the address a reset e-mail points to.
func ResetLink(origin, token string) string {
	return origin + "/reset-password?token=" + url.QueryEscape(token)
}

// htmlEscaper writes the five characters as the Next.js server writes them.
var htmlEscaper = strings.NewReplacer("&", "&#38;", "<", "&#60;", ">", "&#62;", `"`, "&#34;", "'", "&#39;")

// ResetEmail is the reset message (Uzbek), the Next.js server's byte for
// byte (apps/web/src/server/password-reset.ts). It names no one: only the
// link is personal.
func ResetEmail(to, link string) mail.Message {
	minutes := strconv.Itoa(int(ResetTokenTTL / time.Minute))
	lines := []string{
		"Salom!",
		"Lookly hisobingiz uchun parolni tiklash so‘raldi. Yangi parol o‘rnatish uchun havolani oching:",
		link,
		"Havola " + minutes + " daqiqa amal qiladi va faqat bir marta ishlaydi. Yangi parol o‘rnatilgach, barcha qurilmalardagi kirishlar yakunlanadi.",
		"Agar buni siz so‘ramagan bo‘lsangiz, xatni e’tiborsiz qoldiring: parolingiz o‘zgarmaydi.",
		"Lookly",
	}
	html := make([]string, len(lines))
	for i, line := range lines {
		if i == 2 {
			html[i] = `<p><a href="` + htmlEscaper.Replace(link) + `">Yangi parol o‘rnatish</a></p>`
		} else {
			html[i] = "<p>" + htmlEscaper.Replace(line) + "</p>"
		}
	}
	return mail.Message{To: to, Subject: "Lookly: parolni tiklash", Text: strings.Join(lines, "\n\n"), HTML: strings.Join(html, "\n")}
}

// ResetMailer makes reset links and e-mails them: the worker's side of a
// password reset request.
type ResetMailer struct {
	pool   *pgxpool.Pool
	sender mail.Sender
	origin string // of the links
	log    *slog.Logger
}

// NewResetMailer returns a ResetMailer whose links point to origin.
func NewResetMailer(pool *pgxpool.Pool, sender mail.Sender, origin string, log *slog.Logger) *ResetMailer {
	return &ResetMailer{pool: pool, sender: sender, origin: origin, log: log}
}

// Send makes a link for the user and e-mails it; once it has left, the
// user's earlier links stop working. It does nothing for no user (a request
// for an address without an account), for an account that is gone, and for
// a request that waited too long. An error means the attempt left nothing
// behind that works and was not sent (earlier links stay as they were): the
// job is tried again.
func (m *ResetMailer) Send(ctx context.Context, userID string, requestedAt time.Time) error {
	if userID == "" {
		return nil
	}
	if age := time.Since(requestedAt); age > ResetRequestMaxAge {
		m.log.WarnContext(ctx, "password reset request dropped: it waited too long", "userId", userID, "age", age.Round(time.Second).String())
		return nil
	}
	q := store.New(m.pool)
	user, err := q.UserByID(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil // the account was deleted since the request
	} else if err != nil {
		return fmt.Errorf("load user %s: %w", userID, err)
	}
	token := auth.NewRefreshToken() // 32 random bytes, base64url
	tokenHash := auth.HashToken(token)
	err = q.CreateResetToken(ctx, store.CreateResetTokenParams{
		ID: platform.NewID(), UserID: userID, TokenHash: tokenHash, TtlSeconds: ResetTokenTTL.Seconds(),
	})
	var pg *pgconn.PgError
	if errors.As(err, &pg) && pg.Code == foreignKeyViolation {
		return nil // deleted between the two statements
	} else if err != nil {
		return fmt.Errorf("store the reset link of user %s: %w", userID, err)
	}
	if err := m.sender.Send(ctx, ResetEmail(user.Email, ResetLink(m.origin, token))); err != nil {
		// The link never left: it must not stay valid. (The job's own
		// context may be the reason the send failed.)
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		if cerr := store.New(m.pool).DeleteResetToken(cleanup, tokenHash); cerr != nil {
			m.log.ErrorContext(ctx, "an unsent password reset link could not be deleted", "userId", userID, "err", cerr.Error())
		}
		return fmt.Errorf("send the reset mail of user %s: %w", userID, err)
	}
	// Only the links made before this one: another job for the same user
	// may have made and sent a newer one meanwhile. A failure here is
	// retried: the next attempt sends another link and ends the earlier
	// ones, this one included.
	if err := q.DeleteEarlierResetTokens(ctx, tokenHash); err != nil {
		return fmt.Errorf("end the earlier reset links of user %s: %w", userID, err)
	}
	m.log.InfoContext(ctx, "password reset link sent", "userId", userID)
	return nil
}
