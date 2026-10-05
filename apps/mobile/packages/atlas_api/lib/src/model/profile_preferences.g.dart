// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'profile_preferences.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$ProfilePreferences extends ProfilePreferences {
  @override
  final BuiltList<String> dislikedColors;
  @override
  final BuiltList<String> dislikedStyles;
  @override
  final BuiltList<String> favoriteColors;
  @override
  final String language;
  @override
  final BuiltList<String> preferredStyles;

  factory _$ProfilePreferences([void Function(ProfilePreferencesBuilder)? updates]) =>
      (ProfilePreferencesBuilder()..update(updates))._build();

  _$ProfilePreferences._({
    required this.dislikedColors,
    required this.dislikedStyles,
    required this.favoriteColors,
    required this.language,
    required this.preferredStyles,
  }) : super._();
  @override
  ProfilePreferences rebuild(void Function(ProfilePreferencesBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  ProfilePreferencesBuilder toBuilder() => ProfilePreferencesBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is ProfilePreferences &&
        dislikedColors == other.dislikedColors &&
        dislikedStyles == other.dislikedStyles &&
        favoriteColors == other.favoriteColors &&
        language == other.language &&
        preferredStyles == other.preferredStyles;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, dislikedColors.hashCode);
    _$hash = $jc(_$hash, dislikedStyles.hashCode);
    _$hash = $jc(_$hash, favoriteColors.hashCode);
    _$hash = $jc(_$hash, language.hashCode);
    _$hash = $jc(_$hash, preferredStyles.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'ProfilePreferences')
          ..add('dislikedColors', dislikedColors)
          ..add('dislikedStyles', dislikedStyles)
          ..add('favoriteColors', favoriteColors)
          ..add('language', language)
          ..add('preferredStyles', preferredStyles))
        .toString();
  }
}

class ProfilePreferencesBuilder implements Builder<ProfilePreferences, ProfilePreferencesBuilder> {
  _$ProfilePreferences? _$v;

  ListBuilder<String>? _dislikedColors;
  ListBuilder<String> get dislikedColors => _$this._dislikedColors ??= ListBuilder<String>();
  set dislikedColors(ListBuilder<String>? dislikedColors) => _$this._dislikedColors = dislikedColors;

  ListBuilder<String>? _dislikedStyles;
  ListBuilder<String> get dislikedStyles => _$this._dislikedStyles ??= ListBuilder<String>();
  set dislikedStyles(ListBuilder<String>? dislikedStyles) => _$this._dislikedStyles = dislikedStyles;

  ListBuilder<String>? _favoriteColors;
  ListBuilder<String> get favoriteColors => _$this._favoriteColors ??= ListBuilder<String>();
  set favoriteColors(ListBuilder<String>? favoriteColors) => _$this._favoriteColors = favoriteColors;

  String? _language;
  String? get language => _$this._language;
  set language(String? language) => _$this._language = language;

  ListBuilder<String>? _preferredStyles;
  ListBuilder<String> get preferredStyles => _$this._preferredStyles ??= ListBuilder<String>();
  set preferredStyles(ListBuilder<String>? preferredStyles) => _$this._preferredStyles = preferredStyles;

  ProfilePreferencesBuilder() {
    ProfilePreferences._defaults(this);
  }

  ProfilePreferencesBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _dislikedColors = $v.dislikedColors.toBuilder();
      _dislikedStyles = $v.dislikedStyles.toBuilder();
      _favoriteColors = $v.favoriteColors.toBuilder();
      _language = $v.language;
      _preferredStyles = $v.preferredStyles.toBuilder();
      _$v = null;
    }
    return this;
  }

  @override
  void replace(ProfilePreferences other) {
    _$v = other as _$ProfilePreferences;
  }

  @override
  void update(void Function(ProfilePreferencesBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  ProfilePreferences build() => _build();

  _$ProfilePreferences _build() {
    _$ProfilePreferences _$result;
    try {
      _$result =
          _$v ??
          _$ProfilePreferences._(
            dislikedColors: dislikedColors.build(),
            dislikedStyles: dislikedStyles.build(),
            favoriteColors: favoriteColors.build(),
            language: BuiltValueNullFieldError.checkNotNull(language, r'ProfilePreferences', 'language'),
            preferredStyles: preferredStyles.build(),
          );
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'dislikedColors';
        dislikedColors.build();
        _$failedField = 'dislikedStyles';
        dislikedStyles.build();
        _$failedField = 'favoriteColors';
        favoriteColors.build();

        _$failedField = 'preferredStyles';
        preferredStyles.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'ProfilePreferences', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
