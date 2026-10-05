//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'wardrobe_list_query.g.dart';

/// WardrobeListQuery
///
/// Properties:
/// * [category]
/// * [cursor]
/// * [limit]
@BuiltValue()
abstract class WardrobeListQuery implements Built<WardrobeListQuery, WardrobeListQueryBuilder> {
  @BuiltValueField(wireName: r'category')
  WardrobeListQueryCategoryEnum? get category;
  // enum categoryEnum {  all,  outerwear,  shirt,  pants,  dress,  shoes,  bag,  accessory,  };

  @BuiltValueField(wireName: r'cursor')
  String? get cursor;

  @BuiltValueField(wireName: r'limit')
  int? get limit;

  WardrobeListQuery._();

  factory WardrobeListQuery([void updates(WardrobeListQueryBuilder b)]) = _$WardrobeListQuery;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(WardrobeListQueryBuilder b) => b..limit = 100;

  @BuiltValueSerializer(custom: true)
  static Serializer<WardrobeListQuery> get serializer => _$WardrobeListQuerySerializer();
}

class _$WardrobeListQuerySerializer implements PrimitiveSerializer<WardrobeListQuery> {
  @override
  final Iterable<Type> types = const [WardrobeListQuery, _$WardrobeListQuery];

  @override
  final String wireName = r'WardrobeListQuery';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    WardrobeListQuery object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    if (object.category != null) {
      yield r'category';
      yield serializers.serialize(object.category, specifiedType: const FullType(WardrobeListQueryCategoryEnum));
    }
    if (object.cursor != null) {
      yield r'cursor';
      yield serializers.serialize(object.cursor, specifiedType: const FullType(String));
    }
    if (object.limit != null) {
      yield r'limit';
      yield serializers.serialize(object.limit, specifiedType: const FullType(int));
    }
  }

  @override
  Object serialize(Serializers serializers, WardrobeListQuery object, {FullType specifiedType = FullType.unspecified}) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required WardrobeListQueryBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'category':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(WardrobeListQueryCategoryEnum),
          ) as WardrobeListQueryCategoryEnum;
          result.category = valueDes;
          break;
        case r'cursor':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.cursor = valueDes;
          break;
        case r'limit':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(int)) as int;
          result.limit = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  WardrobeListQuery deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = WardrobeListQueryBuilder();
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

class WardrobeListQueryCategoryEnum extends EnumClass {
  @BuiltValueEnumConst(wireName: r'all')
  static const WardrobeListQueryCategoryEnum all = _$wardrobeListQueryCategoryEnum_all;
  @BuiltValueEnumConst(wireName: r'outerwear')
  static const WardrobeListQueryCategoryEnum outerwear = _$wardrobeListQueryCategoryEnum_outerwear;
  @BuiltValueEnumConst(wireName: r'shirt')
  static const WardrobeListQueryCategoryEnum shirt = _$wardrobeListQueryCategoryEnum_shirt;
  @BuiltValueEnumConst(wireName: r'pants')
  static const WardrobeListQueryCategoryEnum pants = _$wardrobeListQueryCategoryEnum_pants;
  @BuiltValueEnumConst(wireName: r'dress')
  static const WardrobeListQueryCategoryEnum dress = _$wardrobeListQueryCategoryEnum_dress;
  @BuiltValueEnumConst(wireName: r'shoes')
  static const WardrobeListQueryCategoryEnum shoes = _$wardrobeListQueryCategoryEnum_shoes;
  @BuiltValueEnumConst(wireName: r'bag')
  static const WardrobeListQueryCategoryEnum bag = _$wardrobeListQueryCategoryEnum_bag;
  @BuiltValueEnumConst(wireName: r'accessory')
  static const WardrobeListQueryCategoryEnum accessory = _$wardrobeListQueryCategoryEnum_accessory;
  @BuiltValueEnumConst(wireName: r'unknown_default_open_api', fallback: true)
  static const WardrobeListQueryCategoryEnum unknownDefaultOpenApi =
      _$wardrobeListQueryCategoryEnum_unknownDefaultOpenApi;

  static Serializer<WardrobeListQueryCategoryEnum> get serializer => _$wardrobeListQueryCategoryEnumSerializer;

  const WardrobeListQueryCategoryEnum._(String name) : super(name);

  static BuiltSet<WardrobeListQueryCategoryEnum> get values => _$wardrobeListQueryCategoryEnumValues;
  static WardrobeListQueryCategoryEnum valueOf(String name) => _$wardrobeListQueryCategoryEnumValueOf(name);
}
