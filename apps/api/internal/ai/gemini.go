package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"
)

// GeminiURL is the base of Google's Gemini REST API.
const GeminiURL = "https://generativelanguage.googleapis.com/v1beta"

// geminiFiltered are the finish reasons that mean the provider refused or
// filtered the content.
var geminiFiltered = map[string]bool{
	"SAFETY": true, "RECITATION": true, "BLOCKLIST": true, "PROHIBITED_CONTENT": true, "SPII": true, "IMAGE_SAFETY": true, "LANGUAGE": true,
}

// Gemini is Google's Gemini over its REST API (generateContent). The key
// goes in a header, never in the address.
type Gemini struct {
	key, model, base string
	transport        transport
}

// NewGemini returns the adapter. base is the API's base address
// (GeminiURL; a test's stand-in).
func NewGemini(key, model, base string) (*Gemini, error) {
	if key == "" {
		return nil, &Error{Kind: Config, Provider: "gemini", Detail: "API key missing"}
	}
	return &Gemini{key: key, model: model, base: base, transport: newTransport()}, nil
}

// Name is "gemini".
func (*Gemini) Name() string { return "gemini" }

// Model is the model's id.
func (g *Gemini) Model() string { return g.model }

type geminiInline struct {
	MimeType string `json:"mimeType"`
	Data     string `json:"data"`
}

type geminiPart struct {
	Text       *string       `json:"text,omitempty"`
	InlineData *geminiInline `json:"inlineData,omitempty"`
}

type geminiContent struct {
	Role  string       `json:"role"`
	Parts []geminiPart `json:"parts"`
}

type geminiSystem struct {
	Parts []geminiPart `json:"parts"`
}

type geminiThinking struct {
	ThinkingLevel string `json:"thinkingLevel"`
}

// geminiConfig is generationConfig, its members in the order the Next.js
// adapter writes them.
type geminiConfig struct {
	Temperature        *float64        `json:"temperature,omitempty"`
	MaxOutputTokens    *int            `json:"maxOutputTokens,omitempty"`
	ResponseMimeType   string          `json:"responseMimeType,omitempty"`
	ResponseJSONSchema json.RawMessage `json:"responseJsonSchema,omitempty"`
	MediaResolution    string          `json:"mediaResolution,omitempty"`
	ThinkingConfig     *geminiThinking `json:"thinkingConfig,omitempty"`
}

type geminiBody struct {
	SystemInstruction *geminiSystem   `json:"systemInstruction,omitempty"`
	Contents          []geminiContent `json:"contents"`
	GenerationConfig  geminiConfig    `json:"generationConfig"`
}

func geminiGeneration(temperature *float64, maxOutputTokens *int, schema json.RawMessage) geminiConfig {
	config := geminiConfig{Temperature: temperature, MaxOutputTokens: maxOutputTokens}
	if schema != nil {
		config.ResponseMimeType, config.ResponseJSONSchema = "application/json", schema
	}
	return config
}

// Generate asks the model. The leading system messages are the system
// instruction; Gemini has no system turn inside a conversation, so a later
// one (a correction after the model's answer) is sent as a user turn.
func (g *Gemini) Generate(ctx context.Context, r TextRequest) (TextResult, error) {
	first := len(r.Messages)
	for i, m := range r.Messages {
		if m.Role != "system" {
			first = i
			break
		}
	}
	body := geminiBody{Contents: []geminiContent{}}
	if first > 0 {
		system := make([]string, 0, first)
		for _, m := range r.Messages[:first] {
			system = append(system, m.Content)
		}
		text := strings.Join(system, "\n\n")
		body.SystemInstruction = &geminiSystem{Parts: []geminiPart{{Text: &text}}}
	}
	for _, m := range r.Messages[first:] {
		role := "user"
		if m.Role == "assistant" {
			role = "model"
		}
		body.Contents = append(body.Contents, geminiContent{Role: role, Parts: []geminiPart{{Text: &m.Content}}})
	}
	if len(body.Contents) == 0 {
		return TextResult{}, &Error{Kind: InvalidRequest, Provider: g.Name(), Detail: "no user message"}
	}
	var schema json.RawMessage
	if r.JSONSchema != nil {
		schema = r.JSONSchema.Schema
	}
	body.GenerationConfig = geminiGeneration(r.Temperature, r.MaxOutputTokens, schema)
	text, metadata, err := g.call(ctx, body, r)
	if err != nil {
		return TextResult{}, err
	}
	if r.JSONSchema != nil {
		output, err := jsonOutput(g.Name(), text)
		if err != nil {
			return TextResult{}, err
		}
		text = string(output)
	}
	return TextResult{Text: text, Metadata: metadata}, nil
}

