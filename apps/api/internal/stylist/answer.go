package stylist

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"unicode/utf16"

	"lookly/internal/catalog"
	"lookly/internal/engine"
	"lookly/internal/platform"
)

// Answer is a validated answer: references still unresolved.
type Answer struct {
	Answer string
	// ReferencedItems are every reference used (written or listed), in
	// first-use order.
	ReferencedItems []string
	NeedsMoreInfo   bool
}

// The reasons an answer is refused.
const (
	SchemaRefusal    = "schema"
	InvalidReference = "invalid_reference"
)

// InvalidOutputError is an answer that broke the contract: never shown,
// never stored. InvalidRefs are the unknown references, only W-shaped ones
// (they go into the correction message), at most ten.
type InvalidOutputError struct {
	Reason      string
	InvalidRefs []string
}

func (e *InvalidOutputError) Error() string { return "invalid stylist output: " + e.Reason }

// reference is a reference written in an answer, with or without brackets:
// [W3] or W3 (\b is ASCII in Go's regexp, as in JavaScript's).
var reference = regexp.MustCompile(`\[?\bW(\d{1,4})\b\]?`)

var wellFormed = regexp.MustCompile(`^W\d{1,4}$`)

// units is a text's length as JavaScript counts it (UTF-16 code units).
func units(s string) int { return len(utf16.Encode([]rune(s))) }

// Interpret validates a model's answer (its JSON text): the schema, then
// every reference, written or listed, against the context's refs.
func Interpret(text string, refs []string) (Answer, error) {
	schema := &InvalidOutputError{Reason: SchemaRefusal}
	var members map[string]json.RawMessage
	if json.Unmarshal([]byte(text), &members) != nil || members == nil || len(members) != 3 {
		return Answer{}, schema
	}
	var a Answer
	var listed []string
	// A null answer decodes as "", which the length refuses below.
	if json.Unmarshal(members["answer"], &a.Answer) != nil ||
		!is(members["referencedItems"], '[') || !strings1(members["referencedItems"], &listed) ||
		!is(members["needsMoreInfo"], 't', 'f') || json.Unmarshal(members["needsMoreInfo"], &a.NeedsMoreInfo) != nil {
		return Answer{}, schema
	}
	a.Answer = strings.TrimFunc(a.Answer, platform.IsJSWhiteSpace)
	if n := units(a.Answer); n < 1 || n > AnswerChars || len(listed) > WardrobeItems ||
		slices.ContainsFunc(listed, func(r string) bool { return units(r) > 8 }) ||
		len(slices.Compact(slices.Sorted(slices.Values(listed)))) != len(listed) {
		return Answer{}, schema
	}
	var used []string
	for _, m := range reference.FindAllStringSubmatch(a.Answer, -1) {
		if r := "W" + m[1]; !slices.Contains(used, r) {
			used = append(used, r)
		}
	}
	for _, r := range listed {
		if !slices.Contains(used, r) {
			used = append(used, r)
		}
	}
	var invalid []string
	for _, r := range used {
		if !slices.Contains(refs, r) {
			invalid = append(invalid, r)
		}
	}
	if len(invalid) > 0 {
		shaped := []string{}
		for _, r := range invalid {
			if wellFormed.MatchString(r) && len(shaped) < 10 {
				shaped = append(shaped, r)
			}
		}
		return Answer{}, &InvalidOutputError{Reason: InvalidReference, InvalidRefs: shaped}
	}
	a.ReferencedItems = used
	if a.ReferencedItems == nil {
		a.ReferencedItems = []string{}
	}
	return a, nil
}

// is reports whether a JSON value starts with one of the given bytes (a
// null decodes into Go values without an error: it is none of them).
func is(raw json.RawMessage, first ...byte) bool {
	raw = bytes.TrimSpace(raw)
	return len(raw) > 0 && bytes.IndexByte(first, raw[0]) >= 0
}

