//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:atlas_api/src/model/outfit_save_request_items_inner.dart';
import 'package:atlas_api/src/model/outfit_generate_request_weather.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'outfit_save_request.g.dart';

/// OutfitSaveRequest
///
/// Properties:
/// * [explanation]
/// * [isSaved]
/// * [items]
/// * [name]
/// * [occasion]
/// * [reasons]
/// * [score]
/// * [weather]
@BuiltValue()
abstract class OutfitSaveRequest implements Built<OutfitSaveRequest, OutfitSaveRequestBuilder> {
  @BuiltValueField(wireName: r'explanation')
  String? get explanation;

  @BuiltValueField(wireName: r'isSaved')
  bool? get isSaved;

  @BuiltValueField(wireName: r'items')
  BuiltList<OutfitSaveRequestItemsInner> get items;

  @BuiltValueField(wireName: r'name')
  String? get name;

  @BuiltValueField(wireName: r'occasion')
  OutfitSaveRequestOccasionEnum? get occasion;
  // enum occasionEnum {  work,  wedding,  date,  travel,  casual,  other,  };

  @BuiltValueField(wireName: r'reasons')
  BuiltList<String>? get reasons;

  @BuiltValueField(wireName: r'score')
  num? get score;

  @BuiltValueField(wireName: r'weather')
  OutfitGenerateRequestWeather? get weather;

  OutfitSaveRequest._();

  factory OutfitSaveRequest([void updates(OutfitSaveRequestBuilder b)]) = _$OutfitSaveRequest;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(OutfitSaveRequestBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<OutfitSaveRequest> get serializer => _$OutfitSaveRequestSerializer();
}

class _$OutfitSaveRequestSerializer implements PrimitiveSerializer<OutfitSaveRequest> {
  @override
  final Iterable<Type> types = const [OutfitSaveRequest, _$OutfitSaveRequest];

  @override
  final String wireName = r'OutfitSaveRequest';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    OutfitSaveRequest object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    if (object.explanation != null) {
      yield r'explanation';
      yield serializers.serialize(object.explanation, specifiedType: const FullType.nullable(String));
    }
    if (object.isSaved != null) {
      yield r'isSaved';
      yield serializers.serialize(object.isSaved, specifiedType: const FullType(bool));
    }
    yield r'items';
    yield serializers.serialize(
      object.items,
      specifiedType: const FullType(BuiltList, [FullType(OutfitSaveRequestItemsInner)]),
    );
    if (object.name != null) {
      yield r'name';
      yield serializers.serialize(object.name, specifiedType: const FullType.nullable(String));
    }
    if (object.occasion != null) {
      yield r'occasion';
      yield serializers.serialize(
        object.occasion,
        specifiedType: const FullType.nullable(OutfitSaveRequestOccasionEnum),
      );
    }
    if (object.reasons != null) {
      yield r'reasons';
      yield serializers.serialize(object.reasons, specifiedType: const FullType(BuiltList, [FullType(String)]));
    }
    if (object.score != null) {
      yield r'score';
      yield serializers.serialize(object.score, specifiedType: const FullType.nullable(num));
    }
    if (object.weather != null) {
      yield r'weather';
      yield serializers.serialize(object.weather, specifiedType: const FullType.nullable(OutfitGenerateRequestWeather));
    }
  }

  @override
  Object serialize(Serializers serializers, OutfitSaveRequest object, {FullType specifiedType = FullType.unspecified}) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required OutfitSaveRequestBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'explanation':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(String)) as String?;
          if (valueDes == null) continue;
          result.explanation = valueDes;
          break;
        case r'isSaved':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(bool)) as bool;
          result.isSaved = valueDes;
          break;
        case r'items':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(OutfitSaveRequestItemsInner)]),
          ) as BuiltList<OutfitSaveRequestItemsInner>;
          result.items.replace(valueDes);
          break;
        case r'name':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(String)) as String?;
          if (valueDes == null) continue;
          result.name = valueDes;
          break;
        case r'occasion':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(OutfitSaveRequestOccasionEnum),
          ) as OutfitSaveRequestOccasionEnum?;
          if (valueDes == null) continue;
          result.occasion = valueDes;
          break;
        case r'reasons':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(String)]),
          ) as BuiltList<String>;
          result.reasons.replace(valueDes);
          break;
        case r'score':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(num)) as num?;
          if (valueDes == null) continue;
          result.score = valueDes;
          break;
        case r'weather':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(OutfitGenerateRequestWeather),
          ) as OutfitGenerateRequestWeather?;
          if (valueDes == null) continue;
          result.weather.replace(valueDes);
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  OutfitSaveRequest deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = OutfitSaveRequestBuilder();
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

class OutfitSaveRequestOccasionEnum extends EnumClass {
  @BuiltValueEnumConst(wireName: r'work')
  static const OutfitSaveRequestOccasionEnum work = _$outfitSaveRequestOccasionEnum_work;
  @BuiltValueEnumConst(wireName: r'wedding')
  static const OutfitSaveRequestOccasionEnum wedding = _$outfitSaveRequestOccasionEnum_wedding;
  @BuiltValueEnumConst(wireName: r'date')
  static const OutfitSaveRequestOccasionEnum date = _$outfitSaveRequestOccasionEnum_date;
  @BuiltValueEnumConst(wireName: r'travel')
  static const OutfitSaveRequestOccasionEnum travel = _$outfitSaveRequestOccasionEnum_travel;
  @BuiltValueEnumConst(wireName: r'casual')
  static const OutfitSaveRequestOccasionEnum casual = _$outfitSaveRequestOccasionEnum_casual;
  @BuiltValueEnumConst(wireName: r'other')
  static const OutfitSaveRequestOccasionEnum other = _$outfitSaveRequestOccasionEnum_other;
  @BuiltValueEnumConst(wireName: r'unknown_default_open_api', fallback: true)
  static const OutfitSaveRequestOccasionEnum unknownDefaultOpenApi =
      _$outfitSaveRequestOccasionEnum_unknownDefaultOpenApi;

  static Serializer<OutfitSaveRequestOccasionEnum> get serializer => _$outfitSaveRequestOccasionEnumSerializer;

  const OutfitSaveRequestOccasionEnum._(String name) : super(name);

  static BuiltSet<OutfitSaveRequestOccasionEnum> get values => _$outfitSaveRequestOccasionEnumValues;
  static OutfitSaveRequestOccasionEnum valueOf(String name) => _$outfitSaveRequestOccasionEnumValueOf(name);
}
