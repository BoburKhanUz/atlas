// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'profile_patch_request_profile.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

const ProfilePatchRequestProfileGenderEnum _$profilePatchRequestProfileGenderEnum_male =
    const ProfilePatchRequestProfileGenderEnum._('male');
const ProfilePatchRequestProfileGenderEnum _$profilePatchRequestProfileGenderEnum_female =
    const ProfilePatchRequestProfileGenderEnum._('female');
const ProfilePatchRequestProfileGenderEnum _$profilePatchRequestProfileGenderEnum_other =
    const ProfilePatchRequestProfileGenderEnum._('other');
const ProfilePatchRequestProfileGenderEnum _$profilePatchRequestProfileGenderEnum_unisex =
    const ProfilePatchRequestProfileGenderEnum._('unisex');
const ProfilePatchRequestProfileGenderEnum _$profilePatchRequestProfileGenderEnum_unknownDefaultOpenApi =
    const ProfilePatchRequestProfileGenderEnum._('unknownDefaultOpenApi');

ProfilePatchRequestProfileGenderEnum _$profilePatchRequestProfileGenderEnumValueOf(String name) {
  switch (name) {
    case 'male':
      return _$profilePatchRequestProfileGenderEnum_male;
    case 'female':
      return _$profilePatchRequestProfileGenderEnum_female;
    case 'other':
      return _$profilePatchRequestProfileGenderEnum_other;
    case 'unisex':
      return _$profilePatchRequestProfileGenderEnum_unisex;
    case 'unknownDefaultOpenApi':
      return _$profilePatchRequestProfileGenderEnum_unknownDefaultOpenApi;
    default:
      return _$profilePatchRequestProfileGenderEnum_unknownDefaultOpenApi;
  }
}

final BuiltSet<ProfilePatchRequestProfileGenderEnum> _$profilePatchRequestProfileGenderEnumValues =
    BuiltSet<ProfilePatchRequestProfileGenderEnum>(const <ProfilePatchRequestProfileGenderEnum>[
      _$profilePatchRequestProfileGenderEnum_male,
      _$profilePatchRequestProfileGenderEnum_female,
      _$profilePatchRequestProfileGenderEnum_other,
      _$profilePatchRequestProfileGenderEnum_unisex,
      _$profilePatchRequestProfileGenderEnum_unknownDefaultOpenApi,
    ]);

const ProfilePatchRequestProfilePreferredFitEnum _$profilePatchRequestProfilePreferredFitEnum_slim =
    const ProfilePatchRequestProfilePreferredFitEnum._('slim');
const ProfilePatchRequestProfilePreferredFitEnum _$profilePatchRequestProfilePreferredFitEnum_regular =
    const ProfilePatchRequestProfilePreferredFitEnum._('regular');
const ProfilePatchRequestProfilePreferredFitEnum _$profilePatchRequestProfilePreferredFitEnum_relaxed =
    const ProfilePatchRequestProfilePreferredFitEnum._('relaxed');
const ProfilePatchRequestProfilePreferredFitEnum _$profilePatchRequestProfilePreferredFitEnum_oversized =
    const ProfilePatchRequestProfilePreferredFitEnum._('oversized');
const ProfilePatchRequestProfilePreferredFitEnum _$profilePatchRequestProfilePreferredFitEnum_unknownDefaultOpenApi =
    const ProfilePatchRequestProfilePreferredFitEnum._('unknownDefaultOpenApi');

ProfilePatchRequestProfilePreferredFitEnum _$profilePatchRequestProfilePreferredFitEnumValueOf(String name) {
  switch (name) {
    case 'slim':
      return _$profilePatchRequestProfilePreferredFitEnum_slim;
    case 'regular':
      return _$profilePatchRequestProfilePreferredFitEnum_regular;
    case 'relaxed':
      return _$profilePatchRequestProfilePreferredFitEnum_relaxed;
    case 'oversized':
      return _$profilePatchRequestProfilePreferredFitEnum_oversized;
    case 'unknownDefaultOpenApi':
      return _$profilePatchRequestProfilePreferredFitEnum_unknownDefaultOpenApi;
    default:
      return _$profilePatchRequestProfilePreferredFitEnum_unknownDefaultOpenApi;
  }
}

final BuiltSet<ProfilePatchRequestProfilePreferredFitEnum> _$profilePatchRequestProfilePreferredFitEnumValues =
    BuiltSet<ProfilePatchRequestProfilePreferredFitEnum>(const <ProfilePatchRequestProfilePreferredFitEnum>[
      _$profilePatchRequestProfilePreferredFitEnum_slim,
      _$profilePatchRequestProfilePreferredFitEnum_regular,
      _$profilePatchRequestProfilePreferredFitEnum_relaxed,
      _$profilePatchRequestProfilePreferredFitEnum_oversized,
      _$profilePatchRequestProfilePreferredFitEnum_unknownDefaultOpenApi,
    ]);

