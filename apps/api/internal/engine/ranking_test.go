package engine

import (
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"testing"

	"lookly/internal/golden"
)

func TestTheRankingPromptIsTheNextJSOneByteForByte(t *testing.T) {
	t.Parallel()
	g := golden.LoadOutfitAI(t)
	if RankingVersion != g.Version || RankingSystemPrompt != g.SystemPrompt || RankingUserMessage != g.UserMessage {
		t.Errorf("the prompt differs:\n got %q\nwant %q", RankingSystemPrompt, g.SystemPrompt)
	}
	for n := 1; n <= 5; n++ {
		if got := string(RankingSchema(n)); got != g.Schemas[n-1] {
			t.Errorf("the schema for %d:\n got %s\nwant %s", n, got, g.Schemas[n-1])
		}
	}
	if last := g.Correction[len(g.Correction)-1]; last.Role != "system" || RankingCorrection("schema", RankingRefs(3)) != last.Content {
		t.Errorf("the correction: %q", RankingCorrection("schema", RankingRefs(3)))
	}
	if RankingTimeoutMs != g.Limits.TimeoutMs || RankingBudgetMs != g.Limits.BudgetMs || RankingExplanationMaxChars != g.Limits.ExplanationMaxChars {
		t.Errorf("limits: %+v", g.Limits)
	}
}

// The model is sent, for the engine's own outfits, the context the Next.js
// server sends for them.
func TestTheRankingContextOfTheEnginesOutfitsIsTheNextJSOne(t *testing.T) {
	t.Parallel()
	g := loadGolden(t)
	contexts := map[string]string{}
	for _, c := range golden.LoadOutfitAI(t).Contexts {
		contexts[c.Name] = c.Context
	}
	compared := 0
	for _, c := range g.Cases {
		var in goldenInput
		if err := json.Unmarshal(c.Input, &in); err != nil {
			t.Fatal(err)
		}
		input := in.input()
		result := Generate(input)
		want, ok := contexts[c.Name]
		if len(result.Outfits) == 0 {
			if ok {
				t.Errorf("%s: no outfits, the vectors have a context", c.Name)
			}
			continue
		}
		if got := RankingContext(result.Outfits, input.Occasion, result.Weather, input.ColorProfile); got != want {
			t.Errorf("%s:\n got %s\nwant %s", c.Name, got, want)
		}
		compared++
	}
	if compared != len(contexts) || compared < 100 {
		t.Errorf("compared %d of %d contexts", compared, len(contexts))
	}
}

// Stored values the catalog does not know never reach the model.
func TestTheRankingContextShowsOnlyCatalogValues(t *testing.T) {
	t.Parallel()
	for _, d := range golden.LoadOutfitAI(t).Direct {
		t.Run(d.Name, func(t *testing.T) {
			var candidates []Candidate
			for _, c := range d.Candidates {
				candidate := Candidate{Score: c.Score, Reasons: c.Reasons}
				for _, p := range c.Items {
					candidate.Items = append(candidate.Items, Piece{Slot: Slot(p.Slot), Item: Item{
						ID: p.Item.ID, Category: p.Item.Category, Subcategory: p.Item.Subcategory, Colors: p.Item.Colors, Pattern: p.Item.Pattern,
						Material: p.Item.Material, SleeveLength: p.Item.SleeveLength, Fit: p.Item.Fit, Style: p.Item.Style, Season: p.Item.Season,
						Gender: p.Item.Gender, Formality: p.Item.Formality,
					}})
				}
				candidates = append(candidates, candidate)
			}
			occasion := ""
			if d.Occasion != nil {
				occasion = *d.Occasion
			}
			var wx *WeatherContext
			if w := d.Weather; w != nil {
				wx = &WeatherContext{Band: str(w.Band), FeelsLike: w.FeelsLike, Wet: str(w.Wet), Snow: w.Snow, Wind: str(w.Wind), UVHigh: w.UVHigh, Completeness: w.Completeness}
			}
			var profile *ColorProfile
			if p := d.ColorProfile; p != nil {
				profile = &ColorProfile{Season: p.Season, Undertone: p.Undertone, Confidence: p.Confidence}
			}
			if got := RankingContext(candidates, occasion, wx, profile); got != d.Context {
				t.Errorf("\n got %s\nwant %s", got, d.Context)
			}
		})
	}
}

func TestAnAnswerIsInterpretedAsTheNextJSServerDid(t *testing.T) {
	t.Parallel()
	for _, c := range golden.LoadOutfitAI(t).Interpreted {
		t.Run(c.Name, func(t *testing.T) {
			ranking, explanation, err := InterpretRanking(c.Text, c.Refs)
			if c.Result == nil {
				var invalid *InvalidRankingError
				if !errors.As(err, &invalid) || invalid.Reason != c.Reason {
					t.Fatalf("got %v %q %v, want the refusal %q", ranking, explanation, err, c.Reason)
				}
				return
			}
			if err != nil || !slices.Equal(ranking, c.Result.Ranking) || explanation != c.Result.Explanation {
				t.Errorf("got %v %q %v, want %v %q", ranking, explanation, err, c.Result.Ranking, c.Result.Explanation)
			}
		})
	}
}

func TestTheWordingGateIsTheNextJSOne(t *testing.T) {
	t.Parallel()
	g := golden.LoadOutfitAI(t)
	var terms []string
	for _, w := range ForbiddenTerms {
		terms = append(terms, strings.Join(w, " "))
	}
	if !slices.Equal(terms, g.ForbiddenTerms) {
		t.Errorf("forbidden terms:\n got %v\nwant %v", terms, g.ForbiddenTerms)
	}
	for _, c := range g.Wording {
		if got := ExposedCatalogTerms(c.Text); !slices.Equal(got, c.Terms) && !(len(got) == 0 && len(c.Terms) == 0) {
			t.Errorf("%q: %v, want %v", c.Text, got, c.Terms)
		}
		if got := HasCyrillic(c.Text); got != c.Cyrillic {
			t.Errorf("%q: cyrillic %t", c.Text, got)
		}
	}
}
