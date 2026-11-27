package engine

import (
	"bytes"
	"encoding/json"
	"testing"

	"lookly/internal/golden"
)

// goldenFile is testdata/golden/engine.json
// (apps/web/scripts/golden-engine.ts): what the TypeScript engine gives.
type goldenFile struct {
	GeneratedBy  string `json:"generatedBy"`
	SourceCommit string `json:"sourceCommit"`
	Note         string `json:"note"`
	Colors       struct {
		Meta []struct {
			ID   string `json:"id"`
			Meta *struct {
				ID          string  `json:"id"`
				Hex         string  `json:"hex"`
				Hue         float64 `json:"hue"`
				Saturation  float64 `json:"saturation"`
				Lightness   float64 `json:"lightness"`
				Temperature string  `json:"temperature"`
				IsNeutral   bool    `json:"isNeutral"`
			} `json:"meta"`
		} `json:"meta"`
		Pairs    [][]float64 `json:"pairs"`
		Occasion []struct {
			Sets     [][]string `json:"sets"`
			Occasion string     `json:"occasion"`
			Score    float64    `json:"score"`
		} `json:"occasion"`
		Contrast []struct {
			Sets  [][]string `json:"sets"`
			Level string     `json:"level"`
		} `json:"contrast"`
	} `json:"colors"`
	Numbers struct {
		Round []struct {
			Value   float64 `json:"value"`
			Rounded float64 `json:"rounded"`
		} `json:"round"`
		Seeds []struct {
			Seed float64 `json:"seed"`
			Text string  `json:"text"`
			Hash uint32  `json:"hash"`
		} `json:"seeds"`
	} `json:"numbers"`
	Cases        []goldenCase `json:"cases"`
	Compositions []struct {
		Items []struct {
			ID       string `json:"id"`
			Category string `json:"category"`
		} `json:"items"`
		Error *string `json:"error"`
	} `json:"compositions"`
	Keys []struct {
		Pieces []struct {
			ID   string `json:"id"`
			Slot Slot   `json:"slot"`
		} `json:"pieces"`
		Key string `json:"key"`
	} `json:"keys"`
}

type goldenCase struct {
	Name   string          `json:"name"`
	Input  json.RawMessage `json:"input"`
	Output json.RawMessage `json:"output"`
}

func loadGolden(t testing.TB) goldenFile {
	t.Helper()
	var g goldenFile
	dec := json.NewDecoder(bytes.NewReader(golden.TestdataFile(t, "golden/engine.json")))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&g); err != nil {
		t.Fatalf("engine.json: %v", err)
	}
	if len(g.Cases) == 0 || len(g.Colors.Pairs) == 0 || len(g.Numbers.Seeds) == 0 || len(g.Compositions) == 0 {
		t.Fatal("engine.json: a section is empty")
	}
	return g
}
