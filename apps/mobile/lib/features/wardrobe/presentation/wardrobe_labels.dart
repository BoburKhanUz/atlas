import '../../onboarding/data/options.dart';

/// Uzbek labels for the wardrobe values of the contract. Values the app does
/// not know yet (a newer backend) are shown as they are.
abstract final class WardrobeLabels {
  static const categories = {
    'all': 'Hammasi',
    'outerwear': 'Ustki kiyim',
    'shirt': 'Ko‘ylaklar',
    'pants': 'Shimlar',
    'dress': 'Ko‘ylak (ayollar)',
    'shoes': 'Poyabzal',
    'bag': 'Sumkalar',
    'accessory': 'Aksessuarlar',
  };

  static const _subcategories = {
    'jacket': 'Kurtka',
    'blazer': 'Blazer',
    'coat': 'Palto',
    'windbreaker': 'Shamoldan himoya kurtka',
    'tshirt': 'Futbolka',
    'oxford_shirt': 'Oksford ko‘ylak',
    'polo': 'Polo',
    'blouse': 'Bluzka',
    'knit': 'Trikotaj',
    'jeans': 'Jinsi',
    'chinos': 'Chinos',
    'trousers': 'Klassik shim',
    'shorts': 'Shorti',
    'casual_dress': 'Kundalik ko‘ylak',
    'evening_dress': 'Kechki ko‘ylak',
    'midi_dress': 'Midi ko‘ylak',
    'sneakers': 'Krossovka',
    'loafers': 'Lofer',
    'oxford_shoes': 'Oksford tufli',
    'boots': 'Botinka',
    'sandals': 'Sandal',
    'tote': 'Tote sumka',
    'backpack': 'Ryukzak',
    'crossbody': 'Yelka sumkasi',
    'clutch': 'Klatch',
    'belt': 'Kamar',
    'scarf': 'Sharf',
    'hat': 'Bosh kiyim',
    'watch': 'Soat',
    'sunglasses': 'Quyosh ko‘zoynagi',
  };

  static const _patterns = {
    'solid': 'Bir rangli',
    'striped': 'Yo‘l-yo‘l',
    'checked': 'Katak',
    'plaid': 'Shotland katak',
    'floral': 'Gulli',
    'graphic': 'Grafik',
    'color_block': 'Rang bloklari',
    'denim': 'Denim',
  };

  static const _materials = {
    'cotton': 'Paxta',
    'linen': 'Zig‘ir',
    'denim': 'Denim',
    'wool': 'Jun',
    'cashmere': 'Kashemir',
    'silk': 'Ipak',
    'polyester': 'Poliester',
    'nylon': 'Neylon',
    'leather': 'Charm',
    'suede': 'Zamsh',
    'knit': 'Trikotaj',
    'blend': 'Aralash',
  };

  static const _sleeves = {
    'short': 'Kalta yeng',
    'long': 'Uzun yeng',
    'sleeveless': 'Yengsiz',
    'three_quarter': 'Uchdan to‘rt yeng',
  };

  static const _fits = {'slim': 'Tor', 'regular': 'O‘rtacha', 'relaxed': 'Erkin', 'oversized': 'Keng'};
  static const _formality = {
    'casual': 'Kundalik',
    'smart_casual': 'Smart-casual',
    'formal': 'Rasmiy',
    'black_tie': 'Tantanali',
  };
  static const _seasons = {'spring': 'Bahor', 'summer': 'Yoz', 'autumn': 'Kuz', 'winter': 'Qish'};
  static const _genders = {'male': 'Erkaklar', 'female': 'Ayollar', 'unisex': 'Uniseks'};

  static String category(String v) => categories[v] ?? v;
  static String subcategory(String v) => _subcategories[v] ?? v;
  static String pattern(String v) => _patterns[v] ?? v;
  static String material(String v) => _materials[v] ?? v;
  static String sleeve(String v) => _sleeves[v] ?? v;
  static String fit(String v) => _fits[v] ?? v;
  static String formality(String v) => _formality[v] ?? v;
  static String season(String v) => _seasons[v] ?? v;
  static String gender(String v) => _genders[v] ?? v;
  static String style(String v) => StyleOption.values.where((o) => o.wire == v).firstOrNull?.label ?? v;
  static String color(String v) => ColorOption.values.where((o) => o.wire == v).firstOrNull?.label ?? v;

  /// Field names of `correctionLog` entries.
  static String field(String v) =>
      const {
        'category': 'Toifa',
        'subcategory': 'Tur',
        'colors': 'Ranglar',
        'pattern': 'Naqsh',
        'material': 'Material',
        'sleeveLength': 'Yeng',
        'fit': 'Bichim',
        'style': 'Uslub',
        'season': 'Mavsum',
        'gender': 'Kim uchun',
        'formality': 'Rasmiylik',
      }[v] ??
      v;
}
