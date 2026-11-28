package evaluation

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg" // the prepared pictures' size
	_ "image/png"

	"lookly/internal/ai"
)

// LineGate is the ai.AttemptGate of `lookly eval --gate`: the harness's own
// accounting decides every attempt. Before an attempt it writes
// {"ask": {...}} (what the attempt sends, without the picture's bytes) and
// reads {"admit": true|false} on the input; after an attempt it let through
// it writes {"attempted": {...}} (the outcome and the reported tokens). The
// requests, the answers and the results share the two streams, so the
// harness sends a case only once the previous result has come back.
type LineGate struct {
	in  *bufio.Scanner
	out *json.Encoder
	// err is a failed write of an attempt's end; Run stops on it.
	err error
}

// errRefused is the harness's refusal of an attempt.
var errRefused = errors.New("the evaluation refused the attempt")

// ask is an attempt as the harness is asked about it.
type ask struct {
	Feature  ai.Feature  `json:"feature"`
	Provider string      `json:"provider"`
	Model    string      `json:"model"`
	Text     *askText    `json:"text,omitempty"`
	Vision   *askPicture `json:"vision,omitempty"`
}

type askText struct {
	Messages        []message `json:"messages"`
	Temperature     *float64  `json:"temperature"`
	MaxOutputTokens *int      `json:"maxOutputTokens"`
	Schema          *schema   `json:"schema"`
}

type askPicture struct {
	MimeType string `json:"mimeType"`
	// Width and Height are the sent picture's (0 when it cannot be read).
	Width           int            `json:"width"`
	Height          int            `json:"height"`
	MaxSide         int            `json:"maxSide"`
	MaxOutputTokens *int           `json:"maxOutputTokens"`
	Options         pictureOptions `json:"options"`
}

type pictureOptions struct {
	GeminiMediaResolution string `json:"geminiMediaResolution,omitempty"`
	GeminiThinkingLevel   string `json:"geminiThinkingLevel,omitempty"`
	OpenAIDetail          string `json:"openaiDetail,omitempty"`
}

// Admit asks the harness.
func (g *LineGate) Admit(_ context.Context, attempt ai.Attempt) error {
	if g.in == nil || g.out == nil {
		return errors.New("the gate is not connected to a run")
	}
	question := ask{Feature: attempt.Feature, Provider: attempt.Provider, Model: attempt.Model}
	if t := attempt.Text; t != nil {
		question.Text = &askText{Messages: messagesOut(t.Messages), Temperature: t.Temperature, MaxOutputTokens: t.MaxOutputTokens}
		if t.JSONSchema != nil {
			question.Text.Schema = &schema{Name: t.JSONSchema.Name, Schema: t.JSONSchema.Schema}
		}
	}
	if v := attempt.Vision; v != nil {
		question.Vision = &askPicture{MimeType: v.MimeType, MaxSide: v.MaxSide, MaxOutputTokens: v.MaxOutputTokens, Options: pictureOptions{
			GeminiMediaResolution: v.Options.GeminiMediaResolution, GeminiThinkingLevel: v.Options.GeminiThinkingLevel, OpenAIDetail: v.Options.OpenAIDetail,
		}}
		if cfg, _, err := image.DecodeConfig(bytes.NewReader(v.Image)); err == nil {
			question.Vision.Width, question.Vision.Height = cfg.Width, cfg.Height
		}
	}
	if err := g.out.Encode(map[string]ask{"ask": question}); err != nil {
		return fmt.Errorf("evaluation: ask about an attempt: %w", err)
	}
	for g.in.Scan() {
		line := g.in.Bytes()
		if len(line) == 0 {
			continue
		}
		var answer struct {
			Admit *bool `json:"admit"`
		}
		decoder := json.NewDecoder(bytes.NewReader(line))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&answer); err != nil || answer.Admit == nil {
			return errors.New("the answer to an attempt is not {\"admit\": true|false}")
		}
		if !*answer.Admit {
			return errRefused
		}
		return nil
	}
	return errors.New("no answer to an attempt: the input ended")
}

// attempted is an admitted attempt's end as the harness is told of it.
type attempted struct {
	Outcome      string   `json:"outcome"`
	InputTokens  *float64 `json:"inputTokens,omitempty"`
	OutputTokens *float64 `json:"outputTokens,omitempty"`
}

// Attempted tells the harness; a failed write is kept and ends the run
// after the case.
func (g *LineGate) Attempted(_ context.Context, outcome string, usage ai.Usage) {
	if g.out == nil || g.err != nil {
		return
	}
	if err := g.out.Encode(map[string]attempted{"attempted": {Outcome: outcome, InputTokens: usage.InputTokens, OutputTokens: usage.OutputTokens}}); err != nil {
		g.err = fmt.Errorf("evaluation: tell an attempt's end: %w", err)
	}
}
