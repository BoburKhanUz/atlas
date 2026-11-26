package mail

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"net"
	netmail "net/mail"
	"net/smtp"
	"strconv"
	"strings"
	"time"
)

// Time limits of one delivery.
const (
	smtpDialTimeout = 10 * time.Second
	smtpSendTimeout = 30 * time.Second
)

// SMTP sends through an SMTP server.
type SMTP struct {
	Host string
	Port int
	// Secure: TLS from the first byte. Otherwise STARTTLS is used when the
	// server offers it, and RequireTLS refuses to go on without it.
	Secure     bool
	RequireTLS bool
	// User and Password: both or neither. They are sent only over TLS, or to
	// a server on this machine.
	User     string
	Password string
	From     netmail.Address

	// rootCAs replaces the system's certificate authorities (tests).
	rootCAs *x509.CertPool
}

// Send delivers one message, within ctx and at most smtpSendTimeout. An
// error says what failed and never names the recipient or shows the
// message: a server's refusal often quotes the address, and errors end up
// in logs and in the job queue.
func (s *SMTP) Send(ctx context.Context, m Message) error {
	to, err := recipient(m.To)
	if err != nil {
		return err
	}
	if err := s.deliver(ctx, to, m); err != nil {
		return withoutAddress{err: err, address: to}
	}
	return nil
}

// withoutAddress is an error whose text has the recipient's address
// replaced.
type withoutAddress struct {
	err     error
	address string
}

func (e withoutAddress) Error() string {
	// Addresses are ASCII here (recipient), so lower-casing keeps positions.
	text, address := e.err.Error(), strings.ToLower(e.address)
	var out strings.Builder
	for {
		i := strings.Index(strings.ToLower(text), address)
		if i < 0 {
			out.WriteString(text)
			return out.String()
		}
		out.WriteString(text[:i] + "[recipient]")
		text = text[i+len(address):]
	}
}

func (e withoutAddress) Unwrap() error { return e.err }

func (s *SMTP) deliver(ctx context.Context, to string, m Message) error {
	data, err := compose(s.From, to, m, time.Now())
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, smtpSendTimeout)
	defer cancel()

	addr := net.JoinHostPort(s.Host, strconv.Itoa(s.Port))
	tlsConfig := &tls.Config{ServerName: s.Host, MinVersion: tls.VersionTLS12, RootCAs: s.rootCAs}
	dialer := &net.Dialer{Timeout: smtpDialTimeout}
	var conn net.Conn
	if s.Secure {
		conn, err = (&tls.Dialer{NetDialer: dialer, Config: tlsConfig}).DialContext(ctx, "tcp", addr)
	} else {
		conn, err = dialer.DialContext(ctx, "tcp", addr)
	}
	if err != nil {
		return fmt.Errorf("mail: connect to the SMTP server: %w", err)
	}
	// Whatever happens below, the connection ends with the context.
	stop := context.AfterFunc(ctx, func() { _ = conn.Close() })
	defer stop()
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	}

	c, err := smtp.NewClient(conn, s.Host)
	if err != nil {
		_ = conn.Close()
		return fmt.Errorf("mail: SMTP greeting: %w", err)
	}
	defer func() { _ = c.Close() }()

	if !s.Secure {
		switch offered, _ := c.Extension("STARTTLS"); {
		case offered:
			if err := c.StartTLS(tlsConfig); err != nil {
				return fmt.Errorf("mail: STARTTLS: %w", err)
			}
		case s.RequireTLS:
			return errors.New("mail: the SMTP server does not offer STARTTLS, and the connection must be encrypted")
		}
	}
	if s.User != "" {
		auth, err := s.auth(c)
		if err != nil {
			return err
		}
		if err := c.Auth(auth); err != nil {
			return fmt.Errorf("mail: SMTP sign-in: %w", err)
		}
	}
	if err := c.Mail(s.From.Address); err != nil {
		return fmt.Errorf("mail: SMTP sender: %w", err)
	}
	if err := c.Rcpt(to); err != nil {
		return fmt.Errorf("mail: SMTP recipient: %w", err)
	}
	w, err := c.Data()
	if err != nil {
		return fmt.Errorf("mail: SMTP data: %w", err)
	}
	if _, err := w.Write(data); err != nil {
		return fmt.Errorf("mail: SMTP data: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("mail: SMTP data: %w", err)
	}
	// The message is accepted; a failed goodbye does not undo that.
	_ = c.Quit()
	return nil
}

// auth picks the sign-in method the server offers: PLAIN, else LOGIN.
func (s *SMTP) auth(c *smtp.Client) (smtp.Auth, error) {
	_, mechanisms := c.Extension("AUTH")
	offered := strings.Fields(strings.ToUpper(mechanisms))
	has := func(name string) bool {
		for _, m := range offered {
			if m == name {
				return true
			}
		}
		return false
	}
	switch {
	case has("PLAIN"):
		return smtp.PlainAuth("", s.User, s.Password, s.Host), nil
	case has("LOGIN"):
		return &loginAuth{user: s.User, password: s.Password, host: s.Host}, nil
	default:
		return nil, errors.New("mail: the SMTP server offers no sign-in method this client knows (PLAIN, LOGIN)")
	}
}

// loginAuth is the LOGIN method (the user name, then the password, each
// when asked), for servers that do not offer PLAIN. Like the standard
// library's PLAIN it gives the credentials only over TLS or to this machine.
type loginAuth struct{ user, password, host string }

func (a *loginAuth) Start(server *smtp.ServerInfo) (string, []byte, error) {
	if !server.TLS && !isLocal(server.Name) {
		return "", nil, errors.New("mail: unencrypted connection")
	}
	if server.Name != a.host {
		return "", nil, errors.New("mail: wrong host name")
	}
	return "LOGIN", nil, nil
}

func (a *loginAuth) Next(fromServer []byte, more bool) ([]byte, error) {
	if !more {
		return nil, nil
	}
	switch strings.ToLower(strings.TrimRight(string(fromServer), ": ")) {
	case "username":
		return []byte(a.user), nil
	case "password":
		return []byte(a.password), nil
	default:
		return nil, errors.New("mail: unexpected LOGIN challenge")
	}
}

func isLocal(host string) bool { return host == "localhost" || host == "127.0.0.1" || host == "::1" }
