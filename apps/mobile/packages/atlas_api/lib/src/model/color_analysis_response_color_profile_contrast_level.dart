//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'dart:core';

import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';
import 'package:one_of/any_of.dart';

part 'color_analysis_response_color_profile_contrast_level.g.dart';

/// ColorAnalysisResponseColorProfileContrastLevel
@BuiltValue()
abstract class ColorAnalysisResponseColorProfileContrastLevel
    implements
        Built<ColorAnalysisResponseColorProfileContrastLevel, ColorAnalysisResponseColorProfileContrastLevelBuilder> {
  /// Any Of [String]
  AnyOf get anyOf;

  ColorAnalysisResponseColorProfileContrastLevel._();

  factory ColorAnalysisResponseColorProfileContrastLevel([
    void updates(ColorAnalysisResponseColorProfileContrastLevelBuilder b),
  ]) = _$ColorAnalysisResponseColorProfileContrastLevel;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ColorAnalysisResponseColorProfileContrastLevelBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ColorAnalysisResponseColorProfileContrastLevel> get serializer =>
      _$ColorAnalysisResponseColorProfileContrastLevelSerializer();
}

class _$ColorAnalysisResponseColorProfileContrastLevelSerializer
    implements PrimitiveSerializer<ColorAnalysisResponseColorProfileContrastLevel> {
  @override
  final Iterable<Type> types = const [
    ColorAnalysisResponseColorProfileContrastLevel,
    _$ColorAnalysisResponseColorProfileContrastLevel,
  ];

  @override
  final String wireName = r'ColorAnalysisResponseColorProfileContrastLevel';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ColorAnalysisResponseColorProfileContrastLevel object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {}

  @override
  Object serialize(
    Serializers serializers,
    ColorAnalysisResponseColorProfileContrastLevel object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final anyOf = object.anyOf;
    return serializers.serialize(
      anyOf,
      specifiedType: FullType(AnyOf, anyOf.valueTypes.map((type) => FullType(type)).toList()),
    )!;
  }

  @override
  ColorAnalysisResponseColorProfileContrastLevel deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = ColorAnalysisResponseColorProfileContrastLevelBuilder();
    Object? anyOfDataSrc;
    final targetType = const FullType(AnyOf, [FullType.nullable(String)]);
    anyOfDataSrc = serialized;
    result.anyOf = serializers.deserialize(anyOfDataSrc, specifiedType: targetType) as AnyOf;
    return result.build();
  }
}
