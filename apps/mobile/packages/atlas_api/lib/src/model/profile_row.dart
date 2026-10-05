//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'profile_row.g.dart';

/// UserProfile row
///
/// Properties:
/// * [id]
/// * [userId]
@BuiltValue()
abstract class ProfileRow implements Built<ProfileRow, ProfileRowBuilder> {
  @BuiltValueField(wireName: r'id')
  String get id;

  @BuiltValueField(wireName: r'userId')
  String get userId;

  ProfileRow._();

  factory ProfileRow([void updates(ProfileRowBuilder b)]) = _$ProfileRow;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ProfileRowBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ProfileRow> get serializer => _$ProfileRowSerializer();
}

class _$ProfileRowSerializer implements PrimitiveSerializer<ProfileRow> {
  @override
  final Iterable<Type> types = const [ProfileRow, _$ProfileRow];

  @override
  final String wireName = r'ProfileRow';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ProfileRow object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'id';
    yield serializers.serialize(object.id, specifiedType: const FullType(String));
    yield r'userId';
    yield serializers.serialize(object.userId, specifiedType: const FullType(String));
  }

  @override
  Object serialize(Serializers serializers, ProfileRow object, {FullType specifiedType = FullType.unspecified}) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required ProfileRowBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'id':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.id = valueDes;
          break;
        case r'userId':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.userId = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  ProfileRow deserialize(Serializers serializers, Object serialized, {FullType specifiedType = FullType.unspecified}) {
    final result = ProfileRowBuilder();
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
