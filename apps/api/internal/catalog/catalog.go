// Package catalog holds the fixed vocabularies of the product: the values
// clients may send and the database stores. Until the cutover (B7) the
// Next.js app owns them (apps/web/src/lib/catalog); a test compares these
// lists with the ones its request schemas accept. Later stages add the
// wardrobe vocabularies (categories, patterns, materials, ...).
package catalog

// Styles a user can prefer or dislike, in the catalog's order.
var Styles = []string{"casual", "smart_casual", "formal", "sporty", "bohemian", "minimal", "streetwear", "classic", "preppy"}

// Colors of the catalog, in its order.
var Colors = []string{
	"white", "black", "beige", "gray", "navy", "blue", "light_blue", "green", "olive", "khaki", "brown", "tan",
	"red", "burgundy", "pink", "orange", "yellow", "purple", "teal", "cream", "ivory", "rust", "mustard",
}

// Fits of a garment, and the fit a user prefers.
var Fits = []string{"slim", "regular", "relaxed", "oversized"}
