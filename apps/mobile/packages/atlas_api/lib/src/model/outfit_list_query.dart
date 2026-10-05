//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'outfit_list_query.g.dart';

/// OutfitListQuery
///
/// Properties:
/// * [saved]
@BuiltValue()
abstract class OutfitListQuery implements Built<OutfitListQuery, OutfitListQueryBuilder> {
  @BuiltValueField(wireName: r'saved')
  OutfitListQuerySavedEnum? get saved;
  // enum savedEnum {  0,  1,  true,  false,  };

  OutfitListQuery._();

  factory OutfitListQuery([void updates(OutfitListQueryBuilder b)]) = _$OutfitListQuery;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(OutfitListQueryBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<OutfitListQuery> get serializer => _$OutfitListQuerySerializer();
}

class _$OutfitListQuerySerializer implements PrimitiveSerializer<OutfitListQuery> {
  @override
  final Iterable<Type> types = const [OutfitListQuery, _$OutfitListQuery];

  @override
  final String wireName = r'OutfitListQuery';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    OutfitListQuery object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    if (object.saved != null) {
      yield r'saved';
      yield serializers.serialize(object.saved, specifiedType: const FullType(OutfitListQuerySavedEnum));
    }
  }

  @override
  Object serialize(Serializers serializers, OutfitListQuery object, {FullType specifiedType = FullType.unspecified}) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required OutfitListQueryBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'saved':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(OutfitListQuerySavedEnum),
          ) as OutfitListQuerySavedEnum;
          result.saved = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  OutfitListQuery deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = OutfitListQueryBuilder();
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

class OutfitListQuerySavedEnum extends EnumClass {
  @BuiltValueEnumConst(wireName: r'0')
  static const OutfitListQuerySavedEnum n0 = _$outfitListQuerySavedEnum_n0;
  @BuiltValueEnumConst(wireName: r'1')
  static const OutfitListQuerySavedEnum n1 = _$outfitListQuerySavedEnum_n1;
  @BuiltValueEnumConst(wireName: r'true')
  static const OutfitListQuerySavedEnum true_ = _$outfitListQuerySavedEnum_true_;
  @BuiltValueEnumConst(wireName: r'false')
  static const OutfitListQuerySavedEnum false_ = _$outfitListQuerySavedEnum_false_;
  @BuiltValueEnumConst(wireName: r'unknown_default_open_api', fallback: true)
  static const OutfitListQuerySavedEnum unknownDefaultOpenApi = _$outfitListQuerySavedEnum_unknownDefaultOpenApi;

  static Serializer<OutfitListQuerySavedEnum> get serializer => _$outfitListQuerySavedEnumSerializer;

  const OutfitListQuerySavedEnum._(String name) : super(name);

  static BuiltSet<OutfitListQuerySavedEnum> get values => _$outfitListQuerySavedEnumValues;
  static OutfitListQuerySavedEnum valueOf(String name) => _$outfitListQuerySavedEnumValueOf(name);
}
