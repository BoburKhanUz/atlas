package imaging

// Guarded runs a decoder as the package runs its decoders, and gives the
// refusal a failed one becomes.
func Guarded(decoder func() (int, error)) error {
	if _, err := guarded(decoder); err != nil {
		return unreadable(err)
	}
	return nil
}
