//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:atlas_api/src/model/outfit_generate_request_weather.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'outfit_generate_request.g.dart';

/// OutfitGenerateRequest
///
/// Properties:
/// * [lat]
/// * [lon]
/// * [occasion]
/// * [seed] - Omitted: the best outfits. Any number: a deterministic window of the top candidates (same seed, same result)
/// * [topN]
/// * [weather]
@BuiltValue()
abstract class OutfitGenerateRequest implements Built<OutfitGenerateRequest, OutfitGenerateRequestBuilder> {
  @BuiltValueField(wireName: r'lat')
  num? get lat;

  @BuiltValueField(wireName: r'lon')
  num? get lon;

  @BuiltValueField(wireName: r'occasion')
  OutfitGenerateRequestOccasionEnum? get occasion;
  // enum occasionEnum {  work,  wedding,  date,  travel,  casual,  other,  };

  /// Omitted: the best outfits. Any number: a deterministic window of the top candidates (same seed, same result)
  @BuiltValueField(wireName: r'seed')
  num? get seed;

  @BuiltValueField(wireName: r'topN')
  int? get topN;

  @BuiltValueField(wireName: r'weather')
  OutfitGenerateRequestWeather? get weather;

  OutfitGenerateRequest._();

  factory OutfitGenerateRequest([void updates(OutfitGenerateRequestBuilder b)]) = _$OutfitGenerateRequest;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(OutfitGenerateRequestBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<OutfitGenerateRequest> get serializer => _$OutfitGenerateRequestSerializer();
}

class _$OutfitGenerateRequestSerializer implements PrimitiveSerializer<OutfitGenerateRequest> {
  @override
  final Iterable<Type> types = const [OutfitGenerateRequest, _$OutfitGenerateRequest];

  @override
  final String wireName = r'OutfitGenerateRequest';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    OutfitGenerateRequest object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    if (object.lat != null) {
      yield r'lat';
      yield serializers.serialize(object.lat, specifiedType: const FullType.nullable(num));
    }
    if (object.lon != null) {
      yield r'lon';
      yield serializers.serialize(object.lon, specifiedType: const FullType.nullable(num));
    }
    if (object.occasion != null) {
      yield r'occasion';
      yield serializers.serialize(
        object.occasion,
        specifiedType: const FullType.nullable(OutfitGenerateRequestOccasionEnum),
      );
    }
    if (object.seed != null) {
      yield r'seed';
      yield serializers.serialize(object.seed, specifiedType: const FullType(num));
    }
    if (object.topN != null) {
      yield r'topN';
      yield serializers.serialize(object.topN, specifiedType: const FullType(int));
    }
    if (object.weather != null) {
      yield r'weather';
      yield serializers.serialize(object.weather, specifiedType: const FullType.nullable(OutfitGenerateRequestWeather));
    }
  }

  @override
  Object serialize(
    Serializers serializers,
    OutfitGenerateRequest object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required OutfitGenerateRequestBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'lat':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(num)) as num?;
          if (valueDes == null) continue;
          result.lat = valueDes;
          break;
        case r'lon':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(num)) as num?;
          if (valueDes == null) continue;
          result.lon = valueDes;
          break;
        case r'occasion':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(OutfitGenerateRequestOccasionEnum),
          ) as OutfitGenerateRequestOccasionEnum?;
          if (valueDes == null) continue;
          result.occasion = valueDes;
          break;
        case r'seed':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(num)) as num;
          result.seed = valueDes;
          break;
        case r'topN':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(int)) as int;
          result.topN = valueDes;
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
  OutfitGenerateRequest deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = OutfitGenerateRequestBuilder();
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

class OutfitGenerateRequestOccasionEnum extends EnumClass {
  @BuiltValueEnumConst(wireName: r'work')
  static const OutfitGenerateRequestOccasionEnum work = _$outfitGenerateRequestOccasionEnum_work;
  @BuiltValueEnumConst(wireName: r'wedding')
  static const OutfitGenerateRequestOccasionEnum wedding = _$outfitGenerateRequestOccasionEnum_wedding;
  @BuiltValueEnumConst(wireName: r'date')
  static const OutfitGenerateRequestOccasionEnum date = _$outfitGenerateRequestOccasionEnum_date;
  @BuiltValueEnumConst(wireName: r'travel')
  static const OutfitGenerateRequestOccasionEnum travel = _$outfitGenerateRequestOccasionEnum_travel;
  @BuiltValueEnumConst(wireName: r'casual')
  static const OutfitGenerateRequestOccasionEnum casual = _$outfitGenerateRequestOccasionEnum_casual;
  @BuiltValueEnumConst(wireName: r'other')
  static const OutfitGenerateRequestOccasionEnum other = _$outfitGenerateRequestOccasionEnum_other;
  @BuiltValueEnumConst(wireName: r'unknown_default_open_api', fallback: true)
  static const OutfitGenerateRequestOccasionEnum unknownDefaultOpenApi =
      _$outfitGenerateRequestOccasionEnum_unknownDefaultOpenApi;

  static Serializer<OutfitGenerateRequestOccasionEnum> get serializer => _$outfitGenerateRequestOccasionEnumSerializer;

  const OutfitGenerateRequestOccasionEnum._(String name) : super(name);

  static BuiltSet<OutfitGenerateRequestOccasionEnum> get values => _$outfitGenerateRequestOccasionEnumValues;
  static OutfitGenerateRequestOccasionEnum valueOf(String name) => _$outfitGenerateRequestOccasionEnumValueOf(name);
}
