package engine

import (
	"crypto/sha256"
	"encoding/hex"
	"math"
	"slices"
	"strings"
)

// The flow (apps/web/src/lib/ai/outfit-engine.ts):
//
//	wardrobe
//	→ hard eligibility (slot, weather safety, occasion: soft-excluded only
//	  when the slot keeps an alternative)
//	→ per-slot pre-ranking → bounded finalists
//	→ valid compositions only (top+bottom+shoes [+outerwear],
//	  dress+shoes [+outerwear]; layering rules per temperature band)
//	→ scoring (weather, occasion, colour, colour profile, style, layering,
//	  preference, feedback; signals that are not available are left out)
//	→ stable order → variety pool → seeded window → accessories
//
// Arithmetic is written as the TypeScript code performs it, operation by
// operation: the scores must be equal to the bit. Every product that is
// added to something is converted explicitly (float64(a*b)), so that no
// compiler fuses it into a multiply-add with another rounding.

// ─── Inputs ─────────────────────────────────────────────────────────────────

// Item is a wardrobe item as the engine sees it. A nil field is "not
// known" (null in the database).
type Item struct {
	ID           string
	Category     string
	Subcategory  *string
	Colors       []string
	Pattern      *string
	Material     *string
	SleeveLength *string
	Fit          *string
	Style        *string
	Season       []string
	Gender       *string
	Formality    *string
}

// Weather is what is known of the weather; a nil field is not known.
type Weather struct {
	Temperature              *float64
	FeelsLike                *float64
	Condition                *string
	PrecipitationProbability *float64
	Humidity                 *float64
	WindSpeed                *float64
	UVIndex                  *float64
}

// Profile is the user's stated preferences.
type Profile struct {
	Gender          *string
	PreferredStyles []string
	DislikedStyles  []string
	FavoriteColors  []string
	DislikedColors  []string
	PreferredFit    *string
}

// ColorProfile is the stored colour profile (never made up: nil when the
// user has none).
type ColorProfile struct {
	Season              *string
	SecondarySeason     *string
	Undertone           *string
	Confidence          *float64 // nil for profiles from before confidences were stored
	UndertoneConfidence *float64
	SecondaryConfidence *float64
	RecommendedColors   []string
	NeutralColors       []string
	CautionColors       []string
}

// Feedback is what the user's recent feedback says.
type Feedback struct {
	RejectedItemIDs []string
	LikedItemIDs    []string
	// RejectedOutfitKeys are the main-composition keys (Key) of rejected outfits.
	RejectedOutfitKeys []string
}

// Input is one request to the engine.
type Input struct {
	Wardrobe     []Item
	Weather      *Weather
	Occasion     string // "" for none
	Profile      *Profile
	ColorProfile *ColorProfile
	Feedback     *Feedback
	// TopN is how many outfits to return (1–5; nil: 3).
	TopN *float64
	// Seed, when given, picks a window of the best candidates ("another
	// option"): the same seed gives the same outfits.
	Seed *float64
}

// ─── Outputs ────────────────────────────────────────────────────────────────

// Piece is an item in an outfit.
type Piece struct {
	Item Item
	Slot Slot
	// Role is the slot as the API named it before dresses and outerwear
	// had their own: top, bottom, shoes or accessory.
	Role string
}

// Factors are the scores by their older names (50: nothing known).
type Factors struct {
	Weather, Color, Occasion, Style, Season, Balance, Preference, Feedback float64
}

// Candidate is one outfit.
type Candidate struct {
	// TempID identifies the composition (from Key).
	TempID string
	// Key is the canonical composition, accessories included; MainKey,
	// without them (feedback and de-duplication).
	Key, MainKey string
	Items        []Piece
	// Score is RawScore rounded (0–100); RawScore orders.
	Score, RawScore float64
	// Signals are the scores that were available (0–100, rounded).
	Signals map[string]float64
	Factors Factors
	// Reasons are codes in a fixed order; ReasonLabels, their Uzbek labels.
	Reasons, ReasonLabels []string
	ContrastLevel         string // low | medium | high
}

// Problem says why there are no outfits.
type Problem string

// The problems ("" when there are outfits).
const (
	EmptyWardrobe   Problem = "empty_wardrobe"
	NoFootwear      Problem = "no_footwear"
	NoMainPieces    Problem = "no_main_pieces"
	NothingSuitable Problem = "nothing_suitable"
)

// Message is the problem told to the user.
func (p Problem) Message() string { return tables.ProblemMessages[p] }

// Result is the engine's answer.
type Result struct {
	Outfits []Candidate
	Problem Problem
	// Evaluated is how many combinations were scored.
	Evaluated int
	Weather   *WeatherContext
}

// WeatherContext is what the engine derived from the weather; what is not
// known stays unknown ("" or nil).
type WeatherContext struct {
	Band      string // very_cold | cold | mild | warm | hot
	FeelsLike *float64
	Wet       string // likely | possible | no
	Snow      *bool
	Wind      string // strong | windy | calm
	UVHigh    *bool
	// Completeness is the share of temperature, precipitation and wind
	// that is known.
	Completeness float64
}

// ─── Weather context ────────────────────────────────────────────────────────

func finite(v *float64) bool { return v != nil && !math.IsNaN(*v) && !math.IsInf(*v, 0) }

func bandOf(feelsLike float64) string {
	band := tables.TemperatureBands[0].Band
	for i, b := range tables.TemperatureBands {
		if feelsLike >= bandFrom(i) {
			band = b.Band
		}
	}
	return band
}

