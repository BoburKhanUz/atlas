//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'profile_patch_request_preferences.g.dart';

/// ProfilePatchRequestPreferences
///
/// Properties:
/// * [dislikedColors]
/// * [dislikedStyles]
/// * [favoriteColors]
/// * [language]
/// * [preferredStyles]
@BuiltValue()
abstract class ProfilePatchRequestPreferences
    implements Built<ProfilePatchRequestPreferences, ProfilePatchRequestPreferencesBuilder> {
  @BuiltValueField(wireName: r'dislikedColors')
  BuiltList<ProfilePatchRequestPreferencesDislikedColorsEnum>? get dislikedColors;
  // enum dislikedColorsEnum {  white,  black,  beige,  gray,  navy,  blue,  light_blue,  green,  olive,  khaki,  brown,  tan,  red,  burgundy,  pink,  orange,  yellow,  purple,  teal,  cream,  ivory,  rust,  mustard,  };

  @BuiltValueField(wireName: r'dislikedStyles')
  BuiltList<ProfilePatchRequestPreferencesDislikedStylesEnum>? get dislikedStyles;
  // enum dislikedStylesEnum {  casual,  smart_casual,  formal,  sporty,  bohemian,  minimal,  streetwear,  classic,  preppy,  };

  @BuiltValueField(wireName: r'favoriteColors')
  BuiltList<ProfilePatchRequestPreferencesFavoriteColorsEnum>? get favoriteColors;
  // enum favoriteColorsEnum {  white,  black,  beige,  gray,  navy,  blue,  light_blue,  green,  olive,  khaki,  brown,  tan,  red,  burgundy,  pink,  orange,  yellow,  purple,  teal,  cream,  ivory,  rust,  mustard,  };

  @BuiltValueField(wireName: r'language')
  ProfilePatchRequestPreferencesLanguageEnum? get language;
  // enum languageEnum {  uz,  ru,  en,  };

  @BuiltValueField(wireName: r'preferredStyles')
  BuiltList<ProfilePatchRequestPreferencesPreferredStylesEnum>? get preferredStyles;
  // enum preferredStylesEnum {  casual,  smart_casual,  formal,  sporty,  bohemian,  minimal,  streetwear,  classic,  preppy,  };

  ProfilePatchRequestPreferences._();

  factory ProfilePatchRequestPreferences([void updates(ProfilePatchRequestPreferencesBuilder b)]) =
      _$ProfilePatchRequestPreferences;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ProfilePatchRequestPreferencesBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ProfilePatchRequestPreferences> get serializer => _$ProfilePatchRequestPreferencesSerializer();
}

class _$ProfilePatchRequestPreferencesSerializer implements PrimitiveSerializer<ProfilePatchRequestPreferences> {
  @override
  final Iterable<Type> types = const [ProfilePatchRequestPreferences, _$ProfilePatchRequestPreferences];

