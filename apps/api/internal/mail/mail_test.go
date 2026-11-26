package mail_test

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"math/big"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net"
	netmail "net/mail"
	"net/smtp"
	"net/textproto"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"lookly/internal/config"
	"lookly/internal/mail"
)

var from = netmail.Address{Name: "Lookly Ўзбек", Address: "no-reply@example.uz"}

// message has what a transport can get wrong: characters outside ASCII in
// the subject and the bodies, a line longer than a mail line may be, a line
// that starts with a dot, and a trailing space.
var message = mail.Message{
	To:      "aziza@example.uz",
	Subject: "Lookly: parolni tiklash — ‘sinov’",
	Text: "Salom!\n\nYangi parol o‘rnatish uchun havolani oching: \n" +
		"https://lookly.example.uz/reset-password?token=" + strings.Repeat("Ab0_-", 20) + "\n\n.bir nuqta bilan boshlangan qator\n..ikki nuqta\nLookly",
	HTML: `<p>Salom!</p>` + "\n" + `<p><a href="https://lookly.example.uz/reset-password?token=` + strings.Repeat("Ab0_-", 20) + `">Yangi parol o‘rnatish</a></p>`,
}

// ─── A fake SMTP server ──────────────────────────────────────────────────

type delivery struct {
	commands  []string // every command line, as received (credentials replaced)
	tlsAtAuth bool
	tlsAtData bool
	user      string
	password  string
	from      string
	to        []string
	data      string
	accepted  bool
}

type fakeServer struct {
	t        *testing.T
	listener net.Listener
	cert     tls.Certificate
	roots    *x509.CertPool

	// addr is where it listens: 127.0.0.1 (a relay on this machine) unless
	// a test needs a server that is not, to the sender (127.0.0.2: another
	// loopback address, which the sender does not count as local).
	addr        string
	implicitTLS bool
	startTLS    bool
	mechanisms  string // "" offers no AUTH
	user, pass  string
	rejectRcpt  bool
	rejectData  bool
	rejectBody  bool // takes the message and refuses it at its end
	silent      bool // accepts the connection and never speaks

	mu         sync.Mutex
	deliveries []*delivery
	wg         sync.WaitGroup
}

func newFakeServer(t *testing.T, configure func(*fakeServer)) *fakeServer {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "fake smtp"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		KeyUsage: x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		IsCA: true, BasicConstraintsValid: true,
		IPAddresses: []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("127.0.0.2")}, DNSNames: []string{"localhost"},
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	s := &fakeServer{t: t, cert: tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}, roots: x509.NewCertPool(), user: "mailer", pass: "smtp pass-word"}
	s.roots.AddCert(parsed)
	s.addr = "127.0.0.1"
	configure(s)
	s.listener, err = net.Listen("tcp", net.JoinHostPort(s.addr, "0"))
	if err != nil {
		t.Fatal(err)
	}
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		for {
			conn, err := s.listener.Accept()
			if err != nil {
				return
			}
			s.wg.Add(1)
			go func() {
				defer s.wg.Done()
				defer conn.Close()
				s.serve(conn)
			}()
		}
	}()
	t.Cleanup(func() {
		_ = s.listener.Close()
		s.wg.Wait()
	})
	return s
}

func (s *fakeServer) port() int { return s.listener.Addr().(*net.TCPAddr).Port }

func (s *fakeServer) tlsConfig() *tls.Config {
	return &tls.Config{Certificates: []tls.Certificate{s.cert}, MinVersion: tls.VersionTLS12}
}

func (s *fakeServer) all() []*delivery {
	s.mu.Lock()
	defer s.mu.Unlock()
	return slices.Clone(s.deliveries)
}

