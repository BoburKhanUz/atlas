// Package ai is the provider layer: one way to ask a text model or a vision
// model, whoever serves it (Gemini, OpenAI, the mock), with the attempt's
// time limit, one retry and a fixed classification of failures. It is the
// Next.js provider layer (apps/web/src/lib/ai/providers and client.ts),
// held to it by testdata/golden/ai-providers.json. Nothing here knows a
// prompt: the features (stylist, outfits, garment analysis) build their
// requests and judge the answers.
package ai

import (
	"context"
	"encoding/json"
	"time"

	"lookly/internal/visionlimit"
)

// Feature is a product feature that calls AI: for the monitoring and the
// quotas.
type Feature string

// The features.
const (
	StylistChat       Feature = "stylist_chat"
	OutfitExplanation Feature = "outfit_explanation"
	ClothingAnalysis  Feature = "clothing_analysis"
	ColorAnalysis     Feature = "color_analysis"
)

// Message is one turn of a conversation with a text model.
type Message struct {
	Role    string // system | user | assistant
	Content string
}

// Schema is a JSON Schema the provider must hold its output to.
type Schema struct {
	// Name is sent to providers that want one (letters, digits, _ and -).
	Name string
	// Schema is the schema's JSON, written as the feature wrote it.
	Schema json.RawMessage
}

// Usage is the token counts a provider reported; nil: not reported.
type Usage struct {
	InputTokens  *float64
	OutputTokens *float64
	TotalTokens  *float64
}

// Metadata says who answered.
type Metadata struct {
	Provider string
	Model    string
	Usage    Usage
}

// TextRequest is a question to a text model.
type TextRequest struct {
	Messages        []Message
	Temperature     *float64
	MaxOutputTokens *int
	// JSONSchema, when set, makes the answer JSON of this schema (the
	// feature still validates it).
	JSONSchema *Schema
	// Timeout is the time limit of one attempt (0: the route's own).
	Timeout time.Duration
}

// TextResult is a text model's answer. With a schema, Text is JSON.
type TextResult struct {
	Text     string
	Metadata Metadata
}

// VisionOptions are provider-specific image settings; each adapter reads
// its own.
type VisionOptions struct {
	GeminiMediaResolution string // low | medium | high | ultra_high; "" sends none
	GeminiThinkingLevel   string // none | minimal | low | medium | high; "" and none send none
	OpenAIDetail          string // low | high | auto; "" is auto
}

// VisionRequest is a picture with the question about it.
type VisionRequest struct {
	// Image is the prepared picture: turned upright, without metadata, at
	// most MaxSide on its longest side.
	Image    []byte
	MimeType string // image/jpeg | image/png | image/webp
	MaxSide  int
	// Instruction says what to read from the picture.
	Instruction     string
	JSONSchema      *Schema
	MaxOutputTokens *int
	Options         VisionOptions
	Timeout         time.Duration
}

// VisionResult is a vision model's answer: JSON, not yet trusted.
type VisionResult struct {
	Output   json.RawMessage
	Metadata Metadata
}

// TextProvider serves text requests.
type TextProvider interface {
	Name() string
	Model() string
	Generate(ctx context.Context, request TextRequest) (TextResult, error)
}

// VisionProvider serves vision requests.
type VisionProvider interface {
	Name() string
	Model() string
	AnalyzeImage(ctx context.Context, request VisionRequest) (VisionResult, error)
}

var visionMimeTypes = map[string]bool{"image/jpeg": true, "image/png": true, "image/webp": true}

// checkVisionRequest refuses a vision request no provider is to be sent.
func checkVisionRequest(provider string, r VisionRequest) error {
	problem := ""
	switch {
	case !visionMimeTypes[r.MimeType]:
		problem = "unsupported image type"
	case len(r.Image) == 0:
		problem = "empty image"
	case len(r.Image) > visionlimit.MaxBytes:
		problem = "image too large"
	case r.MaxSide < 1 || r.MaxSide > visionlimit.MaxSide:
		problem = "maxSide out of range"
	case isBlank(r.Instruction):
		problem = "missing instruction"
	}
	if problem != "" {
		return &Error{Kind: InvalidRequest, Provider: provider, Detail: problem}
	}
	return nil
}