func weatherContext(w *Weather) *WeatherContext {
	if w == nil {
		return nil
	}
	var feels *float64
	switch {
	case finite(w.FeelsLike):
		feels = w.FeelsLike
	case finite(w.Temperature):
		feels = w.Temperature
	}
	condition := ""
	if w.Condition != nil {
		condition = *w.Condition
	}
	wet := ""
	switch {
	case condition == "rain" || condition == "thunderstorm":
		wet = "likely"
	case finite(w.PrecipitationProbability):
		switch pct := *w.PrecipitationProbability; {
		case pct >= tables.RainLikelyPct:
			wet = "likely"
		case pct >= tables.RainPossiblePct:
			wet = "possible"
		default:
			wet = "no"
		}
	case condition != "":
		wet = "no"
	}
	wind := ""
	if finite(w.WindSpeed) {
		switch speed := *w.WindSpeed; {
		case speed >= tables.StrongWindKmh:
			wind = "strong"
		case speed >= tables.WindyKmh:
			wind = "windy"
		default:
			wind = "calm"
		}
	}
	known := 0
	for _, k := range []bool{feels != nil, wet != "" || condition == "snow", wind != ""} {
		if k {
			known++
		}
	}
	if known == 0 {
		return nil
	}
	wx := &WeatherContext{FeelsLike: feels, Wet: wet, Wind: wind, Completeness: float64(known) / 3}
	if feels != nil {
		wx.Band = bandOf(*feels)
	}
	if condition != "" {
		snow := condition == "snow"
		wx.Snow = &snow
	}
	if finite(w.UVIndex) {
		high := *w.UVIndex >= tables.HighUV
		wx.UVHigh = &high
	}
	return wx
}

func (wx *WeatherContext) band() string {
	if wx == nil {
		return ""
	}
	return wx.Band
}
func (wx *WeatherContext) snow() bool   { return wx != nil && wx.Snow != nil && *wx.Snow }
func (wx *WeatherContext) uvHigh() bool { return wx != nil && wx.UVHigh != nil && *wx.UVHigh }
func (wx *WeatherContext) wet() string {
	if wx == nil {
		return ""
	}
	return wx.Wet
}
func (wx *WeatherContext) wind() string {
	if wx == nil {
		return ""
	}
	return wx.Wind
}
func (wx *WeatherContext) cold() bool  { return wx.band() == "cold" || wx.band() == "very_cold" }
func (wx *WeatherContext) windy() bool { return wx.wind() == "windy" || wx.wind() == "strong" }

// ─── Item semantics ─────────────────────────────────────────────────────────