func (s *fakeServer) serve(conn net.Conn) {
	d := &delivery{}
	s.mu.Lock()
	s.deliveries = append(s.deliveries, d)
	s.mu.Unlock()
	if s.silent {
		_, _ = io.Copy(io.Discard, conn) // until the client gives up
		return
	}
	_ = conn.SetDeadline(time.Now().Add(10 * time.Second))
	encrypted := false
	if s.implicitTLS {
		tlsConn := tls.Server(conn, s.tlsConfig())
		if tlsConn.Handshake() != nil {
			return
		}
		conn, encrypted = tlsConn, true
	}
	text := textproto.NewConn(conn)
	reply := func(line string) { _ = text.PrintfLine("%s", line) }
	record := func(line string) {
		s.mu.Lock()
		d.commands = append(d.commands, line)
		s.mu.Unlock()
	}
	reply("220 fake.example ESMTP")
	for {
		line, err := text.ReadLine()
		if err != nil {
			return
		}
		verb, rest, _ := strings.Cut(line, " ")
		switch strings.ToUpper(verb) {
		case "EHLO":
			record(line)
			lines := []string{"fake.example"}
			if s.startTLS && !encrypted {
				lines = append(lines, "STARTTLS")
			}
			if s.mechanisms != "" {
				lines = append(lines, "AUTH "+s.mechanisms)
			}
			for i, l := range lines {
				if i == len(lines)-1 {
					reply("250 " + l)
				} else {
					reply("250-" + l)
				}
			}
		case "STARTTLS":
			record(line)
			reply("220 go ahead")
			tlsConn := tls.Server(conn, s.tlsConfig())
			if tlsConn.Handshake() != nil {
				return
			}
			conn, encrypted = tlsConn, true
			text = textproto.NewConn(conn)
		case "AUTH":
			record("AUTH " + strings.Fields(rest)[0])
			s.mu.Lock()
			d.tlsAtAuth = encrypted
			s.mu.Unlock()
			decode := func(v string) string {
				b, _ := base64.StdEncoding.DecodeString(v)
				return string(b)
			}
			var user, pass string
			switch fields := strings.Fields(rest); strings.ToUpper(fields[0]) {
			case "PLAIN":
				parts := strings.Split(decode(fields[1]), "\x00")
				if len(parts) == 3 {
					user, pass = parts[1], parts[2]
				}
			case "LOGIN":
				reply("334 " + base64.StdEncoding.EncodeToString([]byte("Username:")))
				u, _ := text.ReadLine()
				reply("334 " + base64.StdEncoding.EncodeToString([]byte("Password:")))
				p, _ := text.ReadLine()
				user, pass = decode(u), decode(p)
			}
			s.mu.Lock()
			d.user, d.password = user, pass
			s.mu.Unlock()
			if user == s.user && pass == s.pass {
				reply("235 welcome")
			} else {
				reply("535 authentication failed")
			}
		case "MAIL":
			record(line)
			s.mu.Lock()
			d.from = strings.TrimSuffix(strings.TrimPrefix(strings.Fields(rest)[0], "FROM:<"), ">")
			s.mu.Unlock()
			reply("250 ok")
		case "RCPT":
			record(line)
			if s.rejectRcpt {
				// What real servers do: quote the address, in other cases,
				// next to bytes that are not UTF-8 and letters whose lower
				// case is longer or shorter than they are.
				reply("550 5.1.1 \xff\xff\xff\xff İȺ " + rest[3:] + ": no such mailbox \xff" + strings.ToUpper(rest[3:]) + "İ" + rest[4:len(rest)-1])
				continue
			}
			s.mu.Lock()
			d.to = append(d.to, strings.TrimSuffix(strings.TrimPrefix(rest, "TO:<"), ">"))
			s.mu.Unlock()
			reply("250 ok")
		case "DATA":
			record(line)
			if s.rejectData {
				reply("554 not today")
				continue
			}
			reply("354 go on")
			data, err := io.ReadAll(text.DotReader())
			if err != nil {
				return
			}
			if s.rejectBody {
				reply("554 message refused")
				continue
			}
			s.mu.Lock()
			d.data, d.tlsAtData, d.accepted = string(data), encrypted, true
			s.mu.Unlock()
			reply("250 queued")
		case "QUIT":
			record(line)
			reply("221 bye")
			return
		default:
			record(line)
			reply("502 not implemented")
		}
	}
}

