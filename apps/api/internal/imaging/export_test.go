package imaging

import "image"

// NewProcessorWithDecoders is a Processor whose decoders are replaced (nil:
// the standard one): for what the package does with a decoder that fails
// in ways no file we have makes the real ones fail.
func NewProcessorWithDecoders(n int, config func([]byte) (image.Config, error), pixels func([]byte) (image.Image, error)) *Processor {
	p := NewProcessor(n)
	if config != nil {
		p.d.config = func(_ Format, data []byte) (image.Config, error) { return config(data) }
	}
	if pixels != nil {
		p.d.pixels = func(_ Format, data []byte) (image.Image, error) { return pixels(data) }
	}
	return p
}
