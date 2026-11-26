package mail

import (
	"crypto/x509"
	"net/smtp"
)

// TrustOnly makes the sender trust these certificate authorities instead
// of the system's.
func (s *SMTP) TrustOnly(pool *x509.CertPool) { s.rootCAs = pool }

// LoginAuth is the LOGIN sign-in method.
func LoginAuth(user, password, host string) smtp.Auth {
	return &loginAuth{user: user, password: password, host: host}
}
