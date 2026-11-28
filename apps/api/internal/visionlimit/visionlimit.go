// Package visionlimit holds the limits of a picture sent to a vision model,
// in one place for the three packages that apply them: the configuration
// (AI_VISION_MAX_SIDE), the preparation of the picture (imaging) and the
// last check before a provider is called (ai).
package visionlimit

const (
	// MaxSide is the largest longest side, in pixels, a model is sent.
	MaxSide = 2048
	// MinConfiguredSide is the smallest longest side AI_VISION_MAX_SIDE may
	// ask for.
	MinConfiguredSide = 256
	// MaxBytes bounds the picture sent inline (base64 makes it a third
	// larger on the wire).
	MaxBytes = 4 << 20
)
