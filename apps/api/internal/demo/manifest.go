package demo

import (
	"bytes"
	"encoding/json"
	"fmt"
	"path"
	"slices"
	"strconv"
	"strings"

	"lookly/internal/catalog"
	"lookly/internal/platform"
)

// The manifest's limits (the TypeScript seed's, apps/web/src/server/demo/
// manifest.ts at e57764f).
const (
	MaxItems           = 60
	MaxNameLength      = 60 // characters as JavaScript counts them, after trimming
	MaxPreferredStyles = 5
	MaxFavoriteColors  = 8
	// An item's lists: the wardrobe correction's limits (the API's).
	maxItemColors  = 5
	maxItemSeasons = 4
)

// photoExtensions are the names a photo may have; what it is is decided by
// its bytes, as for an upload.
var photoExtensions = []string{".jpg", ".jpeg", ".png", ".webp"}

// Manifest is who the demo user is and what is in the wardrobe, every value
// a catalog id: nothing is left for an AI to decide.
type Manifest struct {
	// Name is the user's name, trimmed.
	Name        string
	Preferences Preferences
	Items       []Item
}

// Preferences are the demo user's style preferences.
type Preferences struct {
	PreferredStyles []string
	FavoriteColors  []string
}

// Item is one garment: its photo (a path relative to the manifest's
// folder) and its attributes; an attribute left out is none.
type Item struct {
	File                                                                        string
	Category                                                                    string
	Subcategory, Pattern, Material, SleeveLength, Fit, Style, Gender, Formality *string
	Colors, Season                                                              []string
}

// ManifestError is a manifest that is not valid: one problem per line,
// "items.2.subcategory: …", in the manifest's order.
type ManifestError struct {
	Problems []string
}

func (e *ManifestError) Error() string { return strings.Join(e.Problems, "\n") }

// Summary is the manifest's size with the count of each category, in the
// order the manifest names them first: "8 items (shirt 2, pants 2, …)".
func (m Manifest) Summary() string {
	var order []string
	counts := map[string]int{}
	for _, item := range m.Items {
		if counts[item.Category] == 0 {
			order = append(order, item.Category)
		}
		counts[item.Category]++
	}
	parts := make([]string, len(order))
	for i, category := range order {
		parts[i] = category + " " + strconv.Itoa(counts[category])
	}
	noun := "items"
	if len(m.Items) == 1 {
		noun = "item"
	}
	return fmt.Sprintf("%d %s (%s)", len(m.Items), noun, strings.Join(parts, ", "))
}

// ParseManifest reads a manifest strictly: every member known, every value
// a catalog id, a subcategory of its item's category, at least one colour
// and season, the name 1–60 characters after trimming, at most 5 preferred
// styles and 8 favourite colours, 1–60 items, each photo once, by a
// relative path inside the manifest's folder with an image extension. A
// manifest that is not valid gives a *ManifestError with every problem.
func ParseManifest(data []byte) (Manifest, error) {
	v := &validation{}
	m := v.manifest(data)
	if len(v.problems) > 0 {
		return Manifest{}, &ManifestError{Problems: v.problems}
	}
	return m, nil
}

// validation collects the problems of a manifest.
type validation struct {
	problems []string
}

func (v *validation) report(at, message string) {
	if at == "" {
		at = "(manifest)"
	}
	v.problems = append(v.problems, at+": "+message)
}

func join(at, name string) string {
	if at == "" {
		return name
	}
	return at + "." + name
}

// kind names a JSON value's type.
func kind(raw json.RawMessage) string {
	switch first := bytes.TrimLeft(raw, " \t\r\n"); {
	case len(first) == 0:
		return "nothing"
	case first[0] == '"':
		return "string"
	case first[0] == '{':
		return "object"
	case first[0] == '[':
		return "list"
	case first[0] == 'n':
		return "null"
	default:
		return "other"
	}
}

// object reads a JSON object's members. ok is false, and it is reported,
// when raw is no object.
func (v *validation) object(raw json.RawMessage, at string) (map[string]json.RawMessage, bool) {
	if kind(raw) != "object" {
		v.report(at, "must be an object")
		return nil, false
	}
	var members map[string]json.RawMessage
	if err := json.Unmarshal(raw, &members); err != nil { // cannot happen: valid JSON, an object
		v.report(at, "must be an object")
		return nil, false
	}
	return members, true
}