// AnalyzeImage asks the model about a picture.
func (g *Gemini) AnalyzeImage(ctx context.Context, r VisionRequest) (VisionResult, error) {
	if err := checkVisionRequest(g.Name(), r); err != nil {
		return VisionResult{}, err
	}
	schema := json.RawMessage(`{"type":"object"}`)
	if r.JSONSchema != nil {
		schema = r.JSONSchema.Schema
	}
	zero := 0.0
	config := geminiGeneration(&zero, r.MaxOutputTokens, schema)
	if r.Options.GeminiMediaResolution != "" {
		config.MediaResolution = "MEDIA_RESOLUTION_" + strings.ToUpper(r.Options.GeminiMediaResolution)
	}
	if level := r.Options.GeminiThinkingLevel; level != "" && level != "none" {
		config.ThinkingConfig = &geminiThinking{ThinkingLevel: level}
	}
	// Google recommends the text before a single image.
	body := geminiBody{
		Contents: []geminiContent{{Role: "user", Parts: []geminiPart{
			{Text: &r.Instruction},
			{InlineData: &geminiInline{MimeType: r.MimeType, Data: base64.StdEncoding.EncodeToString(r.Image)}},
		}}},
		GenerationConfig: config,
	}
	text, metadata, err := g.call(ctx, body, TextRequest{Timeout: r.Timeout})
	if err != nil {
		return VisionResult{}, err
	}
	output, err := jsonOutput(g.Name(), text)
	if err != nil {
		return VisionResult{}, err
	}
	return VisionResult{Output: output, Metadata: metadata}, nil
}

func (g *Gemini) call(ctx context.Context, body geminiBody, r TextRequest) (string, Metadata, error) {
	address := g.base + "/models/" + encodeURIComponent(g.model) + ":generateContent"
	raw, err := g.transport.postJSON(ctx, g.Name(), address, [][2]string{{"x-goog-api-key", g.key}}, body, r.Timeout)
	if err != nil {
		return "", Metadata{}, err
	}
	var answer any
	if err := json.Unmarshal(raw, &answer); err != nil {
		return "", Metadata{}, notJSON(g.Name())
	}
	text, err := g.text(answer)
	if err != nil {
		return "", Metadata{}, err
	}
	return text, Metadata{Provider: g.Name(), Model: g.model, Usage: geminiUsage(answer)}, nil
}

// text is the model's text in an answer: the text parts of the first
// candidate that are not thoughts, joined.
func (g *Gemini) text(answer any) (string, error) {
	malformed := func(detail string) error {
		return &Error{Kind: MalformedResponse, Provider: g.Name(), Detail: detail}
	}
	switch answer.(type) {
	case map[string]any, []any:
	default:
		return "", malformed("")
	}
	if truthy(member(member(answer, "promptFeedback"), "blockReason")) {
		return "", &Error{Kind: ContentFiltered, Provider: g.Name()}
	}
	var candidate any
	if candidates, ok := list(member(answer, "candidates")); ok && len(candidates) > 0 {
		candidate = candidates[0]
	}
	if !truthy(candidate) {
		return "", malformed("no candidate")
	}
	if reason, ok := member(candidate, "finishReason").(string); ok && geminiFiltered[reason] {
		return "", &Error{Kind: ContentFiltered, Provider: g.Name()}
	}
	var text strings.Builder
	parts, _ := list(member(member(candidate, "content"), "parts"))
	for _, part := range parts {
		// A null part is no answer we know how to read. (The Next.js
		// adapter fell over it with a JavaScript error.)
		if part == nil {
			return "", malformed("a part is null")
		}
		if piece, ok := member(part, "text").(string); ok && member(part, "thought") != true {
			text.WriteString(piece)
		}
	}
	if isBlank(text.String()) {
		return "", malformed("empty output")
	}
	return text.String(), nil
}

// geminiUsage reads the token counts. Thinking tokens are billed as output.
func geminiUsage(answer any) Usage {
	usage, ok := member(answer, "usageMetadata").(map[string]any)
	if !ok {
		return Usage{}
	}
	candidates, thoughts := count(usage["candidatesTokenCount"]), count(usage["thoughtsTokenCount"])
	var output *float64
	if candidates != nil || thoughts != nil {
		sum := 0.0
		for _, n := range []*float64{candidates, thoughts} {
			if n != nil {
				sum += *n
			}
		}
		output = &sum
	}
	return Usage{InputTokens: count(usage["promptTokenCount"]), OutputTokens: output, TotalTokens: count(usage["totalTokenCount"])}
}