func (s *fakeServer) sender(change func(*mail.SMTP)) *mail.SMTP {
	out := &mail.SMTP{Host: s.addr, Port: s.port(), From: from, User: s.user, Password: s.pass}
	out.TrustOnly(s.roots)
	if change != nil {
		change(out)
	}
	return out
}

// parts reads a delivered message: its headers, and the text and HTML
// bodies decoded.
func parts(t *testing.T, data string) (header netmail.Header, text, html string) {
	t.Helper()
	msg, err := netmail.ReadMessage(strings.NewReader(data))
	if err != nil {
		t.Fatalf("the delivered data is not a message: %v\n%s", err, data)
	}
	kind, params, err := mime.ParseMediaType(msg.Header.Get("Content-Type"))
	if err != nil || kind != "multipart/alternative" {
		t.Fatalf("Content-Type %q: %v", msg.Header.Get("Content-Type"), err)
	}
	reader := multipart.NewReader(msg.Body, params["boundary"])
	var kinds []string
	for {
		part, err := reader.NextRawPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		kinds = append(kinds, part.Header.Get("Content-Type"))
		if part.Header.Get("Content-Transfer-Encoding") != "quoted-printable" {
			t.Errorf("part %q is encoded as %q", part.Header.Get("Content-Type"), part.Header.Get("Content-Transfer-Encoding"))
		}
		// No raw line is longer than a mail line may be, and all is ASCII.
		raw, err := io.ReadAll(part)
		if err != nil {
			t.Fatal(err)
		}
		for _, line := range strings.Split(string(raw), "\n") {
			if len(strings.TrimSuffix(line, "\r")) > 76 {
				t.Errorf("a line of %d characters in the encoded body", len(line))
			}
		}
		if strings.ContainsFunc(string(raw), func(r rune) bool { return r > 126 }) {
			t.Error("the encoded body holds characters outside ASCII")
		}
		decoded, err := io.ReadAll(quotedprintable.NewReader(strings.NewReader(string(raw))))
		if err != nil {
			t.Fatal(err)
		}
		body := strings.ReplaceAll(string(decoded), "\r\n", "\n")
		if strings.HasPrefix(part.Header.Get("Content-Type"), "text/plain") {
			text = body
		} else {
			html = body
		}
	}
	if !slices.Equal(kinds, []string{"text/plain; charset=utf-8", "text/html; charset=utf-8"}) {
		t.Errorf("parts %v, want the text and then the HTML", kinds)
	}
	return msg.Header, text, html
}

func checkDelivered(t *testing.T, d *delivery) {
	t.Helper()
	if !d.accepted || d.from != from.Address || !slices.Equal(d.to, []string{message.To}) {
		t.Fatalf("delivery: accepted %v, from %q, to %v", d.accepted, d.from, d.to)
	}
	header, text, html := parts(t, d.data)
	if text != message.Text || html != message.HTML {
		t.Errorf("bodies arrived changed:\n%q\n%q", text, html)
	}
	decoder := new(mime.WordDecoder)
	if subject, err := decoder.DecodeHeader(header.Get("Subject")); err != nil || subject != message.Subject {
		t.Errorf("subject %q (%v)", subject, err)
	}
	if sender, err := netmail.ParseAddress(header.Get("From")); err != nil || *sender != from {
		t.Errorf("From %q (%v)", header.Get("From"), err)
	}
	if to, err := netmail.ParseAddress(header.Get("To")); err != nil || to.Address != message.To || to.Name != "" {
		t.Errorf("To %q (%v)", header.Get("To"), err)
	}
	if date, err := header.Date(); err != nil || time.Since(date) > time.Minute || time.Since(date) < -time.Minute {
		t.Errorf("Date %q (%v)", header.Get("Date"), err)
	}
	if id := header.Get("Message-ID"); !regexp.MustCompile(`^<[0-9a-f]{32}@example\.uz>$`).MatchString(id) {
		t.Errorf("Message-ID %q", id)
	}
	if header.Get("MIME-Version") != "1.0" {
		t.Errorf("MIME-Version %q", header.Get("MIME-Version"))
	}
	// Headers are ASCII on the wire.
	head, _, _ := strings.Cut(d.data, "\n\n")
	if strings.ContainsFunc(head, func(r rune) bool { return r > 126 }) {
		t.Errorf("the headers hold characters outside ASCII:\n%s", head)
	}
}

