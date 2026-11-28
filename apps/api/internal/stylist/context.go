package stylist

import (
	"encoding/json"
	"fmt"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"

	"lookly/internal/catalog"
	"lookly/internal/engine"
	"lookly/internal/platform"
)

// The bounded, sanitized context of one turn: what the model may see.
// At most 40 wardrobe items, chosen deterministically (the engine's
// candidates first, then by relevance, round-robin over the categories),
// each with a reference W1…Wn; ids never leave the server. Every attribute
// is a catalog id or nothing, so free text stored on a row cannot reach the
// model as instructions.

// WardrobeRow is an item as the turn loads it.
type WardrobeRow struct {
	engine.Item
	CreatedAt time.Time
}

// Preferences are the user's stated preferences.
type Preferences struct {
	PreferredStyles, DislikedStyles, FavoriteColors, DislikedColors []string
	PreferredFit                                                    *string
}

// ColorProfile is the stored colour profile's summary (no selfie, no raw
// analysis).
type ColorProfile struct {
	Season, Undertone, ContrastLevel                *string
	RecommendedColors, NeutralColors, CautionColors []string
}

// Weather is a complete weather snapshot (the client sends one only while
// it is fresh).
type Weather struct {
	Temperature, FeelsLike                                 float64
	Condition                                              string
	PrecipitationProbability, Humidity, WindSpeed, UVIndex float64
}

// BuildInput is what a context is made of. Occasion is "" for none;
// Weather, Preferences and ColorProfile may be nil.
type BuildInput struct {
	Items        []WardrobeRow
	Candidates   []engine.Candidate
	Occasion     string
	Weather      *Weather
	Preferences  *Preferences
	ColorProfile *ColorProfile
}

// Built is a turn's context.
type Built struct {
	// Data is the context as the model reads it (JSON).
	Data string
	Refs []string
	// Items are the referenced items (to resolve references and to store
	// the ids an answer used).
	Items map[string]Item
	// FirstCandidate are the top candidate's references (the mock's
	// answer), or nil.
	FirstCandidate []string
}

var (
	weatherConditions = []string{"clear", "partly_cloudy", "cloudy", "rain", "thunderstorm", "snow", "fog"}
	undertones        = []string{"warm", "neutral_warm", "neutral", "neutral_cool", "cool"}
	contrasts         = []string{"low", "medium", "high"}
)

func pick(allowed []string, v *string) *string {
	if v == nil || !slices.Contains(allowed, *v) {
		return nil
	}
	return v
}

func pickAll(allowed, values []string, most int) []string {
	out := []string{}
	for _, v := range values {
		if slices.Contains(allowed, v) && !slices.Contains(out, v) {
			out = append(out, v)
		}
	}
	return out[:min(len(out), most)]
}

// occasionFormality are the formalities that suit an occasion (for the
// choice of items only; the engine has its own rules).
var occasionFormality = map[string][]string{
	"work":    {"smart_casual", "formal"},
	"wedding": {"formal", "black_tie"},
	"date":    {"smart_casual", "formal"},
	"travel":  {"casual", "smart_casual"},
	"casual":  {"casual", "smart_casual"},
}

// seasonsFor are the seasons that suit a felt temperature (°C).
func seasonsFor(feelsLike float64) []string {
	switch {
	case feelsLike >= 25:
		return []string{"summer"}
	case feelsLike >= 15:
		return []string{"spring", "autumn", "summer"}
	case feelsLike >= 5:
		return []string{"autumn", "spring", "winter"}
	}
	return []string{"winter"}
}

