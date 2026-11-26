package wardrobe

import (
	"bytes"
	"encoding/json"

	"lookly/internal/catalog"
	"lookly/internal/store"
)

// Field is a change of one attribute that can be empty: Set says the
// request named it; a nil Value clears it.
type Field struct {
	Set   bool
	Value *string
}

// Patch is a correction of an item's attributes; what is nil or not Set is
// left as it is. The values are valid already (the HTTP edge's body rule).
type Patch struct {
	Category                                                         *string
	Subcategory, Pattern, Material, SleeveLength, Fit, Style, Gender Field
	Formality                                                        Field
	Colors, Season                                                   *[]string
}

// Correction is one logged change of one attribute: its old and new value
// as text ("" for none, a list as its JSON text) and when, as JavaScript's
// toISOString writes a time.
type Correction struct {
	Field string `json:"field"`
	From  string `json:"from"`
	To    string `json:"to"`
	At    string `json:"at"`
}

// subcategoryMismatch reports whether the subcategory the item would end up
// with does not belong to its category: either may change alone, and a
// stale subcategory is not kept silently. Unchanged, the pair is not
// judged (an older row may hold one the catalog no longer has).
func subcategoryMismatch(current store.WardrobeItem, p Patch) bool {
	if p.Category == nil && !p.Subcategory.Set {
		return false
	}
	category := current.Category
	if p.Category != nil {
		category = *p.Category
	}
	subcategory := current.Subcategory
	if p.Subcategory.Set {
		subcategory = p.Subcategory.Value
	}
	return subcategory != nil && !catalog.SubcategoryOf(category, *subcategory)
}

// change is the columns a correction writes.
type change struct {
	category                                                                    *string
	subcategory, pattern, material, sleeveLength, fit, style, gender, formality Field
	colors, season                                                              *string // JSON text
}

func (c change) empty() bool {
	return c.category == nil && c.colors == nil && c.season == nil &&
		!c.subcategory.Set && !c.pattern.Set && !c.material.Set && !c.sleeveLength.Set &&
		!c.fit.Set && !c.style.Set && !c.gender.Set && !c.formality.Set
}

// corrections compares a patch with the stored item as the Next.js route
// does (apps/web/src/lib/wardrobe/corrections.ts), in the order of the
// request schema: a value differs when its text does, where nothing is ""
// and a list is its JSON text (the stored list is compared as it is
// stored). It returns the log entries and the columns to write.
func corrections(current store.WardrobeItem, p Patch, at string) ([]Correction, change) {
	var log []Correction
	var c change
	differs := func(field, from, to string) bool {
		if from == to {
			return false
		}
		log = append(log, Correction{Field: field, From: from, To: to, At: at})
		return true
	}
	text := func(v *string) string {
		if v == nil {
			return ""
		}
		return *v
	}
	optional := func(field string, from *string, to Field, into *Field) {
		if to.Set && differs(field, text(from), text(to.Value)) {
			*into = to
		}
	}
	list := func(field, from string, to *[]string, into **string) {
		if to == nil {
			return
		}
		encoded := jsonText(*to)
		if differs(field, from, encoded) {
			*into = &encoded
		}
	}

	if p.Category != nil && differs("category", current.Category, *p.Category) {
		c.category = p.Category
	}
	optional("subcategory", current.Subcategory, p.Subcategory, &c.subcategory)
	list("colors", current.Colors, p.Colors, &c.colors)
	optional("pattern", current.Pattern, p.Pattern, &c.pattern)
	optional("material", current.Material, p.Material, &c.material)
	optional("sleeveLength", current.SleeveLength, p.SleeveLength, &c.sleeveLength)
	optional("fit", current.Fit, p.Fit, &c.fit)
	optional("style", current.Style, p.Style, &c.style)
	list("season", current.Season, p.Season, &c.season)
	optional("gender", current.Gender, p.Gender, &c.gender)
	optional("formality", current.Formality, p.Formality, &c.formality)
	return log, c
}

// jsonText is a value as JavaScript's JSON.stringify writes it: compact,
// and without the HTML escapes Go adds by default.
func jsonText(v any) string {
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		panic("wardrobe: encoding a value that always encodes: " + err.Error())
	}
	return string(bytes.TrimSuffix(b.Bytes(), []byte("\n")))
}
