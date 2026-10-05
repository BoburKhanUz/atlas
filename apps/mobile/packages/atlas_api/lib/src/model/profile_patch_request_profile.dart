//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'profile_patch_request_profile.g.dart';

/// ProfilePatchRequestProfile
///
/// Properties:
/// * [ageRange]
/// * [bodyShape]
/// * [clothingSize]
/// * [eyeColor]
/// * [gender]
/// * [hairColor]
/// * [height]
/// * [preferredFit]
/// * [skinTone]
/// * [skinUndertone]
/// * [typicalBudget]
/// * [weight]
@BuiltValue()
abstract class ProfilePatchRequestProfile
    implements Built<ProfilePatchRequestProfile, ProfilePatchRequestProfileBuilder> {
  @BuiltValueField(wireName: r'ageRange')
  String? get ageRange;

  @BuiltValueField(wireName: r'bodyShape')
  String? get bodyShape;

  @BuiltValueField(wireName: r'clothingSize')
  String? get clothingSize;

  @BuiltValueField(wireName: r'eyeColor')
  String? get eyeColor;

  @BuiltValueField(wireName: r'gender')
  ProfilePatchRequestProfileGenderEnum? get gender;
  // enum genderEnum {  male,  female,  other,  unisex,  };

  @BuiltValueField(wireName: r'hairColor')
  String? get hairColor;

  @BuiltValueField(wireName: r'height')
  num? get height;

  @BuiltValueField(wireName: r'preferredFit')
  ProfilePatchRequestProfilePreferredFitEnum? get preferredFit;
  // enum preferredFitEnum {  slim,  regular,  relaxed,  oversized,  };

  @BuiltValueField(wireName: r'skinTone')
  String? get skinTone;

  @BuiltValueField(wireName: r'skinUndertone')
  String? get skinUndertone;

  @BuiltValueField(wireName: r'typicalBudget')
  int? get typicalBudget;

  @BuiltValueField(wireName: r'weight')
  num? get weight;

  ProfilePatchRequestProfile._();

  factory ProfilePatchRequestProfile([void updates(ProfilePatchRequestProfileBuilder b)]) =
      _$ProfilePatchRequestProfile;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ProfilePatchRequestProfileBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ProfilePatchRequestProfile> get serializer => _$ProfilePatchRequestProfileSerializer();
}

class _$ProfilePatchRequestProfileSerializer implements PrimitiveSerializer<ProfilePatchRequestProfile> {
  @override
  final Iterable<Type> types = const [ProfilePatchRequestProfile, _$ProfilePatchRequestProfile];

  @override
  final String wireName = r'ProfilePatchRequestProfile';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ProfilePatchRequestProfile object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    if (object.ageRange != null) {
      yield r'ageRange';
      yield serializers.serialize(object.ageRange, specifiedType: const FullType.nullable(String));
    }
    if (object.bodyShape != null) {
      yield r'bodyShape';
      yield serializers.serialize(object.bodyShape, specifiedType: const FullType.nullable(String));
    }
    if (object.clothingSize != null) {
      yield r'clothingSize';
      yield serializers.serialize(object.clothingSize, specifiedType: const FullType.nullable(String));
    }
    if (object.eyeColor != null) {
      yield r'eyeColor';
      yield serializers.serialize(object.eyeColor, specifiedType: const FullType.nullable(String));
    }
    if (object.gender != null) {
      yield r'gender';
      yield serializers.serialize(
        object.gender,
        specifiedType: const FullType.nullable(ProfilePatchRequestProfileGenderEnum),
      );
    }
    if (object.hairColor != null) {
      yield r'hairColor';
      yield serializers.serialize(object.hairColor, specifiedType: const FullType.nullable(String));
    }
    if (object.height != null) {
      yield r'height';
      yield serializers.serialize(object.height, specifiedType: const FullType.nullable(num));
    }
    if (object.preferredFit != null) {
      yield r'preferredFit';
      yield serializers.serialize(
        object.preferredFit,
        specifiedType: const FullType.nullable(ProfilePatchRequestProfilePreferredFitEnum),
      );
    }
    if (object.skinTone != null) {
      yield r'skinTone';
      yield serializers.serialize(object.skinTone, specifiedType: const FullType.nullable(String));
    }
    if (object.skinUndertone != null) {
      yield r'skinUndertone';
      yield serializers.serialize(object.skinUndertone, specifiedType: const FullType.nullable(String));
    }
    if (object.typicalBudget != null) {
      yield r'typicalBudget';
      yield serializers.serialize(object.typicalBudget, specifiedType: const FullType.nullable(int));
    }
    if (object.weight != null) {
      yield r'weight';
      yield serializers.serialize(object.weight, specifiedType: const FullType.nullable(num));
    }
  }

  @override
  Object serialize(
    Serializers serializers,
    ProfilePatchRequestProfile object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required ProfilePatchRequestProfileBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'ageRange':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(String)) as String?;
          if (valueDes == null) continue;
          result.ageRange = valueDes;
          break;
        case r'bodyShape':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(String)) as String?;
          if (valueDes == null) continue;
          result.bodyShape = valueDes;
          break;
        case r'clothingSize':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(String)) as String?;
          if (valueDes == null) continue;
          result.clothingSize = valueDes;
          break;
        case r'eyeColor':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(String)) as String?;
          if (valueDes == null) continue;
          result.eyeColor = valueDes;
          break;
        case r'gender':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(ProfilePatchRequestProfileGenderEnum),
          ) as ProfilePatchRequestProfileGenderEnum?;
          if (valueDes == null) continue;
          result.gender = valueDes;
          break;
        case r'hairColor':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(String)) as String?;
          if (valueDes == null) continue;
          result.hairColor = valueDes;
          break;
        case r'height':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(num)) as num?;
          if (valueDes == null) continue;
          result.height = valueDes;
          break;
        case r'preferredFit':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(ProfilePatchRequestProfilePreferredFitEnum),
          ) as ProfilePatchRequestProfilePreferredFitEnum?;
          if (valueDes == null) continue;
          result.preferredFit = valueDes;
          break;
        case r'skinTone':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(String)) as String?;
          if (valueDes == null) continue;
          result.skinTone = valueDes;
          break;
        case r'skinUndertone':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(String)) as String?;
          if (valueDes == null) continue;
          result.skinUndertone = valueDes;
          break;
        case r'typicalBudget':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(int)) as int?;
          if (valueDes == null) continue;
          result.typicalBudget = valueDes;
          break;
        case r'weight':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(num)) as num?;
          if (valueDes == null) continue;
          result.weight = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  ProfilePatchRequestProfile deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = ProfilePatchRequestProfileBuilder();
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