// unknown reports the members that are not known, by name, in order.
func (v *validation) unknown(members map[string]json.RawMessage, at string, known ...string) {
	var extra []string
	for name := range members {
		if !slices.Contains(known, name) {
			extra = append(extra, name)
		}
	}
	slices.Sort(extra)
	for _, name := range extra {
		v.report(at, fmt.Sprintf("unknown field %q", name))
	}
}

// present reports whether a member is there and not null.
func present(members map[string]json.RawMessage, name string) bool {
	raw, has := members[name]
	return has && kind(raw) != "null"
}

// text reads a required string member.
func (v *validation) text(members map[string]json.RawMessage, at, name string) (string, bool) {
	if !present(members, name) {
		v.report(join(at, name), "required")
		return "", false
	}
	var s string
	if kind(members[name]) != "string" || json.Unmarshal(members[name], &s) != nil {
		v.report(join(at, name), "must be a string")
		return "", false
	}
	return s, true
}

// vocabulary is a catalog list and what one of its values is called.
type vocabulary struct {
	ids            []string
	label, plural  string
	min, max       int // of a list of them; max 0: no limit
	required, list bool
}

var (
	categories    = vocabulary{ids: catalog.Categories, label: "category", required: true}
	subcategories = vocabulary{ids: catalog.AllSubcategories, label: "subcategory"}
	patterns      = vocabulary{ids: catalog.Patterns, label: "pattern"}
	materials     = vocabulary{ids: catalog.Materials, label: "material"}
	sleeveLengths = vocabulary{ids: catalog.SleeveLengths, label: "sleeve length"}
	fits          = vocabulary{ids: catalog.Fits, label: "fit"}
	styles        = vocabulary{ids: catalog.Styles, label: "style"}
	genders       = vocabulary{ids: catalog.Genders, label: "gender"}
	formalities   = vocabulary{ids: catalog.Formalities, label: "formality"}

	itemColors      = vocabulary{ids: catalog.Colors, label: "colour", plural: "colours", min: 1, max: maxItemColors, required: true, list: true}
	itemSeasons     = vocabulary{ids: catalog.Seasons, label: "season", plural: "seasons", min: 1, max: maxItemSeasons, required: true, list: true}
	preferredStyles = vocabulary{ids: catalog.Styles, label: "style", plural: "styles", max: MaxPreferredStyles, list: true}
	favoriteColors  = vocabulary{ids: catalog.Colors, label: "colour", plural: "colours", max: MaxFavoriteColors, list: true}
)

// one reads a member that is one id of the vocabulary; nil when it is
// absent or null (and not required) or not valid (then reported).
func (v *validation) one(members map[string]json.RawMessage, at, name string, of vocabulary) (*string, bool) {
	if !present(members, name) {
		if of.required {
			v.report(join(at, name), "required")
			return nil, false
		}
		return nil, true
	}
	return v.id(members[name], join(at, name), of)
}

func (v *validation) id(raw json.RawMessage, at string, of vocabulary) (*string, bool) {
	var s string
	if kind(raw) != "string" || json.Unmarshal(raw, &s) != nil {
		v.report(at, "must be a string")
		return nil, false
	}
	if !slices.Contains(of.ids, s) {
		v.report(at, fmt.Sprintf("unknown %s %q", of.label, s))
		return nil, false
	}
	return &s, true
}

// many reads a member that is a list of ids of the vocabulary, within its
// limits: each wrong value is reported under its index, then the length.
func (v *validation) many(members map[string]json.RawMessage, at, name string, of vocabulary) ([]string, bool) {
	at = join(at, name)
	if !present(members, name) {
		if of.required {
			v.report(at, "required")
			return nil, false
		}
		return []string{}, true
	}
	var list []json.RawMessage
	if kind(members[name]) != "list" || json.Unmarshal(members[name], &list) != nil {
		v.report(at, "must be a list")
		return nil, false
	}
	ok := true
	values := make([]string, 0, len(list))
	for i, raw := range list {
		if s, valid := v.id(raw, join(at, strconv.Itoa(i)), of); valid {
			values = append(values, *s)
		} else {
			ok = false
		}
	}
	switch {
	case len(list) < of.min:
		v.report(at, fmt.Sprintf("at least %d %s", of.min, of.label))
		ok = false
	case of.max > 0 && len(list) > of.max:
		v.report(at, fmt.Sprintf("at most %d %s", of.max, of.plural))
		ok = false
	}
	return values, ok
}

