package engine

import (
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"

	"lookly/internal/catalog"
)

// lowerFirst and upperFirst change the case of the first letter only.
func lowerFirst(s string) string { return mapFirst(s, unicode.ToLower) }
func upperFirst(s string) string { return mapFirst(s, unicode.ToUpper) }

func mapFirst(s string, to func(rune) rune) string {
	r, size := utf8.DecodeRuneInString(s)
	if size == 0 {
		return s
	}
	return string(to(r)) + s[size:]
}

func label(entries []catalog.Entry, id string) (string, bool) {
	for _, e := range entries {
		if e.ID == id {
			return e.Label, true
		}
	}
	return "", false
}

// DisplayName is the natural Uzbek name of an item ("oq futbolka",
// "to‘q ko‘k chinos"): its colour and what it is, in the owner-approved
// words where those replace the catalog's labels.
func DisplayName(item Item) string {
	noun, ok := "", false
	if sub := str(item.Subcategory); sub != "" {
		if noun, ok = tables.ApprovedSubcategories[sub]; !ok {
			noun, ok = label(catalog.Subcategories(item.Category), sub)
		}
	}
	if !ok {
		if noun, ok = tables.ApprovedCategoryNames[item.Category]; !ok {
			if noun, ok = label(catalog.CategoryEntries, item.Category); !ok {
				noun = "kiyim"
			}
		}
	}
	if id := first(item.Colors); id != "" {
		color, known := tables.ApprovedColorNames[id]
		if !known {
			for _, c := range catalog.ColorEntries {
				if c.ID == id {
					color, known = c.Label, true
					break
				}
			}
		}
		if known && color != "" {
			return lowerFirst(color + " " + lowerFirst(noun))
		}
	}
	return lowerFirst(noun)
}

// joinUz joins a list as Uzbek does: "a, b va c".
func joinUz(parts []string) string {
	if len(parts) <= 1 {
		return strings.Join(parts, "")
	}
	return strings.Join(parts[:len(parts)-1], ", ") + " va " + parts[len(parts)-1]
}

// Explanation is the plain explanation of an outfit, made only from its
// own items and what is known of the context (the weather as the engine
// derived it, the occasion asked for).
func Explanation(c Candidate, occasion string, wx *WeatherContext) string {
	names := make([]string, len(c.Items))
	for i, p := range c.Items {
		names[i] = DisplayName(p.Item)
	}
	has := func(code string) bool { return slices.Contains(c.Reasons, code) }
	var why []string
	if wx.band() != "" && has("weather") {
		why = append(why, "bugungi "+tables.BandLabel[wx.Band]+" ob-havoga")
	}
	if has("rain_ready") {
		why = append(why, "yomg‘irli kunga")
	}
	if has("snow_ready") {
		why = append(why, "qorli yo‘lga")
	}
	if has("wind_ready") {
		why = append(why, "shamolli havoga")
	}
	if occasion != "" && has("occasion") {
		if phrase := tables.OccasionPhrase[occasion]; phrase != nil && *phrase != "" {
			why = append(why, *phrase)
		}
	}
	if has("color_profile") {
		why = append(why, "rang profilingizga")
	}
	tail := " Garderobingizdagi eng mos variantlardan biri."
	if len(why) > 0 {
		tail = " Bu obraz " + joinUz(why) + " mos keladi."
	}
	harmony := ""
	if has("color_harmony") {
		harmony = " Ranglari bir-biriga uyg‘un."
	}
	return upperFirst(joinUz(names)) + "." + tail + harmony
}

// ApprovedColorName, ApprovedSubcategoryName and ApprovedCategoryName are
// the owner-approved names that replace a catalog label (ok is false where
// the label stands).
func ApprovedColorName(id string) (name string, ok bool) {
	name, ok = tables.ApprovedColorNames[id]
	return name, ok
}

func ApprovedSubcategoryName(id string) (name string, ok bool) {
	name, ok = tables.ApprovedSubcategories[id]
	return name, ok
}

func ApprovedCategoryName(id string) (name string, ok bool) {
	name, ok = tables.ApprovedCategoryNames[id]
	return name, ok
}
