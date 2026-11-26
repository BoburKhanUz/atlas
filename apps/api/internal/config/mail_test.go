package config_test

import (
	"fmt"
	"log/slog"
	"path/filepath"
	"strings"
	"testing"

	"lookly/internal/config"
)

// smtp is a production configuration that sends mail.
func smtp(changes map[string]string) map[string]string {
	vars := with(map[string]string{
		"MAIL_TRANSPORT":  "smtp",
		"SMTP_HOST":       "smtp.example.uz",
		"SMTP_USER":       "mailer",
		"SMTP_PASSWORD":   "smtp-s3cret pass ",
		"MAIL_FROM":       "Lookly <no-reply@example.uz>",
		"PUBLIC_BASE_URL": "https://lookly.example.uz",
	})
	for k, v := range changes {
		if v == "<unset>" {
			delete(vars, k)
		} else {
			vars[k] = v
		}
	}
	return vars
}

func TestMailIsOffUnlessConfigured(t *testing.T) {
	t.Parallel()
	if (config.Mail{}).Enabled() {
		t.Error("a Mail that names no transport is enabled")
	}
	for _, e := range []string{"production", "staging"} {
		c, err := config.Load(env(with(map[string]string{"LOOKLY_ENV": e})))
		if err != nil {
			t.Fatal(err)
		}
		if c.Mail.Transport != config.MailDisabled || c.Mail.Enabled() {
			t.Errorf("%s: mail is %q by default, want disabled", e, c.Mail.Transport)
		}
	}
	// Disabled: the other mail settings are not read at all.
	c, err := config.Load(env(with(map[string]string{"MAIL_TRANSPORT": "disabled", "SMTP_PORT": "nonsense", "MAIL_FROM": "x"})))
	if err != nil || c.Mail.Enabled() {
		t.Errorf("disabled with leftovers: %v, enabled %v", err, c.Mail.Enabled())
	}
	// Development and test write messages to files.
	for _, e := range []string{"development", "test"} {
		c, err := config.Load(env(with(map[string]string{"LOOKLY_ENV": e})))
		if err != nil {
			t.Fatal(err)
		}
		if c.Mail.Transport != config.MailOutbox || !c.Mail.Enabled() {
			t.Fatalf("%s: mail is %q by default, want outbox", e, c.Mail.Transport)
		}
		if !filepath.IsAbs(c.Mail.OutboxDir) || !strings.HasSuffix(filepath.ToSlash(c.Mail.OutboxDir), "/storage/mail-outbox") {
			t.Errorf("%s: outbox directory %q", e, c.Mail.OutboxDir)
		}
		if c.Mail.From.Name != "Lookly" || c.Mail.From.Address != "no-reply@localhost" {
			t.Errorf("%s: outbox sender %+v", e, c.Mail.From)
		}
		if c.LinkOrigin() != "http://localhost:3000" {
			t.Errorf("%s: link origin %q", e, c.LinkOrigin())
		}
	}
	c, err = config.Load(env(with(map[string]string{"LOOKLY_ENV": "test", "MAIL_TRANSPORT": "outbox", "MAIL_OUTBOX_DIR": "/var/tmp/lookly-outbox", "MAIL_FROM": "Sinov <sinov@example.uz>", "PUBLIC_BASE_URL": "http://127.0.0.1:3100/"})))
	if err != nil {
		t.Fatal(err)
	}
	if c.Mail.OutboxDir != "/var/tmp/lookly-outbox" || c.Mail.From.Address != "sinov@example.uz" || c.LinkOrigin() != "http://127.0.0.1:3100" {
		t.Errorf("explicit outbox: %+v, origin %q", c.Mail, c.LinkOrigin())
	}
}