// strings1 decodes a list that holds only strings.
func strings1(raw json.RawMessage, into *[]string) bool {
	var items []json.RawMessage
	if json.Unmarshal(raw, &items) != nil {
		return false
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		var s string
		if !is(item, '"') || json.Unmarshal(item, &s) != nil {
			return false
		}
		out = append(out, s)
	}
	*into = out
	return true
}

// ─── Names and references ───────────────────────────────────────────────────

// Item is a wardrobe item as a reference names it.
type Item struct {
	ID          string
	Category    string
	Subcategory *string
	Colors      []string
}

// DisplayName is the natural Uzbek name of an item ("oq futbolka").
func DisplayName(item Item) string {
	return engine.DisplayName(engine.Item{Category: item.Category, Subcategory: item.Subcategory, Colors: item.Colors})
}

// apostrophes are the forms an apostrophe takes; ‘ is the app's own.
const apostrophes = "'’ʻʼ`"

// norm is a word lower-cased with every apostrophe as ‘ (for comparison).
func norm(w string) string {
	return strings.Map(func(r rune) rune {
		if strings.ContainsRune(apostrophes, r) {
			return '‘'
		}
		return r
	}, strings.ToLower(w))
}

// wordsOf are the words of texts: split at white space, _, / and brackets.
func wordsOf(texts ...string) []string {
	var out []string
	for _, t := range texts {
		out = append(out, strings.FieldsFunc(norm(t), func(r rune) bool {
			return platform.IsJSWhiteSpace(r) || strings.ContainsRune("_/()", r)
		})...)
	}
	return out
}

func label(entries []catalog.Entry, id string) string {
	for _, e := range entries {
		if e.ID == id {
			return e.Label
		}
	}
	return ""
}

func subcategoryName(item Item) string {
	if item.Subcategory == nil || *item.Subcategory == "" {
		return ""
	}
	if name, ok := engine.ApprovedSubcategoryName(*item.Subcategory); ok {
		return name
	}
	return label(catalog.Subcategories(item.Category), *item.Subcategory)
}

func categoryName(category string) string {
	if name, ok := engine.ApprovedCategoryName(category); ok {
		return name
	}
	return label(catalog.CategoryEntries, category)
}

// colorWords are the words of every colour (ids, labels, approved names)
// and the shade words.
var colorWords = func() map[string]bool {
	words := map[string]bool{"och": true, "to‘q": true, "rangli": true}
	for _, c := range catalog.ColorEntries {
		approved, _ := engine.ApprovedColorName(c.ID)
		for _, w := range wordsOf(c.ID, c.Label, approved) {
			words[w] = true
		}
	}
	return words
}()

// itemWords are the words that name this item itself.
func itemWords(item Item) map[string]bool {
	sub := ""
	if item.Subcategory != nil {
		sub = *item.Subcategory
	}
	catalogSub := ""
	if sub != "" {
		catalogSub = label(catalog.Subcategories(item.Category), sub)
	}
	words := map[string]bool{}
	for _, w := range wordsOf(sub, catalogSub, subcategoryName(item), item.Category, label(catalog.CategoryEntries, item.Category), categoryName(item.Category)) {
		words[w] = true
	}
	return words
}

// withoutOwnName is text without its trailing run (at most five words,
// within the last line) of colour words or words naming the item; text
// itself when there is none.
func withoutOwnName(text string, own map[string]bool) string {
	lineStart := strings.LastIndex(text, "\n") + 1
	words := strings.Split(text[lineStart:], " ")
	n := 0
	for n < min(5, len(words)) {
		w := norm(words[len(words)-1-n])
		if w == "" || !(colorWords[w] || own[w]) {
			break
		}
		n++
	}
	if n == 0 {
		return text
	}
	kept := strings.Join(words[:len(words)-n], " ")
	if kept != "" {
		kept += " "
	}
	return text[:lineStart] + kept
}