func (v *validation) manifest(data []byte) Manifest {
	var m Manifest
	if !json.Valid(data) {
		v.report("", "not valid JSON")
		return m
	}
	members, ok := v.object(data, "")
	if !ok {
		return m
	}
	if name, ok := v.text(members, "", "name"); ok {
		m.Name = strings.TrimFunc(name, platform.IsJSWhiteSpace)
		switch n := platform.UTF16Length(m.Name); {
		case n < 1 || n > MaxNameLength:
			v.report("name", fmt.Sprintf("must be 1 to %d characters after trimming", MaxNameLength))
		case strings.ContainsRune(m.Name, 0):
			v.report("name", "must not contain the NUL character")
		}
	}
	m.Preferences = Preferences{PreferredStyles: []string{}, FavoriteColors: []string{}}
	if present(members, "preferences") {
		if p, ok := v.object(members["preferences"], "preferences"); ok {
			m.Preferences.PreferredStyles, _ = v.many(p, "preferences", "preferredStyles", preferredStyles)
			m.Preferences.FavoriteColors, _ = v.many(p, "preferences", "favoriteColors", favoriteColors)
			v.unknown(p, "preferences", "preferredStyles", "favoriteColors")
		}
	}
	m.Items = v.items(members)
	v.unknown(members, "", "name", "preferences", "items")
	return m
}

func (v *validation) items(members map[string]json.RawMessage) []Item {
	if !present(members, "items") {
		v.report("items", "required")
		return nil
	}
	var list []json.RawMessage
	if kind(members["items"]) != "list" || json.Unmarshal(members["items"], &list) != nil {
		v.report("items", "must be a list")
		return nil
	}
	if len(list) < 1 {
		v.report("items", "at least 1 item")
		return nil
	}
	if len(list) > MaxItems {
		v.report("items", fmt.Sprintf("at most %d items", MaxItems))
		return nil
	}
	items := make([]Item, 0, len(list))
	seen := map[string]bool{}
	for i, raw := range list {
		at := "items." + strconv.Itoa(i)
		item, fileOK := v.item(raw, at)
		if fileOK {
			// The same file under another spelling is the same photo.
			if same := path.Clean(item.File); seen[same] {
				v.report(at+".file", "the same photo twice")
			} else {
				seen[same] = true
			}
		}
		items = append(items, item)
	}
	return items
}

// item reads one item; fileOK says its photo's path is valid.
func (v *validation) item(raw json.RawMessage, at string) (item Item, fileOK bool) {
	members, ok := v.object(raw, at)
	if !ok {
		return item, false
	}
	if file, ok := v.text(members, at, "file"); ok {
		item.File, fileOK = file, v.photoPath(file, at+".file")
	}
	category, categoryOK := v.one(members, at, "category", categories)
	if category != nil {
		item.Category = *category
	}
	subcategory, subcategoryOK := v.one(members, at, "subcategory", subcategories)
	item.Subcategory = subcategory
	item.Colors, _ = v.many(members, at, "colors", itemColors)
	item.Pattern, _ = v.one(members, at, "pattern", patterns)
	item.Material, _ = v.one(members, at, "material", materials)
	item.SleeveLength, _ = v.one(members, at, "sleeveLength", sleeveLengths)
	item.Fit, _ = v.one(members, at, "fit", fits)
	item.Style, _ = v.one(members, at, "style", styles)
	item.Season, _ = v.many(members, at, "season", itemSeasons)
	item.Gender, _ = v.one(members, at, "gender", genders)
	item.Formality, _ = v.one(members, at, "formality", formalities)
	v.unknown(members, at, "file", "category", "subcategory", "colors", "pattern", "material", "sleeveLength", "fit", "style", "season", "gender", "formality")
	if categoryOK && subcategoryOK && subcategory != nil && !catalog.SubcategoryOf(item.Category, *subcategory) {
		v.report(at+".subcategory", fmt.Sprintf("%s is not a %s subcategory", *subcategory, item.Category))
	}
	return item, fileOK
}

// photoPath judges a photo's path: an image extension, relative, and
// inside the manifest's folder (no ".." part, with either separator).
func (v *validation) photoPath(file, at string) bool {
	ok := true
	if !slices.Contains(photoExtensions, strings.ToLower(path.Ext(file))) {
		v.report(at, "photo must be "+strings.Join(photoExtensions[:len(photoExtensions)-1], ", ")+" or "+photoExtensions[len(photoExtensions)-1])
		ok = false
	}
	parts := strings.FieldsFunc(file, func(r rune) bool { return r == '/' || r == '\\' })
	if strings.HasPrefix(file, "/") || strings.HasPrefix(file, `\`) || slices.Contains(parts, "..") || strings.ContainsRune(file, 0) {
		v.report(at, "photo path must stay inside the manifest folder")
		ok = false
	}
	return ok
}