func TestSMTPSettings(t *testing.T) {
	t.Parallel()
	c, err := config.Load(env(smtp(nil)))
	if err != nil {
		t.Fatal(err)
	}
	m := c.Mail
	if m.Transport != config.MailSMTP || !m.Enabled() || m.Host != "smtp.example.uz" || m.Port != 587 || m.Secure {
		t.Errorf("defaults: %+v", m)
	}
	// The password is used as given; the user name is trimmed.
	if m.User != "mailer" || m.Password != "smtp-s3cret pass " {
		t.Error("the credentials are not the configured ones")
	}
	if m.From.Name != "Lookly" || m.From.Address != "no-reply@example.uz" || c.LinkOrigin() != "https://lookly.example.uz" {
		t.Errorf("sender %+v, origin %q", m.From, c.LinkOrigin())
	}

	for _, tc := range []struct {
		name    string
		changes map[string]string
		port    int
		secure  bool
	}{
		{"port 465 is TLS from the first byte", map[string]string{"SMTP_PORT": "465"}, 465, true},
		{"port 465 with STARTTLS asked for", map[string]string{"SMTP_PORT": "465", "SMTP_SECURE": "0"}, 465, false},
		{"another port with TLS asked for", map[string]string{"SMTP_PORT": "2465", "SMTP_SECURE": "TRUE"}, 2465, true},
		{"false spelled out", map[string]string{"SMTP_SECURE": "false"}, 587, false},
		{"a relay on localhost without credentials", map[string]string{"SMTP_HOST": "localhost", "SMTP_PORT": "25", "SMTP_USER": "<unset>", "SMTP_PASSWORD": "<unset>"}, 25, false},
	} {
		c, err := config.Load(env(smtp(tc.changes)))
		if err != nil {
			t.Errorf("%s: %v", tc.name, err)
			continue
		}
		if c.Mail.Port != tc.port || c.Mail.Secure != tc.secure {
			t.Errorf("%s: port %d, secure %v", tc.name, c.Mail.Port, c.Mail.Secure)
		}
	}
	// No credentials: both empty.
	c, err = config.Load(env(smtp(map[string]string{"SMTP_USER": " ", "SMTP_PASSWORD": ""})))
	if err != nil || c.Mail.User != "" || c.Mail.Password != "" {
		t.Errorf("no credentials: %v, user %q", err, c.Mail.User)
	}
	// A bare address as the sender; outside production SMTP needs no public address.
	c, err = config.Load(env(smtp(map[string]string{"LOOKLY_ENV": "development", "MAIL_FROM": "no-reply@example.uz", "PUBLIC_BASE_URL": "<unset>"})))
	if err != nil || c.Mail.From.Name != "" || c.Mail.From.Address != "no-reply@example.uz" || c.LinkOrigin() != "http://localhost:3000" {
		t.Errorf("development: %v, %+v, origin %q", err, c.Mail.From, c.LinkOrigin())
	}
}

func TestMailAndStorageRefusals(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name     string
		vars     map[string]string
		variable string
	}{
		{"unknown transport", with(map[string]string{"MAIL_TRANSPORT": "sendgrid"}), "MAIL_TRANSPORT"},
		{"transport in another case", with(map[string]string{"MAIL_TRANSPORT": "SMTP"}), "MAIL_TRANSPORT"},
		{"files instead of mail in production", with(map[string]string{"MAIL_TRANSPORT": "outbox"}), "MAIL_TRANSPORT"},
		{"files instead of mail in staging", with(map[string]string{"LOOKLY_ENV": "staging", "MAIL_TRANSPORT": "outbox"}), "MAIL_TRANSPORT"},
		{"the Next.js override does not open the outbox", with(map[string]string{"MAIL_TRANSPORT": "outbox", "MAIL_ALLOW_OUTBOX_IN_PRODUCTION": "1"}), "MAIL_TRANSPORT"},
		{"outbox sender malformed", with(map[string]string{"LOOKLY_ENV": "test", "MAIL_FROM": "nobody"}), "MAIL_FROM"},
		{"no host", smtp(map[string]string{"SMTP_HOST": "<unset>"}), "SMTP_HOST"},
		{"host with a space", smtp(map[string]string{"SMTP_HOST": "smtp example.uz"}), "SMTP_HOST"},
		{"port zero", smtp(map[string]string{"SMTP_PORT": "0"}), "SMTP_PORT"},
		{"port too big", smtp(map[string]string{"SMTP_PORT": "65536"}), "SMTP_PORT"},
		{"port not a number", smtp(map[string]string{"SMTP_PORT": "smtp"}), "SMTP_PORT"},
		{"port with a sign", smtp(map[string]string{"SMTP_PORT": "+587"}), "SMTP_PORT"},
		{"port of six digits", smtp(map[string]string{"SMTP_PORT": "000587"}), "SMTP_PORT"},
		{"secure flag unknown", smtp(map[string]string{"SMTP_SECURE": "yes"}), "SMTP_SECURE"},
		{"user without password", smtp(map[string]string{"SMTP_PASSWORD": "<unset>"}), "SMTP_USER"},
		{"password without user", smtp(map[string]string{"SMTP_USER": "<unset>"}), "SMTP_USER"},
		{"no sender", smtp(map[string]string{"MAIL_FROM": "<unset>"}), "MAIL_FROM"},
		{"sender of two lines", smtp(map[string]string{"MAIL_FROM": "Lookly <no-reply@example.uz>\r\nBcc: x@evil.example"}), "MAIL_FROM"},
		{"sender too long", smtp(map[string]string{"MAIL_FROM": strings.Repeat("L", 190) + " <no-reply@example.uz>"}), "MAIL_FROM"},
		{"sender not an address", smtp(map[string]string{"MAIL_FROM": "Lookly"}), "MAIL_FROM"},
		{"sender with an open bracket", smtp(map[string]string{"MAIL_FROM": "Lookly <no-reply@example.uz"}), "MAIL_FROM"},
		{"sender with two addresses", smtp(map[string]string{"MAIL_FROM": "a@example.uz, b@example.uz"}), "MAIL_FROM"},
		{"sender with a space in the address", smtp(map[string]string{"MAIL_FROM": "Lookly <no reply@example.uz>"}), "MAIL_FROM"},
		{"links without a public address in production", smtp(map[string]string{"PUBLIC_BASE_URL": "<unset>"}), "PUBLIC_BASE_URL"},
		{"links without a public address in staging", smtp(map[string]string{"LOOKLY_ENV": "staging", "PUBLIC_BASE_URL": "<unset>"}), "PUBLIC_BASE_URL"},
		{"public address without a scheme", smtp(map[string]string{"PUBLIC_BASE_URL": "lookly.example.uz"}), "PUBLIC_BASE_URL"},
		{"public address of another scheme", smtp(map[string]string{"PUBLIC_BASE_URL": "ftp://lookly.example.uz"}), "PUBLIC_BASE_URL"},
		{"public address with a path", smtp(map[string]string{"PUBLIC_BASE_URL": "https://lookly.example.uz/app"}), "PUBLIC_BASE_URL"},
		{"public address with a query", smtp(map[string]string{"PUBLIC_BASE_URL": "https://lookly.example.uz?x=1"}), "PUBLIC_BASE_URL"},
		{"public address with an empty query", smtp(map[string]string{"PUBLIC_BASE_URL": "https://lookly.example.uz?"}), "PUBLIC_BASE_URL"},
		{"public address with a fragment", smtp(map[string]string{"PUBLIC_BASE_URL": "https://lookly.example.uz#top"}), "PUBLIC_BASE_URL"},
		{"public address with credentials", smtp(map[string]string{"PUBLIC_BASE_URL": "https://user:pw@lookly.example.uz"}), "PUBLIC_BASE_URL"},
		{"public address with the default port", smtp(map[string]string{"PUBLIC_BASE_URL": "https://lookly.example.uz:443"}), "PUBLIC_BASE_URL"},
		{"public address without a host", smtp(map[string]string{"PUBLIC_BASE_URL": "https://"}), "PUBLIC_BASE_URL"},
		{"public address over plain http in production", smtp(map[string]string{"PUBLIC_BASE_URL": "http://lookly.example.uz"}), "PUBLIC_BASE_URL"},
		{"public address invalid although mail is off", with(map[string]string{"PUBLIC_BASE_URL": "lookly.example.uz"}), "PUBLIC_BASE_URL"},
		{"no storage directory", with(map[string]string{"STORAGE_LOCAL_DIR": "<unset>"}), "STORAGE_LOCAL_DIR"},
		{"a relative storage directory", with(map[string]string{"STORAGE_LOCAL_DIR": "./storage/uploads"}), "STORAGE_LOCAL_DIR"},
		{"a storage driver that does not exist yet", with(map[string]string{"STORAGE_DRIVER": "s3"}), "STORAGE_DRIVER"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			_, err := config.Load(env(tc.vars))
			if err == nil {
				t.Fatal("accepted")
			}
			if !strings.Contains(err.Error(), tc.variable) {
				t.Errorf("error does not name %s: %q", tc.variable, err)
			}
			if strings.Contains(err.Error(), "s3cret") {
				t.Errorf("error shows a secret: %q", err)
			}
		})
	}
}

