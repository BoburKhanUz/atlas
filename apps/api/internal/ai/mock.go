package ai

import (
	"context"
	"encoding/json"
)

// MockText is what the mock answers a text request without a schema: said
// to be a demo, in Uzbek.
const MockText = "Demo rejim: AI stilist hali ulanmagan. Bu javob haqiqiy AI tomonidan yozilmagan."

// Mock is the development provider: no call, no cost. The features have
// their own mock answers (a mock stylist, a mock garment analysis); this
// one only stands where a provider must.
type Mock struct{}

// Name is "mock".
func (Mock) Name() string { return "mock" }

// Model is "mock".
func (Mock) Model() string { return "mock" }

// Generate answers MockText, or an empty object when a schema is asked.
func (m Mock) Generate(_ context.Context, r TextRequest) (TextResult, error) {
	text := MockText
	if r.JSONSchema != nil {
		text = "{}"
	}
	return TextResult{Text: text, Metadata: Metadata{Provider: m.Name(), Model: m.Model()}}, nil
}

// AnalyzeImage answers an empty object.
func (m Mock) AnalyzeImage(_ context.Context, r VisionRequest) (VisionResult, error) {
	if err := checkVisionRequest(m.Name(), r); err != nil {
		return VisionResult{}, err
	}
	return VisionResult{Output: json.RawMessage("{}"), Metadata: Metadata{Provider: m.Name(), Model: m.Model()}}, nil
}
