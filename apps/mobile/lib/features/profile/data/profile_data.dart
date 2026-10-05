import 'package:flutter/foundation.dart';

import '../../onboarding/data/options.dart';

/// Limits of `ProfilePatchRequest` (the fields the contract lets the app
/// read back; gender, fit, height etc. are NOT readable through
/// `ProfileRow` and are deliberately not edited — see the docs).
abstract final class ProfileLimits {
  static const nameMax = 60;
  static const listMax = 20;
}

/// The profile as the server returned it (`GET /api/v1/profile`).
@immutable
class ProfileData {
  const ProfileData({
    required this.email,
    required this.name,
    this.preferredStyles = const {},
    this.dislikedStyles = const {},
    this.favoriteColors = const {},
    this.dislikedColors = const {},
  });

  final String email;
  final String? name;
  final Set<StyleOption> preferredStyles;
  final Set<StyleOption> dislikedStyles;
  final Set<ColorOption> favoriteColors;
  final Set<ColorOption> dislikedColors;

  ProfileDraft toDraft() => ProfileDraft(
    name: name ?? '',
    nameRequired: name != null,
    preferredStyles: preferredStyles,
    dislikedStyles: dislikedStyles,
    favoriteColors: favoriteColors,
    dislikedColors: dislikedColors,
  );

  /// Never prints profile values.
  @override
  String toString() => 'ProfileData';
}

enum ProfileProblem { nameEmpty, nameTooLong, tooManyItems }

/// Unsaved edits of the profile screen.
@immutable
class ProfileDraft {
  const ProfileDraft({
    required this.name,
    this.nameRequired = true,
    this.preferredStyles = const {},
    this.dislikedStyles = const {},
    this.favoriteColors = const {},
    this.dislikedColors = const {},
  });

  final String name;

  /// The server has a name: it cannot be cleared (the contract needs 1–60
  /// characters). Without one, an empty name is simply "not set".
  final bool nameRequired;
  final Set<StyleOption> preferredStyles;
  final Set<StyleOption> dislikedStyles;
  final Set<ColorOption> favoriteColors;
  final Set<ColorOption> dislikedColors;

  ProfileDraft withName(String value) => _copy(name: value);

  /// A value is either liked or disliked, never both (same rule as
  /// onboarding). Adding beyond [ProfileLimits.listMax] is ignored.
  ProfileDraft togglePreferredStyle(StyleOption s) =>
      _copy(preferredStyles: _toggle(preferredStyles, s), dislikedStyles: {...dislikedStyles}..remove(s));
  ProfileDraft toggleDislikedStyle(StyleOption s) =>
      _copy(dislikedStyles: _toggle(dislikedStyles, s), preferredStyles: {...preferredStyles}..remove(s));
  ProfileDraft toggleFavoriteColor(ColorOption c) =>
      _copy(favoriteColors: _toggle(favoriteColors, c), dislikedColors: {...dislikedColors}..remove(c));
  ProfileDraft toggleDislikedColor(ColorOption c) =>
      _copy(dislikedColors: _toggle(dislikedColors, c), favoriteColors: {...favoriteColors}..remove(c));

  ProfileProblem? get problem {
    final n = name.trim();
    if (n.isEmpty && nameRequired) return ProfileProblem.nameEmpty;
    if (n.length > ProfileLimits.nameMax) return ProfileProblem.nameTooLong;
    if ([
      preferredStyles,
      dislikedStyles,
      favoriteColors,
      dislikedColors,
    ].any((l) => l.length > ProfileLimits.listMax)) {
      return ProfileProblem.tooManyItems;
    }
    return null;
  }

  /// `PATCH /api/v1/profile` with ONLY the changed fields (name trimmed;
  /// lists in option order); null when nothing changed. An unchanged empty
  /// name (none on the server) is not a change.
  Map<String, Object?>? patchFrom(ProfileData original) {
    final n = name.trim();
    final nameChanged = n != (original.name ?? '');
    List<String> wires<T extends Enum>(Set<T> chosen, List<T> order, String Function(T) wire) => [
      for (final o in order)
        if (chosen.contains(o)) wire(o),
    ];
    final preferences = <String, Object?>{
      if (!setEquals(preferredStyles, original.preferredStyles))
        'preferredStyles': wires(preferredStyles, StyleOption.values, (o) => o.wire),
      if (!setEquals(dislikedStyles, original.dislikedStyles))
        'dislikedStyles': wires(dislikedStyles, StyleOption.values, (o) => o.wire),
      if (!setEquals(favoriteColors, original.favoriteColors))
        'favoriteColors': wires(favoriteColors, ColorOption.values, (o) => o.wire),
      if (!setEquals(dislikedColors, original.dislikedColors))
        'dislikedColors': wires(dislikedColors, ColorOption.values, (o) => o.wire),
    };
    if (!nameChanged && preferences.isEmpty) return null;
    return {if (nameChanged) 'name': n, if (preferences.isNotEmpty) 'preferences': preferences};
  }

  ProfileDraft _copy({
    String? name,
    Set<StyleOption>? preferredStyles,
    Set<StyleOption>? dislikedStyles,
    Set<ColorOption>? favoriteColors,
    Set<ColorOption>? dislikedColors,
  }) => ProfileDraft(
    name: name ?? this.name,
    nameRequired: nameRequired,
    preferredStyles: preferredStyles ?? this.preferredStyles,
    dislikedStyles: dislikedStyles ?? this.dislikedStyles,
    favoriteColors: favoriteColors ?? this.favoriteColors,
    dislikedColors: dislikedColors ?? this.dislikedColors,
  );

  static Set<T> _toggle<T>(Set<T> set, T value) {
    if (set.contains(value)) return {...set}..remove(value);
    if (set.length >= ProfileLimits.listMax) return set;
    return {...set, value};
  }

  @override
  String toString() => 'ProfileDraft';
}
