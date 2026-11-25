package session

// EncryptSuccessorWithNonce lets a test reproduce a recorded ciphertext.
func EncryptSuccessorWithNonce(token, aad string, keys Keys, nonce []byte) string {
	return encryptSuccessor(token, aad, keys, nonce)
}
