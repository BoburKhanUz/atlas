//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'outfit_generate_response_outfits_inner_factors.g.dart';

/// OutfitGenerateResponseOutfitsInnerFactors
///
/// Properties:
/// * [balance]
/// * [color]
/// * [feedback]
/// * [occasion]
/// * [preference]
/// * [season]
/// * [style]
/// * [weather]
@BuiltValue()
abstract class OutfitGenerateResponseOutfitsInnerFactors
    implements Built<OutfitGenerateResponseOutfitsInnerFactors, OutfitGenerateResponseOutfitsInnerFactorsBuilder> {
  @BuiltValueField(wireName: r'balance')
  num get balance;

  @BuiltValueField(wireName: r'color')
  num get color;

  @BuiltValueField(wireName: r'feedback')
  num get feedback;

  @BuiltValueField(wireName: r'occasion')
  num get occasion;

  @BuiltValueField(wireName: r'preference')
  num get preference;

  @BuiltValueField(wireName: r'season')
  num get season;

  @BuiltValueField(wireName: r'style')
  num get style;

  @BuiltValueField(wireName: r'weather')
  num get weather;

  OutfitGenerateResponseOutfitsInnerFactors._();

  factory OutfitGenerateResponseOutfitsInnerFactors([
    void updates(OutfitGenerateResponseOutfitsInnerFactorsBuilder b),
  ]) = _$OutfitGenerateResponseOutfitsInnerFactors;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(OutfitGenerateResponseOutfitsInnerFactorsBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<OutfitGenerateResponseOutfitsInnerFactors> get serializer =>
      _$OutfitGenerateResponseOutfitsInnerFactorsSerializer();
}

class _$OutfitGenerateResponseOutfitsInnerFactorsSerializer
    implements PrimitiveSerializer<OutfitGenerateResponseOutfitsInnerFactors> {
  @override
  final Iterable<Type> types = const [
    OutfitGenerateResponseOutfitsInnerFactors,
    _$OutfitGenerateResponseOutfitsInnerFactors,
  ];

  @override
  final String wireName = r'OutfitGenerateResponseOutfitsInnerFactors';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    OutfitGenerateResponseOutfitsInnerFactors object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'balance';
    yield serializers.serialize(object.balance, specifiedType: const FullType(num));
    yield r'color';
    yield serializers.serialize(object.color, specifiedType: const FullType(num));
    yield r'feedback';
    yield serializers.serialize(object.feedback, specifiedType: const FullType(num));
    yield r'occasion';
    yield serializers.serialize(object.occasion, specifiedType: const FullType(num));
    yield r'preference';
    yield serializers.serialize(object.preference, specifiedType: const FullType(num));
    yield r'season';
    yield serializers.serialize(object.season, specifiedType: const FullType(num));
    yield r'style';
    yield serializers.serialize(object.style, specifiedType: const FullType(num));
    yield r'weather';
    yield serializers.serialize(object.weather, specifiedType: const FullType(num));
  }

  @override
  Object serialize(
    Serializers serializers,
    OutfitGenerateResponseOutfitsInnerFactors object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required OutfitGenerateResponseOutfitsInnerFactorsBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'balance':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(num)) as num;
          result.balance = valueDes;
          break;
        case r'color':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(num)) as num;
          result.color = valueDes;
          break;
        case r'feedback':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(num)) as num;
          result.feedback = valueDes;
          break;
        case r'occasion':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(num)) as num;
          result.occasion = valueDes;
          break;
        case r'preference':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(num)) as num;
          result.preference = valueDes;
          break;
        case r'season':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(num)) as num;
          result.season = valueDes;
          break;
        case r'style':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(num)) as num;
          result.style = valueDes;
          break;
        case r'weather':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(num)) as num;
          result.weather = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  OutfitGenerateResponseOutfitsInnerFactors deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = OutfitGenerateResponseOutfitsInnerFactorsBuilder();
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
