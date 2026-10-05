import 'package:atlas_api/atlas_api.dart' show OutfitSaveRequest, OutfitSummary;
import 'package:flutter/foundation.dart' show listEquals;

/// D4: POST /api/v1/outfits has no Idempotency-Key, so a save whose answer
/// was lost cannot be made exactly-once. After such an unknown outcome the
/// app reads the outfit list ONCE and accepts the save as confirmed only
/// when the list proves it:
///
///   * exactly one outfit matches every saved field exactly (items with
///     their roles, occasion, rounded score, reasons, explanation, saved
///     flag), and
///   * it was created inside the attempt's window by the SERVER's clock
///     (the list response's `Date` minus the time since the attempt started,
///     with a few seconds of slack), and
///   * it is not an outfit this screen already knows.
///
/// Anything else (no match, several matches, no `Date`) is inconclusive:
/// the save stays "unknown" — never "failed", and never re-sent.
abstract final class SaveCheck {
  static const slack = Duration(seconds: 5);

  static String? confirmedId({
    required OutfitSaveRequest sent,
    required List<OutfitSummary> outfits,
    required DateTime? serverNow,
    required Duration sinceAttempt,
    Set<String> knownIds = const {},
  }) {
    if (serverNow == null) return null;
    final from = serverNow.toUtc().subtract(sinceAttempt).subtract(slack);
    final to = serverNow.toUtc().add(slack);
    final matches = outfits.where(
      (o) =>
          !knownIds.contains(o.id) &&
          !o.createdAt.toUtc().isBefore(from) &&
          !o.createdAt.toUtc().isAfter(to) &&
          _sameContent(sent, o),
    );
    return matches.length == 1 ? matches.single.id : null;
  }

  static bool _sameContent(OutfitSaveRequest s, OutfitSummary o) {
    final sentItems = s.items.map((i) => '${i.itemId}\u0000${i.role}').toList()..sort();
    final storedItems = o.items.map((i) => '${i.id}\u0000${i.role}').toList()..sort();
    return listEquals(sentItems, storedItems) &&
        s.occasion?.name == o.occasion &&
        s.score?.round() == o.score &&
        listEquals(s.reasons?.toList() ?? const <String>[], o.reasons.toList()) &&
        s.explanation == o.explanation &&
        (s.isSaved ?? false) == o.isSaved;
  }
}
