package stylist

import (
	"encoding/json"
	"errors"
	"maps"
	"slices"
	"testing"

	"lookly/internal/catalog"
	"lookly/internal/engine"
	"lookly/internal/golden"
)

func TestThePromptAndTheSchemaAreTheNextJSOnesByteForByte(t *testing.T) {
	t.Parallel()
	g := golden.LoadStylist(t)
	if PromptVersion != g.Version || SystemPrompt != g.SystemPrompt || ContextPreamble != g.ContextPreamble || LegacyFallbackText != g.LegacyFallback {
		t.Errorf("the prompt differs:\n got %q\nwant %q", SystemPrompt, g.SystemPrompt)
	}
	l := g.Limits
	if MessageChars != l.Message || EventChars != l.Event || WardrobeItems != l.WardrobeItems || HistoryMessages != l.HistoryMessages ||
		HistoryMessageChars != l.HistoryMessageChars || OutfitCandidates != l.OutfitCandidates || AnswerChars != l.AnswerChars ||
		MaxOutputTokens != l.MaxOutputTokens || DeadlineMs != l.DeadlineMs {
		t.Errorf("limits: %+v", l)
	}
	for _, s := range g.Schemas {
		if got := string(Schema(Refs(s.Refs))); got != s.Schema {
			t.Errorf("the schema for %d references:\n got %s\nwant %s", s.Refs, got, s.Schema)
		}
	}
}

func TestAnAnswerIsInterpretedAsTheNextJSServerDid(t *testing.T) {
	t.Parallel()
	for _, c := range golden.LoadStylist(t).Interpreted {
		t.Run(c.Name, func(t *testing.T) {
			got, err := Interpret(string(c.Output), c.Refs)
			if c.Result == nil {
				var invalid *InvalidOutputError
				if !errors.As(err, &invalid) || invalid.Reason != c.Reason || !slices.Equal(invalid.InvalidRefs, c.InvalidRefs) && !(len(invalid.InvalidRefs) == 0 && len(c.InvalidRefs) == 0) {
					t.Fatalf("got %+v %v, want the refusal %s %v", got, err, c.Reason, c.InvalidRefs)
				}
				return
			}
			if err != nil || got.Answer != c.Result.Answer || !slices.Equal(got.ReferencedItems, c.Result.ReferencedItems) || got.NeedsMoreInfo != c.Result.NeedsMoreInfo {
				t.Errorf("got %+v %v, want %+v", got, err, c.Result)
			}
		})
	}
	// A text that is no JSON is the schema's refusal, as JSON.parse's failure was.
	for _, p := range golden.LoadStylist(t).Parsed {
		if _, err := Interpret(p.Text, nil); !p.OK && !isSchema(err) {
			t.Errorf("%q is no JSON: %v", p.Text, err)
		}
	}
}

func isSchema(err error) bool {
	var invalid *InvalidOutputError
	return errors.As(err, &invalid) && invalid.Reason == SchemaRefusal
}

func itemOf(i golden.StylistItem) Item {
	return Item{Category: i.Category, Subcategory: i.Subcategory, Colors: i.Colors}
}

func TestItemsAreNamedAsTheNextJSServerNamesThem(t *testing.T) {
	t.Parallel()
	for _, c := range golden.LoadStylist(t).Names {
		if got := DisplayName(itemOf(c.Item)); got != c.Name {
			t.Errorf("%+v: %q, want %q", c.Item, got, c.Name)
		}
	}
}

func TestReferencesBecomeNamesAsInTheNextJSServer(t *testing.T) {
	t.Parallel()
	g := golden.LoadStylist(t)
	items := map[string]Item{}
	for i, it := range g.ResolveWardrobe {
		items[Refs(len(g.ResolveWardrobe))[i]] = itemOf(it)
	}
	for _, c := range g.Resolved {
		got, err := Resolve(c.Text, items)
		if c.Error != "" {
			var invalid *InvalidOutputError
			if !errors.As(err, &invalid) || invalid.Reason != c.Error {
				t.Errorf("%q: %q %v, want the refusal %s", c.Text, got, err, c.Error)
			}
			continue
		}
		if err != nil || got != c.Result {
			t.Errorf("%q:\n got %q\nwant %q (%v)", c.Text, got, c.Result, err)
		}
	}
}