  @override
  final String wireName = r'ProfilePatchRequestPreferences';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ProfilePatchRequestPreferences object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    if (object.dislikedColors != null) {
      yield r'dislikedColors';
      yield serializers.serialize(
        object.dislikedColors,
        specifiedType: const FullType(BuiltList, [FullType(ProfilePatchRequestPreferencesDislikedColorsEnum)]),
      );
    }
    if (object.dislikedStyles != null) {
      yield r'dislikedStyles';
      yield serializers.serialize(
        object.dislikedStyles,
        specifiedType: const FullType(BuiltList, [FullType(ProfilePatchRequestPreferencesDislikedStylesEnum)]),
      );
    }
    if (object.favoriteColors != null) {
      yield r'favoriteColors';
      yield serializers.serialize(
        object.favoriteColors,
        specifiedType: const FullType(BuiltList, [FullType(ProfilePatchRequestPreferencesFavoriteColorsEnum)]),
      );
    }
    if (object.language != null) {
      yield r'language';
      yield serializers.serialize(
        object.language,
        specifiedType: const FullType(ProfilePatchRequestPreferencesLanguageEnum),
      );
    }
    if (object.preferredStyles != null) {
      yield r'preferredStyles';
      yield serializers.serialize(
        object.preferredStyles,
        specifiedType: const FullType(BuiltList, [FullType(ProfilePatchRequestPreferencesPreferredStylesEnum)]),
      );
    }
  }

  @override
  Object serialize(
    Serializers serializers,
    ProfilePatchRequestPreferences object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required ProfilePatchRequestPreferencesBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'dislikedColors':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(ProfilePatchRequestPreferencesDislikedColorsEnum)]),
          ) as BuiltList<ProfilePatchRequestPreferencesDislikedColorsEnum>;
          result.dislikedColors.replace(valueDes);
          break;
        case r'dislikedStyles':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(ProfilePatchRequestPreferencesDislikedStylesEnum)]),
          ) as BuiltList<ProfilePatchRequestPreferencesDislikedStylesEnum>;
          result.dislikedStyles.replace(valueDes);
          break;
        case r'favoriteColors':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(ProfilePatchRequestPreferencesFavoriteColorsEnum)]),
          ) as BuiltList<ProfilePatchRequestPreferencesFavoriteColorsEnum>;
          result.favoriteColors.replace(valueDes);
          break;
        case r'language':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(ProfilePatchRequestPreferencesLanguageEnum),
          ) as ProfilePatchRequestPreferencesLanguageEnum;
          result.language = valueDes;
          break;
        case r'preferredStyles':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(ProfilePatchRequestPreferencesPreferredStylesEnum)]),
          ) as BuiltList<ProfilePatchRequestPreferencesPreferredStylesEnum>;
          result.preferredStyles.replace(valueDes);
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  ProfilePatchRequestPreferences deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = ProfilePatchRequestPreferencesBuilder();
    final serializedList = (serialized as Iterable<Object?>).toList();
    final unhandled = <Object?>[];
    _deserializeProperties(
      serializers,
      serialized,
      specifiedType: specifiedType,
      serializedList: serializedList,
      unhandled: unhandled,
      result: result,
    );
    return result.build();
  }
}

