//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'dart:core';

import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';
import 'package:one_of/any_of.dart';

part 'color_analysis_response_color_profile_secondary_confidence.g.dart';

/// ColorAnalysisResponseColorProfileSecondaryConfidence
@BuiltValue()
abstract class ColorAnalysisResponseColorProfileSecondaryConfidence
    implements
        Built<
          ColorAnalysisResponseColorProfileSecondaryConfidence,
          ColorAnalysisResponseColorProfileSecondaryConfidenceBuilder
        > {
  /// Any Of [num]
  AnyOf get anyOf;

  ColorAnalysisResponseColorProfileSecondaryConfidence._();

  factory ColorAnalysisResponseColorProfileSecondaryConfidence([
    void updates(ColorAnalysisResponseColorProfileSecondaryConfidenceBuilder b),
  ]) = _$ColorAnalysisResponseColorProfileSecondaryConfidence;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ColorAnalysisResponseColorProfileSecondaryConfidenceBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ColorAnalysisResponseColorProfileSecondaryConfidence> get serializer =>
      _$ColorAnalysisResponseColorProfileSecondaryConfidenceSerializer();
}

class _$ColorAnalysisResponseColorProfileSecondaryConfidenceSerializer
    implements PrimitiveSerializer<ColorAnalysisResponseColorProfileSecondaryConfidence> {
  @override
  final Iterable<Type> types = const [
    ColorAnalysisResponseColorProfileSecondaryConfidence,
    _$ColorAnalysisResponseColorProfileSecondaryConfidence,
  ];

  @override
  final String wireName = r'ColorAnalysisResponseColorProfileSecondaryConfidence';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ColorAnalysisResponseColorProfileSecondaryConfidence object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {}

  @override
  Object serialize(
    Serializers serializers,
    ColorAnalysisResponseColorProfileSecondaryConfidence object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final anyOf = object.anyOf;
    return serializers.serialize(
      anyOf,
      specifiedType: FullType(AnyOf, anyOf.valueTypes.map((type) => FullType(type)).toList()),
    )!;
  }

  @override
  ColorAnalysisResponseColorProfileSecondaryConfidence deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = ColorAnalysisResponseColorProfileSecondaryConfidenceBuilder();
    Object? anyOfDataSrc;
    final targetType = const FullType(AnyOf, [FullType.nullable(num)]);
    anyOfDataSrc = serialized;
    result.anyOf = serializers.deserialize(anyOfDataSrc, specifiedType: targetType) as AnyOf;
    return result.build();
  }
}