// ─── SMTP ────────────────────────────────────────────────────────────────

func TestSMTPWithSTARTTLSAndASignIn(t *testing.T) {
	t.Parallel()
	server := newFakeServer(t, func(s *fakeServer) { s.startTLS, s.mechanisms = true, "LOGIN PLAIN" })
	if err := server.sender(nil).Send(context.Background(), message); err != nil {
		t.Fatal(err)
	}
	all := server.all()
	if len(all) != 1 {
		t.Fatalf("%d connections", len(all))
	}
	d := all[0]
	checkDelivered(t, d)
	if !d.tlsAtAuth || !d.tlsAtData || d.user != "mailer" || d.password != "smtp pass-word" {
		t.Errorf("encrypted at sign-in %v, at data %v; signed in as %q", d.tlsAtAuth, d.tlsAtData, d.user)
	}
	if !slices.Contains(d.commands, "AUTH PLAIN") || d.commands[len(d.commands)-1] != "QUIT" {
		t.Errorf("commands %v", d.commands)
	}
	// Two messages: two ids.
	if err := server.sender(nil).Send(context.Background(), message); err != nil {
		t.Fatal(err)
	}
	first, _, _ := parts(t, server.all()[0].data)
	second, _, _ := parts(t, server.all()[1].data)
	if first.Get("Message-ID") == second.Get("Message-ID") {
		t.Error("two messages share a Message-ID")
	}
}

func TestSMTPWithTLSFromTheFirstByteAndTheLoginMethod(t *testing.T) {
	t.Parallel()
	server := newFakeServer(t, func(s *fakeServer) { s.implicitTLS, s.mechanisms = true, "LOGIN" })
	if err := server.sender(func(s *mail.SMTP) { s.Secure = true }).Send(context.Background(), message); err != nil {
		t.Fatal(err)
	}
	d := server.all()[0]
	checkDelivered(t, d)
	if !d.tlsAtAuth || !d.tlsAtData || d.user != "mailer" || d.password != "smtp pass-word" || !slices.Contains(d.commands, "AUTH LOGIN") {
		t.Errorf("encrypted %v/%v, user %q, commands %v", d.tlsAtAuth, d.tlsAtData, d.user, d.commands)
	}
	if slices.Contains(d.commands, "STARTTLS") {
		t.Error("STARTTLS on a connection that is TLS already")
	}
}

func TestSMTPToALocalRelayWithoutTLSOrSignIn(t *testing.T) {
	t.Parallel()
	server := newFakeServer(t, func(s *fakeServer) {})
	for _, host := range []string{"127.0.0.1", "localhost"} {
		if err := server.sender(func(s *mail.SMTP) { s.Host, s.User, s.Password = host, "", "" }).Send(context.Background(), message); err != nil {
			t.Fatalf("%s: %v", host, err)
		}
	}
	d := server.all()[0]
	checkDelivered(t, d)
	if d.tlsAtData || slices.ContainsFunc(d.commands, func(c string) bool { return strings.HasPrefix(c, "AUTH") }) {
		t.Errorf("commands %v", d.commands)
	}
}

// nothingSent: the server saw no sign-in, no envelope and no message.
func nothingSent(t *testing.T, server *fakeServer) {
	t.Helper()
	for _, d := range server.all() {
		if d.accepted || d.user != "" || d.password != "" {
			t.Errorf("the server got a message or credentials: accepted %v, user %q", d.accepted, d.user)
		}
		for _, c := range d.commands {
			if verb := strings.ToUpper(strings.Fields(c)[0]); verb == "AUTH" || verb == "MAIL" || verb == "RCPT" || verb == "DATA" {
				t.Errorf("the server got %q", c)
			}
		}
	}
}