func TestPublicAddressAndStorageSettings(t *testing.T) {
	t.Parallel()
	c, err := config.Load(env(with(map[string]string{"PUBLIC_BASE_URL": " HTTPS://Lookly.Example.UZ/ ", "STORAGE_DRIVER": "LOCAL", "STORAGE_LOCAL_DIR": "/srv/lookly/uploads"})))
	if err != nil {
		t.Fatal(err)
	}
	if c.PublicBaseURL != "https://lookly.example.uz" || c.LinkOrigin() != "https://lookly.example.uz" || c.StorageLocalDir != "/srv/lookly/uploads" {
		t.Errorf("public address %q, storage %q", c.PublicBaseURL, c.StorageLocalDir)
	}
	// Outside production a plain-http address with a port is fine.
	c, err = config.Load(env(with(map[string]string{"LOOKLY_ENV": "development", "PUBLIC_BASE_URL": "http://192.168.1.20:3000"})))
	if err != nil || c.PublicBaseURL != "http://192.168.1.20:3000" {
		t.Errorf("development: %v, %q", err, c.PublicBaseURL)
	}
}

func TestPrintingTheConfigNeverShowsTheMailPassword(t *testing.T) {
	t.Parallel()
	c, err := config.Load(env(smtp(nil)))
	if err != nil {
		t.Fatal(err)
	}
	var b strings.Builder
	slog.New(slog.NewJSONHandler(&b, nil)).Info("config", "config", c)
	for _, s := range []string{fmt.Sprint(c), fmt.Sprintf("%+v", c), fmt.Sprintf("%#v", c), fmt.Sprintf("%+v", c.Mail), fmt.Sprintf("%#v", c.Mail), b.String()} {
		if strings.Contains(s, "s3cret") {
			t.Errorf("printed config shows the mail password: %s", s)
		}
	}
	for _, want := range []string{`"mailTransport":"smtp"`, `"smtpHost":"smtp.example.uz"`, `"publicBaseURL":"https://lookly.example.uz"`, `"storageLocalDir"`} {
		if !strings.Contains(b.String(), want) {
			t.Errorf("log value lacks %s: %s", want, b.String())
		}
	}
}