func TestTheMockAndTheCorrectionAreTheNextJSOnes(t *testing.T) {
	t.Parallel()
	g := golden.LoadStylist(t)
	for _, c := range g.Mocks {
		got := Mock(c.Refs, c.FirstCandidate)
		if got.Answer != c.Output.Answer || !slices.Equal(got.ReferencedItems, c.Output.ReferencedItems) || got.NeedsMoreInfo != c.Output.NeedsMoreInfo {
			t.Errorf("%v %v: %+v, want %+v", c.Refs, c.FirstCandidate, got, c.Output)
		}
	}
	for _, c := range g.Corrections {
		if got := Correction(c.InvalidRefs, c.Refs); got != c.Message {
			t.Errorf("\n got %q\nwant %q", got, c.Message)
		}
	}
}

func historyOf(t *testing.T, rows []struct {
	Role     string          `json:"role"`
	Content  string          `json:"content"`
	Metadata json.RawMessage `json:"metadata"`
}) []HistoryRow {
	t.Helper()
	out := make([]HistoryRow, len(rows))
	for i, r := range rows {
		var meta any
		if err := json.Unmarshal(r.Metadata, &meta); err != nil {
			t.Fatal(err)
		}
		out[i] = HistoryRow{Role: r.Role, Content: r.Content, Metadata: meta}
	}
	return out
}

func TestTheHistoryIsTheNextJSOne(t *testing.T) {
	t.Parallel()
	for _, h := range golden.LoadStylist(t).History {
		got := History(historyOf(t, h.Rows))
		if len(got) != len(h.Messages) {
			t.Errorf("%s: %d messages, want %d", h.Name, len(got), len(h.Messages))
			continue
		}
		for i, m := range h.Messages {
			if got[i].Role != m.Role || got[i].Content != m.Content {
				t.Errorf("%s: message %d: %+v, want %+v", h.Name, i, got[i], m)
			}
		}
	}
}

func TestEventsNameOccasionsAsInTheNextJSServer(t *testing.T) {
	t.Parallel()
	for _, c := range golden.LoadStylist(t).Occasions {
		want := ""
		if c.Occasion != nil {
			want = *c.Occasion
		}
		if got := catalog.OccasionFromEvent(c.Event); got != want {
			t.Errorf("%q: %q, want %q", c.Event, got, want)
		}
	}
}