class ProfilePatchRequestPreferencesDislikedColorsEnum extends EnumClass {
  @BuiltValueEnumConst(wireName: r'white')
  static const ProfilePatchRequestPreferencesDislikedColorsEnum white =
      _$profilePatchRequestPreferencesDislikedColorsEnum_white;
  @BuiltValueEnumConst(wireName: r'black')
  static const ProfilePatchRequestPreferencesDislikedColorsEnum black =
      _$profilePatchRequestPreferencesDislikedColorsEnum_black;
  @BuiltValueEnumConst(wireName: r'beige')
  static const ProfilePatchRequestPreferencesDislikedColorsEnum beige =
      _$profilePatchRequestPreferencesDislikedColorsEnum_beige;
  @BuiltValueEnumConst(wireName: r'gray')
  static const ProfilePatchRequestPreferencesDislikedColorsEnum gray =
      _$profilePatchRequestPreferencesDislikedColorsEnum_gray;
  @BuiltValueEnumConst(wireName: r'navy')
  static const ProfilePatchRequestPreferencesDislikedColorsEnum navy =
      _$profilePatchRequestPreferencesDislikedColorsEnum_navy;
  @BuiltValueEnumConst(wireName: r'blue')
  static const ProfilePatchRequestPreferencesDislikedColorsEnum blue =
      _$profilePatchRequestPreferencesDislikedColorsEnum_blue;
  @BuiltValueEnumConst(wireName: r'light_blue')
  static const ProfilePatchRequestPreferencesDislikedColorsEnum lightBlue =
      _$profilePatchRequestPreferencesDislikedColorsEnum_lightBlue;
  @BuiltValueEnumConst(wireName: r'green')
  static const ProfilePatchRequestPreferencesDislikedColorsEnum green =
      _$profilePatchRequestPreferencesDislikedColorsEnum_green;
  @BuiltValueEnumConst(wireName: r'olive')
  static const ProfilePatchRequestPreferencesDislikedColorsEnum olive =
      _$profilePatchRequestPreferencesDislikedColorsEnum_olive;
  @BuiltValueEnumConst(wireName: r'khaki')
  static const ProfilePatchRequestPreferencesDislikedColorsEnum khaki =
      _$profilePatchRequestPreferencesDislikedColorsEnum_khaki;
  @BuiltValueEnumConst(wireName: r'brown')
  static const ProfilePatchRequestPreferencesDislikedColorsEnum brown =
      _$profilePatchRequestPreferencesDislikedColorsEnum_brown;
  @BuiltValueEnumConst(wireName: r'tan')
  static const ProfilePatchRequestPreferencesDislikedColorsEnum tan =
      _$profilePatchRequestPreferencesDislikedColorsEnum_tan;
  @BuiltValueEnumConst(wireName: r'red')
  static const ProfilePatchRequestPreferencesDislikedColorsEnum red =
      _$profilePatchRequestPreferencesDislikedColorsEnum_red;
  @BuiltValueEnumConst(wireName: r'burgundy')
  static const ProfilePatchRequestPreferencesDislikedColorsEnum burgundy =
      _$profilePatchRequestPreferencesDislikedColorsEnum_burgundy;
  @BuiltValueEnumConst(wireName: r'pink')
  static const ProfilePatchRequestPreferencesDislikedColorsEnum pink =
      _$profilePatchRequestPreferencesDislikedColorsEnum_pink;
  @BuiltValueEnumConst(wireName: r'orange')
  static const ProfilePatchRequestPreferencesDislikedColorsEnum orange =
      _$profilePatchRequestPreferencesDislikedColorsEnum_orange;
  @BuiltValueEnumConst(wireName: r'yellow')
  static const ProfilePatchRequestPreferencesDislikedColorsEnum yellow =
      _$profilePatchRequestPreferencesDislikedColorsEnum_yellow;
  @BuiltValueEnumConst(wireName: r'purple')
  static const ProfilePatchRequestPreferencesDislikedColorsEnum purple =
      _$profilePatchRequestPreferencesDislikedColorsEnum_purple;
  @BuiltValueEnumConst(wireName: r'teal')
  static const ProfilePatchRequestPreferencesDislikedColorsEnum teal =
      _$profilePatchRequestPreferencesDislikedColorsEnum_teal;
  @BuiltValueEnumConst(wireName: r'cream')
  static const ProfilePatchRequestPreferencesDislikedColorsEnum cream =
      _$profilePatchRequestPreferencesDislikedColorsEnum_cream;
  @BuiltValueEnumConst(wireName: r'ivory')
  static const ProfilePatchRequestPreferencesDislikedColorsEnum ivory =
      _$profilePatchRequestPreferencesDislikedColorsEnum_ivory;
  @BuiltValueEnumConst(wireName: r'rust')
  static const ProfilePatchRequestPreferencesDislikedColorsEnum rust =
      _$profilePatchRequestPreferencesDislikedColorsEnum_rust;
  @BuiltValueEnumConst(wireName: r'mustard')
  static const ProfilePatchRequestPreferencesDislikedColorsEnum mustard =
      _$profilePatchRequestPreferencesDislikedColorsEnum_mustard;
  @BuiltValueEnumConst(wireName: r'unknown_default_open_api', fallback: true)
  static const ProfilePatchRequestPreferencesDislikedColorsEnum unknownDefaultOpenApi =
      _$profilePatchRequestPreferencesDislikedColorsEnum_unknownDefaultOpenApi;

  static Serializer<ProfilePatchRequestPreferencesDislikedColorsEnum> get serializer =>
      _$profilePatchRequestPreferencesDislikedColorsEnumSerializer;

  const ProfilePatchRequestPreferencesDislikedColorsEnum._(String name) : super(name);

  static BuiltSet<ProfilePatchRequestPreferencesDislikedColorsEnum> get values =>
      _$profilePatchRequestPreferencesDislikedColorsEnumValues;
  static ProfilePatchRequestPreferencesDislikedColorsEnum valueOf(String name) =>
      _$profilePatchRequestPreferencesDislikedColorsEnumValueOf(name);
}

