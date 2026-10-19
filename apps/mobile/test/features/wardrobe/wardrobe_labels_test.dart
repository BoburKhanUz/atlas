import 'package:atlas_mobile/features/wardrobe/presentation/wardrobe_labels.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('item names: main colour + type; the type alone when the colour is unknown', () {
    expect(WardrobeLabels.itemName(category: 'shirt', subcategory: 'tshirt', colors: ['white', 'navy']), 'Oq futbolka');
    expect(WardrobeLabels.itemName(category: 'pants', colors: ['navy']), 'To‘q ko‘k shim');
    expect(WardrobeLabels.itemName(category: 'shoes', subcategory: 'sneakers'), 'Krossovka');
    expect(WardrobeLabels.itemName(category: 'bag', colors: ['neon']), 'Sumka');
    expect(WardrobeLabels.itemName(category: 'future_kind'), 'future_kind');
  });
}