Serializer<ProfilePatchRequestProfileGenderEnum> _$profilePatchRequestProfileGenderEnumSerializer =
    _$ProfilePatchRequestProfileGenderEnumSerializer();
Serializer<ProfilePatchRequestProfilePreferredFitEnum> _$profilePatchRequestProfilePreferredFitEnumSerializer =
    _$ProfilePatchRequestProfilePreferredFitEnumSerializer();

class _$ProfilePatchRequestProfileGenderEnumSerializer
    implements PrimitiveSerializer<ProfilePatchRequestProfileGenderEnum> {
  static const Map<String, Object> _toWire = const <String, Object>{
    'male': 'male',
    'female': 'female',
    'other': 'other',
    'unisex': 'unisex',
    'unknownDefaultOpenApi': 'unknown_default_open_api',
  };
  static const Map<Object, String> _fromWire = const <Object, String>{
    'male': 'male',
    'female': 'female',
    'other': 'other',
    'unisex': 'unisex',
    'unknown_default_open_api': 'unknownDefaultOpenApi',
  };

  @override
  final Iterable<Type> types = const <Type>[ProfilePatchRequestProfileGenderEnum];
  @override
  final String wireName = 'ProfilePatchRequestProfileGenderEnum';

  @override
  Object serialize(
    Serializers serializers,
    ProfilePatchRequestProfileGenderEnum object, {
    FullType specifiedType = FullType.unspecified,
  }) => _toWire[object.name] ?? object.name;

  @override
  ProfilePatchRequestProfileGenderEnum deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) => ProfilePatchRequestProfileGenderEnum.valueOf(_fromWire[serialized] ?? (serialized is String ? serialized : ''));
}

class _$ProfilePatchRequestProfilePreferredFitEnumSerializer
    implements PrimitiveSerializer<ProfilePatchRequestProfilePreferredFitEnum> {
  static const Map<String, Object> _toWire = const <String, Object>{
    'slim': 'slim',
    'regular': 'regular',
    'relaxed': 'relaxed',
    'oversized': 'oversized',
    'unknownDefaultOpenApi': 'unknown_default_open_api',
  };
  static const Map<Object, String> _fromWire = const <Object, String>{
    'slim': 'slim',
    'regular': 'regular',
    'relaxed': 'relaxed',
    'oversized': 'oversized',
    'unknown_default_open_api': 'unknownDefaultOpenApi',
  };

  @override
  final Iterable<Type> types = const <Type>[ProfilePatchRequestProfilePreferredFitEnum];
  @override
  final String wireName = 'ProfilePatchRequestProfilePreferredFitEnum';

  @override
  Object serialize(
    Serializers serializers,
    ProfilePatchRequestProfilePreferredFitEnum object, {
    FullType specifiedType = FullType.unspecified,
  }) => _toWire[object.name] ?? object.name;

  @override
  ProfilePatchRequestProfilePreferredFitEnum deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) => ProfilePatchRequestProfilePreferredFitEnum.valueOf(
    _fromWire[serialized] ?? (serialized is String ? serialized : ''),
  );
}

class _$ProfilePatchRequestProfile extends ProfilePatchRequestProfile {
  @override
  final String? ageRange;
  @override
  final String? bodyShape;
  @override
  final String? clothingSize;
  @override
  final String? eyeColor;
  @override
  final ProfilePatchRequestProfileGenderEnum? gender;
  @override
  final String? hairColor;
  @override
  final num? height;
  @override
  final ProfilePatchRequestProfilePreferredFitEnum? preferredFit;
  @override
  final String? skinTone;
  @override
  final String? skinUndertone;
  @override
  final int? typicalBudget;
  @override
  final num? weight;

  factory _$ProfilePatchRequestProfile([void Function(ProfilePatchRequestProfileBuilder)? updates]) =>
      (ProfilePatchRequestProfileBuilder()..update(updates))._build();