class ProfilePatchRequestPreferencesDislikedStylesEnum extends EnumClass {
  @BuiltValueEnumConst(wireName: r'casual')
  static const ProfilePatchRequestPreferencesDislikedStylesEnum casual =
      _$profilePatchRequestPreferencesDislikedStylesEnum_casual;
  @BuiltValueEnumConst(wireName: r'smart_casual')
  static const ProfilePatchRequestPreferencesDislikedStylesEnum smartCasual =
      _$profilePatchRequestPreferencesDislikedStylesEnum_smartCasual;
  @BuiltValueEnumConst(wireName: r'formal')
  static const ProfilePatchRequestPreferencesDislikedStylesEnum formal =
      _$profilePatchRequestPreferencesDislikedStylesEnum_formal;
  @BuiltValueEnumConst(wireName: r'sporty')
  static const ProfilePatchRequestPreferencesDislikedStylesEnum sporty =
      _$profilePatchRequestPreferencesDislikedStylesEnum_sporty;
  @BuiltValueEnumConst(wireName: r'bohemian')
  static const ProfilePatchRequestPreferencesDislikedStylesEnum bohemian =
      _$profilePatchRequestPreferencesDislikedStylesEnum_bohemian;
  @BuiltValueEnumConst(wireName: r'minimal')
  static const ProfilePatchRequestPreferencesDislikedStylesEnum minimal =
      _$profilePatchRequestPreferencesDislikedStylesEnum_minimal;
  @BuiltValueEnumConst(wireName: r'streetwear')
  static const ProfilePatchRequestPreferencesDislikedStylesEnum streetwear =
      _$profilePatchRequestPreferencesDislikedStylesEnum_streetwear;
  @BuiltValueEnumConst(wireName: r'classic')
  static const ProfilePatchRequestPreferencesDislikedStylesEnum classic =
      _$profilePatchRequestPreferencesDislikedStylesEnum_classic;
  @BuiltValueEnumConst(wireName: r'preppy')
  static const ProfilePatchRequestPreferencesDislikedStylesEnum preppy =
      _$profilePatchRequestPreferencesDislikedStylesEnum_preppy;
  @BuiltValueEnumConst(wireName: r'unknown_default_open_api', fallback: true)
  static const ProfilePatchRequestPreferencesDislikedStylesEnum unknownDefaultOpenApi =
      _$profilePatchRequestPreferencesDislikedStylesEnum_unknownDefaultOpenApi;

  static Serializer<ProfilePatchRequestPreferencesDislikedStylesEnum> get serializer =>
      _$profilePatchRequestPreferencesDislikedStylesEnumSerializer;

  const ProfilePatchRequestPreferencesDislikedStylesEnum._(String name) : super(name);

  static BuiltSet<ProfilePatchRequestPreferencesDislikedStylesEnum> get values =>
      _$profilePatchRequestPreferencesDislikedStylesEnumValues;
  static ProfilePatchRequestPreferencesDislikedStylesEnum valueOf(String name) =>
      _$profilePatchRequestPreferencesDislikedStylesEnumValueOf(name);
}