// inflects: word is head, or head with a suffix (k→g and q→g‘ before it),
// e.g. ko‘ylak → ko‘ylagini.
func inflects(word, head string) bool {
	w, h := norm(word), norm(head)
	if strings.HasPrefix(w, h) {
		return true
	}
	stem := ""
	switch {
	case strings.HasSuffix(h, "k"):
		stem = strings.TrimSuffix(h, "k") + "g"
	case strings.HasSuffix(h, "q"):
		stem = strings.TrimSuffix(h, "q") + "g‘"
	}
	return stem != "" && strings.HasPrefix(w, stem) && units(w) > units(stem)
}

// jsSpace is JavaScript's \s, for the patterns below (Go's \s is ASCII).
const jsSpace = `\t\n\x0b\f\r \x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}`

// nextWord is the word right after a reference.
var nextWord = regexp.MustCompile(`^[ \t]+([^` + jsSpace + `.,;:!?()\[\]]+)`)

// Resolve replaces each validated reference with the item's name, shown
// once: the words right before it that name this same item go with it, and
// the model's own noun right after it keeps its suffix ("[W1] ko‘ylagini" →
// "oq oksford ko‘ylagini"). An unknown reference (validation refused it
// already) is an error rather than a leak.
func Resolve(answer string, items map[string]Item) (string, error) {
	var out strings.Builder
	rest := 0
	for _, m := range reference.FindAllStringSubmatchIndex(answer, -1) {
		ref := "W" + answer[m[2]:m[3]]
		item, ok := items[ref]
		if !ok {
			return "", &InvalidOutputError{Reason: InvalidReference, InvalidRefs: []string{ref}}
		}
		own := itemWords(item)
		name := DisplayName(item)

		before := answer[rest:m[0]]
		trimmed := strings.TrimRight(before, " \t")
		if stripped := withoutOwnName(trimmed, own); stripped != trimmed {
			before = stripped
		}
		end := m[1]
		head := name[strings.LastIndex(name, " ")+1:]
		if next := nextWord.FindStringSubmatch(answer[end:]); next != nil && own[norm(head)] && inflects(next[1], head) {
			// The model's suffix, with the app's apostrophe.
			name = name[:len(name)-len(head)] + strings.Map(func(r rune) rune {
				if strings.ContainsRune(apostrophes, r) {
					return '‘'
				}
				return r
			}, next[1])
			end += len(next[0])
		}
		out.WriteString(before + name)
		rest = end
	}
	out.WriteString(answer[rest:])
	return out.String(), nil
}

// ─── Mock and correction ────────────────────────────────────────────────────

// Mock is the development mock's answer: it recommends the engine's first
// outfit (or the first item) and goes through the same validation and
// resolution as a real answer.
func Mock(refs, firstCandidate []string) Answer {
	note := "Bu javob haqiqiy AI tomonidan yozilmagan."
	if len(refs) == 0 {
		return Answer{Answer: MockPrefix + " garderobingiz hali bo‘sh. Avval kiyim qo‘shing. " + note, ReferencedItems: []string{}, NeedsMoreInfo: true}
	}
	pick := firstCandidate
	if len(pick) == 0 {
		pick = refs[:1]
	}
	list := make([]string, len(pick))
	for i, r := range pick {
		list[i] = "[" + r + "]"
	}
	joined := list[0]
	if len(list) > 1 {
		joined = strings.Join(list[:len(list)-1], ", ") + " va " + list[len(list)-1]
	}
	return Answer{Answer: fmt.Sprintf("%s %s — bugungi tavsiya. %s", MockPrefix, joined, note), ReferencedItems: slices.Clone(pick)}
}

// Correction is the message of the single correction after unknown
// references.
func Correction(invalidRefs, refs []string) string {
	allowed := "none (the wardrobe list is empty)"
	if len(refs) > 0 {
		allowed = refs[0] + "–" + refs[len(refs)-1]
	}
	invalid := strings.Join(invalidRefs, ", ")
	if invalid == "" {
		invalid = "unknown"
	}
	return "Your previous answer used wardrobe references that do not exist in the context: " + invalid + ". " +
		"Valid references: " + allowed + ". Answer again using only valid references, without inventing items."
}