// The context of seeded wardrobes, with the Go engine's candidates on the
// same inputs, and the request's messages.
func TestTheContextIsTheNextJSOne(t *testing.T) {
	t.Parallel()
	g := golden.LoadStylist(t)
	histories := map[string][]HistoryRow{}
	for _, h := range g.History {
		histories[h.Name] = historyOf(t, h.Rows)
	}
	for _, c := range g.Contexts {
		t.Run(c.Name, func(t *testing.T) {
			in := c.Input
			var rows []WardrobeRow
			var wardrobe []engine.Item
			for _, x := range in.Items {
				item := engine.Item{
					ID: x.ID, Category: x.Category, Subcategory: x.Subcategory, Colors: x.Colors, Pattern: x.Pattern, Material: x.Material,
					SleeveLength: x.SleeveLength, Fit: x.Fit, Style: x.Style, Season: x.Season, Gender: x.Gender, Formality: x.Formality,
				}
				rows = append(rows, WardrobeRow{Item: item, CreatedAt: x.CreatedAt})
				wardrobe = append(wardrobe, item)
			}
			prefs := &Preferences{
				PreferredStyles: in.Preferences.PreferredStyles, DislikedStyles: in.Preferences.DislikedStyles,
				FavoriteColors: in.Preferences.FavoriteColors, DislikedColors: in.Preferences.DislikedColors, PreferredFit: in.Preferences.PreferredFit,
			}
			occasion := ""
			if in.Occasion != nil {
				occasion = *in.Occasion
			}
			var weather *Weather
			var forEngine *engine.Weather
			if w := in.Weather; w != nil {
				weather = &Weather{Temperature: w.Temperature, FeelsLike: w.FeelsLike, Condition: w.Condition, PrecipitationProbability: w.PrecipitationProbability, Humidity: w.Humidity, WindSpeed: w.WindSpeed, UVIndex: w.UVIndex}
				forEngine = &engine.Weather{Temperature: &w.Temperature, FeelsLike: &w.FeelsLike, Condition: &w.Condition, PrecipitationProbability: &w.PrecipitationProbability, Humidity: &w.Humidity, WindSpeed: &w.WindSpeed, UVIndex: &w.UVIndex}
			}
			var candidates []engine.Candidate
			if len(wardrobe) > 0 {
				topN := c.TopN
				candidates = engine.Generate(engine.Input{
					Wardrobe: wardrobe, Weather: forEngine, Occasion: occasion, TopN: &topN,
					Profile: &engine.Profile{Gender: in.Gender, PreferredStyles: prefs.PreferredStyles, DislikedStyles: prefs.DislikedStyles, FavoriteColors: prefs.FavoriteColors, DislikedColors: prefs.DislikedColors, PreferredFit: prefs.PreferredFit},
				}).Outfits
			}
			var ids [][]string
			for _, cand := range candidates {
				var one []string
				for _, p := range cand.Items {
					one = append(one, p.Item.ID)
				}
				ids = append(ids, one)
			}
			if len(ids) != len(c.Candidates) || !slices.EqualFunc(ids, c.Candidates, slices.Equal) {
				t.Fatalf("the engine's candidates: %v, want %v", ids, c.Candidates)
			}
			var profile *ColorProfile
			if cp := in.ColorProfile; cp != nil {
				profile = &ColorProfile{Season: cp.Season, Undertone: cp.Undertone, ContrastLevel: cp.ContrastLevel, RecommendedColors: cp.RecommendedColors, NeutralColors: cp.NeutralColors, CautionColors: cp.CautionColors}
			}
			built := Build(BuildInput{Items: rows, Candidates: candidates, Occasion: occasion, Weather: weather, Preferences: prefs, ColorProfile: profile})
			if built.Data != c.Context {
				t.Errorf("the context:\n got %s\nwant %s", built.Data, c.Context)
			}
			if !slices.Equal(built.Refs, c.Refs) || !slices.Equal(built.FirstCandidate, c.FirstCandidate) {
				t.Errorf("refs %v first %v, want %v %v", built.Refs, built.FirstCandidate, c.Refs, c.FirstCandidate)
			}
			want := map[string]Item{}
			for _, x := range c.Items {
				want[x.Ref] = Item{ID: x.ID, Category: x.Category, Subcategory: x.Subcategory, Colors: x.Colors}
			}
			if !maps.EqualFunc(built.Items, want, func(a, b Item) bool {
				return a.ID == b.ID && a.Category == b.Category && (a.Subcategory == nil) == (b.Subcategory == nil) && (a.Subcategory == nil || *a.Subcategory == *b.Subcategory) && slices.Equal(a.Colors, b.Colors)
			}) {
				t.Errorf("items %v, want %v", built.Items, want)
			}
			messages := Messages(built.Data, History(histories[c.HistoryName]), c.Message, c.OccasionText)
			if len(messages) != len(c.Messages) {
				t.Fatalf("%d messages, want %d", len(messages), len(c.Messages))
			}
			for i, m := range c.Messages {
				if messages[i].Role != m.Role || messages[i].Content != m.Content {
					t.Errorf("message %d:\n got %+v\nwant %+v", i, messages[i], m)
				}
			}
		})
	}
}