  _$ProfilePatchRequestProfile._({
    this.ageRange,
    this.bodyShape,
    this.clothingSize,
    this.eyeColor,
    this.gender,
    this.hairColor,
    this.height,
    this.preferredFit,
    this.skinTone,
    this.skinUndertone,
    this.typicalBudget,
    this.weight,
  }) : super._();
  @override
  ProfilePatchRequestProfile rebuild(void Function(ProfilePatchRequestProfileBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  ProfilePatchRequestProfileBuilder toBuilder() => ProfilePatchRequestProfileBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is ProfilePatchRequestProfile &&
        ageRange == other.ageRange &&
        bodyShape == other.bodyShape &&
        clothingSize == other.clothingSize &&
        eyeColor == other.eyeColor &&
        gender == other.gender &&
        hairColor == other.hairColor &&
        height == other.height &&
        preferredFit == other.preferredFit &&
        skinTone == other.skinTone &&
        skinUndertone == other.skinUndertone &&
        typicalBudget == other.typicalBudget &&
        weight == other.weight;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, ageRange.hashCode);
    _$hash = $jc(_$hash, bodyShape.hashCode);
    _$hash = $jc(_$hash, clothingSize.hashCode);
    _$hash = $jc(_$hash, eyeColor.hashCode);
    _$hash = $jc(_$hash, gender.hashCode);
    _$hash = $jc(_$hash, hairColor.hashCode);
    _$hash = $jc(_$hash, height.hashCode);
    _$hash = $jc(_$hash, preferredFit.hashCode);
    _$hash = $jc(_$hash, skinTone.hashCode);
    _$hash = $jc(_$hash, skinUndertone.hashCode);
    _$hash = $jc(_$hash, typicalBudget.hashCode);
    _$hash = $jc(_$hash, weight.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'ProfilePatchRequestProfile')
          ..add('ageRange', ageRange)
          ..add('bodyShape', bodyShape)
          ..add('clothingSize', clothingSize)
          ..add('eyeColor', eyeColor)
          ..add('gender', gender)
          ..add('hairColor', hairColor)
          ..add('height', height)
          ..add('preferredFit', preferredFit)
          ..add('skinTone', skinTone)
          ..add('skinUndertone', skinUndertone)
          ..add('typicalBudget', typicalBudget)
          ..add('weight', weight))
        .toString();
  }
}

class ProfilePatchRequestProfileBuilder
    implements Builder<ProfilePatchRequestProfile, ProfilePatchRequestProfileBuilder> {
  _$ProfilePatchRequestProfile? _$v;

  String? _ageRange;
  String? get ageRange => _$this._ageRange;
  set ageRange(String? ageRange) => _$this._ageRange = ageRange;

  String? _bodyShape;
  String? get bodyShape => _$this._bodyShape;
  set bodyShape(String? bodyShape) => _$this._bodyShape = bodyShape;

  String? _clothingSize;
  String? get clothingSize => _$this._clothingSize;
  set clothingSize(String? clothingSize) => _$this._clothingSize = clothingSize;

  String? _eyeColor;
  String? get eyeColor => _$this._eyeColor;
  set eyeColor(String? eyeColor) => _$this._eyeColor = eyeColor;

  ProfilePatchRequestProfileGenderEnum? _gender;
  ProfilePatchRequestProfileGenderEnum? get gender => _$this._gender;
  set gender(ProfilePatchRequestProfileGenderEnum? gender) => _$this._gender = gender;

  String? _hairColor;
  String? get hairColor => _$this._hairColor;
  set hairColor(String? hairColor) => _$this._hairColor = hairColor;

  num? _height;
  num? get height => _$this._height;
  set height(num? height) => _$this._height = height;

  ProfilePatchRequestProfilePreferredFitEnum? _preferredFit;
  ProfilePatchRequestProfilePreferredFitEnum? get preferredFit => _$this._preferredFit;
  set preferredFit(ProfilePatchRequestProfilePreferredFitEnum? preferredFit) => _$this._preferredFit = preferredFit;

  String? _skinTone;
  String? get skinTone => _$this._skinTone;
  set skinTone(String? skinTone) => _$this._skinTone = skinTone;

  String? _skinUndertone;
  String? get skinUndertone => _$this._skinUndertone;
  set skinUndertone(String? skinUndertone) => _$this._skinUndertone = skinUndertone;

  int? _typicalBudget;
  int? get typicalBudget => _$this._typicalBudget;
  set typicalBudget(int? typicalBudget) => _$this._typicalBudget = typicalBudget;

  num? _weight;
  num? get weight => _$this._weight;
  set weight(num? weight) => _$this._weight = weight;

  ProfilePatchRequestProfileBuilder() {
    ProfilePatchRequestProfile._defaults(this);
  }

  ProfilePatchRequestProfileBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _ageRange = $v.ageRange;
      _bodyShape = $v.bodyShape;
      _clothingSize = $v.clothingSize;
      _eyeColor = $v.eyeColor;
      _gender = $v.gender;
      _hairColor = $v.hairColor;
      _height = $v.height;
      _preferredFit = $v.preferredFit;
      _skinTone = $v.skinTone;
      _skinUndertone = $v.skinUndertone;
      _typicalBudget = $v.typicalBudget;
      _weight = $v.weight;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(ProfilePatchRequestProfile other) {
    _$v = other as _$ProfilePatchRequestProfile;
  }

  @override
  void update(void Function(ProfilePatchRequestProfileBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  ProfilePatchRequestProfile build() => _build();

  _$ProfilePatchRequestProfile _build() {
    final _$result =
        _$v ??
        _$ProfilePatchRequestProfile._(
          ageRange: ageRange,
          bodyShape: bodyShape,
          clothingSize: clothingSize,
          eyeColor: eyeColor,
          gender: gender,
          hairColor: hairColor,
          height: height,
          preferredFit: preferredFit,
          skinTone: skinTone,
          skinUndertone: skinUndertone,
          typicalBudget: typicalBudget,
          weight: weight,
        );
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
