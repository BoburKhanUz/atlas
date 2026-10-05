import 'package:material_ui/material_ui.dart';

/// Choices offered during onboarding. Wire values are exactly the enums of
/// `ProfilePatchRequest` in docs/api/openapi.json (checked by tests); labels
/// are Uzbek.

enum StyleOption {
  casual('casual', 'Kundalik'),
  smartCasual('smart_casual', 'Smart-casual'),
  formal('formal', 'Rasmiy'),
  sporty('sporty', 'Sport'),
  bohemian('bohemian', 'Bogema'),
  minimal('minimal', 'Minimalist'),
  streetwear('streetwear', 'Ko‘cha uslubi'),
  classic('classic', 'Klassik'),
  preppy('preppy', 'Preppi');

  const StyleOption(this.wire, this.label);
  final String wire;
  final String label;
}

enum ColorOption {
  white('white', 'Oq', Color(0xFFFFFFFF)),
  black('black', 'Qora', Color(0xFF111111)),
  beige('beige', 'Bej', Color(0xFFE8DCC4)),
  gray('gray', 'Kulrang', Color(0xFF9CA3AF)),
  navy('navy', 'To‘q ko‘k', Color(0xFF1E2A4A)),
  blue('blue', 'Ko‘k', Color(0xFF2563EB)),
  lightBlue('light_blue', 'Havorang', Color(0xFF93C5FD)),
  green('green', 'Yashil', Color(0xFF16A34A)),
  olive('olive', 'Zaytun', Color(0xFF6B7A2E)),
  khaki('khaki', 'Xaki', Color(0xFFBDB07A)),
  brown('brown', 'Jigarrang', Color(0xFF6B4226)),
  tan('tan', 'Och jigarrang', Color(0xFFC8A27A)),
  red('red', 'Qizil', Color(0xFFDC2626)),
  burgundy('burgundy', 'Bordo', Color(0xFF7F1D2D)),
  pink('pink', 'Pushti', Color(0xFFF9A8D4)),
  orange('orange', 'To‘q sariq', Color(0xFFF97316)),
  yellow('yellow', 'Sariq', Color(0xFFFACC15)),
  purple('purple', 'Binafsha', Color(0xFF7C3AED)),
  teal('teal', 'Feruza', Color(0xFF0F766E)),
  cream('cream', 'Krem', Color(0xFFF5EBD7)),
  ivory('ivory', 'Fil suyagi', Color(0xFFFBF8EF)),
  rust('rust', 'Zang rang', Color(0xFFB45309)),
  mustard('mustard', 'Xantal', Color(0xFFCA9A1B));

  const ColorOption(this.wire, this.label, this.swatch);
  final String wire;
  final String label;
  final Color swatch;
}

enum GenderOption {
  female('female', 'Ayol'),
  male('male', 'Erkak'),
  unisex('unisex', 'Farqi yo‘q'),
  other('other', 'Boshqa');

  const GenderOption(this.wire, this.label);
  final String wire;
  final String label;
}

enum FitOption {
  slim('slim', 'Tor'),
  regular('regular', 'O‘rtacha'),
  relaxed('relaxed', 'Erkin'),
  oversized('oversized', 'Keng (oversize)');

  const FitOption(this.wire, this.label);
  final String wire;
  final String label;
}