class ProfilePatchRequestPreferencesFavoriteColorsEnum extends EnumClass {
  @BuiltValueEnumConst(wireName: r'white')
  static const ProfilePatchRequestPreferencesFavoriteColorsEnum white =
      _$profilePatchRequestPreferencesFavoriteColorsEnum_white;
  @BuiltValueEnumConst(wireName: r'black')
  static const ProfilePatchRequestPreferencesFavoriteColorsEnum black =
      _$profilePatchRequestPreferencesFavoriteColorsEnum_black;
  @BuiltValueEnumConst(wireName: r'beige')
  static const ProfilePatchRequestPreferencesFavoriteColorsEnum beige =
      _$profilePatchRequestPreferencesFavoriteColorsEnum_beige;
  @BuiltValueEnumConst(wireName: r'gray')
  static const ProfilePatchRequestPreferencesFavoriteColorsEnum gray =
      _$profilePatchRequestPreferencesFavoriteColorsEnum_gray;
  @BuiltValueEnumConst(wireName: r'navy')
  static const ProfilePatchRequestPreferencesFavoriteColorsEnum navy =
      _$profilePatchRequestPreferencesFavoriteColorsEnum_navy;
  @BuiltValueEnumConst(wireName: r'blue')
  static const ProfilePatchRequestPreferencesFavoriteColorsEnum blue =
      _$profilePatchRequestPreferencesFavoriteColorsEnum_blue;
  @BuiltValueEnumConst(wireName: r'light_blue')
  static const ProfilePatchRequestPreferencesFavoriteColorsEnum lightBlue =
      _$profilePatchRequestPreferencesFavoriteColorsEnum_lightBlue;
  @BuiltValueEnumConst(wireName: r'green')
  static const ProfilePatchRequestPreferencesFavoriteColorsEnum green =
      _$profilePatchRequestPreferencesFavoriteColorsEnum_green;
  @BuiltValueEnumConst(wireName: r'olive')
  static const ProfilePatchRequestPreferencesFavoriteColorsEnum olive =
      _$profilePatchRequestPreferencesFavoriteColorsEnum_olive;
  @BuiltValueEnumConst(wireName: r'khaki')
  static const ProfilePatchRequestPreferencesFavoriteColorsEnum khaki =
      _$profilePatchRequestPreferencesFavoriteColorsEnum_khaki;
  @BuiltValueEnumConst(wireName: r'brown')
  static const ProfilePatchRequestPreferencesFavoriteColorsEnum brown =
      _$profilePatchRequestPreferencesFavoriteColorsEnum_brown;
  @BuiltValueEnumConst(wireName: r'tan')
  static const ProfilePatchRequestPreferencesFavoriteColorsEnum tan =
      _$profilePatchRequestPreferencesFavoriteColorsEnum_tan;
  @BuiltValueEnumConst(wireName: r'red')
  static const ProfilePatchRequestPreferencesFavoriteColorsEnum red =
      _$profilePatchRequestPreferencesFavoriteColorsEnum_red;
  @BuiltValueEnumConst(wireName: r'burgundy')
  static const ProfilePatchRequestPreferencesFavoriteColorsEnum burgundy =
      _$profilePatchRequestPreferencesFavoriteColorsEnum_burgundy;
  @BuiltValueEnumConst(wireName: r'pink')
  static const ProfilePatchRequestPreferencesFavoriteColorsEnum pink =
      _$profilePatchRequestPreferencesFavoriteColorsEnum_pink;
  @BuiltValueEnumConst(wireName: r'orange')
  static const ProfilePatchRequestPreferencesFavoriteColorsEnum orange =
      _$profilePatchRequestPreferencesFavoriteColorsEnum_orange;
  @BuiltValueEnumConst(wireName: r'yellow')
  static const ProfilePatchRequestPreferencesFavoriteColorsEnum yellow =
      _$profilePatchRequestPreferencesFavoriteColorsEnum_yellow;
  @BuiltValueEnumConst(wireName: r'purple')
  static const ProfilePatchRequestPreferencesFavoriteColorsEnum purple =
      _$profilePatchRequestPreferencesFavoriteColorsEnum_purple;
  @BuiltValueEnumConst(wireName: r'teal')
  static const ProfilePatchRequestPreferencesFavoriteColorsEnum teal =
      _$profilePatchRequestPreferencesFavoriteColorsEnum_teal;
  @BuiltValueEnumConst(wireName: r'cream')
  static const ProfilePatchRequestPreferencesFavoriteColorsEnum cream =
      _$profilePatchRequestPreferencesFavoriteColorsEnum_cream;
  @BuiltValueEnumConst(wireName: r'ivory')
  static const ProfilePatchRequestPreferencesFavoriteColorsEnum ivory =
      _$profilePatchRequestPreferencesFavoriteColorsEnum_ivory;
  @BuiltValueEnumConst(wireName: r'rust')
  static const ProfilePatchRequestPreferencesFavoriteColorsEnum rust =
      _$profilePatchRequestPreferencesFavoriteColorsEnum_rust;
  @BuiltValueEnumConst(wireName: r'mustard')
  static const ProfilePatchRequestPreferencesFavoriteColorsEnum mustard =
      _$profilePatchRequestPreferencesFavoriteColorsEnum_mustard;
  @BuiltValueEnumConst(wireName: r'unknown_default_open_api', fallback: true)
  static const ProfilePatchRequestPreferencesFavoriteColorsEnum unknownDefaultOpenApi =
      _$profilePatchRequestPreferencesFavoriteColorsEnum_unknownDefaultOpenApi;

  static Serializer<ProfilePatchRequestPreferencesFavoriteColorsEnum> get serializer =>
      _$profilePatchRequestPreferencesFavoriteColorsEnumSerializer;

  const ProfilePatchRequestPreferencesFavoriteColorsEnum._(String name) : super(name);

  static BuiltSet<ProfilePatchRequestPreferencesFavoriteColorsEnum> get values =>
      _$profilePatchRequestPreferencesFavoriteColorsEnumValues;
  static ProfilePatchRequestPreferencesFavoriteColorsEnum valueOf(String name) =>
      _$profilePatchRequestPreferencesFavoriteColorsEnumValueOf(name);
}

