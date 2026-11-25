import 'package:atlas_mobile/core/text/uzbek_text.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('normalizeUzbekApostrophes', () {
    test('turns every keyboard apostrophe into the app apostrophe', () {
      for (final apostrophe in ["'", '`', '´', '‘', '’', 'ʻ', 'ʼ']) {
        expect(normalizeUzbekApostrophes('o${apostrophe}g${apostrophe}il'), 'o‘g‘il', reason: apostrophe);
      }
    });

    test('leaves every other character alone', () {
      expect(normalizeUzbekApostrophes('Salom, dunyo! «Ha» "yo‘q"'), 'Salom, dunyo! «Ha» "yo‘q"');
      expect(normalizeUzbekApostrophes(''), '');
    });
  });

  group('matchesUzbekWord', () {
    test('ignores case, surrounding spaces and the apostrophe variant', () {
      expect(matchesUzbekWord("  o'chirish ", 'O‘CHIRISH'), isTrue);
      expect(matchesUzbekWord('Oʻchirish', 'O‘CHIRISH'), isTrue);
    });

    test('does not ignore inner spaces, missing letters or a missing apostrophe', () {
      expect(matchesUzbekWord('o chirish', 'O‘CHIRISH'), isFalse);
      expect(matchesUzbekWord('ochirish', 'O‘CHIRISH'), isFalse);
      expect(matchesUzbekWord('o‘chiris', 'O‘CHIRISH'), isFalse);
    });
  });
}
