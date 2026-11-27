// Package engine is the deterministic outfit engine: from a wardrobe, the
// weather, the occasion, the user's preferences, colour profile and recent
// feedback it makes the outfits to propose, each with its score, its
// reasons and a plain explanation. It is pure: no database, no network, no
// clock, no randomness; the same input gives the same output.
//
// Until the cutover (B7) the Next.js app owns the engine
// (apps/web/src/lib/ai/outfit-engine.ts). The rules here are that code
// ported, held to it by golden vectors (testdata/golden/engine.json,
// apps/web/scripts/golden-engine.ts) to the bit; the tables (weights,
// thresholds, limits, word lists, texts) are a copy written by
// apps/web/scripts/engine-copy.ts, and a test there fails when it is stale.
package engine

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"math"
)

// Version names the rules and weights: it changes when rankings change.
const Version = "outfit-engine-v2"

// Slot is the part an item plays in an outfit.
type Slot string

// The slots, by catalog category (tables.CategorySlot).
const (
	Top       Slot = "top"
	Bottom    Slot = "bottom"
	Dress     Slot = "dress"
	Outerwear Slot = "outerwear"
	Footwear  Slot = "footwear"
	Accessory Slot = "accessory"
)

//go:embed tables.json
var tablesJSON []byte

type set map[string]bool

func (s *set) UnmarshalJSON(b []byte) error {
	var list []string
	if err := json.Unmarshal(b, &list); err != nil {
		return err
	}
	*s = make(set, len(list))
	for _, v := range list {
		(*s)[v] = true
	}
	return nil
}

type palette struct {
	Recommended []string `json:"recommended"`
	Neutral     []string `json:"neutral"`
	Caution     []string `json:"caution"`
}

type tablesDocument struct {
	Version          string          `json:"version"`
	CategorySlot     map[string]Slot `json:"categorySlot"`
	TemperatureBands []struct {
		Band string   `json:"band"`
		From *float64 `json:"from"` // nil: no lower bound
	} `json:"temperatureBands"`
	TargetWarmth          map[string]struct{ Min, Max float64 } `json:"targetWarmth"`
	RainLikelyPct         float64                               `json:"rainLikelyPct"`
	RainPossiblePct       float64                               `json:"rainPossiblePct"`
	WindyKmh              float64                               `json:"windyKmh"`
	StrongWindKmh         float64                               `json:"strongWindKmh"`
	HighUV                float64                               `json:"highUv"`
	SubcategoryWarmth     map[string]float64                    `json:"subcategoryWarmth"`
	CategoryWarmth        map[string]float64                    `json:"categoryWarmth"`
	MaterialWarmth        map[string]float64                    `json:"materialWarmth"`
	SleeveWarmth          map[string]float64                    `json:"sleeveWarmth"`
	ProtectiveOuterwear   set                                   `json:"protectiveOuterwear"`
	WetFootwear           set                                   `json:"wetFootwear"`
	SnowFootwear          set                                   `json:"snowFootwear"`
	WetSensitiveMaterials set                                   `json:"wetSensitiveMaterials"`
	FormalityOrder        []string                              `json:"formalityOrder"`
	OccasionFormality     map[string][]string                   `json:"occasionFormality"`
	DressyOccasions       set                                   `json:"dressyOccasions"`
	OffOccasionStyles     map[string]set                        `json:"offOccasionStyles"`
	StyleFormality        map[string]string                     `json:"styleFormality"`
	SubcategoryFormality  map[string]string                     `json:"subcategoryFormality"`
	StyleFamilies         []set                                 `json:"styleFamilies"`
	Weights               map[string]float64                    `json:"weights"`
	SlotWeight            map[Slot]float64                      `json:"slotWeight"`
	SlotArea              map[Slot]float64                      `json:"slotArea"`
	ProfileSlotWeight     map[Slot]float64                      `json:"profileSlotWeight"`
	ProfileMinConfidence  float64                               `json:"profileMinConfidence"`
	LegacyProfileConf     float64                               `json:"legacyProfileConfidence"`
	UndertoneMinConf      float64                               `json:"undertoneMinConfidence"`
	SlotLimits            map[Slot]int                          `json:"slotLimits"`
	MaxCandidates         int                                   `json:"maxCandidates"`
	PoolSize              int                                   `json:"poolSize"`
	MaxItemRepeat         int                                   `json:"maxItemRepeat"`
	MaxTopN               int                                   `json:"maxTopN"`
	AccessoryMinScore     float64                               `json:"accessoryMinScore"`
	ReasonLabels          []struct{ Code, Label string }        `json:"reasonLabels"`
	RolesForSlot          map[Slot][]string                     `json:"rolesForSlot"`
	SaveRoles             []string                              `json:"saveRoles"`
	SeasonalPalettes      map[string]palette                    `json:"seasonalPalettes"`
	BandLabel             map[string]string                     `json:"bandLabel"`
	OccasionPhrase        map[string]*string                    `json:"occasionPhrase"`
	ApprovedColorNames    map[string]string                     `json:"approvedColorNames"`
	ApprovedSubcategories map[string]string                     `json:"approvedSubcategoryNames"`
	ApprovedCategoryNames map[string]string                     `json:"approvedCategoryNames"`
	ProblemMessages       map[Problem]string                    `json:"problemMessages"`
	CompositionMessages   map[CompositionError]string           `json:"compositionMessages"`
}

// tables are the engine's tables (tables.json).
var tables tablesDocument

func init() {
	if err := json.Unmarshal(tablesJSON, &tables); err != nil {
		panic(fmt.Sprintf("engine: tables.json does not parse: %v", err))
	}
	if tables.Version != Version {
		panic(fmt.Sprintf("engine: tables.json is of %q, the rules here of %q", tables.Version, Version))
	}
	if len(tables.TemperatureBands) == 0 || tables.TemperatureBands[0].From != nil {
		panic("engine: tables.json: the first temperature band must have no lower bound")
	}
	for _, name := range signalOrder {
		if _, ok := tables.Weights[name]; !ok {
			panic("engine: tables.json: no weight for the signal " + name)
		}
	}
	if len(tables.Weights) != len(signalOrder) {
		panic("engine: tables.json: a weight for a signal the rules do not know")
	}
}

// bandFrom is a band's lower bound.
func bandFrom(i int) float64 {
	if tables.TemperatureBands[i].From == nil {
		return math.Inf(-1)
	}
	return *tables.TemperatureBands[i].From
}
