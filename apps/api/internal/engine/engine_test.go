package engine

import (
	"encoding/json"
	"reflect"
	"strconv"
	"testing"
)

// jsNumber is a number of a golden input: a JSON number, or the name of a
// value JSON cannot carry ({"number": "NaN"}).
type jsNumber float64

func (n *jsNumber) UnmarshalJSON(b []byte) error {
	var named struct {
		Number string `json:"number"`
	}
	if err := json.Unmarshal(b, &named); err == nil && named.Number != "" {
		v, err := strconv.ParseFloat(named.Number, 64) // NaN, Infinity, -Infinity
		*n = jsNumber(v)
		return err
	}
	var v float64
	err := json.Unmarshal(b, &v)
	*n = jsNumber(v)
	return err
}

func number(n *jsNumber) *float64 {
	if n == nil {
		return nil
	}
	v := float64(*n)
	return &v
}

type goldenInput struct {
	Wardrobe []struct {
		ID           string   `json:"id"`
		Category     string   `json:"category"`
		Subcategory  *string  `json:"subcategory"`
		Colors       []string `json:"colors"`
		Pattern      *string  `json:"pattern"`
		Material     *string  `json:"material"`
		SleeveLength *string  `json:"sleeveLength"`
		Fit          *string  `json:"fit"`
		Style        *string  `json:"style"`
		Season       []string `json:"season"`
		Gender       *string  `json:"gender"`
		Formality    *string  `json:"formality"`
	} `json:"wardrobe"`
	Weather *struct {
		Temperature              *jsNumber `json:"temperature"`
		FeelsLike                *jsNumber `json:"feelsLike"`
		Condition                *string   `json:"condition"`
		PrecipitationProbability *jsNumber `json:"precipitationProbability"`
		Humidity                 *jsNumber `json:"humidity"`
		WindSpeed                *jsNumber `json:"windSpeed"`
		UVIndex                  *jsNumber `json:"uvIndex"`
	} `json:"weather"`
	Occasion string `json:"occasion"`
	Profile  *struct {
		Gender          *string  `json:"gender"`
		PreferredStyles []string `json:"preferredStyles"`
		DislikedStyles  []string `json:"dislikedStyles"`
		FavoriteColors  []string `json:"favoriteColors"`
		DislikedColors  []string `json:"dislikedColors"`
		PreferredFit    *string  `json:"preferredFit"`
	} `json:"profile"`
	ColorProfile *struct {
		Season              *string  `json:"season"`
		SecondarySeason     *string  `json:"secondarySeason"`
		Undertone           *string  `json:"undertone"`
		Confidence          *float64 `json:"confidence"`
		UndertoneConfidence *float64 `json:"undertoneConfidence"`
		SecondaryConfidence *float64 `json:"secondaryConfidence"`
		RecommendedColors   []string `json:"recommendedColors"`
		NeutralColors       []string `json:"neutralColors"`
		CautionColors       []string `json:"cautionColors"`
	} `json:"colorProfile"`
	Feedback *struct {
		RejectedItemIDs    []string `json:"rejectedItemIds"`
		LikedItemIDs       []string `json:"likedItemIds"`
		RejectedOutfitKeys []string `json:"rejectedOutfitKeys"`
	} `json:"feedback"`
	TopN *float64 `json:"topN"`
	Seed *float64 `json:"seed"`
}

