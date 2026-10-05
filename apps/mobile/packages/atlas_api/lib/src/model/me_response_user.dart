//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:atlas_api/src/model/color_analysis_response_color_profile_contrast_level.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'me_response_user.g.dart';

/// MeResponseUser
///
/// Properties:
/// * [createdAt] - ISO 8601, UTC
/// * [email]
/// * [id]
/// * [name]
@BuiltValue()
abstract class MeResponseUser implements Built<MeResponseUser, MeResponseUserBuilder> {
  /// ISO 8601, UTC
  @BuiltValueField(wireName: r'createdAt')
  DateTime get createdAt;

  @BuiltValueField(wireName: r'email')
  String get email;

  @BuiltValueField(wireName: r'id')
  String get id;

  @BuiltValueField(wireName: r'name')
  ColorAnalysisResponseColorProfileContrastLevel? get name;

  MeResponseUser._();

  factory MeResponseUser([void updates(MeResponseUserBuilder b)]) = _$MeResponseUser;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(MeResponseUserBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<MeResponseUser> get serializer => _$MeResponseUserSerializer();
}

class _$MeResponseUserSerializer implements PrimitiveSerializer<MeResponseUser> {
  @override
  final Iterable<Type> types = const [MeResponseUser, _$MeResponseUser];

  @override
  final String wireName = r'MeResponseUser';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    MeResponseUser object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'createdAt';
    yield serializers.serialize(object.createdAt, specifiedType: const FullType(DateTime));
    yield r'email';
    yield serializers.serialize(object.email, specifiedType: const FullType(String));
    yield r'id';
    yield serializers.serialize(object.id, specifiedType: const FullType(String));
    yield r'name';
    yield object.name == null
        ? null
        : serializers.serialize(
            object.name,
            specifiedType: const FullType.nullable(ColorAnalysisResponseColorProfileContrastLevel),
          );
  }

  @override
  Object serialize(Serializers serializers, MeResponseUser object, {FullType specifiedType = FullType.unspecified}) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required MeResponseUserBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'createdAt':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(DateTime)) as DateTime;
          result.createdAt = valueDes;
          break;
        case r'email':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.email = valueDes;
          break;
        case r'id':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.id = valueDes;
          break;
        case r'name':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(ColorAnalysisResponseColorProfileContrastLevel),
          ) as ColorAnalysisResponseColorProfileContrastLevel?;
          if (valueDes == null) continue;
          result.name.replace(valueDes);
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  MeResponseUser deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = MeResponseUserBuilder();
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
