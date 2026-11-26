// Package catalog holds the fixed vocabularies of the product: the values
// clients may send and the database stores (categories, subcategories,
// colours, patterns, materials, styles, sleeve lengths, fits, seasons,
// formalities, genders, occasions), each with its Uzbek label.
//
// Until the cutover (B7) the Next.js app owns them
// (apps/web/src/lib/ai/catalog.ts); catalog.json is a copy written by
// apps/web/scripts/catalog-copy.ts, and a test there fails when it is stale.
package catalog

import (
	_ "embed"
	"encoding/json"
	"fmt"
)

// Entry is one value of a vocabulary.
type Entry struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

// Color is a catalog colour with its reference value ("#rrggbb").
type Color struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Hex   string `json:"hex"`
}

//go:embed catalog.json
var copyJSON []byte

type document struct {
	Categories    []Entry `json:"categories"`
	Subcategories []struct {
		Category string  `json:"category"`
		Entries  []Entry `json:"entries"`
	} `json:"subcategories"`
	Colors        []Color `json:"colors"`
	Patterns      []Entry `json:"patterns"`
	Materials     []Entry `json:"materials"`
	Styles        []Entry `json:"styles"`
	SleeveLengths []Entry `json:"sleeveLengths"`
	Fits          []Entry `json:"fits"`
	Seasons       []Entry `json:"seasons"`
	Formalities   []Entry `json:"formalities"`
	Genders       []Entry `json:"genders"`
	Occasions     []Entry `json:"occasions"`
}

// The vocabularies, in the catalog's order (the order is part of some
// validation messages).
var (
	CategoryEntries     []Entry
	ColorEntries        []Color
	PatternEntries      []Entry
	MaterialEntries     []Entry
	StyleEntries        []Entry
	SleeveLengthEntries []Entry
	FitEntries          []Entry
	SeasonEntries       []Entry
	FormalityEntries    []Entry
	GenderEntries       []Entry
	OccasionEntries     []Entry

	// The ids of each vocabulary, in order.
	Categories, Colors, Patterns, Materials, Styles, SleeveLengths   []string
	Fits, Seasons, Formalities, Genders, Occasions, AllSubcategories []string

	subcategories = map[string][]Entry{}
)

func init() {
	var d document
	if err := json.Unmarshal(copyJSON, &d); err != nil {
		panic(fmt.Sprintf("catalog: catalog.json does not parse: %v", err))
	}
	CategoryEntries, ColorEntries, PatternEntries, MaterialEntries = d.Categories, d.Colors, d.Patterns, d.Materials
	StyleEntries, SleeveLengthEntries, FitEntries, SeasonEntries = d.Styles, d.SleeveLengths, d.Fits, d.Seasons
	FormalityEntries, GenderEntries, OccasionEntries = d.Formalities, d.Genders, d.Occasions
	for _, list := range []struct {
		entries []Entry
		into    *[]string
	}{
		{d.Categories, &Categories}, {d.Patterns, &Patterns}, {d.Materials, &Materials}, {d.Styles, &Styles},
		{d.SleeveLengths, &SleeveLengths}, {d.Fits, &Fits}, {d.Seasons, &Seasons}, {d.Formalities, &Formalities},
		{d.Genders, &Genders}, {d.Occasions, &Occasions},
	} {
		*list.into = ids(list.entries)
	}
	for _, c := range d.Colors {
		Colors = append(Colors, c.ID)
	}
	for _, s := range d.Subcategories {
		subcategories[s.Category] = s.Entries
		AllSubcategories = append(AllSubcategories, ids(s.Entries)...)
	}
}

func ids(entries []Entry) []string {
	out := make([]string, len(entries))
	for i, e := range entries {
		out[i] = e.ID
	}
	return out
}

// Subcategories are the subcategories of a category, in order (none for an
// unknown category).
func Subcategories(category string) []Entry { return subcategories[category] }

// SubcategoryOf reports whether sub belongs to category.
func SubcategoryOf(category, sub string) bool {
	for _, e := range subcategories[category] {
		if e.ID == sub {
			return true
		}
	}
	return false
}
