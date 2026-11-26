// Package mail sends e-mail: through an SMTP server, or (development and
// tests) into an outbox directory, one file per message. Messages carry
// one-time links: recipients, subjects and bodies are never logged, and
// they never travel unencrypted to a remote server.
package mail

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	netmail "net/mail"
	"net/textproto"
	"strings"
	"time"

	"lookly/internal/config"
)

// Message is one e-mail to one recipient, as text and as HTML.
type Message struct {
	To      string // a bare address
	Subject string
	Text    string
	HTML    string
}

// Sender sends messages.
type Sender interface {
	Send(ctx context.Context, m Message) error
}

// ErrDisabled: no transport is configured.
var ErrDisabled = errors.New("mail: the transport is disabled")

// Disabled sends nothing.
type Disabled struct{}

// Send fails with ErrDisabled.
func (Disabled) Send(context.Context, Message) error { return ErrDisabled }

// New returns the sender the configuration asks for.
func New(c config.Mail) Sender {
	switch c.Transport {
	case config.MailSMTP:
		return &SMTP{Host: c.Host, Port: c.Port, Secure: c.Secure, User: c.User, Password: c.Password, From: c.From}
	case config.MailOutbox:
		return &Outbox{Dir: c.OutboxDir, From: c.From}
	default:
		return Disabled{}
	}
}

// recipient checks that to is one bare address, and nothing else (no name,
// no second address, no line break: the parsed address must be the whole
// value), in ASCII (the addresses accounts have; others would need an SMTP
// extension this client does not speak), and returns it.
func recipient(to string) (string, error) {
	parsed, err := netmail.ParseAddress(to)
	if err != nil || parsed.Name != "" || parsed.Address != to || strings.ContainsFunc(to, func(r rune) bool { return r > 126 }) {
		return "", errors.New("mail: the recipient is not one address")
	}
	return parsed.Address, nil
}

// oneLine reports whether a header value is free of line breaks (a break
// would start another header).
func oneLine(s string) bool { return !strings.ContainsAny(s, "\r\n") }

// compose writes the message as it goes over the wire: UTF-8 headers in
// RFC 2047 form, and the text and HTML bodies as the two alternatives of a
// multipart message, quoted-printable.
func compose(from netmail.Address, to string, m Message, now time.Time) ([]byte, error) {
	if !oneLine(m.Subject) {
		return nil, errors.New("mail: the subject holds a line break")
	}
	id := make([]byte, 16)
	if _, err := rand.Read(id); err != nil {
		return nil, fmt.Errorf("mail: message id: %w", err)
	}
	domain := "localhost"
	if at := strings.LastIndexByte(from.Address, '@'); at >= 0 && at < len(from.Address)-1 {
		domain = from.Address[at+1:]
	}

	var body bytes.Buffer
	parts := multipart.NewWriter(&body)
	for _, part := range []struct{ kind, content string }{{"text/plain", m.Text}, {"text/html", m.HTML}} {
		w, err := parts.CreatePart(textproto.MIMEHeader{
			"Content-Type":              {part.kind + "; charset=utf-8"},
			"Content-Transfer-Encoding": {"quoted-printable"},
		})
		if err != nil {
			return nil, fmt.Errorf("mail: compose: %w", err)
		}
		qp := quotedprintable.NewWriter(w)
		if _, err := qp.Write([]byte(part.content)); err != nil {
			return nil, fmt.Errorf("mail: compose: %w", err)
		}
		if err := qp.Close(); err != nil {
			return nil, fmt.Errorf("mail: compose: %w", err)
		}
	}
	if err := parts.Close(); err != nil {
		return nil, fmt.Errorf("mail: compose: %w", err)
	}

	var out bytes.Buffer
	for _, header := range [][2]string{
		{"From", from.String()},
		{"To", (&netmail.Address{Address: to}).String()},
		{"Subject", mime.QEncoding.Encode("utf-8", m.Subject)},
		{"Date", now.Format(time.RFC1123Z)},
		{"Message-ID", "<" + hex.EncodeToString(id) + "@" + domain + ">"},
		{"MIME-Version", "1.0"},
		{"Content-Type", `multipart/alternative; boundary="` + parts.Boundary() + `"`},
	} {
		out.WriteString(header[0] + ": " + header[1] + "\r\n")
	}
	out.WriteString("\r\n")
	out.Write(body.Bytes())
	return out.Bytes(), nil
}
