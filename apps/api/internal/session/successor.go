package session

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"strings"
)

// The successor refresh token kept on a rotated session row
// (Session.successorTokenEnc), encrypted so that a grace replay can return
// the same successor without the token ever being stored in the clear.
//
// AES-256-GCM with a random 96-bit nonce. The additional data binds the
// value to its two rows: copied onto another row it does not decrypt.
// Format, shared with the Next.js API:
//
//	v1.<keyId>.<nonce>.<ciphertext>.<tag>
//
// The parts are unpadded base64url; keyId is the first 8 hex digits of the
// key's SHA-256.

const (
	successorVersion = "v1"
	keyBytes         = 32
	nonceBytes       = 12
	tagBytes         = 16
)

// Keys are the session encryption keys, each 32 bytes (config checks this).
type Keys struct {
	Active      []byte   // encrypts new values, and decrypts
	DecryptOnly [][]byte // older keys during a staged rotation
}

// SuccessorAAD is the additional data of the ciphertext stored on the
// rotated session for its successor.
func SuccessorAAD(rotatedSessionID, successorSessionID string) string {
	return rotatedSessionID + "|" + successorSessionID
}

// EncryptSuccessor encrypts a refresh token with the active key.
func EncryptSuccessor(token, aad string, keys Keys) string {
	nonce := make([]byte, nonceBytes)
	rand.Read(nonce) // never fails (crypto/rand aborts the program instead)
	return encryptSuccessor(token, aad, keys, nonce)
}

func encryptSuccessor(token, aad string, keys Keys, nonce []byte) string {
	sealed := gcm(keys.Active).Seal(nil, nonce, []byte(token), []byte(aad))
	ct, tag := sealed[:len(sealed)-tagBytes], sealed[len(sealed)-tagBytes:]
	enc := base64.RawURLEncoding
	return strings.Join([]string{
		successorVersion, keyID(keys.Active), enc.EncodeToString(nonce), enc.EncodeToString(ct), enc.EncodeToString(tag),
	}, ".")
}

// DecryptSuccessor returns the token, or false when the value is malformed,
// tampered with, bound to other rows, or encrypted with a key we do not
// have. The key id only decides which key is tried first, as in the Next.js
// API: a value whose id names no key is still tried against all of them.
func DecryptSuccessor(value, aad string, keys Keys) (string, bool) {
	parts := strings.Split(value, ".")
	if len(parts) != 5 || parts[0] != successorVersion {
		return "", false
	}
	enc := base64.RawURLEncoding.Strict()
	nonce, err1 := enc.DecodeString(parts[2])
	ct, err2 := enc.DecodeString(parts[3])
	tag, err3 := enc.DecodeString(parts[4])
	if err1 != nil || err2 != nil || err3 != nil || len(nonce) != nonceBytes || len(tag) != tagBytes {
		return "", false
	}
	sealed := append(ct, tag...)

	candidates := append([][]byte{keys.Active}, keys.DecryptOnly...)
	for _, named := range []bool{true, false} {
		for _, key := range candidates {
			if (keyID(key) == parts[1]) != named {
				continue
			}
			if plain, err := gcm(key).Open(nil, nonce, sealed, []byte(aad)); err == nil {
				return string(plain), true
			}
		}
	}
	return "", false
}

func keyID(key []byte) string {
	sum := sha256.Sum256(key)
	return hex.EncodeToString(sum[:4])
}

// gcm panics on a key of the wrong length: configuration validates the keys
// at startup, so that is a programming error, never a runtime condition.
func gcm(key []byte) cipher.AEAD {
	if len(key) != keyBytes {
		panic("session: encryption key is not 32 bytes")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		panic(err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		panic(err)
	}
	return aead
}