func (g goldenInput) input() Input {
	in := Input{Occasion: g.Occasion, TopN: g.TopN, Seed: g.Seed}
	for _, w := range g.Wardrobe {
		in.Wardrobe = append(in.Wardrobe, Item{
			ID: w.ID, Category: w.Category, Subcategory: w.Subcategory, Colors: w.Colors, Pattern: w.Pattern, Material: w.Material,
			SleeveLength: w.SleeveLength, Fit: w.Fit, Style: w.Style, Season: w.Season, Gender: w.Gender, Formality: w.Formality,
		})
	}
	if w := g.Weather; w != nil {
		in.Weather = &Weather{
			Temperature: number(w.Temperature), FeelsLike: number(w.FeelsLike), Condition: w.Condition,
			PrecipitationProbability: number(w.PrecipitationProbability), Humidity: number(w.Humidity),
			WindSpeed: number(w.WindSpeed), UVIndex: number(w.UVIndex),
		}
	}
	if p := g.Profile; p != nil {
		in.Profile = &Profile{Gender: p.Gender, PreferredStyles: p.PreferredStyles, DislikedStyles: p.DislikedStyles, FavoriteColors: p.FavoriteColors, DislikedColors: p.DislikedColors, PreferredFit: p.PreferredFit}
	}
	if c := g.ColorProfile; c != nil {
		in.ColorProfile = &ColorProfile{
			Season: c.Season, SecondarySeason: c.SecondarySeason, Undertone: c.Undertone, Confidence: c.Confidence,
			UndertoneConfidence: c.UndertoneConfidence, SecondaryConfidence: c.SecondaryConfidence,
			RecommendedColors: c.RecommendedColors, NeutralColors: c.NeutralColors, CautionColors: c.CautionColors,
		}
	}
	if f := g.Feedback; f != nil {
		in.Feedback = &Feedback{RejectedItemIDs: f.RejectedItemIDs, LikedItemIDs: f.LikedItemIDs, RejectedOutfitKeys: f.RejectedOutfitKeys}
	}
	return in
}

// asJSON is a result in the shape the golden file stores it in.
func asJSON(r Result, occasion string) map[string]any {
	orNull := func(s string) any {
		if s == "" {
			return nil
		}
		return s
	}
	out := map[string]any{"problem": orNull(string(r.Problem)), "evaluated": float64(r.Evaluated), "weather": nil}
	if wx := r.Weather; wx != nil {
		w := map[string]any{"band": orNull(wx.Band), "feelsLike": nil, "wet": orNull(wx.Wet), "snow": nil, "wind": orNull(wx.Wind), "uvHigh": nil, "completeness": wx.Completeness}
		if wx.FeelsLike != nil {
			w["feelsLike"] = *wx.FeelsLike
		}
		if wx.Snow != nil {
			w["snow"] = *wx.Snow
		}
		if wx.UVHigh != nil {
			w["uvHigh"] = *wx.UVHigh
		}
		out["weather"] = w
	}
	list := func(values []string) []any {
		l := make([]any, len(values))
		for i, v := range values {
			l[i] = v
		}
		return l
	}
	outfits := make([]any, len(r.Outfits))
	for i, c := range r.Outfits {
		items := make([]any, len(c.Items))
		for j, p := range c.Items {
			items[j] = map[string]any{"id": p.Item.ID, "role": p.Role, "slot": string(p.Slot)}
		}
		signals := map[string]any{}
		for name, v := range c.Signals {
			signals[name] = v
		}
		f := c.Factors
		outfits[i] = map[string]any{
			"tempId": c.TempID, "key": c.Key, "mainKey": c.MainKey, "items": items, "score": c.Score, "rawScore": c.RawScore, "signals": signals,
			"factors": map[string]any{
				"weather": f.Weather, "color": f.Color, "occasion": f.Occasion, "style": f.Style,
				"season": f.Season, "balance": f.Balance, "preference": f.Preference, "feedback": f.Feedback,
			},
			"reasons": list(c.Reasons), "reasonLabels": list(c.ReasonLabels), "contrastLevel": c.ContrastLevel,
			"explanation": Explanation(c, occasion, r.Weather),
		}
	}
	out["outfits"] = outfits
	return out
}