func TestSMTPRefusesToGoOnUnencryptedWhenTLSIsRequired(t *testing.T) {
	t.Parallel()
	// A server that is not on this machine and offers no STARTTLS: nothing
	// goes, without any setting asking for it.
	server := newFakeServer(t, func(s *fakeServer) { s.addr, s.mechanisms = "127.0.0.2", "PLAIN" })
	err := server.sender(nil).Send(context.Background(), message)
	if err == nil || !strings.Contains(err.Error(), "STARTTLS") {
		t.Fatalf("err %v", err)
	}
	nothingSent(t, server)
	// Without credentials either: the message itself holds the link.
	err = server.sender(func(s *mail.SMTP) { s.User, s.Password = "", "" }).Send(context.Background(), message)
	if err == nil || !strings.Contains(err.Error(), "STARTTLS") {
		t.Fatalf("without credentials: err %v", err)
	}
	nothingSent(t, server)
}

func TestSMTPVerifiesTheServerCertificate(t *testing.T) {
	t.Parallel()
	for _, implicit := range []bool{false, true} {
		server := newFakeServer(t, func(s *fakeServer) { s.implicitTLS, s.startTLS, s.mechanisms = implicit, !implicit, "PLAIN" })
		// The client does not trust the authority that signed the server's
		// certificate: it stops before anything is sent.
		err := server.sender(func(s *mail.SMTP) {
			s.Secure = implicit
			s.TrustOnly(x509.NewCertPool())
		}).Send(context.Background(), message)
		if err == nil || !strings.Contains(err.Error(), "certificate") {
			t.Errorf("implicit TLS %v: err %v", implicit, err)
		}
		nothingSent(t, server)
	}
}

func TestSMTPSignInFailures(t *testing.T) {
	t.Parallel()
	// A wrong password.
	server := newFakeServer(t, func(s *fakeServer) { s.startTLS, s.mechanisms = true, "PLAIN" })
	err := server.sender(func(s *mail.SMTP) { s.Password = "wrong" }).Send(context.Background(), message)
	if err == nil || strings.Contains(err.Error(), "wrong") {
		t.Errorf("wrong password: err %v", err)
	}
	if d := server.all()[0]; d.accepted || d.from != "" {
		t.Error("a message went out after a refused sign-in")
	}
	// Credentials configured and no sign-in on offer: the message does not
	// go out unsigned.
	server = newFakeServer(t, func(s *fakeServer) { s.startTLS = true })
	if err := server.sender(nil).Send(context.Background(), message); err == nil {
		t.Error("sent without the configured sign-in")
	}
	nothingSent(t, server)
	// A method this client does not know.
	server = newFakeServer(t, func(s *fakeServer) { s.startTLS, s.mechanisms = true, "XOAUTH2 GSSAPI" })
	if err := server.sender(nil).Send(context.Background(), message); err == nil {
		t.Error("sent although no known sign-in method was offered")
	}
	nothingSent(t, server)
}