func str(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// relevance is an item's relevance to the request (higher is better).
func relevance(item engine.Item, in BuildInput) int {
	score := 0
	if formalities, ok := occasionFormality[in.Occasion]; ok && str(item.Formality) != "" {
		if slices.Contains(formalities, *item.Formality) {
			score += 3
		} else {
			score -= 2
		}
	}
	if in.Weather != nil && len(item.Season) > 0 {
		suitable := seasonsFor(in.Weather.FeelsLike)
		if slices.ContainsFunc(item.Season, func(s string) bool { return slices.Contains(suitable, s) }) {
			score += 2
		} else {
			score -= 2
		}
	}
	p := in.Preferences
	if p != nil && str(item.Style) != "" {
		if slices.Contains(p.PreferredStyles, *item.Style) {
			score += 2
		}
		if slices.Contains(p.DislikedStyles, *item.Style) {
			score -= 3
		}
	}
	primary := ""
	if len(item.Colors) > 0 {
		primary = item.Colors[0]
	}
	if p != nil && primary != "" {
		if slices.Contains(p.FavoriteColors, primary) {
			score++
		}
		if slices.Contains(p.DislikedColors, primary) {
			score -= 2
		}
	}
	if cp := in.ColorProfile; cp != nil && primary != "" {
		if slices.Contains(cp.RecommendedColors, primary) || slices.Contains(cp.NeutralColors, primary) {
			score++
		}
		if slices.Contains(cp.CautionColors, primary) {
			score--
		}
	}
	return score
}

// selectWardrobe is the deterministic choice of at most WardrobeItems
// items: the pinned (engine) items first, then rounds over the categories,
// each taking its most relevant remaining item (ties: newest, then id).
func selectWardrobe(in BuildInput, pinned []string) []WardrobeRow {
	byID := map[string]WardrobeRow{}
	for _, row := range in.Items {
		byID[row.ID] = row
	}
	var chosen []WardrobeRow
	taken := map[string]bool{}
	// The pinned ids are distinct, and fewer than the limit (three outfits).
	for _, id := range pinned {
		if row, ok := byID[id]; ok {
			chosen = append(chosen, row)
			taken[id] = true
		}
	}
	type scored struct {
		row   WardrobeRow
		score int
	}
	var rest []scored
	for _, row := range in.Items {
		if !taken[row.ID] {
			rest = append(rest, scored{row, relevance(row.Item, in)})
		}
	}
	sort.SliceStable(rest, func(i, j int) bool {
		a, b := rest[i], rest[j]
		if a.score != b.score {
			return a.score > b.score
		}
		if !a.row.CreatedAt.Equal(b.row.CreatedAt) {
			return a.row.CreatedAt.After(b.row.CreatedAt)
		}
		return a.row.ID < b.row.ID
	})
	queues := map[string][]WardrobeRow{}
	for _, s := range rest {
		key := s.row.Category
		if !slices.Contains(catalog.Categories, key) {
			key = "~other"
		}
		queues[key] = append(queues[key], s.row)
	}
	var order []string
	for _, c := range append(slices.Clone(catalog.Categories), "~other") {
		if _, ok := queues[c]; ok {
			order = append(order, c)
		}
	}
	for len(chosen) < WardrobeItems {
		took := false
		for _, c := range order {
			if q := queues[c]; len(q) > 0 && len(chosen) < WardrobeItems {
				chosen = append(chosen, q[0])
				queues[c] = q[1:]
				took = true
			}
		}
		if !took {
			break
		}
	}
	return chosen
}

// The context's JSON, in the Next.js server's member order.
type contextItem struct {
	Ref         string   `json:"ref"`
	Category    *string  `json:"category"`
	Subcategory *string  `json:"subcategory"`
	Colors      []string `json:"colors"`
	Pattern     *string  `json:"pattern"`
	Material    *string  `json:"material"`
	Style       *string  `json:"style"`
	Season      []string `json:"season"`
	Fit         *string  `json:"fit"`
	Gender      *string  `json:"gender"`
	Formality   *string  `json:"formality"`
}

type contextCandidate struct {
	Items    []string `json:"items"`
	Score    float64  `json:"score"`
	Contrast string   `json:"contrast"`
}

type contextWeather struct {
	Available                   bool    `json:"available"`
	TemperatureC                float64 `json:"temperatureC"`
	FeelsLikeC                  float64 `json:"feelsLikeC"`
	Condition                   *string `json:"condition"`
	PrecipitationProbabilityPct float64 `json:"precipitationProbabilityPct"`
	WindSpeedKmh                float64 `json:"windSpeedKmh"`
	HumidityPct                 float64 `json:"humidityPct"`
	UVIndex                     float64 `json:"uvIndex"`
}

type contextPreferences struct {
	PreferredStyles []string `json:"preferredStyles"`
	DislikedStyles  []string `json:"dislikedStyles"`
	FavoriteColors  []string `json:"favoriteColors"`
	DislikedColors  []string `json:"dislikedColors"`
	PreferredFit    *string  `json:"preferredFit"`
}

type contextColorProfile struct {
	Season            *string  `json:"season"`
	Undertone         *string  `json:"undertone"`
	ContrastLevel     *string  `json:"contrastLevel"`
	RecommendedColors []string `json:"recommendedColors"`
	NeutralColors     []string `json:"neutralColors"`
	CautionColors     []string `json:"cautionColors"`
}

type contextData struct {
	Wardrobe         []contextItem        `json:"wardrobe"`
	WardrobeTotal    int                  `json:"wardrobeTotal"`
	OutfitCandidates []contextCandidate   `json:"outfitCandidates"`
	Weather          any                  `json:"weather"`
	Occasion         *string              `json:"occasion"`
	Preferences      *contextPreferences  `json:"preferences"`
	ColorProfile     *contextColorProfile `json:"colorProfile"`
}

// round is JavaScript's Math.round (which gives -0 for -0.4; JSON.stringify
// writes it 0, and RoundHalfUp gives 0 itself).
func round(v float64) float64 { return platform.RoundHalfUp(v) }

// Build makes the context of a turn.
func Build(in BuildInput) Built {
	candidates := in.Candidates[:min(len(in.Candidates), OutfitCandidates)]
	var pinned []string
	for _, c := range candidates {
		for _, p := range c.Items {
			if !slices.Contains(pinned, p.Item.ID) {
				pinned = append(pinned, p.Item.ID)
			}
		}
	}
	selected := selectWardrobe(in, pinned)
	refOf := map[string]string{}
	built := Built{Refs: []string{}, Items: map[string]Item{}}
	data := contextData{Wardrobe: []contextItem{}, WardrobeTotal: len(in.Items), OutfitCandidates: []contextCandidate{}, Weather: struct {
		Available bool `json:"available"`
	}{}}
	for i, row := range selected {
		ref := "W" + strconv.Itoa(i+1)
		refOf[row.ID] = ref
		category := pick(catalog.Categories, &row.Category)
		var subcategory *string
		if category != nil && row.Subcategory != nil && catalog.SubcategoryOf(*category, *row.Subcategory) {
			subcategory = row.Subcategory
		}
		colors := pickAll(catalog.Colors, row.Colors, 5)
		built.Items[ref] = Item{ID: row.ID, Category: row.Category, Subcategory: subcategory, Colors: colors}
		built.Refs = append(built.Refs, ref)
		data.Wardrobe = append(data.Wardrobe, contextItem{
			Ref: ref, Category: category, Subcategory: subcategory, Colors: colors,
			Pattern: pick(catalog.Patterns, row.Pattern), Material: pick(catalog.Materials, row.Material),
			Style: pick(catalog.Styles, row.Style), Season: pickAll(catalog.Seasons, row.Season, 4), Fit: pick(catalog.Fits, row.Fit),
			Gender: pick(catalog.Genders, row.Gender), Formality: pick(catalog.Formalities, row.Formality),
		})
	}
	for _, c := range candidates {
		refs := []string{}
		for _, p := range c.Items {
			if r, ok := refOf[p.Item.ID]; ok {
				refs = append(refs, r)
			}
		}
		// Every item of a kept candidate is pinned, so selected: refs is
		// never empty.
		data.OutfitCandidates = append(data.OutfitCandidates, contextCandidate{Items: refs, Score: round(c.Score), Contrast: c.ContrastLevel})
	}
	if len(data.OutfitCandidates) > 0 {
		built.FirstCandidate = data.OutfitCandidates[0].Items
	}
	if w := in.Weather; w != nil {
		data.Weather = contextWeather{
			Available: true, TemperatureC: round(w.Temperature), FeelsLikeC: round(w.FeelsLike), Condition: pick(weatherConditions, &w.Condition),
			PrecipitationProbabilityPct: round(w.PrecipitationProbability), WindSpeedKmh: round(w.WindSpeed), HumidityPct: round(w.Humidity),
			UVIndex: round(w.UVIndex*10) / 10,
		}
	}
	if in.Occasion != "" {
		data.Occasion = pick(catalog.Occasions, &in.Occasion)
	}
	if p := in.Preferences; p != nil {
		data.Preferences = &contextPreferences{
			PreferredStyles: pickAll(catalog.Styles, p.PreferredStyles, 8), DislikedStyles: pickAll(catalog.Styles, p.DislikedStyles, 8),
			FavoriteColors: pickAll(catalog.Colors, p.FavoriteColors, 10), DislikedColors: pickAll(catalog.Colors, p.DislikedColors, 10),
			PreferredFit: pick(catalog.Fits, p.PreferredFit),
		}
	}
	if cp := in.ColorProfile; cp != nil {
		data.ColorProfile = &contextColorProfile{
			Season: pick(catalog.Seasons, cp.Season), Undertone: pick(undertones, cp.Undertone), ContrastLevel: pick(contrasts, cp.ContrastLevel),
			RecommendedColors: pickAll(catalog.Colors, cp.RecommendedColors, 12), NeutralColors: pickAll(catalog.Colors, cp.NeutralColors, 12),
			CautionColors: pickAll(catalog.Colors, cp.CautionColors, 12),
		}
	}
	// Every text in it is a catalog id, a reference or a fixed code.
	encoded, err := json.Marshal(data)
	if err != nil {
		panic(fmt.Sprintf("stylist: the context does not encode: %v", err))
	}
	built.Data = string(encoded)
	return built
}

// ─── History and messages ───────────────────────────────────────────────────

// HistoryRow is a stored message of the conversation.
type HistoryRow struct {
	Role, Content string
	// Metadata is the stored metadataJson, parsed (anything for old rows).
	Metadata any
}

// Message is one message of the request.
type Message struct{ Role, Content string }

// isAdvice: a user message, or an answer that was real advice (not a
// fallback apology, not the mock).
func isAdvice(row HistoryRow) bool {
	if row.Role == "user" {
		return true
	}
	if row.Role != "assistant" {
		return false
	}
	if meta, ok := row.Metadata.(map[string]any); ok && (meta["fallback"] == true || meta["provider"] == "none" || meta["provider"] == "mock") {
		return false
	}
	text := strings.TrimFunc(row.Content, platform.IsJSWhiteSpace)
	return text != LegacyFallbackText && !strings.HasPrefix(text, MockPrefix) && !strings.HasPrefix(text, "Demo rejim")
}

// History are the last twelve meaningful messages, oldest first, each
// bounded; only answered exchanges, so the turns alternate.
func History(rows []HistoryRow) []Message {
	var kept []HistoryRow
	for _, r := range rows {
		if strings.TrimFunc(r.Content, platform.IsJSWhiteSpace) != "" && isAdvice(r) {
			kept = append(kept, r)
		}
	}
	var answered []HistoryRow
	for i, r := range kept {
		if r.Role == "assistant" && i > 0 && kept[i-1].Role == "user" ||
			r.Role != "assistant" && i+1 < len(kept) && kept[i+1].Role == "assistant" {
			answered = append(answered, r)
		}
	}
	answered = answered[max(0, len(answered)-HistoryMessages):]
	out := make([]Message, len(answered))
	for i, r := range answered {
		role := "user"
		if r.Role == "assistant" {
			role = "assistant"
		}
		out[i] = Message{Role: role, Content: firstUnits(r.Content, HistoryMessageChars)}
	}
	return out
}

// firstUnits is a text's first n UTF-16 code units, as JavaScript's slice
// takes them (a pair split in the middle keeps its first half, which is
// written as U+FFFD here: Go strings hold no lone surrogates).
func firstUnits(s string, n int) string {
	u := utf16.Encode([]rune(s))
	if len(u) <= n {
		return s
	}
	return string(utf16.Decode(u[:n]))
}

// Messages are the request: SYSTEM (the rules) → CONTEXT (data) → history
// → USER (the untrusted text, as JSON). occasionText is nil for none.
func Messages(context string, history []Message, message string, occasionText *string) []Message {
	occasion := "null"
	if occasionText != nil {
		occasion = platform.JSONString(*occasionText)
	}
	out := []Message{{Role: "system", Content: SystemPrompt}, {Role: "system", Content: ContextPreamble + "\n" + context}}
	out = append(out, history...)
	return append(out, Message{Role: "user", Content: `{"message":` + platform.JSONString(message) + `,"occasion":` + occasion + `}`})
}
