//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'profile_preferences.g.dart';

/// ProfilePreferences
///
/// Properties:
/// * [dislikedColors]
/// * [dislikedStyles]
/// * [favoriteColors]
/// * [language]
/// * [preferredStyles]
@BuiltValue()
abstract class ProfilePreferences implements Built<ProfilePreferences, ProfilePreferencesBuilder> {
  @BuiltValueField(wireName: r'dislikedColors')
  BuiltList<String> get dislikedColors;

  @BuiltValueField(wireName: r'dislikedStyles')
  BuiltList<String> get dislikedStyles;

  @BuiltValueField(wireName: r'favoriteColors')
  BuiltList<String> get favoriteColors;

  @BuiltValueField(wireName: r'language')
  String get language;

  @BuiltValueField(wireName: r'preferredStyles')
  BuiltList<String> get preferredStyles;

  ProfilePreferences._();

  factory ProfilePreferences([void updates(ProfilePreferencesBuilder b)]) = _$ProfilePreferences;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ProfilePreferencesBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ProfilePreferences> get serializer => _$ProfilePreferencesSerializer();
}

class _$ProfilePreferencesSerializer implements PrimitiveSerializer<ProfilePreferences> {
  @override
  final Iterable<Type> types = const [ProfilePreferences, _$ProfilePreferences];

  @override
  final String wireName = r'ProfilePreferences';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ProfilePreferences object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'dislikedColors';
    yield serializers.serialize(object.dislikedColors, specifiedType: const FullType(BuiltList, [FullType(String)]));
    yield r'dislikedStyles';
    yield serializers.serialize(object.dislikedStyles, specifiedType: const FullType(BuiltList, [FullType(String)]));
    yield r'favoriteColors';
    yield serializers.serialize(object.favoriteColors, specifiedType: const FullType(BuiltList, [FullType(String)]));
    yield r'language';
    yield serializers.serialize(object.language, specifiedType: const FullType(String));
    yield r'preferredStyles';
    yield serializers.serialize(object.preferredStyles, specifiedType: const FullType(BuiltList, [FullType(String)]));
  }

  @override
  Object serialize(
    Serializers serializers,
    ProfilePreferences object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required ProfilePreferencesBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'dislikedColors':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(String)]),
          ) as BuiltList<String>;
          result.dislikedColors.replace(valueDes);
          break;
        case r'dislikedStyles':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(String)]),
          ) as BuiltList<String>;
          result.dislikedStyles.replace(valueDes);
          break;
        case r'favoriteColors':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(String)]),
          ) as BuiltList<String>;
          result.favoriteColors.replace(valueDes);
          break;
        case r'language':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.language = valueDes;
          break;
        case r'preferredStyles':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(String)]),
          ) as BuiltList<String>;
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
  ProfilePreferences deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = ProfilePreferencesBuilder();
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