// The address is replaced however the text around it is written: bytes
// that are not UTF-8 and letters whose lower case has another length do
// not move it.
func TestErrorsNeverShowTheRecipient(t *testing.T) {
	t.Parallel()
	const to = "aziza@example.uz"
	for text, want := range map[string]string{
		"550 \xff\xff\xff\xffaziza@example.uz":       "550 \xff\xff\xff\xff[recipient]",
		"550 \xff\xff <aziza@example.uz>: unknown":   "550 \xff\xff <[recipient]>: unknown",
		"550 İȺ AZIZA@Example.UZ, aziza@example.uz.": "550 İȺ [recipient], [recipient].",
		"550 aziza@example.uzİaziza@example.uz":      "550 [recipient]İ[recipient]",
		"550 azizaaziza@example.uz":                  "550 aziza[recipient]",
		"550 no address here, İ \xff":                "550 no address here, İ \xff",
		"":                                           "",
	} {
		got := mail.WithoutAddress(errors.New(text), to)
		if got.Error() != want {
			t.Errorf("%q → %q, want %q", text, got.Error(), want)
		}
		if !errors.Is(got, got) || errors.Unwrap(got) == nil {
			t.Errorf("%q: the cause is not kept", text)
		}
	}
	// An address stored with capitals (an old account) is found in any case.
	if got := mail.WithoutAddress(errors.New("550 aziza@example.uz, AZIZA@EXAMPLE.UZ"), "Aziza@Example.uz").Error(); got != "550 [recipient], [recipient]" {
		t.Errorf("mixed-case address: %q", got)
	}
}

// The LOGIN method gives the credentials only over TLS or to this machine,
// and only to the server it was made for.
func TestTheLoginMethodProtectsTheCredentials(t *testing.T) {
	t.Parallel()
	auth := mail.LoginAuth("mailer", "pw", "smtp.example.uz")
	for name, c := range map[string]struct {
		server smtp.ServerInfo
		ok     bool
	}{
		"remote over TLS":       {smtp.ServerInfo{Name: "smtp.example.uz", TLS: true}, true},
		"remote without TLS":    {smtp.ServerInfo{Name: "smtp.example.uz"}, false},
		"another host over TLS": {smtp.ServerInfo{Name: "evil.example", TLS: true}, false},
	} {
		if _, _, err := auth.Start(&c.server); (err == nil) != c.ok {
			t.Errorf("%s: err %v", name, err)
		}
	}
	if _, _, err := mail.LoginAuth("mailer", "pw", "localhost").Start(&smtp.ServerInfo{Name: "localhost"}); err != nil {
		t.Errorf("a relay on this machine: %v", err)
	}
	if _, err := auth.Next([]byte("Something else:"), true); err == nil {
		t.Error("an unexpected challenge was answered")
	}
}

