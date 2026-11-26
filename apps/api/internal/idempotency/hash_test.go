package idempotency_test

import (
	"encoding/base64"
	"testing"

	"lookly/internal/golden"
	"lookly/internal/idempotency"
)

// A retry may reach the other server: both must hash a request alike.
func TestMultipartHashIsTheNextServers(t *testing.T) {
	t.Parallel()
	for _, c := range golden.LoadIdempotency(t).Cases {
		file, err := base64.StdEncoding.DecodeString(c.FileBase64)
		if err != nil {
			t.Fatal(err)
		}
		if got := idempotency.MultipartHash(file, c.Filename, c.Fields); got != c.Hash {
			t.Errorf("%s: %s, want %s", c.Name, got, c.Hash)
		}
	}
}
