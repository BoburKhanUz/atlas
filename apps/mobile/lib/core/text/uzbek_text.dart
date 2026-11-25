/// Text helpers for comparing what a user typed in Uzbek Latin.
library;

/// Code points a phone keyboard may produce for the Uzbek apostrophe in o‘ / g‘
/// and the tutuq belgisi: apostrophe U+0027, grave accent U+0060, acute accent
/// U+00B4, left and right single quotation marks U+2018 and U+2019, modifier
/// letters turned comma U+02BB and apostrophe U+02BC.
const _apostropheCodePoints = {0x0027, 0x0060, 0x00B4, 0x2018, 0x2019, 0x02BB, 0x02BC};

/// The one apostrophe the app writes in its own texts (U+2018).
const uzbekApostrophe = '‘';

/// [text] with every apostrophe variant replaced by [uzbekApostrophe], so two
/// spellings of the same word compare equal. Nothing else changes.
String normalizeUzbekApostrophes(String text) {
  final out = StringBuffer();
  for (final rune in text.runes) {
    if (_apostropheCodePoints.contains(rune)) {
      out.write(uzbekApostrophe);
    } else {
      out.writeCharCode(rune);
    }
  }
  return out.toString();
}

/// Whether [typed] is [expected] once surrounding spaces, letter case and the
/// apostrophe variant are ignored.
bool matchesUzbekWord(String typed, String expected) =>
    normalizeUzbekApostrophes(typed.trim()).toUpperCase() == normalizeUzbekApostrophes(expected).toUpperCase();
