package storage

import (
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
)

// The examples of AWS's own documentation of Signature Version 4 for S3
// ("Authenticating Requests: Using the Authorization Header"), with its
// example credentials: the signatures are the documentation's.
func TestSignatureVersion4MatchesTheDocumentedExamples(t *testing.T) {
	t.Parallel()
	c := credentials{accessKeyID: "AKIAIOSFODNN7EXAMPLE", secret: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1"}
	at := time.Date(2013, 5, 24, 0, 0, 0, 0, time.UTC)
	const emptyPayload = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
	cases := []struct {
		name, method, url, payload string
		headers                    map[string]string
		signedHeaders, signature   string
	}{
		{
			name: "GET Object", method: http.MethodGet, url: "https://examplebucket.s3.amazonaws.com/test.txt", payload: emptyPayload,
			headers:       map[string]string{"Range": "bytes=0-9"},
			signedHeaders: "host;range;x-amz-content-sha256;x-amz-date",
			signature:     "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
		},
		{
			name: "PUT Object", method: http.MethodPut, url: "https://examplebucket.s3.amazonaws.com/test$file.text",
			payload:       hexSHA256([]byte("Welcome to Amazon S3.")),
			headers:       map[string]string{"Date": "Fri, 24 May 2013 00:00:00 GMT", "x-amz-storage-class": "REDUCED_REDUNDANCY"},
			signedHeaders: "date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class",
			signature:     "98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd",
		},
		{
			name: "GET Bucket Lifecycle", method: http.MethodGet, url: "https://examplebucket.s3.amazonaws.com/?lifecycle", payload: emptyPayload,
			signedHeaders: "host;x-amz-content-sha256;x-amz-date",
			signature:     "fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543",
		},
		{
			name: "Get Bucket (List Objects)", method: http.MethodGet, url: "https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J", payload: emptyPayload,
			signedHeaders: "host;x-amz-content-sha256;x-amz-date",
			signature:     "34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7",
		},
	}
	for _, tc := range cases {
		r, err := http.NewRequest(tc.method, tc.url, nil)
		if err != nil {
			t.Fatal(err)
		}
		for name, value := range tc.headers {
			r.Header.Set(name, value)
		}
		// What the HTTP client adds later is not part of the signature.
		r.Header.Set("User-Agent", "lookly-test")
		c.sign(r, tc.payload, at)
		want := "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=" + tc.signedHeaders + ", Signature=" + tc.signature
		if got := r.Header.Get("Authorization"); got != want {
			t.Errorf("%s:\n got %s\nwant %s", tc.name, got, want)
		}
		if r.Header.Get("X-Amz-Date") != "20130524T000000Z" || r.Header.Get("X-Amz-Content-Sha256") != tc.payload {
			t.Errorf("%s: date %q, payload hash %q", tc.name, r.Header.Get("X-Amz-Date"), r.Header.Get("X-Amz-Content-Sha256"))
		}
		if strings.Contains(r.Header.Get("Authorization"), c.secret) {
			t.Errorf("%s: the secret is in the header", tc.name)
		}
	}
}

func TestAWSEscape(t *testing.T) {
	t.Parallel()
	for in, want := range map[string]string{
		"users":          "users",
		"A-z_0.9~":       "A-z_0.9~",
		"a b":            "a%20b",
		"a+b&c=d":        "a%2Bb%26c%3Dd",
		"test$file.text": "test%24file.text",
		"ko‘ylak":        "ko%E2%80%98ylak",
		"a/b":            "a%2Fb",
		"100%":           "100%25",
		"":               "",
		"\x00\xff":       "%00%FF",
		"*'()!":          "%2A%27%28%29%21",
	} {
		if got := awsEscape(in); got != want {
			t.Errorf("%q: %q, want %q", in, got, want)
		}
	}
}

// The path and the query as they are signed, by the rules of the
// specification (not by this code's own helpers).
func TestCanonicalPathAndQuery(t *testing.T) {
	t.Parallel()
	query := url.Values{"prefix": {"users/u_one/"}, "list-type": {"2"}, "continuation-token": {"a+b/c= d"}, "max-keys": {"1000"}, "empty": {""}}
	if got, want := canonicalQuery(query), "continuation-token=a%2Bb%2Fc%3D%20d&empty=&list-type=2&max-keys=1000&prefix=users%2Fu_one%2F"; got != want {
		t.Errorf("query %q, want %q", got, want)
	}
	// By name, then by value: not by the pairs as text ("a-b=" sorts before
	// "a=" there).
	if got, want := canonicalQuery(url.Values{"a": {"2", "1"}, "a-b": {"1"}, "A": {"x"}, "a b": {"0"}}), "A=x&a=1&a=2&a%20b=0&a-b=1"; got != want {
		t.Errorf("query %q, want %q", got, want)
	}
	if got := canonicalQuery(nil); got != "" {
		t.Errorf("no query: %q", got)
	}
	for path, want := range map[string]string{
		"":                                 "/",
		"/":                                "/",
		"/bucket":                          "/bucket",
		"/bucket/users/u_one/a b+c&d=e%.x": "/bucket/users/u_one/a%20b%2Bc%26d%3De%25.x",
		"/bucket/users/u/ko‘ylak.jpg":      "/bucket/users/u/ko%E2%80%98ylak.jpg",
	} {
		if got := canonicalPath(&url.URL{Path: path}); got != want {
			t.Errorf("path %q: %q, want %q", path, got, want)
		}
	}
}

// White space around a header's value and runs of it inside are not part
// of what is signed; anything else is.
func TestSignedHeaderValuesAreTrimmedAndCollapsed(t *testing.T) {
	t.Parallel()
	c := credentials{accessKeyID: "k", secret: "s", region: "auto"}
	at := time.Date(2026, 11, 26, 10, 0, 0, 0, time.UTC)
	signature := func(value string) string {
		r, _ := http.NewRequest(http.MethodGet, "https://host.example/bucket/key", nil)
		r.Header.Set("X-Amz-Meta-Note", value)
		c.sign(r, hexSHA256(nil), at)
		return r.Header.Get("Authorization")
	}
	if signature("a b") != signature("  a   b ") {
		t.Error("white space changes the signature")
	}
	if signature("a b") == signature("ab") || signature("a b") == signature("a c") {
		t.Error("the value does not change the signature")
	}
}
