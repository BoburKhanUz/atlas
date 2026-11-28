package config

import (
	"errors"
	"fmt"
	"log/slog"
	netmail "net/mail"
	"net/url"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

// MailTransport is how outgoing e-mail leaves (MAIL_TRANSPORT).
type MailTransport string

const (
	// MailSMTP sends through an SMTP server.
	MailSMTP MailTransport = "smtp"
	// MailOutbox writes each message to a file: development and tests only.
	MailOutbox MailTransport = "outbox"
	// MailDisabled sends nothing; password reset answers that it is unavailable.
	MailDisabled MailTransport = "disabled"
)

// Mail is the outgoing e-mail configuration, read as the Next.js server
// read it (until B7.6) so one environment file served both, with these
// differences: the outbox is refused in production
// and staging without exception, the sender must also parse as an RFC 5322
// address, and SMTP needs PUBLIC_BASE_URL in staging too.
type Mail struct {
	Transport MailTransport
	From      netmail.Address
	// SMTP.
	Host string
	Port int
	// Secure: TLS from the first byte (usual on port 465). Otherwise the
	// connection is upgraded with STARTTLS, which the sender requires of
	// every server but a relay on this machine (internal/mail).
	Secure   bool
	User     string
	Password string // secret
	// Outbox.
	OutboxDir string
}

// Enabled reports whether messages can be sent at all.
// A Mail that names no transport (its zero value) is disabled, as mail.New
// treats it.
func (m Mail) Enabled() bool { return m.Transport == MailSMTP || m.Transport == MailOutbox }

// String keeps the password out of fmt output.
func (m Mail) String() string {
	return fmt.Sprintf("Mail{Transport:%s From:%s Host:%s Port:%d Secure:%t User:%s Password:%s OutboxDir:%s}",
		m.Transport, m.From.Address, m.Host, m.Port, m.Secure, setOrNot(m.User), setOrNot(m.Password), m.OutboxDir)
}

// GoString keeps the password out of %#v.
func (m Mail) GoString() string { return m.String() }

// LogValue keeps the password out of logs.
func (m Mail) LogValue() slog.Value {
	return slog.GroupValue(
		slog.String("transport", string(m.Transport)), slog.String("from", m.From.Address), slog.String("host", m.Host),
		slog.Int("port", m.Port), slog.Bool("secure", m.Secure), slog.String("credentials", setOrNot(m.Password)),
		slog.String("outboxDir", m.OutboxDir),
	)
}

func setOrNot(v string) string {
	if v == "" {
		return "[none]"
	}
	return "[set]"
}

const (
	defaultSMTPPort   = 587
	implicitTLSPort   = 465
	maxMailFromLength = 200
	defaultOutboxDir  = "./storage/mail-outbox"
	// devLinkOrigin is where links in e-mails point when no public address
	// is configured (the web app's development server).
	devLinkOrigin = "http://localhost:3000"
)

var (
	defaultOutboxFrom = netmail.Address{Name: "Lookly", Address: "no-reply@localhost"}
	bareAddress       = regexp.MustCompile(`^[^\s@<>"]+@[^\s@<>"]+$`)
	namedAddress      = regexp.MustCompile(`^[^<>]*<([^<>]+)>$`)
	portDigits        = regexp.MustCompile(`^[0-9]{1,5}$`)
)

// LinkOrigin is the origin of the links in e-mails: PUBLIC_BASE_URL, or the
// development server's address when none is configured (which production
// and staging do not allow when mail is sent).
func (c Config) LinkOrigin() string {
	if c.PublicBaseURL != "" {
		return c.PublicBaseURL
	}
	return devLinkOrigin
}

// parseMailFrom reads MAIL_FROM: an address, or "Name <address>".
func parseMailFrom(value string) (netmail.Address, error) {
	const example = "for example: Lookly <no-reply@example.uz>"
	if len(value) > maxMailFromLength || strings.ContainsAny(value, "\r\n") {
		return netmail.Address{}, fmt.Errorf("must be one line of at most %d characters", maxMailFromLength)
	}
	address := value
	if m := namedAddress.FindStringSubmatch(value); m != nil {
		address = strings.TrimSpace(m[1])
	}
	parsed, err := netmail.ParseAddress(value)
	if !bareAddress.MatchString(address) || err != nil {
		return netmail.Address{}, errors.New(`must be an address or "Name <address>" (` + example + ")")
	}
	return *parsed, nil
}

// parsePublicBaseURL reads PUBLIC_BASE_URL: an origin only, in lower case.
func parsePublicBaseURL(value string, env Env) (string, error) {
	const originOnly = "must be an origin only (no path, query, fragment or credentials), such as https://lookly.example"
	if strings.ContainsFunc(value, func(r rune) bool { return r > unicode.MaxASCII || unicode.IsSpace(r) || unicode.IsControl(r) }) {
		return "", errors.New(originOnly)
	}
	u, err := url.Parse(value)
	if err != nil || u.Host == "" {
		return "", errors.New("must be an absolute URL such as https://lookly.example")
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "https" && scheme != "http" {
		return "", errors.New("must use http or https")
	}
	if u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || strings.Contains(value, "#") || (u.Path != "" && u.Path != "/") {
		return "", errors.New(originOnly)
	}
	// A default port is not part of an origin.
	if port := u.Port(); port != "" {
		if n, err := strconv.Atoi(port); err != nil || n < 1 || n > 65535 || (scheme == "https" && n == 443) || (scheme == "http" && n == 80) {
			return "", errors.New(originOnly)
		}
	}
	if (env == Production || env == Staging) && scheme != "https" {
		return "", errors.New("must use https in production and staging")
	}
	return scheme + "://" + strings.ToLower(u.Host), nil
}

// loadMail reads the mail settings. value returns a trimmed variable and
// whether it is set and not empty; raw returns it untouched.
func loadMail(env Env, publicBaseURL string, value func(string) (string, bool), raw func(string) (string, bool), fail func(variable, format string, args ...any)) Mail {
	deployed := env == Production || env == Staging
	transport, set := value("MAIL_TRANSPORT")
	if !set {
		transport = string(MailOutbox)
		if deployed {
			transport = string(MailDisabled)
		}
	}
	switch MailTransport(transport) {
	case MailDisabled:
		return Mail{Transport: MailDisabled}
	case MailOutbox:
		if deployed {
			fail("MAIL_TRANSPORT", "outbox only writes files: it is for development and test, not for %s", env)
			return Mail{Transport: MailDisabled}
		}
		m := Mail{Transport: MailOutbox, From: defaultOutboxFrom}
		if v, ok := value("MAIL_FROM"); ok {
			from, err := parseMailFrom(v)
			if err != nil {
				fail("MAIL_FROM", "%v", err)
			}
			m.From = from
		}
		dir, ok := value("MAIL_OUTBOX_DIR")
		if !ok {
			dir = defaultOutboxDir
		}
		abs, err := filepath.Abs(dir)
		if err != nil {
			fail("MAIL_OUTBOX_DIR", "cannot be resolved to a directory")
		}
		m.OutboxDir = abs
		return m
	case MailSMTP:
	default:
		fail("MAIL_TRANSPORT", "must be one of: smtp, outbox, disabled")
		return Mail{Transport: MailDisabled}
	}

	m := Mail{Transport: MailSMTP, Port: defaultSMTPPort}
	if deployed && publicBaseURL == "" {
		fail("PUBLIC_BASE_URL", "is not set: links in e-mails need the public address of the site")
	}
	if host, ok := value("SMTP_HOST"); !ok || strings.ContainsFunc(host, unicode.IsSpace) {
		fail("SMTP_HOST", "is not set, or holds white space")
	} else {
		m.Host = host
	}
	if v, ok := value("SMTP_PORT"); ok {
		n, err := strconv.Atoi(v)
		if !portDigits.MatchString(v) || err != nil || n < 1 || n > 65535 {
			fail("SMTP_PORT", "must be a port number")
		} else {
			m.Port = n
		}
	}
	m.Secure = m.Port == implicitTLSPort
	if v, ok := value("SMTP_SECURE"); ok {
		switch strings.ToLower(v) {
		case "1", "true":
			m.Secure = true
		case "0", "false":
			m.Secure = false
		default:
			fail("SMTP_SECURE", "must be 1 or 0")
		}
	}
	m.User, _ = value("SMTP_USER")
	m.Password, _ = raw("SMTP_PASSWORD")
	if (m.User == "") != (m.Password == "") {
		fail("SMTP_USER", "set both SMTP_USER and SMTP_PASSWORD, or neither")
		m.User, m.Password = "", ""
	}
	if v, ok := value("MAIL_FROM"); !ok {
		fail("MAIL_FROM", "is not set (for example: Lookly <no-reply@example.uz>)")
	} else if from, err := parseMailFrom(v); err != nil {
		fail("MAIL_FROM", "%v", err)
	} else {
		m.From = from
	}
	return m
}
