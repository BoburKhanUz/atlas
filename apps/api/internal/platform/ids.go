// Package platform holds small helpers several domain packages share.
package platform

import (
	"crypto/rand"
	"math/big"
)

const idAlphabet = "abcdefghijklmnopqrstuvwxyz0123456789"

// NewID returns a new primary key: "c" and 24 random characters of
// [a-z0-9] (about 124 bits). It has the shape of the cuid values Prisma
// generated for the same tables, which the Next.js API still writes until
// the cutover; the database generates ids from B7 on.
func NewID() string {
	const n = 24
	id := make([]byte, 1, 1+n)
	id[0] = 'c'
	limit := big.NewInt(int64(len(idAlphabet)))
	for range n {
		// rand.Int draws without modulo bias; crypto/rand never fails.
		i, err := rand.Int(rand.Reader, limit)
		if err != nil {
			panic(err)
		}
		id = append(id, idAlphabet[i.Int64()])
	}
	return string(id)
}
