/// Category → subcategory grouping, copied exactly from the backend's
/// catalogue (apps/web/src/lib/ai/catalog.ts, `SUBCATEGORIES`) — the single
/// source of truth for these values. A test parses that file and fails when
/// the two differ; every value is also checked against the contract enum.
abstract final class WardrobeCatalog {
  static const subcategories = <String, List<String>>{
    'outerwear': ['jacket', 'blazer', 'coat', 'windbreaker'],
    'shirt': ['tshirt', 'oxford_shirt', 'polo', 'blouse', 'knit'],
    'pants': ['jeans', 'chinos', 'trousers', 'shorts'],
    'dress': ['casual_dress', 'evening_dress', 'midi_dress'],
    'shoes': ['sneakers', 'loafers', 'oxford_shoes', 'boots', 'sandals'],
    'bag': ['tote', 'backpack', 'crossbody', 'clutch'],
    'accessory': ['belt', 'scarf', 'hat', 'watch', 'sunglasses'],
  };

  static List<String> get categories => subcategories.keys.toList();

  // Values of WardrobeItemPatchRequest (docs/api/openapi.json); a test
  // checks each list against the contract enum.
  static const colors = [
    'white', 'black', 'beige', 'gray', 'navy', 'blue', 'light_blue', 'green', 'olive', 'khaki', 'brown', 'tan', //
    'red', 'burgundy', 'pink', 'orange', 'yellow', 'purple', 'teal', 'cream', 'ivory', 'rust', 'mustard',
  ];
  static const patterns = ['solid', 'striped', 'checked', 'plaid', 'floral', 'graphic', 'color_block', 'denim'];
  static const materials = [
    'cotton',
    'linen',
    'denim',
    'wool',
    'cashmere',
    'silk',
    'polyester',
    'nylon',
    'leather',
    'suede',
    'knit',
    'blend', //
  ];
  static const sleeveLengths = ['short', 'long', 'sleeveless', 'three_quarter'];
  static const fits = ['slim', 'regular', 'relaxed', 'oversized'];
  static const styles = [
    'casual', 'smart_casual', 'formal', 'sporty', 'bohemian', 'minimal', 'streetwear', 'classic', 'preppy', //
  ];
  static const seasons = ['spring', 'summer', 'autumn', 'winter'];
  static const genders = ['male', 'female', 'unisex'];
  static const formalities = ['casual', 'smart_casual', 'formal', 'black_tie'];

  static List<String> subcategoriesOf(String category) => subcategories[category] ?? const [];
}
