import 'package:flutter/foundation.dart';

import 'options.dart';

/// What the user chose during onboarding. Lives in memory only (never
/// stored, never logged) until Finish sends it.
@immutable
class OnboardingAnswers {
  const OnboardingAnswers({
    this.preferredStyles = const {},
    this.dislikedStyles = const {},
    this.favoriteColors = const {},
    this.dislikedColors = const {},
    this.gender,
    this.fit,
  });

  final Set<StyleOption> preferredStyles;
  final Set<StyleOption> dislikedStyles;
  final Set<ColorOption> favoriteColors;
  final Set<ColorOption> dislikedColors;
  final GenderOption? gender;
  final FitOption? fit;

  bool get isEmpty => toPatchJson() == null;

  /// A style is either liked or disliked, never both.
  OnboardingAnswers togglePreferredStyle(StyleOption s) =>
      _copy(preferredStyles: _toggle(preferredStyles, s), dislikedStyles: {...dislikedStyles}..remove(s));

  OnboardingAnswers toggleDislikedStyle(StyleOption s) =>
      _copy(dislikedStyles: _toggle(dislikedStyles, s), preferredStyles: {...preferredStyles}..remove(s));

  OnboardingAnswers toggleFavoriteColor(ColorOption c) =>
      _copy(favoriteColors: _toggle(favoriteColors, c), dislikedColors: {...dislikedColors}..remove(c));

  OnboardingAnswers toggleDislikedColor(ColorOption c) =>
      _copy(dislikedColors: _toggle(dislikedColors, c), favoriteColors: {...favoriteColors}..remove(c));

  /// Selecting the current value again clears it.
  OnboardingAnswers withGender(GenderOption? g) => OnboardingAnswers(
    preferredStyles: preferredStyles,
    dislikedStyles: dislikedStyles,
    favoriteColors: favoriteColors,
    dislikedColors: dislikedColors,
    gender: g == gender ? null : g,
    fit: fit,
  );

  OnboardingAnswers withFit(FitOption? f) => OnboardingAnswers(
    preferredStyles: preferredStyles,
    dislikedStyles: dislikedStyles,
    favoriteColors: favoriteColors,
    dislikedColors: dislikedColors,
    gender: gender,
    fit: f == fit ? null : f,
  );

  OnboardingAnswers clearStyles() => _copy(preferredStyles: const {}, dislikedStyles: const {});
  OnboardingAnswers clearColors() => _copy(favoriteColors: const {}, dislikedColors: const {});
  OnboardingAnswers clearProfile() => OnboardingAnswers(
    preferredStyles: preferredStyles,
    dislikedStyles: dislikedStyles,
    favoriteColors: favoriteColors,
    dislikedColors: dislikedColors,
  );

  /// The `PATCH /api/v1/profile` body: only what was chosen, nothing empty;
  /// null when nothing was chosen at all. Lists follow the option order
  /// (deterministic).
  Map<String, Object?>? toPatchJson() {
    List<String> wires<T extends Enum>(Set<T> chosen, List<T> order, String Function(T) wire) => [
      for (final o in order)
        if (chosen.contains(o)) wire(o),
    ];
    final preferences = <String, Object?>{
      if (preferredStyles.isNotEmpty) 'preferredStyles': wires(preferredStyles, StyleOption.values, (o) => o.wire),
      if (dislikedStyles.isNotEmpty) 'dislikedStyles': wires(dislikedStyles, StyleOption.values, (o) => o.wire),
      if (favoriteColors.isNotEmpty) 'favoriteColors': wires(favoriteColors, ColorOption.values, (o) => o.wire),
      if (dislikedColors.isNotEmpty) 'dislikedColors': wires(dislikedColors, ColorOption.values, (o) => o.wire),
    };
    final profile = <String, Object?>{'gender': ?gender?.wire, 'preferredFit': ?fit?.wire};
    if (preferences.isEmpty && profile.isEmpty) return null;
    return {if (preferences.isNotEmpty) 'preferences': preferences, if (profile.isNotEmpty) 'profile': profile};
  }

  OnboardingAnswers _copy({
    Set<StyleOption>? preferredStyles,
    Set<StyleOption>? dislikedStyles,
    Set<ColorOption>? favoriteColors,
    Set<ColorOption>? dislikedColors,
  }) => OnboardingAnswers(
    preferredStyles: preferredStyles ?? this.preferredStyles,
    dislikedStyles: dislikedStyles ?? this.dislikedStyles,
    favoriteColors: favoriteColors ?? this.favoriteColors,
    dislikedColors: dislikedColors ?? this.dislikedColors,
    gender: gender,
    fit: fit,
  );

  static Set<T> _toggle<T>(Set<T> set, T value) => set.contains(value) ? ({...set}..remove(value)) : {...set, value};

  @override
  bool operator ==(Object other) =>
      other is OnboardingAnswers &&
      setEquals(other.preferredStyles, preferredStyles) &&
      setEquals(other.dislikedStyles, dislikedStyles) &&
      setEquals(other.favoriteColors, favoriteColors) &&
      setEquals(other.dislikedColors, dislikedColors) &&
      other.gender == gender &&
      other.fit == fit;

  @override
  int get hashCode => Object.hash(
    Object.hashAllUnordered(preferredStyles),
    Object.hashAllUnordered(dislikedStyles),
    Object.hashAllUnordered(favoriteColors),
    Object.hashAllUnordered(dislikedColors),
    gender,
    fit,
  );

  /// Never prints the answers (profile data is not logged).
  @override
  String toString() => 'OnboardingAnswers(${isEmpty ? 'empty' : 'set'})';
}
