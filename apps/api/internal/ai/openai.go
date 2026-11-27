package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"regexp"
)

// OpenAIURL is the base of OpenAI's REST API.
const OpenAIURL = "https://api.openai.com/v1"

// fixedTemperatureModel: models that take no temperature.
var fixedTemperatureModel = regexp.MustCompile(`(?i)^(gpt-5|gpt-6|o[0-9])`)

// OpenAI is OpenAI's chat completions API.
type OpenAI struct {
	key, model, base string
	transport        transport
}

// NewOpenAI returns the adapter. base is the API's base address
// (OpenAIURL; a test's stand-in).
func NewOpenAI(key, model, base string) (*OpenAI, error) {
	if key == "" {
		return nil, &Error{Kind: Config, Provider: "openai", Detail: "API key missing"}
	}
	return &OpenAI{key: key, model: model, base: base, transport: newTransport()}, nil
}

// Name is "openai".
func (*OpenAI) Name() string { return "openai" }

// Model is the model's id.
func (o *OpenAI) Model() string { return o.model }

type openAIImage struct {
	URL    string `json:"url"`
	Detail string `json:"detail"`
}

type openAIPart struct {
	Type     string       `json:"type"`
	Text     *string      `json:"text,omitempty"`
	ImageURL *openAIImage `json:"image_url,omitempty"`
}

type openAIMessage struct {
	Role    string `json:"role"`
	Content any    `json:"content"` // a text, or parts
}

type openAISchema struct {
	Name   string          `json:"name"`
	Schema json.RawMessage `json:"schema"`
	Strict bool            `json:"strict"`
}

type openAIFormat struct {
	Type       string       `json:"type"`
	JSONSchema openAISchema `json:"json_schema"`
}

// openAIBody is the request, its members in the order the Next.js adapter
// writes them.
type openAIBody struct {
	Model               string          `json:"model"`
	Messages            []openAIMessage `json:"messages"`
	Temperature         *float64        `json:"temperature,omitempty"`
	MaxCompletionTokens *int            `json:"max_completion_tokens,omitempty"`
	ResponseFormat      *openAIFormat   `json:"response_format,omitempty"`
	// Store false: OpenAI is not to keep these completions.
	Store bool `json:"store"`
}

// Generate asks the model.
func (o *OpenAI) Generate(ctx context.Context, r TextRequest) (TextResult, error) {
	messages := make([]openAIMessage, 0, len(r.Messages))
	asked := false
	for _, m := range r.Messages {
		asked = asked || m.Role != "system"
		messages = append(messages, openAIMessage{Role: m.Role, Content: m.Content})
	}
	if !asked {
		return TextResult{}, &Error{Kind: InvalidRequest, Provider: o.Name(), Detail: "no user message"}
	}
	text, metadata, err := o.call(ctx, messages, r.Temperature, r.MaxOutputTokens, r.JSONSchema, r)
	if err != nil {
		return TextResult{}, err
	}
	if r.JSONSchema != nil {
		output, err := jsonOutput(o.Name(), text)
		if err != nil {
			return TextResult{}, err
		}
		text = string(output)
	}
	return TextResult{Text: text, Metadata: metadata}, nil
}

// AnalyzeImage asks the model about a picture.
func (o *OpenAI) AnalyzeImage(ctx context.Context, r VisionRequest) (VisionResult, error) {
	if err := checkVisionRequest(o.Name(), r); err != nil {
		return VisionResult{}, err
	}
	detail := r.Options.OpenAIDetail
	if detail == "" {
		detail = "auto"
	}
	schema := r.JSONSchema
	if schema == nil {
		schema = &Schema{Name: "vision_output", Schema: json.RawMessage(`{"type":"object"}`)}
	}
	content := []openAIPart{
		{Type: "text", Text: &r.Instruction},
		{Type: "image_url", ImageURL: &openAIImage{URL: "data:" + r.MimeType + ";base64," + base64.StdEncoding.EncodeToString(r.Image), Detail: detail}},
	}
	zero := 0.0
	text, metadata, err := o.call(ctx, []openAIMessage{{Role: "user", Content: content}}, &zero, r.MaxOutputTokens, schema, TextRequest{Timeout: r.Timeout})
	if err != nil {
		return VisionResult{}, err
	}
	output, err := jsonOutput(o.Name(), text)
	if err != nil {
		return VisionResult{}, err
	}
	return VisionResult{Output: output, Metadata: metadata}, nil
}

func (o *OpenAI) call(ctx context.Context, messages []openAIMessage, temperature *float64, maxOutputTokens *int, schema *Schema, r TextRequest) (string, Metadata, error) {
	body := openAIBody{Model: o.model, Messages: messages, MaxCompletionTokens: maxOutputTokens}
	if temperature != nil && !fixedTemperatureModel.MatchString(o.model) {
		body.Temperature = temperature
	}
	if schema != nil {
		body.ResponseFormat = &openAIFormat{Type: "json_schema", JSONSchema: openAISchema{Name: schema.Name, Schema: schema.Schema, Strict: true}}
	}
	raw, err := o.transport.postJSON(ctx, o.Name(), o.base+"/chat/completions", [][2]string{{"Authorization", "Bearer " + o.key}}, body, r.Timeout)
	if err != nil {
		return "", Metadata{}, err
	}
	var answer any
	if err := json.Unmarshal(raw, &answer); err != nil {
		return "", Metadata{}, notJSON(o.Name())
	}
	text, err := o.text(answer)
	if err != nil {
		return "", Metadata{}, err
	}
	return text, Metadata{Provider: o.Name(), Model: o.model, Usage: openAIUsage(answer)}, nil
}

// text is the model's text in an answer: the first choice's content.
func (o *OpenAI) text(answer any) (string, error) {
	var choice any
	if choices, ok := list(member(answer, "choices")); ok && len(choices) > 0 {
		choice = choices[0]
	}
	if !truthy(choice) {
		return "", &Error{Kind: MalformedResponse, Provider: o.Name(), Detail: "no choice"}
	}
	message := member(choice, "message")
	if refusal, _ := member(message, "refusal").(string); member(choice, "finish_reason") == "content_filter" || refusal != "" {
		return "", &Error{Kind: ContentFiltered, Provider: o.Name()}
	}
	content, ok := member(message, "content").(string)
	if !ok || isBlank(content) {
		return "", &Error{Kind: MalformedResponse, Provider: o.Name(), Detail: "empty output"}
	}
	return content, nil
}

func openAIUsage(answer any) Usage {
	usage, ok := member(answer, "usage").(map[string]any)
	if !ok {
		return Usage{}
	}
	return Usage{InputTokens: count(usage["prompt_tokens"]), OutputTokens: count(usage["completion_tokens"]), TotalTokens: count(usage["total_tokens"])}
}