func TestSMTPServerRefusals(t *testing.T) {
	t.Parallel()
	for name, configure := range map[string]func(*fakeServer){
		"recipient":           func(s *fakeServer) { s.rejectRcpt = true },
		"message":             func(s *fakeServer) { s.rejectData = true },
		"message, at its end": func(s *fakeServer) { s.rejectBody = true },
	} {
		server := newFakeServer(t, func(s *fakeServer) {
			s.startTLS, s.mechanisms = true, "PLAIN"
			configure(s)
		})
		err := server.sender(nil).Send(context.Background(), message)
		if err == nil {
			t.Errorf("%s refused by the server: no error", name)
			continue
		}
		if text := err.Error(); strings.Contains(strings.ToLower(text), message.To) || strings.Contains(strings.ToUpper(text), strings.ToUpper(message.To)) ||
			strings.Contains(text, "aziza") || strings.Contains(text, "AZIZA") || strings.Contains(text, "PANIC") ||
			strings.Contains(text, "token=") || strings.Contains(text, "smtp pass-word") {
			t.Errorf("%s: the error shows the recipient, the link or the password: %v", name, err)
		}
		if name == "recipient" && (strings.Count(err.Error(), "[recipient]") != 3 || !strings.Contains(err.Error(), "İ[recipient]\"")) {
			t.Errorf("the address is not replaced exactly where it was: %q", err.Error())
		}
		if server.all()[0].accepted {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestSMTPGivesUpWithTheContext(t *testing.T) {
	t.Parallel()
	server := newFakeServer(t, func(s *fakeServer) { s.silent = true })
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	start := time.Now()
	err := server.sender(nil).Send(ctx, message)
	if err == nil || time.Since(start) > 5*time.Second {
		t.Fatalf("err %v after %s", err, time.Since(start))
	}
	// Nobody listening at all.
	gone := &mail.SMTP{Host: "127.0.0.1", Port: server.port(), From: from}
	_ = server.listener.Close()
	if err := gone.Send(context.Background(), message); err == nil {
		t.Error("no server: no error")
	}
}

func TestOnlyOnePlainRecipientAndOneLineSubject(t *testing.T) {
	t.Parallel()
	server := newFakeServer(t, func(s *fakeServer) {})
	dir := t.TempDir()
	senders := map[string]mail.Sender{
		"smtp":   server.sender(func(s *mail.SMTP) { s.User, s.Password = "", "" }),
		"outbox": &mail.Outbox{Dir: dir, From: from},
	}
	for _, to := range []string{
		"", "aziza", "aziza@example.uz\r\nBcc: evil@example.org", "aziza@example.uz, evil@example.org",
		"Aziza <aziza@example.uz>", "<aziza@example.uz>", " aziza@example.uz", "aziza@example.uz\n", "ўзбек@example.uz",
	} {
		m := message
		m.To = to
		for name, sender := range senders {
			if err := sender.Send(context.Background(), m); err == nil {
				t.Errorf("%s: sent to %q", name, to)
			}
		}
	}
	m := message
	m.Subject = "Salom\r\nBcc: evil@example.org"
	if err := senders["smtp"].Send(context.Background(), m); err == nil {
		t.Error("a subject of two lines was sent")
	}
	if n := len(server.all()); n != 0 {
		t.Errorf("%d connections for messages that must not leave", n)
	}
	if files, _ := os.ReadDir(dir); len(files) != 0 {
		t.Errorf("%d files written for messages that must not leave", len(files))
	}
}

// ─── Outbox ──────────────────────────────────────────────────────────────

func TestTheOutboxWritesOneFilePerMessageInTheNextJSFormat(t *testing.T) {
	t.Parallel()
	dir := filepath.Join(t.TempDir(), "made", "on", "demand")
	outbox := &mail.Outbox{Dir: dir, From: netmail.Address{Name: "Lookly", Address: "no-reply@localhost"}}
	before := time.Now().Add(-time.Second)
	for range 3 {
		if err := outbox.Send(context.Background(), message); err != nil {
			t.Fatal(err)
		}
	}
	if info, err := os.Stat(dir); err != nil {
		t.Fatal(err)
	} else if info.Mode().Perm() != 0o700 {
		t.Fatalf("directory mode %v", info.Mode().Perm())
	}
	files, err := os.ReadDir(dir)
	if err != nil || len(files) != 3 {
		t.Fatalf("%d files (%v)", len(files), err)
	}
	var stamps []int64
	for _, file := range files { // ReadDir sorts by name, as the e2e specs do
		m := regexp.MustCompile(`^(\d{13})-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$`).FindStringSubmatch(file.Name())
		if m == nil {
			t.Fatalf("file name %q", file.Name())
		}
		stamp, _ := strconv.ParseInt(m[1], 10, 64)
		stamps = append(stamps, stamp)
		info, err := file.Info()
		if err != nil {
			t.Fatal(err)
		} else if info.Mode().Perm() != 0o600 {
			t.Errorf("%s: mode %v", file.Name(), info.Mode().Perm())
		}
		raw, err := os.ReadFile(filepath.Join(dir, file.Name()))
		if err != nil {
			t.Fatal(err)
		}
		// The members, in the Next.js order; the HTML as it is.
		var order []string
		dec := json.NewDecoder(strings.NewReader(string(raw)))
		if _, err := dec.Token(); err != nil {
			t.Fatal(err)
		}
		for dec.More() {
			key, _ := dec.Token()
			order = append(order, key.(string))
			var skip any
			if err := dec.Decode(&skip); err != nil {
				t.Fatal(err)
			}
		}
		if !slices.Equal(order, []string{"from", "to", "subject", "text", "html", "createdAt"}) {
			t.Errorf("members %v", order)
		}
		var record map[string]string
		if err := json.Unmarshal(raw, &record); err != nil {
			t.Fatal(err)
		}
		if record["from"] != "Lookly <no-reply@localhost>" || record["to"] != message.To || record["subject"] != message.Subject || record["text"] != message.Text || record["html"] != message.HTML {
			t.Errorf("record %v", record)
		}
		created, err := time.Parse("2006-01-02T15:04:05.000Z", record["createdAt"])
		if err != nil || created.Before(before) || created.After(time.Now().Add(time.Second)) || created.UnixMilli() != stamp {
			t.Errorf("createdAt %q (%v), file stamp %d", record["createdAt"], err, stamp)
		}
		if !strings.Contains(string(raw), `<p><a href=\"https://`) || !strings.HasPrefix(string(raw), "{\n  \"from\": ") || strings.HasSuffix(string(raw), "\n") {
			t.Errorf("the file is not written as JSON.stringify(record, null, 2) writes it:\n%s", raw)
		}
		// What the e2e specs do with it.
		if link := regexp.MustCompile(`https?://\S+`).FindString(record["text"]); !strings.HasPrefix(link, "https://lookly.example.uz/reset-password?token=Ab0_-") {
			t.Errorf("link %q", link)
		}
	}
	if !slices.IsSorted(stamps) {
		t.Errorf("file names do not sort by time: %v", stamps)
	}
	// A sender without a name.
	bare := &mail.Outbox{Dir: t.TempDir(), From: netmail.Address{Address: "no-reply@localhost"}}
	if err := bare.Send(context.Background(), message); err != nil {
		t.Fatal(err)
	}
	files, _ = os.ReadDir(bare.Dir)
	raw, _ := os.ReadFile(filepath.Join(bare.Dir, files[0].Name()))
	if !strings.Contains(string(raw), `"from": "no-reply@localhost"`) {
		t.Errorf("bare sender: %s", raw)
	}
	// A directory that cannot be made is an error.
	blocked := filepath.Join(bare.Dir, files[0].Name(), "under-a-file")
	if err := (&mail.Outbox{Dir: blocked, From: from}).Send(context.Background(), message); err == nil {
		t.Error("an outbox under a file: no error")
	}
}

func TestManyMessagesAtOnceGetTheirOwnFiles(t *testing.T) {
	t.Parallel()
	outbox := &mail.Outbox{Dir: t.TempDir(), From: from}
	var wg sync.WaitGroup
	for range 40 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := outbox.Send(context.Background(), message); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if files, _ := os.ReadDir(outbox.Dir); len(files) != 40 {
		t.Errorf("%d files for 40 messages", len(files))
	}
}

// ─── Choosing the sender ─────────────────────────────────────────────────

func TestTheConfiguredSender(t *testing.T) {
	t.Parallel()
	if err := mail.New(config.Mail{Transport: config.MailDisabled}).Send(context.Background(), message); !errors.Is(err, mail.ErrDisabled) {
		t.Errorf("disabled: err %v", err)
	}
	if err := mail.New(config.Mail{}).Send(context.Background(), message); !errors.Is(err, mail.ErrDisabled) {
		t.Errorf("nothing configured: err %v", err)
	}
	dir := t.TempDir()
	if err := mail.New(config.Mail{Transport: config.MailOutbox, OutboxDir: dir, From: from}).Send(context.Background(), message); err != nil {
		t.Fatal(err)
	}
	if files, _ := os.ReadDir(dir); len(files) != 1 {
		t.Errorf("%d files in the configured outbox", len(files))
	}
	smtpSender, ok := mail.New(config.Mail{Transport: config.MailSMTP, Host: "smtp.example.uz", Port: 2525, Secure: true, User: "u", Password: "p", From: from}).(*mail.SMTP)
	if !ok || smtpSender.Host != "smtp.example.uz" || smtpSender.Port != 2525 || !smtpSender.Secure || smtpSender.User != "u" || smtpSender.Password != "p" || smtpSender.From != from {
		t.Errorf("smtp sender %+v", smtpSender)
	}
}
