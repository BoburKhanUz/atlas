package accounts_test

import (
	"testing"
	"time"

	"lookly/internal/accounts"
	"lookly/internal/config"
	"lookly/internal/config/configtest"
	"lookly/internal/golden"
)

// The link and the message are the Next.js server's, byte for byte.
func TestTheResetLinkAndMessageAreTheNextJSOnes(t *testing.T) {
	t.Parallel()
	g := golden.LoadPasswordReset(t)
	if accounts.ResetTokenTTL != time.Duration(g.TTLMinutes)*time.Minute {
		t.Fatalf("links live %s here and %d minutes in the Next.js server", accounts.ResetTokenTTL, g.TTLMinutes)
	}
	for _, l := range g.Links {
		changes := map[string]string{}
		if l.PublicBaseURL != nil {
			changes["PUBLIC_BASE_URL"] = *l.PublicBaseURL
		}
		cfg, err := config.Load(configtest.Getenv(changes))
		if err != nil {
			t.Fatal(err)
		}
		if got := accounts.ResetLink(cfg.LinkOrigin(), l.Token); got != l.Link {
			t.Errorf("link %q, want %q", got, l.Link)
		}
	}
	for _, m := range g.Messages {
		got := accounts.ResetEmail(m.To, m.Link)
		if got.To != m.To || got.Subject != m.Subject || got.Text != m.Text || got.HTML != m.HTML {
			t.Errorf("message for link %q:\n%+v\nwant\n%+v", m.Link, got, m)
		}
	}
}