class ProfilePatchRequestProfileGenderEnum extends EnumClass {
  @BuiltValueEnumConst(wireName: r'male')
  static const ProfilePatchRequestProfileGenderEnum male = _$profilePatchRequestProfileGenderEnum_male;
  @BuiltValueEnumConst(wireName: r'female')
  static const ProfilePatchRequestProfileGenderEnum female = _$profilePatchRequestProfileGenderEnum_female;
  @BuiltValueEnumConst(wireName: r'other')
  static const ProfilePatchRequestProfileGenderEnum other = _$profilePatchRequestProfileGenderEnum_other;
  @BuiltValueEnumConst(wireName: r'unisex')
  static const ProfilePatchRequestProfileGenderEnum unisex = _$profilePatchRequestProfileGenderEnum_unisex;
  @BuiltValueEnumConst(wireName: r'unknown_default_open_api', fallback: true)
  static const ProfilePatchRequestProfileGenderEnum unknownDefaultOpenApi =
      _$profilePatchRequestProfileGenderEnum_unknownDefaultOpenApi;

  static Serializer<ProfilePatchRequestProfileGenderEnum> get serializer =>
      _$profilePatchRequestProfileGenderEnumSerializer;

  const ProfilePatchRequestProfileGenderEnum._(String name) : super(name);

  static BuiltSet<ProfilePatchRequestProfileGenderEnum> get values => _$profilePatchRequestProfileGenderEnumValues;
  static ProfilePatchRequestProfileGenderEnum valueOf(String name) =>
      _$profilePatchRequestProfileGenderEnumValueOf(name);
}

class ProfilePatchRequestProfilePreferredFitEnum extends EnumClass {
  @BuiltValueEnumConst(wireName: r'slim')
  static const ProfilePatchRequestProfilePreferredFitEnum slim = _$profilePatchRequestProfilePreferredFitEnum_slim;
  @BuiltValueEnumConst(wireName: r'regular')
  static const ProfilePatchRequestProfilePreferredFitEnum regular =
      _$profilePatchRequestProfilePreferredFitEnum_regular;
  @BuiltValueEnumConst(wireName: r'relaxed')
  static const ProfilePatchRequestProfilePreferredFitEnum relaxed =
      _$profilePatchRequestProfilePreferredFitEnum_relaxed;
  @BuiltValueEnumConst(wireName: r'oversized')
  static const ProfilePatchRequestProfilePreferredFitEnum oversized =
      _$profilePatchRequestProfilePreferredFitEnum_oversized;
  @BuiltValueEnumConst(wireName: r'unknown_default_open_api', fallback: true)
  static const ProfilePatchRequestProfilePreferredFitEnum unknownDefaultOpenApi =
      _$profilePatchRequestProfilePreferredFitEnum_unknownDefaultOpenApi;

  static Serializer<ProfilePatchRequestProfilePreferredFitEnum> get serializer =>
      _$profilePatchRequestProfilePreferredFitEnumSerializer;

  const ProfilePatchRequestProfilePreferredFitEnum._(String name) : super(name);

  static BuiltSet<ProfilePatchRequestProfilePreferredFitEnum> get values =>
      _$profilePatchRequestProfilePreferredFitEnumValues;
  static ProfilePatchRequestProfilePreferredFitEnum valueOf(String name) =>
      _$profilePatchRequestProfilePreferredFitEnumValueOf(name);
}