class ProfilePatchRequestPreferencesLanguageEnum extends EnumClass {
  @BuiltValueEnumConst(wireName: r'uz')
  static const ProfilePatchRequestPreferencesLanguageEnum uz = _$profilePatchRequestPreferencesLanguageEnum_uz;
  @BuiltValueEnumConst(wireName: r'ru')
  static const ProfilePatchRequestPreferencesLanguageEnum ru = _$profilePatchRequestPreferencesLanguageEnum_ru;
  @BuiltValueEnumConst(wireName: r'en')
  static const ProfilePatchRequestPreferencesLanguageEnum en = _$profilePatchRequestPreferencesLanguageEnum_en;
  @BuiltValueEnumConst(wireName: r'unknown_default_open_api', fallback: true)
  static const ProfilePatchRequestPreferencesLanguageEnum unknownDefaultOpenApi =
      _$profilePatchRequestPreferencesLanguageEnum_unknownDefaultOpenApi;

  static Serializer<ProfilePatchRequestPreferencesLanguageEnum> get serializer =>
      _$profilePatchRequestPreferencesLanguageEnumSerializer;

  const ProfilePatchRequestPreferencesLanguageEnum._(String name) : super(name);

  static BuiltSet<ProfilePatchRequestPreferencesLanguageEnum> get values =>
      _$profilePatchRequestPreferencesLanguageEnumValues;
  static ProfilePatchRequestPreferencesLanguageEnum valueOf(String name) =>
      _$profilePatchRequestPreferencesLanguageEnumValueOf(name);
}

class ProfilePatchRequestPreferencesPreferredStylesEnum extends EnumClass {
  @BuiltValueEnumConst(wireName: r'casual')
  static const ProfilePatchRequestPreferencesPreferredStylesEnum casual =
      _$profilePatchRequestPreferencesPreferredStylesEnum_casual;
  @BuiltValueEnumConst(wireName: r'smart_casual')
  static const ProfilePatchRequestPreferencesPreferredStylesEnum smartCasual =
      _$profilePatchRequestPreferencesPreferredStylesEnum_smartCasual;
  @BuiltValueEnumConst(wireName: r'formal')
  static const ProfilePatchRequestPreferencesPreferredStylesEnum formal =
      _$profilePatchRequestPreferencesPreferredStylesEnum_formal;
  @BuiltValueEnumConst(wireName: r'sporty')
  static const ProfilePatchRequestPreferencesPreferredStylesEnum sporty =
      _$profilePatchRequestPreferencesPreferredStylesEnum_sporty;
  @BuiltValueEnumConst(wireName: r'bohemian')
  static const ProfilePatchRequestPreferencesPreferredStylesEnum bohemian =
      _$profilePatchRequestPreferencesPreferredStylesEnum_bohemian;
  @BuiltValueEnumConst(wireName: r'minimal')
  static const ProfilePatchRequestPreferencesPreferredStylesEnum minimal =
      _$profilePatchRequestPreferencesPreferredStylesEnum_minimal;
  @BuiltValueEnumConst(wireName: r'streetwear')
  static const ProfilePatchRequestPreferencesPreferredStylesEnum streetwear =
      _$profilePatchRequestPreferencesPreferredStylesEnum_streetwear;
  @BuiltValueEnumConst(wireName: r'classic')
  static const ProfilePatchRequestPreferencesPreferredStylesEnum classic =
      _$profilePatchRequestPreferencesPreferredStylesEnum_classic;
  @BuiltValueEnumConst(wireName: r'preppy')
  static const ProfilePatchRequestPreferencesPreferredStylesEnum preppy =
      _$profilePatchRequestPreferencesPreferredStylesEnum_preppy;
  @BuiltValueEnumConst(wireName: r'unknown_default_open_api', fallback: true)
  static const ProfilePatchRequestPreferencesPreferredStylesEnum unknownDefaultOpenApi =
      _$profilePatchRequestPreferencesPreferredStylesEnum_unknownDefaultOpenApi;

  static Serializer<ProfilePatchRequestPreferencesPreferredStylesEnum> get serializer =>
      _$profilePatchRequestPreferencesPreferredStylesEnumSerializer;

  const ProfilePatchRequestPreferencesPreferredStylesEnum._(String name) : super(name);

  static BuiltSet<ProfilePatchRequestPreferencesPreferredStylesEnum> get values =>
      _$profilePatchRequestPreferencesPreferredStylesEnumValues;
  static ProfilePatchRequestPreferencesPreferredStylesEnum valueOf(String name) =>
      _$profilePatchRequestPreferencesPreferredStylesEnumValueOf(name);
}
