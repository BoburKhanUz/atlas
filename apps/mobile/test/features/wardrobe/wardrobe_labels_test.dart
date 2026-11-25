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

  test('correction values read as labels: lists, single values, empty and unknown', () {
    expect(WardrobeLabels.correctionValue('colors', '["white"]'), 'Oq');
    expect(WardrobeLabels.correctionValue('colors', '["white","navy"]'), 'Oq, To‘q ko‘k');
    expect(WardrobeLabels.correctionValue('season', '["summer","winter"]'), 'Yoz, Qish');
    expect(WardrobeLabels.correctionValue('subcategory', 'tshirt'), 'Futbolka');
    expect(WardrobeLabels.correctionValue('formality', 'casual'), WardrobeLabels.formality('casual'));
    expect(WardrobeLabels.correctionValue('sleeveLength', 'short'), WardrobeLabels.sleeve('short'));
    expect(WardrobeLabels.correctionValue('pattern', ''), '—');
    expect(WardrobeLabels.correctionValue('colors', '[]'), '—');
    // A value the app does not know, or text that is not a list, is shown as sent.
    expect(WardrobeLabels.correctionValue('colors', '["neon"]'), 'neon');
    expect(WardrobeLabels.correctionValue('colors', '["white"'), '["white"');
    expect(WardrobeLabels.correctionValue('futureField', 'x'), 'x');
  });
}