// Every golden case gives what the TypeScript engine gives: the same
// outfits in the same order, each field equal, the unrounded score to the
// bit, and the same explanation.
func TestTheEngineGivesWhatTheTypeScriptEngineGives(t *testing.T) {
	t.Parallel()
	g := loadGolden(t)
	withOutfits := 0
	for _, c := range g.Cases {
		var in goldenInput
		if err := json.Unmarshal(c.Input, &in); err != nil {
			t.Fatalf("%s: input: %v", c.Name, err)
		}
		var want map[string]any
		if err := json.Unmarshal(c.Output, &want); err != nil {
			t.Fatalf("%s: output: %v", c.Name, err)
		}
		got := asJSON(Generate(in.input()), in.Occasion)
		if len(want["outfits"].([]any)) > 0 {
			withOutfits++
		}
		if reflect.DeepEqual(got, want) {
			continue
		}
		// Say where it differs first.
		for _, field := range []string{"problem", "evaluated", "weather"} {
			if !reflect.DeepEqual(got[field], want[field]) {
				t.Errorf("%s: %s is %v, want %v", c.Name, field, got[field], want[field])
			}
		}
		gotOutfits, wantOutfits := got["outfits"].([]any), want["outfits"].([]any)
		if len(gotOutfits) != len(wantOutfits) {
			t.Errorf("%s: %d outfits, want %d", c.Name, len(gotOutfits), len(wantOutfits))
			continue
		}
		for i := range wantOutfits {
			g, w := gotOutfits[i].(map[string]any), wantOutfits[i].(map[string]any)
			for field, value := range w {
				if !reflect.DeepEqual(g[field], value) {
					t.Errorf("%s: outfit %d: %s is %v, want %v", c.Name, i+1, field, g[field], value)
				}
			}
		}
	}
	if withOutfits < 100 {
		t.Errorf("only %d golden cases have outfits", withOutfits)
	}
}

// The same input gives the same output, whatever the order of the wardrobe.
func TestTheEngineDoesNotDependOnTheOrderOfTheWardrobe(t *testing.T) {
	t.Parallel()
	g := loadGolden(t)
	for _, c := range g.Cases {
		var in goldenInput
		if err := json.Unmarshal(c.Input, &in); err != nil {
			t.Fatal(err)
		}
		input := in.input()
		ids := map[string]bool{}
		for _, item := range input.Wardrobe {
			if ids[item.ID] {
				ids = nil // an id twice: which one counts depends on the order
				break
			}
			ids[item.ID] = true
		}
		if ids == nil {
			continue
		}
		want := asJSON(Generate(input), in.Occasion)
		reversed := input
		reversed.Wardrobe = make([]Item, len(input.Wardrobe))
		for i, item := range input.Wardrobe {
			reversed.Wardrobe[len(input.Wardrobe)-1-i] = item
		}
		if got := asJSON(Generate(reversed), in.Occasion); !reflect.DeepEqual(got, want) {
			t.Errorf("%s: another order of the wardrobe gives another result", c.Name)
		}
	}
}

func TestCompositionsAndKeysAreTheTypeScriptEngines(t *testing.T) {
	t.Parallel()
	g := loadGolden(t)
	errors := map[CompositionError]bool{}
	for _, c := range g.Compositions {
		items := make([]CompositionItem, len(c.Items))
		for i, item := range c.Items {
			items[i] = CompositionItem{item.ID, item.Category}
		}
		want := CompositionError("")
		if c.Error != nil {
			want = CompositionError(*c.Error)
		}
		errors[want] = true
		if got := ValidateComposition(items); got != want {
			t.Errorf("%v: %q, want %q", c.Items, got, want)
		}
		if want != "" && want.Message() == "" {
			t.Errorf("%s has no message", want)
		}
	}
	if len(errors) != 9 {
		t.Errorf("the golden compositions cover %d outcomes of 9: %v", len(errors), errors)
	}
	for _, k := range g.Keys {
		pieces := make([]KeyPiece, len(k.Pieces))
		for i, p := range k.Pieces {
			pieces[i] = KeyPiece{p.ID, p.Slot}
		}
		if got := Key(pieces); got != k.Key {
			t.Errorf("key %q, want %q", got, k.Key)
		}
	}
	for _, p := range []Problem{EmptyWardrobe, NoFootwear, NoMainPieces, NothingSuitable} {
		if p.Message() == "" {
			t.Errorf("%s has no message", p)
		}
	}
	// The roles a saved item may carry: the seven names, and per slot the
	// older name first.
	if !reflect.DeepEqual(SaveRoles(), []string{"top", "bottom", "shoes", "accessory", "dress", "outerwear", "footwear"}) ||
		!reflect.DeepEqual(RolesFor(Dress), []string{"top", "dress"}) || !reflect.DeepEqual(RolesFor(Footwear), []string{"shoes", "footwear"}) || len(RolesFor("")) != 0 {
		t.Errorf("roles: %v, %v, %v", SaveRoles(), RolesFor(Dress), RolesFor(Footwear))
	}
}