// str is a nullable field as JavaScript's truthiness reads it: "" for
// null and for the empty string alike.
func str(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func first(colors []string) string {
	if len(colors) == 0 {
		return ""
	}
	return colors[0]
}

// SlotOf is the slot of an item's category ("" for a category that has none).
func SlotOf(category string) Slot { return tables.CategorySlot[category] }

func legacyRole(slot Slot) string {
	switch slot {
	case Bottom:
		return "bottom"
	case Footwear:
		return "shoes"
	case Accessory:
		return "accessory"
	}
	return "top" // top, dress and outerwear were all "top"
}

// warmthOf is 0 (very light) … 3 (very warm).
func warmthOf(item Item) float64 {
	w, ok := 0.0, false
	if sub := str(item.Subcategory); sub != "" {
		w, ok = tables.SubcategoryWarmth[sub]
	}
	if !ok {
		if w, ok = tables.CategoryWarmth[item.Category]; !ok {
			w = 1
		}
	}
	if material := str(item.Material); material != "" {
		w += tables.MaterialWarmth[material]
	}
	if sleeve := str(item.SleeveLength); (item.Category == "shirt" || item.Category == "dress") && sleeve != "" {
		w += tables.SleeveWarmth[sleeve]
	}
	return clamp(w, 0, 3)
}

// formalityOf is the item's formality: its own, else its subcategory's,
// else its style's. known is false when there is none; a stored empty
// value is "known" and empty, as in the TypeScript code (?? stops at it).
func formalityOf(item Item) (formality string, known bool) {
	if item.Formality != nil {
		return *item.Formality, true
	}
	if sub := str(item.Subcategory); sub != "" {
		if f, ok := tables.SubcategoryFormality[sub]; ok {
			return f, true
		}
	}
	if style := str(item.Style); style != "" {
		if f, ok := tables.StyleFormality[style]; ok {
			return f, true
		}
	}
	return "", false
}

func isShortSleeved(item Item) bool {
	sleeve := str(item.SleeveLength)
	return sleeve == "short" || sleeve == "sleeveless" || str(item.Subcategory) == "tshirt"
}

// exposedWithOuterwear: an outer layer over shorts or sandals is never a
// coherent outfit.
func exposedWithOuterwear(bottom, shoes *Item) bool {
	return (bottom != nil && str(bottom.Subcategory) == "shorts") || (shoes != nil && str(shoes.Subcategory) == "sandals")
}

// ─── Hard eligibility ───────────────────────────────────────────────────────

func weatherExcludes(item Item, slot Slot, wx *WeatherContext) bool {
	if wx == nil {
		return false
	}
	sub := str(item.Subcategory)
	switch {
	case wx.cold() && (sub == "shorts" || sub == "sandals"):
		return true
	case wx.Band == "hot" && slot == Outerwear && warmthOf(item) >= 2:
		return true
	case (wx.snow() || wx.Wet == "likely") && sub == "sandals":
		return true
	}
	if slot == Accessory {
		if sub == "sunglasses" && (wx.snow() || wx.Wet == "likely") {
			return true
		}
		if sub == "hat" && wx.Wind == "strong" {
			return true
		}
	}
	return false
}

func occasionDiscourages(item Item, occasion string) bool {
	if occasion == "" {
		return false
	}
	if style := str(item.Style); style != "" && tables.OffOccasionStyles[occasion][style] {
		return true
	}
	f, _ := formalityOf(item)
	return tables.DressyOccasions[occasion] && f == "casual"
}

// ─── Single-item fit ────────────────────────────────────────────────────────

// opt is a score that may be absent (null in the TypeScript code).
type opt struct {
	v  float64
	ok bool
}

func some(v float64) opt { return opt{v, true} }

var none = opt{}

func formalityFit(item Item, occasion string) opt {
	f, _ := formalityOf(item)
	if occasion == "" || f == "" {
		return none
	}
	suited := tables.OccasionFormality[occasion]
	if slices.Contains(suited, f) {
		return some(100)
	}
	idx := slices.Index(tables.FormalityOrder, f) // -1 for a formality that is not one
	distance := math.Inf(1)
	for _, o := range suited {
		distance = math.Min(distance, math.Abs(float64(slices.Index(tables.FormalityOrder, o)-idx)))
	}
	return some([]float64{100, 65, 35, 10}[int(math.Min(distance, 3))])
}

var bandSeasons = map[string][]string{
	"very_cold": {"winter"},
	"cold":      {"winter", "autumn"},
	"mild":      {"spring", "autumn"},
	"warm":      {"spring", "summer"},
	"hot":       {"summer"},
}

func seasonTagFit(item Item, wx *WeatherContext) opt {
	if wx.band() == "" || len(item.Season) == 0 {
		return none
	}
	for _, s := range item.Season {
		if slices.Contains(bandSeasons[wx.Band], s) {
			return some(100)
		}
	}
	return some(30)
}

func preferenceFit(item Item, p *Profile) opt {
	if p == nil {
		return none
	}
	preferredFit := str(p.PreferredFit)
	if len(p.PreferredStyles) == 0 && len(p.DislikedStyles) == 0 && len(p.FavoriteColors) == 0 && len(p.DislikedColors) == 0 && preferredFit == "" {
		return none
	}
	s := 70.0
	style := str(item.Style)
	if style != "" && slices.Contains(p.PreferredStyles, style) {
		s += 20
	}
	if style != "" && slices.Contains(p.DislikedStyles, style) {
		s -= 30
	}
	if slices.ContainsFunc(item.Colors, func(c string) bool { return slices.Contains(p.FavoriteColors, c) }) {
		s += 12
	}
	if slices.ContainsFunc(item.Colors, func(c string) bool { return slices.Contains(p.DislikedColors, c) }) {
		s -= 25
	}
	if preferredFit != "" && item.Fit != nil && *item.Fit == preferredFit {
		s += 8
	}
	return some(clamp(s, 0, 100))
}

func itemFeedback(item Item, fb *Feedback) opt {
	if fb == nil || (len(fb.RejectedItemIDs) == 0 && len(fb.LikedItemIDs) == 0) {
		return none
	}
	s := 70.0
	if slices.Contains(fb.RejectedItemIDs, item.ID) {
		s -= 25
	}
	if slices.Contains(fb.LikedItemIDs, item.ID) {
		s += 15
	}
	return some(clamp(s, 0, 100))
}

var idealWarmth = map[string]float64{"very_cold": 3, "cold": 2.5, "mild": 1.5, "warm": 1, "hot": 0.3}

func itemWeatherFit(item Item, slot Slot, wx *WeatherContext) opt {
	if wx == nil {
		return none
	}
	var parts []float64
	sub := str(item.Subcategory)
	if wx.Band != "" {
		parts = append(parts, 100-float64(25*math.Abs(warmthOf(item)-idealWarmth[wx.Band])))
	}
	if slot == Footwear && (wx.Wet == "likely" || wx.snow()) {
		suited := tables.WetFootwear
		if wx.snow() {
			suited = tables.SnowFootwear
		}
		if sub != "" && suited[sub] {
			parts = append(parts, 100)
		} else {
			parts = append(parts, 40)
		}
	}
	if slot == Outerwear && (wx.Wet == "likely" || wx.windy()) {
		if sub != "" && tables.ProtectiveOuterwear[sub] {
			parts = append(parts, 100)
		} else {
			parts = append(parts, 50)
		}
	}
	if tag := seasonTagFit(item, wx); tag.ok {
		parts = append(parts, tag.v)
	}
	if len(parts) == 0 {
		return none
	}
	sum := 0.0
	for _, p := range parts {
		sum += p
	}
	return some(sum / float64(len(parts)))
}

type weighted struct {
	value  opt
	weight float64
}

// weightedMean is the mean of the values that are there, by their weights.
func weightedMean(values []weighted) opt {
	num, den := 0.0, 0.0
	for _, x := range values {
		if !x.value.ok || x.weight <= 0 {
			continue
		}
		num += float64(x.value.v * x.weight)
		den += x.weight
	}
	if den == 0 {
		return none
	}
	return some(num / den)
}

// itemRank is the pre-ranking score of one item for its slot.
func itemRank(item Item, slot Slot, ctx *context) float64 {
	profileFit := none
	if tables.ProfileSlotWeight[slot] > 0 {
		profileFit = profileColorFit(first(item.Colors), ctx.cp)
	}
	num, den := 0.0, 0.0
	for _, x := range []weighted{
		{itemWeatherFit(item, slot, ctx.wx), 0.35},
		{formalityFit(item, ctx.occasion), 0.3},
		{preferenceFit(item, ctx.profile), 0.15},
		{profileFit, 0.1},
		{itemFeedback(item, ctx.feedback), 0.1},
	} {
		if !x.value.ok {
			continue
		}
		num += float64(x.value.v * x.weight)
		den += x.weight
	}
	if den == 0 {
		return 50
	}
	return num / den
}

// ─── Colour profile ─────────────────────────────────────────────────────────

type profileContext struct {
	strength                                 float64
	recommended, neutral, caution, secondary set
	undertone                                string // warm | cool | ""
}

func setOf(list []string) set {
	s := make(set, len(list))
	for _, v := range list {
		s[v] = true
	}
	return s
}

// ProfileStrength is how strongly the engine uses a colour profile (its
// confidence, or the legacy default), nil when it uses none.
func ProfileStrength(cp *ColorProfile) *float64 {
	if p := profileOf(cp); p != nil {
		return &p.strength
	}
	return nil
}

// profileOf is the usable part of a colour profile, or nil when it should
// not influence anything.
func profileOf(cp *ColorProfile) *profileContext {
	if cp == nil {
		return nil
	}
	strength := tables.LegacyProfileConf
	if cp.Confidence != nil {
		strength = *cp.Confidence
	}
	undertoneConfidence := 0.0
	switch {
	case cp.UndertoneConfidence != nil:
		undertoneConfidence = *cp.UndertoneConfidence
	case cp.Confidence == nil:
		undertoneConfidence = tables.LegacyProfileConf
	}
	undertone := ""
	if undertoneConfidence >= tables.UndertoneMinConf {
		switch str(cp.Undertone) {
		case "warm", "neutral_warm":
			undertone = "warm"
		case "cool", "neutral_cool":
			undertone = "cool"
		}
	}
	season := str(cp.Season)
	if strength < tables.ProfileMinConfidence || (season == "" && undertone == "") {
		return nil
	}
	out := &profileContext{strength: strength, undertone: undertone, recommended: set{}, neutral: set{}, caution: set{}, secondary: set{}}
	if season != "" {
		out.recommended, out.neutral, out.caution = setOf(cp.RecommendedColors), setOf(cp.NeutralColors), setOf(cp.CautionColors)
	}
	if secondary := str(cp.SecondarySeason); secondary != "" && cp.SecondaryConfidence != nil && *cp.SecondaryConfidence >= 0.2 {
		out.secondary = setOf(tables.SeasonalPalettes[secondary].Recommended)
	}
	return out
}

func profileColorFit(color string, cp *profileContext) opt {
	if cp == nil || color == "" {
		return none
	}
	s := 55.0
	switch {
	case cp.caution[color]:
		s = 20
	case cp.recommended[color]:
		s = 100
	case cp.neutral[color]:
		s = 80
	case cp.secondary[color]:
		s = 75
	}
	if m, ok := metaOf(color); ok && cp.undertone != "" && m.temperature != "neutral" {
		if m.temperature == cp.undertone {
			s += 10
		} else {
			s -= 10
		}
	}
	return some(clamp(s, 0, 100))
}

// ─── Outfit signals ─────────────────────────────────────────────────────────

type context struct {
	wx                 *WeatherContext
	occasion           string
	profile            *Profile
	cp                 *profileContext
	feedback           *Feedback
	outerwearAvailable bool
}

func find(pieces []Piece, slot Slot) *Piece {
	for i := range pieces {
		if pieces[i].Slot == slot {
			return &pieces[i]
		}
	}
	return nil
}

func count(pieces []Piece, match func(Piece) bool) float64 {
	n := 0.0
	for _, p := range pieces {
		if match(p) {
			n++
		}
	}
	return n
}

type weatherScore struct {
	score, availability float64
	season              opt
}

func weatherSignal(pieces []Piece, ctx *context) (weatherScore, bool) {
	wx := ctx.wx
	if wx == nil {
		return weatherScore{}, false
	}
	var parts []weighted
	if wx.Band != "" {
		total := 0.0
		for _, p := range pieces {
			total += warmthOf(p.Item)
		}
		target := tables.TargetWarmth[wx.Band]
		distance := 0.0
		switch {
		case total < target.Min:
			distance = target.Min - total
		case total > target.Max:
			distance = total - target.Max
		}
		parts = append(parts, weighted{some(clamp(100-float64(18*distance), 0, 100)), 0.45})
	}
	outer, shoes := find(pieces, Outerwear), find(pieces, Footwear)
	protective := outer != nil && tables.ProtectiveOuterwear[str(outer.Item.Subcategory)]
	shoeSub := ""
	if shoes != nil {
		shoeSub = str(shoes.Item.Subcategory)
	}
	if wx.Wet == "likely" || wx.Wet == "possible" {
		k := 0.5
		if wx.Wet == "likely" {
			k = 1
		}
		s := 100.0
		if !tables.WetFootwear[shoeSub] {
			s -= float64(30 * k)
		}
		if !protective {
			s -= float64(25 * k)
		}
		sensitive := count(pieces, func(p Piece) bool { return tables.WetSensitiveMaterials[str(p.Item.Material)] })
		s -= float64(float64(12*k) * sensitive)
		parts = append(parts, weighted{some(clamp(s, 0, 100)), 0.25})
	}
	if wx.snow() {
		v := 35.0
		if tables.SnowFootwear[shoeSub] {
			v = 100
		}
		parts = append(parts, weighted{some(v), 0.25})
	}
	if wx.windy() {
		k := 0.5
		if wx.Wind == "strong" {
			k = 1
		}
		s := 100.0
		if !protective {
			s = 100 - float64(30*k)
		}
		loose := count(pieces, func(p Piece) bool { fit := str(p.Item.Fit); return fit == "oversized" || fit == "relaxed" })
		s -= float64(float64(6*k) * loose)
		if find(pieces, Dress) != nil {
			s -= float64(10 * k)
		}
		parts = append(parts, weighted{some(clamp(s, 0, 100)), 0.2})
	}
	tags := make([]weighted, len(pieces))
	for i, p := range pieces {
		tags[i] = weighted{seasonTagFit(p.Item, wx), tables.SlotWeight[p.Slot]}
	}
	season := weightedMean(tags)
	if season.ok {
		parts = append(parts, weighted{season, 0.15})
	}
	score := weightedMean(parts)
	if !score.ok {
		return weatherScore{}, false
	}
	return weatherScore{score: score.v, availability: wx.Completeness, season: season}, true
}

func occasionSignal(pieces []Piece, ctx *context) (score, availability float64, ok bool) {
	if ctx.occasion == "" {
		return 0, 0, false
	}
	fits := make([]weighted, len(pieces))
	var colors [][]string
	for i, p := range pieces {
		fits[i] = weighted{formalityFit(p.Item, ctx.occasion), tables.SlotWeight[p.Slot]}
		if len(p.Item.Colors) > 0 {
			colors = append(colors, p.Item.Colors)
		}
	}
	formality := weightedMean(fits)
	offStyle := count(pieces, func(p Piece) bool {
		style := str(p.Item.Style)
		return style != "" && tables.OffOccasionStyles[ctx.occasion][style]
	})
	colorPart := none
	if len(colors) > 0 {
		colorPart = some(occasionColorScore(colors, ctx.occasion))
	}
	base := weightedMean([]weighted{{formality, 0.75}, {colorPart, 0.25}})
	if !base.ok {
		return 0, 0, false
	}
	availability = 1
	if !formality.ok {
		availability = 0.5
	}
	return clamp(base.v-float64(20*offStyle), 0, 100), availability, true
}

// colorSignal is the harmony of the dominant colours weighted by visual
// area, with the neutral balance, the number of accents and the contrast.
func colorSignal(pieces []Piece, occasion string) opt {
	var main []Piece
	for _, p := range pieces {
		if p.Slot != Accessory && len(p.Item.Colors) > 0 {
			main = append(main, p)
		}
	}
	if len(main) < 2 {
		return none
	}
	num, den := 0.0, 0.0
	for i := range main {
		for j := i + 1; j < len(main); j++ {
			a, b := main[i].Item.Colors, main[j].Item.Colors
			w := float64(tables.SlotArea[main[i].Slot] * tables.SlotArea[main[j].Slot])
			// The dominant colours decide; the others count a little.
			dominant := pairScore(a[0], b[0])
			secondary := dominant
			if n := len(a) - 1 + len(b) - 1; n > 0 {
				sum := 0.0
				for _, c := range a[1:] {
					sum += pairScore(c, b[0])
				}
				for _, c := range b[1:] {
					sum += pairScore(a[0], c)
				}
				secondary = sum / float64(n)
			}
			num += float64(w * (float64(0.8*dominant) + float64(0.2*secondary)))
			den += w
		}
	}
	s := num / den
	neutral := false
	accents := map[float64]bool{}
	dominants := make([][]string, len(main))
	for i, p := range main {
		dominants[i] = []string{p.Item.Colors[0]}
		m, ok := metaOf(p.Item.Colors[0])
		switch {
		case !ok:
		case m.neutral:
			neutral = true
		default:
			accents[jsRound(m.hue/30)] = true
		}
	}
	if neutral {
		s += 5
	}
	if len(accents) > 2 {
		s -= float64(12 * float64(len(accents)-2))
	}
	if occasion != "" && tables.DressyOccasions[occasion] && contrastOf(dominants) == "high" {
		s -= 5
	}
	return some(clamp(s, 0, 100))
}

func profileSignal(pieces []Piece, ctx *context) (score, availability float64, ok bool) {
	if ctx.cp == nil {
		return 0, 0, false
	}
	fits := make([]weighted, len(pieces))
	for i, p := range pieces {
		fits[i] = weighted{profileColorFit(first(p.Item.Colors), ctx.cp), tables.ProfileSlotWeight[p.Slot]}
	}
	s := weightedMean(fits)
	if !s.ok {
		return 0, 0, false
	}
	return s.v, clamp(ctx.cp.strength/0.8, 0, 1), true
}

func styleSignal(pieces []Piece) opt {
	var styles []string
	for _, p := range pieces {
		if style := str(p.Item.Style); p.Slot != Accessory && style != "" {
			styles = append(styles, style)
		}
	}
	if len(styles) < 2 {
		return none
	}
	slices.SortFunc(styles, compareJS)
	unique := slices.Compact(styles)
	if len(unique) == 1 {
		return some(95)
	}
	inOneFamily := func(styles ...string) bool {
		return slices.ContainsFunc(tables.StyleFamilies, func(family set) bool {
			return !slices.ContainsFunc(styles, func(s string) bool { return !family[s] })
		})
	}
	if inOneFamily(unique...) {
		return some(82)
	}
	pairs, ok := 0.0, 0.0
	for i := range unique {
		for j := i + 1; j < len(unique); j++ {
			pairs++
			if inOneFamily(unique[i], unique[j]) {
				ok++
			}
		}
	}
	return some(45 + float64(30*(ok/pairs)))
}

func layeringSignal(pieces []Piece, ctx *context) (score, availability float64) {
	outer := find(pieces, Outerwear)
	dress := find(pieces, Dress) != nil
	dressy := ctx.occasion != "" && tables.DressyOccasions[ctx.occasion]
	wx := ctx.wx
	pickScore := func(cond bool, yes, no float64) float64 {
		if cond {
			return yes
		}
		return no
	}
	if wx.band() == "" {
		if outer != nil {
			return pickScore(dressy, 80, 70), 0.5
		}
		return 75, 0.5
	}
	var s float64
	switch wx.Band {
	case "very_cold", "cold":
		switch {
		case outer != nil:
			s = 95
		case ctx.outerwearAvailable:
			s = 40
		default:
			s = 55
		}
		if outer == nil && dress {
			s -= 10
		}
	case "mild":
		s = 80
		if outer != nil {
			s = pickScore(warmthOf(outer.Item) <= 2, 88, 70)
		}
	case "warm":
		s = 90
		if outer != nil {
			s = pickScore(dressy && str(outer.Item.Subcategory) == "blazer", 85, 62)
		}
	case "hot":
		s = 95
		if outer != nil {
			s = pickScore(dressy, 60, 45)
		}
	}
	if wx.Wet == "likely" || wx.windy() {
		s += pickScore(outer != nil && tables.ProtectiveOuterwear[str(outer.Item.Subcategory)], 8, -8)
	}
	return clamp(s, 0, 100), 1
}

func preferenceSignal(pieces []Piece, ctx *context) opt {
	// Only main pieces are scored here, and each of their slots has a
	// weight (the TypeScript code's fallback for a slot without one is
	// never reached).
	fits := make([]weighted, len(pieces))
	for i, p := range pieces {
		fits[i] = weighted{preferenceFit(p.Item, ctx.profile), tables.SlotWeight[p.Slot]}
	}
	return weightedMean(fits)
}

func feedbackSignal(pieces []Piece, mainKey string, ctx *context) opt {
	fb := ctx.feedback
	if fb == nil {
		return none
	}
	if slices.Contains(fb.RejectedOutfitKeys, mainKey) {
		return some(5)
	}
	sum, n := 0.0, 0
	for _, p := range pieces {
		if v := itemFeedback(p.Item, fb); v.ok {
			sum += v.v
			n++
		}
	}
	if n == 0 {
		if len(fb.RejectedOutfitKeys) > 0 {
			return some(70)
		}
		return none
	}
	return some(sum / float64(n))
}

// ─── Reasons ────────────────────────────────────────────────────────────────

func reasonsOf(pieces []Piece, signals map[string]float64, ctx *context) (codes, labels []string) {
	has := func(slot Slot, in set) bool {
		return slices.ContainsFunc(pieces, func(p Piece) bool {
			return p.Slot == slot && (in == nil || in[str(p.Item.Subcategory)])
		})
	}
	wx := ctx.wx
	holds := map[string]bool{
		"weather":       signals["weather"] >= 80,
		"warm_layers":   wx.cold() && has(Outerwear, nil),
		"rain_ready":    !wx.snow() && (wx.wet() == "likely" || wx.wet() == "possible") && has(Outerwear, tables.ProtectiveOuterwear) && has(Footwear, tables.WetFootwear),
		"snow_ready":    wx.snow() && has(Footwear, tables.SnowFootwear),
		"wind_ready":    wx.windy() && has(Outerwear, tables.ProtectiveOuterwear),
		"occasion":      signals["occasion"] >= 80,
		"color_harmony": signals["color"] >= 80,
		"neutral_balance": signals["color"] >= 70 && slices.ContainsFunc(pieces, func(p Piece) bool {
			m, ok := metaOf(first(p.Item.Colors))
			return p.Slot != Accessory && ok && m.neutral
		}),
		"color_profile": signals["profile"] >= 80,
		"style_match":   signals["style"] >= 80,
		"preference":    signals["preference"] >= 80,
	}
	codes, labels = []string{}, []string{}
	for _, r := range tables.ReasonLabels {
		if holds[r.Code] {
			codes, labels = append(codes, r.Code), append(labels, r.Label)
		}
	}
	return codes, labels
}

// ─── Keys, order, seed ──────────────────────────────────────────────────────

var slotKeyOrder = []Slot{Top, Bottom, Dress, Outerwear, Footwear}

// KeyPiece is an item's id and slot, for a composition's key.
type KeyPiece struct {
	ID   string
	Slot Slot
}

// Key is the canonical key of a composition: one id per main slot, the
// accessories sorted. Two outfits are the same when their keys are equal.
func Key(pieces []KeyPiece) string {
	var b strings.Builder
	for _, slot := range slotKeyOrder {
		id := "-"
		for _, p := range pieces {
			if p.Slot == slot {
				id = p.ID
				break
			}
		}
		b.WriteString(string(slot[:1]) + ":" + id + "|")
	}
	var accessories []string
	for _, p := range pieces {
		if p.Slot == Accessory {
			accessories = append(accessories, p.ID)
		}
	}
	slices.SortFunc(accessories, compareJS)
	return b.String() + "a:" + strings.Join(accessories, ",")
}

func keyOf(pieces []Piece) string {
	ids := make([]KeyPiece, len(pieces))
	for i, p := range pieces {
		ids[i] = KeyPiece{p.Item.ID, p.Slot}
	}
	return Key(ids)
}

// keyID is an id for a canonical key.
func keyID(key string) string {
	sum := sha256.Sum256([]byte(key))
	return "o_" + hex.EncodeToString(sum[:])[:20]
}

// compareCandidates orders by score, then by the weather, occasion and
// colour scores, then by the key.
func compareCandidates(a, b Candidate) int {
	signal := func(c Candidate, name string) float64 {
		if v, ok := c.Signals[name]; ok {
			return v
		}
		return -1
	}
	for _, d := range []float64{
		b.RawScore - a.RawScore,
		signal(b, "weather") - signal(a, "weather"),
		signal(b, "occasion") - signal(a, "occasion"),
		signal(b, "color") - signal(a, "color"),
	} {
		switch {
		case d < 0:
			return -1
		case d > 0:
			return 1
		}
	}
	return compareJS(a.Key, b.Key)
}

// varietyPool takes up to the pool's size from a sorted list, preferring
// variety: an item in at most MaxItemRepeat of them; repeats only fill the
// places that are left.
func varietyPool(sorted []Candidate) []Candidate {
	var pool, skipped []Candidate
	uses := map[string]int{}
	for _, c := range sorted {
		if len(pool) >= tables.PoolSize {
			break
		}
		if !slices.ContainsFunc(c.Items, func(p Piece) bool { return uses[p.Item.ID] >= tables.MaxItemRepeat }) {
			pool = append(pool, c)
			for _, p := range c.Items {
				uses[p.Item.ID]++
			}
		} else {
			skipped = append(skipped, c)
		}
	}
	for _, c := range skipped {
		if len(pool) < tables.PoolSize {
			pool = append(pool, c)
		}
	}
	return pool
}

// selectWithSeed: without a seed, the best n; with one, a window of n from
// the pool (the best first within it), filled up from the top when the
// window is short.
func selectWithSeed(pool []Candidate, n int, seed *float64) []Candidate {
	if seed == nil || len(pool) <= n {
		return pool[:min(n, len(pool))]
	}
	windows := (len(pool) + n - 1) / n
	start := int(seedHash(*seed)%uint32(windows)) * n
	picked := make([]bool, len(pool))
	taken := 0
	for i := start; i < min(start+n, len(pool)); i++ {
		picked[i] = true
		taken++
	}
	for i := 0; i < len(pool) && taken < n; i++ {
		if !picked[i] {
			picked[i] = true
			taken++
		}
	}
	out := make([]Candidate, 0, n)
	for i, c := range pool {
		if picked[i] {
			out = append(out, c)
		}
	}
	return out
}

// ─── Accessories (ranked on their own; never required) ──────────────────────

func accessoryScore(item Item, main []Piece, ctx *context) float64 {
	wx, occ := ctx.wx, ctx.occasion
	is := func(occasions ...string) bool { return occ != "" && slices.Contains(occasions, occ) }
	s := 50.0
	switch str(item.Subcategory) {
	case "scarf":
		switch {
		case wx.cold() || wx.windy():
			s += 35
		case wx.band() == "hot" || wx.band() == "warm":
			s -= 40
		}
	case "hat":
		if (wx.band() == "hot" && wx.uvHigh()) || wx.cold() {
			s += 25
		}
	case "sunglasses":
		if wx.uvHigh() {
			s += 30
		}
	case "watch":
		if is("work", "wedding", "date") {
			s += 25
		} else {
			s += 8
		}
	case "belt":
		if find(main, Bottom) != nil && is("work", "wedding") {
			s += 20
		}
	case "clutch":
		switch {
		case is("wedding", "date"):
			s += 30
		case is("work", "travel"):
			s -= 20
		}
	case "tote":
		switch {
		case is("work", "casual"):
			s += 20
		case is("wedding"):
			s -= 20
		}
	case "backpack":
		switch {
		case is("travel", "casual"):
			s += 25
		case is("wedding", "work"):
			s -= 40
		}
	case "crossbody":
		if is("casual", "date", "travel") {
			s += 15
		}
	}
	if f := formalityFit(item, occ); f.ok {
		s += (f.v - 70) / 2
	}
	if color := first(item.Colors); color != "" {
		best, any := math.Inf(-1), false
		for _, p := range main {
			if c := first(p.Item.Colors); c != "" {
				best, any = math.Max(best, pairScore(color, c)), true
			}
		}
		if any {
			s += (best - 70) / 2
		}
	}
	if pref := preferenceFit(item, ctx.profile); pref.ok {
		s += (pref.v - 70) / 2
	}
	return clamp(s, 0, 100)
}

func bestAccessory(candidates []Item, main []Piece, ctx *context) *Item {
	var best *Item
	bestScore := 0.0
	for i, item := range candidates {
		s := accessoryScore(item, main, ctx)
		if s >= tables.AccessoryMinScore && (best == nil || s > bestScore || (s == bestScore && compareJS(item.ID, best.ID) < 0)) {
			best, bestScore = &candidates[i], s
		}
	}
	return best
}

// ─── Scoring one composition ────────────────────────────────────────────────

// signalOrder is the order the signals are summed in.
var signalOrder = []string{"weather", "occasion", "color", "profile", "style", "layering", "preference", "feedback"}

func scoreComposition(pieces []Piece, ctx *context) Candidate {
	mainKey := keyOf(pieces)
	weather, hasWeather := weatherSignal(pieces, ctx)
	occasion, occasionAvailability, hasOccasion := occasionSignal(pieces, ctx)
	color := colorSignal(pieces, ctx.occasion)
	profile, profileAvailability, hasProfile := profileSignal(pieces, ctx)
	style := styleSignal(pieces)
	layering, layeringAvailability := layeringSignal(pieces, ctx)
	preference := preferenceSignal(pieces, ctx)
	feedback := feedbackSignal(pieces, mainKey, ctx)

	values := map[string]weighted{
		"weather":    {opt{weather.score, hasWeather}, weather.availability},
		"occasion":   {opt{occasion, hasOccasion}, occasionAvailability},
		"color":      {color, 1},
		"profile":    {opt{profile, hasProfile}, profileAvailability},
		"style":      {style, 1},
		"layering":   {some(layering), layeringAvailability},
		"preference": {preference, 1},
		"feedback":   {feedback, 1},
	}
	signals := map[string]float64{}
	num, den := 0.0, 0.0
	for _, name := range signalOrder {
		x := values[name]
		if !x.value.ok || x.weight <= 0 {
			continue
		}
		signals[name] = jsRound(x.value.v)
		share := float64(tables.Weights[name] * x.weight)
		num += float64(share * x.value.v)
		den += share
	}
	raw := 50.0
	if den != 0 {
		raw = num / den
	}
	rounded := func(v opt) float64 {
		if !v.ok {
			return 50
		}
		return jsRound(v.v)
	}
	var colors [][]string
	for _, p := range pieces {
		if p.Slot != Accessory {
			colors = append(colors, p.Item.Colors)
		}
	}
	reasons, labels := reasonsOf(pieces, signals, ctx)
	return Candidate{
		TempID: keyID(mainKey), Key: mainKey, MainKey: mainKey,
		Items: pieces, Score: jsRound(raw), RawScore: raw, Signals: signals,
		Factors: Factors{
			Weather: rounded(opt{weather.score, hasWeather}), Color: rounded(color), Occasion: rounded(opt{occasion, hasOccasion}),
			Style: rounded(style), Season: rounded(opt{weather.season.v, hasWeather && weather.season.ok}), Balance: jsRound(layering),
			Preference: rounded(preference), Feedback: rounded(feedback),
		},
		Reasons: reasons, ReasonLabels: labels, ContrastLevel: contrastOf(colors),
	}
}

// ─── The entry ──────────────────────────────────────────────────────────────

func byID(a, b Item) int { return compareJS(a.ID, b.ID) }

// Generate makes the outfits for the input.
func Generate(in Input) Result {
	wx := weatherContext(in.Weather)
	// One entry per id (the last one given), in the order of the ids: the
	// order of the input never matters.
	byItemID := map[string]Item{}
	for _, item := range in.Wardrobe {
		byItemID[item.ID] = item
	}
	unique := make([]Item, 0, len(byItemID))
	for _, item := range byItemID {
		unique = append(unique, item)
	}
	slices.SortFunc(unique, byID)
	if len(unique) == 0 {
		return Result{Outfits: []Candidate{}, Problem: EmptyWardrobe, Weather: wx}
	}

	bySlot := map[Slot][]Item{}
	excludedByWeather := 0
	for _, item := range unique {
		slot := SlotOf(item.Category)
		if slot == "" {
			continue
		}
		if weatherExcludes(item, slot, wx) {
			excludedByWeather++
			continue
		}
		bySlot[slot] = append(bySlot[slot], item)
	}
	// The occasion drops discouraged items only where the slot keeps an alternative.
	for slot, items := range bySlot {
		kept := slices.DeleteFunc(slices.Clone(items), func(i Item) bool { return occasionDiscourages(i, in.Occasion) })
		if len(kept) > 0 {
			bySlot[slot] = kept
		}
	}

	ctx := &context{wx: wx, occasion: in.Occasion, profile: in.Profile, cp: profileOf(in.ColorProfile), feedback: in.Feedback, outerwearAvailable: len(bySlot[Outerwear]) > 0}

	hasMain := (len(bySlot[Top]) > 0 && len(bySlot[Bottom]) > 0) || len(bySlot[Dress]) > 0
	if len(bySlot[Footwear]) == 0 || !hasMain {
		raw := func(slot Slot) bool {
			return slices.ContainsFunc(unique, func(i Item) bool { return SlotOf(i.Category) == slot })
		}
		problem := NoMainPieces
		switch {
		case !raw(Footwear):
			problem = NoFootwear
		case !((raw(Top) && raw(Bottom)) || raw(Dress)):
			problem = NoMainPieces
		case excludedByWeather > 0:
			problem = NothingSuitable
		}
		return Result{Outfits: []Candidate{}, Problem: problem, Weather: wx}
	}

	// Pre-ranking per slot → bounded finalists.
	finalists := map[Slot][]Item{}
	for slot, limit := range tables.SlotLimits {
		type ranked struct {
			item Item
			s    float64
		}
		list := make([]ranked, len(bySlot[slot]))
		for i, item := range bySlot[slot] {
			list[i] = ranked{item, itemRank(item, slot, ctx)}
		}
		slices.SortStableFunc(list, func(a, b ranked) int {
			switch {
			case b.s < a.s:
				return -1
			case b.s > a.s:
				return 1
			}
			return byID(a.item, b.item)
		})
		for _, r := range list[:min(limit, len(list))] {
			finalists[slot] = append(finalists[slot], r.item)
		}
	}

	// Layering rules (hard): very cold needs a layer when one exists; cold
	// needs one over short sleeves or a dress.
	layeringAllowed := func(base Item, isDress bool, outer, bottom *Item, shoes Item) bool {
		switch {
		case outer != nil:
			return !exposedWithOuterwear(bottom, &shoes)
		case !ctx.outerwearAvailable:
			return true
		case wx.band() == "very_cold":
			return false
		case wx.cold() && (isDress || isShortSleeved(base)):
			return false
		}
		return true
	}
	outerOptions := make([]*Item, 0, 1+len(finalists[Outerwear]))
	outerOptions = append(outerOptions, nil)
	for i := range finalists[Outerwear] {
		outerOptions = append(outerOptions, &finalists[Outerwear][i])
	}

	scored := map[string]Candidate{}
	evaluated := 0
	consider := func(pieces []Piece) {
		// A bound for other tables: with the present limits of finalists
		// there are at most 3840 combinations, below it.
		if evaluated >= tables.MaxCandidates {
			return
		}
		evaluated++
		c := scoreComposition(pieces, ctx)
		if _, seen := scored[c.MainKey]; !seen {
			scored[c.MainKey] = c
		}
	}
	piece := func(item Item, slot Slot) Piece { return Piece{Item: item, Slot: slot, Role: legacyRole(slot)} }
	for _, d := range finalists[Dress] {
		for _, f := range finalists[Footwear] {
			for _, o := range outerOptions {
				if !layeringAllowed(d, true, o, nil, f) {
					continue
				}
				pieces := []Piece{piece(d, Dress)}
				if o != nil {
					pieces = append(pieces, piece(*o, Outerwear))
				}
				consider(append(pieces, piece(f, Footwear)))
			}
		}
	}
	for _, t := range finalists[Top] {
		for i := range finalists[Bottom] {
			b := finalists[Bottom][i]
			for _, f := range finalists[Footwear] {
				for _, o := range outerOptions {
					if !layeringAllowed(t, false, o, &b, f) {
						continue
					}
					pieces := []Piece{piece(t, Top), piece(b, Bottom)}
					if o != nil {
						pieces = append(pieces, piece(*o, Outerwear))
					}
					consider(append(pieces, piece(f, Footwear)))
				}
			}
		}
	}
	if len(scored) == 0 {
		return Result{Outfits: []Candidate{}, Problem: NothingSuitable, Evaluated: evaluated, Weather: wx}
	}

	// A composition the user rejected goes below every other one.
	all := make([]Candidate, 0, len(scored))
	for _, c := range scored {
		all = append(all, c)
	}
	slices.SortStableFunc(all, compareCandidates)
	var rejectedKeys []string
	if in.Feedback != nil {
		rejectedKeys = in.Feedback.RejectedOutfitKeys
	}
	sorted := make([]Candidate, 0, len(all))
	var rejected []Candidate
	for _, c := range all {
		if slices.Contains(rejectedKeys, c.MainKey) {
			rejected = append(rejected, c)
		} else {
			sorted = append(sorted, c)
		}
	}
	sorted = append(sorted, rejected...)

	topN := 3.0
	if in.TopN != nil {
		topN = *in.TopN
	}
	n := int(clamp(math.Floor(topN), 1, float64(tables.MaxTopN)))
	chosen := selectWithSeed(varietyPool(sorted), n, in.Seed)

	// At most one accessory and one bag, only when they suit the outfit.
	var accessories, bags []Item
	for _, item := range bySlot[Accessory] {
		switch item.Category {
		case "accessory":
			accessories = append(accessories, item)
		case "bag":
			bags = append(bags, item)
		}
	}
	outfits := make([]Candidate, len(chosen))
	for i, c := range chosen {
		main := c.Items
		items := slices.Clone(c.Items)
		for _, extra := range []*Item{bestAccessory(accessories, main, ctx), bestAccessory(bags, main, ctx)} {
			if extra != nil {
				items = append(items, piece(*extra, Accessory))
			}
		}
		if len(items) > len(main) {
			c.Items, c.Key = items, keyOf(items)
			c.TempID = keyID(c.Key)
		}
		outfits[i] = c
	}
	return Result{Outfits: outfits, Evaluated: evaluated, Weather: wx}
}
