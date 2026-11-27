package engine

import "slices"

// CompositionError says why a set of items is not one outfit.
type CompositionError string

// The composition errors ("" for a valid outfit).
const (
	DuplicateItem           CompositionError = "duplicate_item"
	UnknownCategory         CompositionError = "unknown_category"
	MissingFootwear         CompositionError = "missing_footwear"
	MultipleFootwear        CompositionError = "multiple_footwear"
	MissingMain             CompositionError = "missing_main"
	DressWithTopOrBottom    CompositionError = "dress_with_top_or_bottom"
	MultiplePrimary         CompositionError = "multiple_primary"
	TooManyAccessories      CompositionError = "too_many_accessories"
	maxAccessories, maxBags                  = 2, 1
)

// Message is the error told to the user.
func (e CompositionError) Message() string { return tables.CompositionMessages[e] }

// CompositionItem is an item by its id and catalog category.
type CompositionItem struct{ ID, Category string }

// ValidateComposition judges a set of items as one outfit, by their
// categories (not by the roles a client names): "" when it is one.
func ValidateComposition(items []CompositionItem) CompositionError {
	seen := map[string]bool{}
	counts := map[Slot]int{}
	accessories, bags := 0, 0
	unknown := false
	for _, item := range items {
		if seen[item.ID] {
			return DuplicateItem
		}
		seen[item.ID] = true
		slot := SlotOf(item.Category)
		unknown = unknown || slot == ""
		counts[slot]++
		switch item.Category {
		case "accessory":
			accessories++
		case "bag":
			bags++
		}
	}
	switch {
	case unknown:
		return UnknownCategory
	case counts[Footwear] == 0:
		return MissingFootwear
	case counts[Footwear] > 1:
		return MultipleFootwear
	case counts[Dress] > 0 && (counts[Top] > 0 || counts[Bottom] > 0):
		return DressWithTopOrBottom
	case counts[Dress] > 1 || counts[Top] > 1 || counts[Bottom] > 1 || counts[Outerwear] > 1:
		return MultiplePrimary
	case counts[Dress] == 0 && (counts[Top] == 0 || counts[Bottom] == 0):
		return MissingMain
	case accessories > maxAccessories || bags > maxBags:
		return TooManyAccessories
	}
	return ""
}

// SaveRoles are the roles a saved item may carry.
func SaveRoles() []string { return slices.Clone(tables.SaveRoles) }

// RolesFor are the roles a saved item of the slot may carry (the older
// names first).
func RolesFor(slot Slot) []string { return slices.Clone(tables.RolesForSlot[slot]) }
