package storage

import (
	"cmp"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"
)

// credentials sign requests to an S3-compatible service.
type credentials struct {
	accessKeyID string
	secret      string // never logged, never part of an error
	region      string
}

// unsignedHeaders are set by the HTTP client after signing, or say nothing
// about the request's meaning.
var unsignedHeaders = []string{"authorization", "user-agent", "accept-encoding", "content-length"}

// sign adds AWS Signature Version 4 to the request (header
// authentication, service "s3"): the x-amz-date and x-amz-content-sha256
// headers and Authorization, over the method, the path, the query, the
// host, every other header set so far and the payload's SHA-256.
// https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
func (c credentials) sign(r *http.Request, payloadSHA256 string, now time.Time) {
	now = now.UTC()
	date, stamp := now.Format("20060102"), now.Format("20060102T150405Z")
	r.Header.Set("X-Amz-Date", stamp)
	r.Header.Set("X-Amz-Content-Sha256", payloadSHA256)

	headers := map[string]string{"host": r.Host}
	if r.Host == "" {
		headers["host"] = r.URL.Host
	}
	for name, values := range r.Header {
		lower := strings.ToLower(name)
		if !slices.Contains(unsignedHeaders, lower) {
			headers[lower] = strings.Join(trimmed(values), ",")
		}
	}
	names := make([]string, 0, len(headers))
	for name := range headers {
		names = append(names, name)
	}
	slices.Sort(names)
	var canonicalHeaders strings.Builder
	for _, name := range names {
		canonicalHeaders.WriteString(name + ":" + headers[name] + "\n")
	}
	signedHeaders := strings.Join(names, ";")

	canonicalRequest := strings.Join([]string{
		r.Method, canonicalPath(r.URL), canonicalQuery(r.URL.Query()), canonicalHeaders.String(), signedHeaders, payloadSHA256,
	}, "\n")
	scope := date + "/" + c.region + "/s3/aws4_request"
	toSign := "AWS4-HMAC-SHA256\n" + stamp + "\n" + scope + "\n" + hexSHA256([]byte(canonicalRequest))

	key := hmacSHA256([]byte("AWS4"+c.secret), date)
	for _, part := range []string{c.region, "s3", "aws4_request"} {
		key = hmacSHA256(key, part)
	}
	signature := hex.EncodeToString(hmacSHA256(key, toSign))
	r.Header.Set("Authorization", "AWS4-HMAC-SHA256 Credential="+c.accessKeyID+"/"+scope+", SignedHeaders="+signedHeaders+", Signature="+signature)
}

func trimmed(values []string) []string {
	out := make([]string, len(values))
	for i, v := range values {
		out[i] = strings.Join(strings.Fields(v), " ") // trimmed, inner runs of spaces as one
	}
	return out
}

// canonicalPath is the request's path with each segment percent-encoded as
// S3 does it (once; only A-Z a-z 0-9 - . _ ~ stay).
func canonicalPath(u *url.URL) string {
	segments := strings.Split(u.Path, "/")
	for i, s := range segments {
		segments[i] = awsEscape(s)
	}
	if path := strings.Join(segments, "/"); path != "" {
		return path
	}
	return "/"
}

// canonicalQuery is the query's parameters sorted by name (then value),
// each percent-encoded.
func canonicalQuery(query url.Values) string {
	type pair struct{ name, value string }
	var pairs []pair
	for name, values := range query {
		for _, v := range values {
			pairs = append(pairs, pair{awsEscape(name), awsEscape(v)})
		}
	}
	// By the encoded name, then by the encoded value.
	slices.SortFunc(pairs, func(a, b pair) int {
		return cmp.Or(strings.Compare(a.name, b.name), strings.Compare(a.value, b.value))
	})
	joined := make([]string, len(pairs))
	for i, p := range pairs {
		joined[i] = p.name + "=" + p.value
	}
	return strings.Join(joined, "&")
}

// awsEscape percent-encodes every byte but the unreserved characters of
// RFC 3986, with upper-case hexadecimal digits.
func awsEscape(s string) string {
	const hexDigits = "0123456789ABCDEF"
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-' || c == '.' || c == '_' || c == '~' {
			b.WriteByte(c)
		} else {
			b.WriteByte('%')
			b.WriteByte(hexDigits[c>>4])
			b.WriteByte(hexDigits[c&15])
		}
	}
	return b.String()
}

func hmacSHA256(key []byte, data string) []byte {
	m := hmac.New(sha256.New, key)
	m.Write([]byte(data))
	return m.Sum(nil)
}

func hexSHA256(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
