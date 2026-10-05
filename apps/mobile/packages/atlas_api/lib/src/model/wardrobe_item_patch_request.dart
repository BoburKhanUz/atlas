//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'wardrobe_item_patch_request.g.dart';

/// WardrobeItemPatchRequest
///
/// Properties:
/// * [category]
/// * [colors]
/// * [fit]
/// * [formality]
/// * [gender]
/// * [material]
/// * [pattern]
/// * [season]
/// * [sleeveLength]
/// * [style]
/// * [subcategory]
@BuiltValue()
abstract class WardrobeItemPatchRequest implements Built<WardrobeItemPatchRequest, WardrobeItemPatchRequestBuilder> {
  @BuiltValueField(wireName: r'category')
  WardrobeItemPatchRequestCategoryEnum? get category;
  // enum categoryEnum {  outerwear,  shirt,  pants,  dress,  shoes,  bag,  accessory,  };

  @BuiltValueField(wireName: r'colors')
  BuiltList<WardrobeItemPatchRequestColorsEnum>? get colors;
  // enum colorsEnum {  white,  black,  beige,  gray,  navy,  blue,  light_blue,  green,  olive,  khaki,  brown,  tan,  red,  burgundy,  pink,  orange,  yellow,  purple,  teal,  cream,  ivory,  rust,  mustard,  };

  @BuiltValueField(wireName: r'fit')
  WardrobeItemPatchRequestFitEnum? get fit;
  // enum fitEnum {  slim,  regular,  relaxed,  oversized,  };

  @BuiltValueField(wireName: r'formality')
  WardrobeItemPatchRequestFormalityEnum? get formality;
  // enum formalityEnum {  casual,  smart_casual,  formal,  black_tie,  };

  @BuiltValueField(wireName: r'gender')
  WardrobeItemPatchRequestGenderEnum? get gender;
  // enum genderEnum {  male,  female,  unisex,  };

  @BuiltValueField(wireName: r'material')
  WardrobeItemPatchRequestMaterialEnum? get material;
  // enum materialEnum {  cotton,  linen,  denim,  wool,  cashmere,  silk,  polyester,  nylon,  leather,  suede,  knit,  blend,  };

  @BuiltValueField(wireName: r'pattern')
  WardrobeItemPatchRequestPatternEnum? get pattern;
  // enum patternEnum {  solid,  striped,  checked,  plaid,  floral,  graphic,  color_block,  denim,  };

  @BuiltValueField(wireName: r'season')
  BuiltList<WardrobeItemPatchRequestSeasonEnum>? get season;
  // enum seasonEnum {  spring,  summer,  autumn,  winter,  };

  @BuiltValueField(wireName: r'sleeveLength')
  WardrobeItemPatchRequestSleeveLengthEnum? get sleeveLength;
  // enum sleeveLengthEnum {  short,  long,  sleeveless,  three_quarter,  };

  @BuiltValueField(wireName: r'style')
  WardrobeItemPatchRequestStyleEnum? get style;
  // enum styleEnum {  casual,  smart_casual,  formal,  sporty,  bohemian,  minimal,  streetwear,  classic,  preppy,  };

  @BuiltValueField(wireName: r'subcategory')
  WardrobeItemPatchRequestSubcategoryEnum? get subcategory;
  // enum subcategoryEnum {  jacket,  blazer,  coat,  windbreaker,  tshirt,  oxford_shirt,  polo,  blouse,  knit,  jeans,  chinos,  trousers,  shorts,  casual_dress,  evening_dress,  midi_dress,  sneakers,  loafers,  oxford_shoes,  boots,  sandals,  tote,  backpack,  crossbody,  clutch,  belt,  scarf,  hat,  watch,  sunglasses,  };

  WardrobeItemPatchRequest._();

  factory WardrobeItemPatchRequest([void updates(WardrobeItemPatchRequestBuilder b)]) = _$WardrobeItemPatchRequest;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(WardrobeItemPatchRequestBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<WardrobeItemPatchRequest> get serializer => _$WardrobeItemPatchRequestSerializer();
}

class _$WardrobeItemPatchRequestSerializer implements PrimitiveSerializer<WardrobeItemPatchRequest> {
  @override
  final Iterable<Type> types = const [WardrobeItemPatchRequest, _$WardrobeItemPatchRequest];

  @override
  final String wireName = r'WardrobeItemPatchRequest';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    WardrobeItemPatchRequest object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    if (object.category != null) {
      yield r'category';
      yield serializers.serialize(object.category, specifiedType: const FullType(WardrobeItemPatchRequestCategoryEnum));
    }
    if (object.colors != null) {
      yield r'colors';
      yield serializers.serialize(
        object.colors,
        specifiedType: const FullType(BuiltList, [FullType(WardrobeItemPatchRequestColorsEnum)]),
      );
    }
    if (object.fit != null) {
      yield r'fit';
      yield serializers.serialize(object.fit, specifiedType: const FullType.nullable(WardrobeItemPatchRequestFitEnum));
    }
    if (object.formality != null) {
      yield r'formality';
      yield serializers.serialize(
        object.formality,
        specifiedType: const FullType.nullable(WardrobeItemPatchRequestFormalityEnum),
      );
    }
    if (object.gender != null) {
      yield r'gender';
      yield serializers.serialize(
        object.gender,
        specifiedType: const FullType.nullable(WardrobeItemPatchRequestGenderEnum),
      );
    }
    if (object.material != null) {
      yield r'material';
      yield serializers.serialize(
        object.material,
        specifiedType: const FullType.nullable(WardrobeItemPatchRequestMaterialEnum),
      );
    }
    if (object.pattern != null) {
      yield r'pattern';
      yield serializers.serialize(
        object.pattern,
        specifiedType: const FullType.nullable(WardrobeItemPatchRequestPatternEnum),
      );
    }
    if (object.season != null) {
      yield r'season';
      yield serializers.serialize(
        object.season,
        specifiedType: const FullType(BuiltList, [FullType(WardrobeItemPatchRequestSeasonEnum)]),
      );
    }
    if (object.sleeveLength != null) {
      yield r'sleeveLength';
      yield serializers.serialize(
        object.sleeveLength,
        specifiedType: const FullType.nullable(WardrobeItemPatchRequestSleeveLengthEnum),
      );
    }
    if (object.style != null) {
      yield r'style';
      yield serializers.serialize(
        object.style,
        specifiedType: const FullType.nullable(WardrobeItemPatchRequestStyleEnum),
      );
    }
    if (object.subcategory != null) {
      yield r'subcategory';
      yield serializers.serialize(
        object.subcategory,
        specifiedType: const FullType.nullable(WardrobeItemPatchRequestSubcategoryEnum),
      );
    }
  }

  @override
  Object serialize(
    Serializers serializers,
    WardrobeItemPatchRequest object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required WardrobeItemPatchRequestBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'category':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(WardrobeItemPatchRequestCategoryEnum),
          ) as WardrobeItemPatchRequestCategoryEnum;
          result.category = valueDes;
          break;
        case r'colors':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(WardrobeItemPatchRequestColorsEnum)]),
          ) as BuiltList<WardrobeItemPatchRequestColorsEnum>;
          result.colors.replace(valueDes);
          break;
        case r'fit':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(WardrobeItemPatchRequestFitEnum),
          ) as WardrobeItemPatchRequestFitEnum?;
          if (valueDes == null) continue;
          result.fit = valueDes;
          break;
        case r'formality':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(WardrobeItemPatchRequestFormalityEnum),
          ) as WardrobeItemPatchRequestFormalityEnum?;
          if (valueDes == null) continue;
          result.formality = valueDes;
          break;
        case r'gender':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(WardrobeItemPatchRequestGenderEnum),
          ) as WardrobeItemPatchRequestGenderEnum?;
          if (valueDes == null) continue;
          result.gender = valueDes;
          break;
        case r'material':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(WardrobeItemPatchRequestMaterialEnum),
          ) as WardrobeItemPatchRequestMaterialEnum?;
          if (valueDes == null) continue;
          result.material = valueDes;
          break;
        case r'pattern':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(WardrobeItemPatchRequestPatternEnum),
          ) as WardrobeItemPatchRequestPatternEnum?;
          if (valueDes == null) continue;
          result.pattern = valueDes;
          break;
        case r'season':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(WardrobeItemPatchRequestSeasonEnum)]),
          ) as BuiltList<WardrobeItemPatchRequestSeasonEnum>;
          result.season.replace(valueDes);
          break;
        case r'sleeveLength':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(WardrobeItemPatchRequestSleeveLengthEnum),
          ) as WardrobeItemPatchRequestSleeveLengthEnum?;
          if (valueDes == null) continue;
          result.sleeveLength = valueDes;
          break;
        case r'style':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(WardrobeItemPatchRequestStyleEnum),
          ) as WardrobeItemPatchRequestStyleEnum?;
          if (valueDes == null) continue;
          result.style = valueDes;
          break;
        case r'subcategory':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(WardrobeItemPatchRequestSubcategoryEnum),
          ) as WardrobeItemPatchRequestSubcategoryEnum?;
          if (valueDes == null) continue;
          result.subcategory = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  WardrobeItemPatchRequest deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = WardrobeItemPatchRequestBuilder();
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

class WardrobeItemPatchRequestCategoryEnum extends EnumClass {
  @BuiltValueEnumConst(wireName: r'outerwear')
  static const WardrobeItemPatchRequestCategoryEnum outerwear = _$wardrobeItemPatchRequestCategoryEnum_outerwear;
  @BuiltValueEnumConst(wireName: r'shirt')
  static const WardrobeItemPatchRequestCategoryEnum shirt = _$wardrobeItemPatchRequestCategoryEnum_shirt;
  @BuiltValueEnumConst(wireName: r'pants')
  static const WardrobeItemPatchRequestCategoryEnum pants = _$wardrobeItemPatchRequestCategoryEnum_pants;
  @BuiltValueEnumConst(wireName: r'dress')
  static const WardrobeItemPatchRequestCategoryEnum dress = _$wardrobeItemPatchRequestCategoryEnum_dress;
  @BuiltValueEnumConst(wireName: r'shoes')
  static const WardrobeItemPatchRequestCategoryEnum shoes = _$wardrobeItemPatchRequestCategoryEnum_shoes;
  @BuiltValueEnumConst(wireName: r'bag')
  static const WardrobeItemPatchRequestCategoryEnum bag = _$wardrobeItemPatchRequestCategoryEnum_bag;
  @BuiltValueEnumConst(wireName: r'accessory')
  static const WardrobeItemPatchRequestCategoryEnum accessory = _$wardrobeItemPatchRequestCategoryEnum_accessory;
  @BuiltValueEnumConst(wireName: r'unknown_default_open_api', fallback: true)
  static const WardrobeItemPatchRequestCategoryEnum unknownDefaultOpenApi =
      _$wardrobeItemPatchRequestCategoryEnum_unknownDefaultOpenApi;

  static Serializer<WardrobeItemPatchRequestCategoryEnum> get serializer =>
      _$wardrobeItemPatchRequestCategoryEnumSerializer;

  const WardrobeItemPatchRequestCategoryEnum._(String name) : super(name);

  static BuiltSet<WardrobeItemPatchRequestCategoryEnum> get values => _$wardrobeItemPatchRequestCategoryEnumValues;
  static WardrobeItemPatchRequestCategoryEnum valueOf(String name) =>
      _$wardrobeItemPatchRequestCategoryEnumValueOf(name);
}

class WardrobeItemPatchRequestColorsEnum extends EnumClass {
  @BuiltValueEnumConst(wireName: r'white')
  static const WardrobeItemPatchRequestColorsEnum white = _$wardrobeItemPatchRequestColorsEnum_white;
  @BuiltValueEnumConst(wireName: r'black')
  static const WardrobeItemPatchRequestColorsEnum black = _$wardrobeItemPatchRequestColorsEnum_black;
  @BuiltValueEnumConst(wireName: r'beige')
  static const WardrobeItemPatchRequestColorsEnum beige = _$wardrobeItemPatchRequestColorsEnum_beige;
  @BuiltValueEnumConst(wireName: r'gray')
  static const WardrobeItemPatchRequestColorsEnum gray = _$wardrobeItemPatchRequestColorsEnum_gray;
  @BuiltValueEnumConst(wireName: r'navy')
  static const WardrobeItemPatchRequestColorsEnum navy = _$wardrobeItemPatchRequestColorsEnum_navy;
  @BuiltValueEnumConst(wireName: r'blue')
  static const WardrobeItemPatchRequestColorsEnum blue = _$wardrobeItemPatchRequestColorsEnum_blue;
  @BuiltValueEnumConst(wireName: r'light_blue')
  static const WardrobeItemPatchRequestColorsEnum lightBlue = _$wardrobeItemPatchRequestColorsEnum_lightBlue;
  @BuiltValueEnumConst(wireName: r'green')
  static const WardrobeItemPatchRequestColorsEnum green = _$wardrobeItemPatchRequestColorsEnum_green;
  @BuiltValueEnumConst(wireName: r'olive')
  static const WardrobeItemPatchRequestColorsEnum olive = _$wardrobeItemPatchRequestColorsEnum_olive;
  @BuiltValueEnumConst(wireName: r'khaki')
  static const WardrobeItemPatchRequestColorsEnum khaki = _$wardrobeItemPatchRequestColorsEnum_khaki;
  @BuiltValueEnumConst(wireName: r'brown')
  static const WardrobeItemPatchRequestColorsEnum brown = _$wardrobeItemPatchRequestColorsEnum_brown;
  @BuiltValueEnumConst(wireName: r'tan')
  static const WardrobeItemPatchRequestColorsEnum tan = _$wardrobeItemPatchRequestColorsEnum_tan;
  @BuiltValueEnumConst(wireName: r'red')
  static const WardrobeItemPatchRequestColorsEnum red = _$wardrobeItemPatchRequestColorsEnum_red;
  @BuiltValueEnumConst(wireName: r'burgundy')
  static const WardrobeItemPatchRequestColorsEnum burgundy = _$wardrobeItemPatchRequestColorsEnum_burgundy;
  @BuiltValueEnumConst(wireName: r'pink')
  static const WardrobeItemPatchRequestColorsEnum pink = _$wardrobeItemPatchRequestColorsEnum_pink;
  @BuiltValueEnumConst(wireName: r'orange')
  static const WardrobeItemPatchRequestColorsEnum orange = _$wardrobeItemPatchRequestColorsEnum_orange;
  @BuiltValueEnumConst(wireName: r'yellow')
  static const WardrobeItemPatchRequestColorsEnum yellow = _$wardrobeItemPatchRequestColorsEnum_yellow;
  @BuiltValueEnumConst(wireName: r'purple')
  static const WardrobeItemPatchRequestColorsEnum purple = _$wardrobeItemPatchRequestColorsEnum_purple;
  @BuiltValueEnumConst(wireName: r'teal')
  static const WardrobeItemPatchRequestColorsEnum teal = _$wardrobeItemPatchRequestColorsEnum_teal;
  @BuiltValueEnumConst(wireName: r'cream')
  static const WardrobeItemPatchRequestColorsEnum cream = _$wardrobeItemPatchRequestColorsEnum_cream;
  @BuiltValueEnumConst(wireName: r'ivory')
  static const WardrobeItemPatchRequestColorsEnum ivory = _$wardrobeItemPatchRequestColorsEnum_ivory;
  @BuiltValueEnumConst(wireName: r'rust')
  static const WardrobeItemPatchRequestColorsEnum rust = _$wardrobeItemPatchRequestColorsEnum_rust;
  @BuiltValueEnumConst(wireName: r'mustard')
  static const WardrobeItemPatchRequestColorsEnum mustard = _$wardrobeItemPatchRequestColorsEnum_mustard;
  @BuiltValueEnumConst(wireName: r'unknown_default_open_api', fallback: true)
  static const WardrobeItemPatchRequestColorsEnum unknownDefaultOpenApi =
      _$wardrobeItemPatchRequestColorsEnum_unknownDefaultOpenApi;

  static Serializer<WardrobeItemPatchRequestColorsEnum> get serializer =>
      _$wardrobeItemPatchRequestColorsEnumSerializer;

  const WardrobeItemPatchRequestColorsEnum._(String name) : super(name);

  static BuiltSet<WardrobeItemPatchRequestColorsEnum> get values => _$wardrobeItemPatchRequestColorsEnumValues;
  static WardrobeItemPatchRequestColorsEnum valueOf(String name) => _$wardrobeItemPatchRequestColorsEnumValueOf(name);
}

class WardrobeItemPatchRequestFitEnum extends EnumClass {
  @BuiltValueEnumConst(wireName: r'slim')
  static const WardrobeItemPatchRequestFitEnum slim = _$wardrobeItemPatchRequestFitEnum_slim;
  @BuiltValueEnumConst(wireName: r'regular')
  static const WardrobeItemPatchRequestFitEnum regular = _$wardrobeItemPatchRequestFitEnum_regular;
  @BuiltValueEnumConst(wireName: r'relaxed')
  static const WardrobeItemPatchRequestFitEnum relaxed = _$wardrobeItemPatchRequestFitEnum_relaxed;
  @BuiltValueEnumConst(wireName: r'oversized')
  static const WardrobeItemPatchRequestFitEnum oversized = _$wardrobeItemPatchRequestFitEnum_oversized;
  @BuiltValueEnumConst(wireName: r'unknown_default_open_api', fallback: true)
  static const WardrobeItemPatchRequestFitEnum unknownDefaultOpenApi =
      _$wardrobeItemPatchRequestFitEnum_unknownDefaultOpenApi;

  static Serializer<WardrobeItemPatchRequestFitEnum> get serializer => _$wardrobeItemPatchRequestFitEnumSerializer;

  const WardrobeItemPatchRequestFitEnum._(String name) : super(name);

  static BuiltSet<WardrobeItemPatchRequestFitEnum> get values => _$wardrobeItemPatchRequestFitEnumValues;
  static WardrobeItemPatchRequestFitEnum valueOf(String name) => _$wardrobeItemPatchRequestFitEnumValueOf(name);
}

class WardrobeItemPatchRequestFormalityEnum extends EnumClass {
  @BuiltValueEnumConst(wireName: r'casual')
  static const WardrobeItemPatchRequestFormalityEnum casual = _$wardrobeItemPatchRequestFormalityEnum_casual;
  @BuiltValueEnumConst(wireName: r'smart_casual')
  static const WardrobeItemPatchRequestFormalityEnum smartCasual = _$wardrobeItemPatchRequestFormalityEnum_smartCasual;
  @BuiltValueEnumConst(wireName: r'formal')
  static const WardrobeItemPatchRequestFormalityEnum formal = _$wardrobeItemPatchRequestFormalityEnum_formal;
  @BuiltValueEnumConst(wireName: r'black_tie')
  static const WardrobeItemPatchRequestFormalityEnum blackTie = _$wardrobeItemPatchRequestFormalityEnum_blackTie;
  @BuiltValueEnumConst(wireName: r'unknown_default_open_api', fallback: true)
  static const WardrobeItemPatchRequestFormalityEnum unknownDefaultOpenApi =
      _$wardrobeItemPatchRequestFormalityEnum_unknownDefaultOpenApi;

  static Serializer<WardrobeItemPatchRequestFormalityEnum> get serializer =>
      _$wardrobeItemPatchRequestFormalityEnumSerializer;

  const WardrobeItemPatchRequestFormalityEnum._(String name) : super(name);

  static BuiltSet<WardrobeItemPatchRequestFormalityEnum> get values => _$wardrobeItemPatchRequestFormalityEnumValues;
  static WardrobeItemPatchRequestFormalityEnum valueOf(String name) =>
      _$wardrobeItemPatchRequestFormalityEnumValueOf(name);
}

class WardrobeItemPatchRequestGenderEnum extends EnumClass {
  @BuiltValueEnumConst(wireName: r'male')
  static const WardrobeItemPatchRequestGenderEnum male = _$wardrobeItemPatchRequestGenderEnum_male;
  @BuiltValueEnumConst(wireName: r'female')
  static const WardrobeItemPatchRequestGenderEnum female = _$wardrobeItemPatchRequestGenderEnum_female;
  @BuiltValueEnumConst(wireName: r'unisex')
  static const WardrobeItemPatchRequestGenderEnum unisex = _$wardrobeItemPatchRequestGenderEnum_unisex;
  @BuiltValueEnumConst(wireName: r'unknown_default_open_api', fallback: true)
  static const WardrobeItemPatchRequestGenderEnum unknownDefaultOpenApi =
      _$wardrobeItemPatchRequestGenderEnum_unknownDefaultOpenApi;

  static Serializer<WardrobeItemPatchRequestGenderEnum> get serializer =>
      _$wardrobeItemPatchRequestGenderEnumSerializer;

  const WardrobeItemPatchRequestGenderEnum._(String name) : super(name);

  static BuiltSet<WardrobeItemPatchRequestGenderEnum> get values => _$wardrobeItemPatchRequestGenderEnumValues;
  static WardrobeItemPatchRequestGenderEnum valueOf(String name) => _$wardrobeItemPatchRequestGenderEnumValueOf(name);
}

class WardrobeItemPatchRequestMaterialEnum extends EnumClass {
  @BuiltValueEnumConst(wireName: r'cotton')
  static const WardrobeItemPatchRequestMaterialEnum cotton = _$wardrobeItemPatchRequestMaterialEnum_cotton;
  @BuiltValueEnumConst(wireName: r'linen')
  static const WardrobeItemPatchRequestMaterialEnum linen = _$wardrobeItemPatchRequestMaterialEnum_linen;
  @BuiltValueEnumConst(wireName: r'denim')
  static const WardrobeItemPatchRequestMaterialEnum denim = _$wardrobeItemPatchRequestMaterialEnum_denim;
  @BuiltValueEnumConst(wireName: r'wool')
  static const WardrobeItemPatchRequestMaterialEnum wool = _$wardrobeItemPatchRequestMaterialEnum_wool;
  @BuiltValueEnumConst(wireName: r'cashmere')
  static const WardrobeItemPatchRequestMaterialEnum cashmere = _$wardrobeItemPatchRequestMaterialEnum_cashmere;
  @BuiltValueEnumConst(wireName: r'silk')
  static const WardrobeItemPatchRequestMaterialEnum silk = _$wardrobeItemPatchRequestMaterialEnum_silk;
  @BuiltValueEnumConst(wireName: r'polyester')
  static const WardrobeItemPatchRequestMaterialEnum polyester = _$wardrobeItemPatchRequestMaterialEnum_polyester;
  @BuiltValueEnumConst(wireName: r'nylon')
  static const WardrobeItemPatchRequestMaterialEnum nylon = _$wardrobeItemPatchRequestMaterialEnum_nylon;
  @BuiltValueEnumConst(wireName: r'leather')
  static const WardrobeItemPatchRequestMaterialEnum leather = _$wardrobeItemPatchRequestMaterialEnum_leather;
  @BuiltValueEnumConst(wireName: r'suede')
  static const WardrobeItemPatchRequestMaterialEnum suede = _$wardrobeItemPatchRequestMaterialEnum_suede;
  @BuiltValueEnumConst(wireName: r'knit')
  static const WardrobeItemPatchRequestMaterialEnum knit = _$wardrobeItemPatchRequestMaterialEnum_knit;
  @BuiltValueEnumConst(wireName: r'blend')
  static const WardrobeItemPatchRequestMaterialEnum blend = _$wardrobeItemPatchRequestMaterialEnum_blend;
  @BuiltValueEnumConst(wireName: r'unknown_default_open_api', fallback: true)
  static const WardrobeItemPatchRequestMaterialEnum unknownDefaultOpenApi =
      _$wardrobeItemPatchRequestMaterialEnum_unknownDefaultOpenApi;

  static Serializer<WardrobeItemPatchRequestMaterialEnum> get serializer =>
      _$wardrobeItemPatchRequestMaterialEnumSerializer;

  const WardrobeItemPatchRequestMaterialEnum._(String name) : super(name);

  static BuiltSet<WardrobeItemPatchRequestMaterialEnum> get values => _$wardrobeItemPatchRequestMaterialEnumValues;
  static WardrobeItemPatchRequestMaterialEnum valueOf(String name) =>
      _$wardrobeItemPatchRequestMaterialEnumValueOf(name);
}

class WardrobeItemPatchRequestPatternEnum extends EnumClass {
  @BuiltValueEnumConst(wireName: r'solid')
  static const WardrobeItemPatchRequestPatternEnum solid = _$wardrobeItemPatchRequestPatternEnum_solid;
  @BuiltValueEnumConst(wireName: r'striped')
  static const WardrobeItemPatchRequestPatternEnum striped = _$wardrobeItemPatchRequestPatternEnum_striped;
  @BuiltValueEnumConst(wireName: r'checked')
  static const WardrobeItemPatchRequestPatternEnum checked = _$wardrobeItemPatchRequestPatternEnum_checked;
  @BuiltValueEnumConst(wireName: r'plaid')
  static const WardrobeItemPatchRequestPatternEnum plaid = _$wardrobeItemPatchRequestPatternEnum_plaid;
  @BuiltValueEnumConst(wireName: r'floral')
  static const WardrobeItemPatchRequestPatternEnum floral = _$wardrobeItemPatchRequestPatternEnum_floral;
  @BuiltValueEnumConst(wireName: r'graphic')
  static const WardrobeItemPatchRequestPatternEnum graphic = _$wardrobeItemPatchRequestPatternEnum_graphic;
  @BuiltValueEnumConst(wireName: r'color_block')
  static const WardrobeItemPatchRequestPatternEnum colorBlock = _$wardrobeItemPatchRequestPatternEnum_colorBlock;
  @BuiltValueEnumConst(wireName: r'denim')
  static const WardrobeItemPatchRequestPatternEnum denim = _$wardrobeItemPatchRequestPatternEnum_denim;
  @BuiltValueEnumConst(wireName: r'unknown_default_open_api', fallback: true)
  static const WardrobeItemPatchRequestPatternEnum unknownDefaultOpenApi =
      _$wardrobeItemPatchRequestPatternEnum_unknownDefaultOpenApi;

  static Serializer<WardrobeItemPatchRequestPatternEnum> get serializer =>
      _$wardrobeItemPatchRequestPatternEnumSerializer;

  const WardrobeItemPatchRequestPatternEnum._(String name) : super(name);

  static BuiltSet<WardrobeItemPatchRequestPatternEnum> get values => _$wardrobeItemPatchRequestPatternEnumValues;
  static WardrobeItemPatchRequestPatternEnum valueOf(String name) => _$wardrobeItemPatchRequestPatternEnumValueOf(name);
}

class WardrobeItemPatchRequestSeasonEnum extends EnumClass {
  @BuiltValueEnumConst(wireName: r'spring')
  static const WardrobeItemPatchRequestSeasonEnum spring = _$wardrobeItemPatchRequestSeasonEnum_spring;
  @BuiltValueEnumConst(wireName: r'summer')
  static const WardrobeItemPatchRequestSeasonEnum summer = _$wardrobeItemPatchRequestSeasonEnum_summer;
  @BuiltValueEnumConst(wireName: r'autumn')
  static const WardrobeItemPatchRequestSeasonEnum autumn = _$wardrobeItemPatchRequestSeasonEnum_autumn;
  @BuiltValueEnumConst(wireName: r'winter')
  static const WardrobeItemPatchRequestSeasonEnum winter = _$wardrobeItemPatchRequestSeasonEnum_winter;
  @BuiltValueEnumConst(wireName: r'unknown_default_open_api', fallback: true)
  static const WardrobeItemPatchRequestSeasonEnum unknownDefaultOpenApi =
      _$wardrobeItemPatchRequestSeasonEnum_unknownDefaultOpenApi;

  static Serializer<WardrobeItemPatchRequestSeasonEnum> get serializer =>
      _$wardrobeItemPatchRequestSeasonEnumSerializer;

  const WardrobeItemPatchRequestSeasonEnum._(String name) : super(name);

  static BuiltSet<WardrobeItemPatchRequestSeasonEnum> get values => _$wardrobeItemPatchRequestSeasonEnumValues;
  static WardrobeItemPatchRequestSeasonEnum valueOf(String name) => _$wardrobeItemPatchRequestSeasonEnumValueOf(name);
}

class WardrobeItemPatchRequestSleeveLengthEnum extends EnumClass {
  @BuiltValueEnumConst(wireName: r'short')
  static const WardrobeItemPatchRequestSleeveLengthEnum short = _$wardrobeItemPatchRequestSleeveLengthEnum_short;
  @BuiltValueEnumConst(wireName: r'long')
  static const WardrobeItemPatchRequestSleeveLengthEnum long = _$wardrobeItemPatchRequestSleeveLengthEnum_long;
  @BuiltValueEnumConst(wireName: r'sleeveless')
  static const WardrobeItemPatchRequestSleeveLengthEnum sleeveless =
      _$wardrobeItemPatchRequestSleeveLengthEnum_sleeveless;
  @BuiltValueEnumConst(wireName: r'three_quarter')
  static const WardrobeItemPatchRequestSleeveLengthEnum threeQuarter =
      _$wardrobeItemPatchRequestSleeveLengthEnum_threeQuarter;
  @BuiltValueEnumConst(wireName: r'unknown_default_open_api', fallback: true)
  static const WardrobeItemPatchRequestSleeveLengthEnum unknownDefaultOpenApi =
      _$wardrobeItemPatchRequestSleeveLengthEnum_unknownDefaultOpenApi;

  static Serializer<WardrobeItemPatchRequestSleeveLengthEnum> get serializer =>
      _$wardrobeItemPatchRequestSleeveLengthEnumSerializer;

  const WardrobeItemPatchRequestSleeveLengthEnum._(String name) : super(name);

  static BuiltSet<WardrobeItemPatchRequestSleeveLengthEnum> get values =>
      _$wardrobeItemPatchRequestSleeveLengthEnumValues;
  static WardrobeItemPatchRequestSleeveLengthEnum valueOf(String name) =>
      _$wardrobeItemPatchRequestSleeveLengthEnumValueOf(name);
}

class WardrobeItemPatchRequestStyleEnum extends EnumClass {
  @BuiltValueEnumConst(wireName: r'casual')
  static const WardrobeItemPatchRequestStyleEnum casual = _$wardrobeItemPatchRequestStyleEnum_casual;
  @BuiltValueEnumConst(wireName: r'smart_casual')
  static const WardrobeItemPatchRequestStyleEnum smartCasual = _$wardrobeItemPatchRequestStyleEnum_smartCasual;
  @BuiltValueEnumConst(wireName: r'formal')
  static const WardrobeItemPatchRequestStyleEnum formal = _$wardrobeItemPatchRequestStyleEnum_formal;
  @BuiltValueEnumConst(wireName: r'sporty')
  static const WardrobeItemPatchRequestStyleEnum sporty = _$wardrobeItemPatchRequestStyleEnum_sporty;
  @BuiltValueEnumConst(wireName: r'bohemian')
  static const WardrobeItemPatchRequestStyleEnum bohemian = _$wardrobeItemPatchRequestStyleEnum_bohemian;
  @BuiltValueEnumConst(wireName: r'minimal')
  static const WardrobeItemPatchRequestStyleEnum minimal = _$wardrobeItemPatchRequestStyleEnum_minimal;
  @BuiltValueEnumConst(wireName: r'streetwear')
  static const WardrobeItemPatchRequestStyleEnum streetwear = _$wardrobeItemPatchRequestStyleEnum_streetwear;
  @BuiltValueEnumConst(wireName: r'classic')
  static const WardrobeItemPatchRequestStyleEnum classic = _$wardrobeItemPatchRequestStyleEnum_classic;
  @BuiltValueEnumConst(wireName: r'preppy')
  static const WardrobeItemPatchRequestStyleEnum preppy = _$wardrobeItemPatchRequestStyleEnum_preppy;
  @BuiltValueEnumConst(wireName: r'unknown_default_open_api', fallback: true)
  static const WardrobeItemPatchRequestStyleEnum unknownDefaultOpenApi =
      _$wardrobeItemPatchRequestStyleEnum_unknownDefaultOpenApi;

  static Serializer<WardrobeItemPatchRequestStyleEnum> get serializer => _$wardrobeItemPatchRequestStyleEnumSerializer;

  const WardrobeItemPatchRequestStyleEnum._(String name) : super(name);

  static BuiltSet<WardrobeItemPatchRequestStyleEnum> get values => _$wardrobeItemPatchRequestStyleEnumValues;
  static WardrobeItemPatchRequestStyleEnum valueOf(String name) => _$wardrobeItemPatchRequestStyleEnumValueOf(name);
}

class WardrobeItemPatchRequestSubcategoryEnum extends EnumClass {
  @BuiltValueEnumConst(wireName: r'jacket')
  static const WardrobeItemPatchRequestSubcategoryEnum jacket = _$wardrobeItemPatchRequestSubcategoryEnum_jacket;
  @BuiltValueEnumConst(wireName: r'blazer')
  static const WardrobeItemPatchRequestSubcategoryEnum blazer = _$wardrobeItemPatchRequestSubcategoryEnum_blazer;
  @BuiltValueEnumConst(wireName: r'coat')
  static const WardrobeItemPatchRequestSubcategoryEnum coat = _$wardrobeItemPatchRequestSubcategoryEnum_coat;
  @BuiltValueEnumConst(wireName: r'windbreaker')
  static const WardrobeItemPatchRequestSubcategoryEnum windbreaker =
      _$wardrobeItemPatchRequestSubcategoryEnum_windbreaker;
  @BuiltValueEnumConst(wireName: r'tshirt')
  static const WardrobeItemPatchRequestSubcategoryEnum tshirt = _$wardrobeItemPatchRequestSubcategoryEnum_tshirt;
  @BuiltValueEnumConst(wireName: r'oxford_shirt')
  static const WardrobeItemPatchRequestSubcategoryEnum oxfordShirt =
      _$wardrobeItemPatchRequestSubcategoryEnum_oxfordShirt;
  @BuiltValueEnumConst(wireName: r'polo')
  static const WardrobeItemPatchRequestSubcategoryEnum polo = _$wardrobeItemPatchRequestSubcategoryEnum_polo;
  @BuiltValueEnumConst(wireName: r'blouse')
  static const WardrobeItemPatchRequestSubcategoryEnum blouse = _$wardrobeItemPatchRequestSubcategoryEnum_blouse;
  @BuiltValueEnumConst(wireName: r'knit')
  static const WardrobeItemPatchRequestSubcategoryEnum knit = _$wardrobeItemPatchRequestSubcategoryEnum_knit;
  @BuiltValueEnumConst(wireName: r'jeans')
  static const WardrobeItemPatchRequestSubcategoryEnum jeans = _$wardrobeItemPatchRequestSubcategoryEnum_jeans;
  @BuiltValueEnumConst(wireName: r'chinos')
  static const WardrobeItemPatchRequestSubcategoryEnum chinos = _$wardrobeItemPatchRequestSubcategoryEnum_chinos;
  @BuiltValueEnumConst(wireName: r'trousers')
  static const WardrobeItemPatchRequestSubcategoryEnum trousers = _$wardrobeItemPatchRequestSubcategoryEnum_trousers;
  @BuiltValueEnumConst(wireName: r'shorts')
  static const WardrobeItemPatchRequestSubcategoryEnum shorts = _$wardrobeItemPatchRequestSubcategoryEnum_shorts;
  @BuiltValueEnumConst(wireName: r'casual_dress')
  static const WardrobeItemPatchRequestSubcategoryEnum casualDress =
      _$wardrobeItemPatchRequestSubcategoryEnum_casualDress;
  @BuiltValueEnumConst(wireName: r'evening_dress')
  static const WardrobeItemPatchRequestSubcategoryEnum eveningDress =
      _$wardrobeItemPatchRequestSubcategoryEnum_eveningDress;
  @BuiltValueEnumConst(wireName: r'midi_dress')
  static const WardrobeItemPatchRequestSubcategoryEnum midiDress = _$wardrobeItemPatchRequestSubcategoryEnum_midiDress;
  @BuiltValueEnumConst(wireName: r'sneakers')
  static const WardrobeItemPatchRequestSubcategoryEnum sneakers = _$wardrobeItemPatchRequestSubcategoryEnum_sneakers;
  @BuiltValueEnumConst(wireName: r'loafers')
  static const WardrobeItemPatchRequestSubcategoryEnum loafers = _$wardrobeItemPatchRequestSubcategoryEnum_loafers;
  @BuiltValueEnumConst(wireName: r'oxford_shoes')
  static const WardrobeItemPatchRequestSubcategoryEnum oxfordShoes =
      _$wardrobeItemPatchRequestSubcategoryEnum_oxfordShoes;
  @BuiltValueEnumConst(wireName: r'boots')
  static const WardrobeItemPatchRequestSubcategoryEnum boots = _$wardrobeItemPatchRequestSubcategoryEnum_boots;
  @BuiltValueEnumConst(wireName: r'sandals')
  static const WardrobeItemPatchRequestSubcategoryEnum sandals = _$wardrobeItemPatchRequestSubcategoryEnum_sandals;
  @BuiltValueEnumConst(wireName: r'tote')
  static const WardrobeItemPatchRequestSubcategoryEnum tote = _$wardrobeItemPatchRequestSubcategoryEnum_tote;
  @BuiltValueEnumConst(wireName: r'backpack')
  static const WardrobeItemPatchRequestSubcategoryEnum backpack = _$wardrobeItemPatchRequestSubcategoryEnum_backpack;
  @BuiltValueEnumConst(wireName: r'crossbody')
  static const WardrobeItemPatchRequestSubcategoryEnum crossbody = _$wardrobeItemPatchRequestSubcategoryEnum_crossbody;
  @BuiltValueEnumConst(wireName: r'clutch')
  static const WardrobeItemPatchRequestSubcategoryEnum clutch = _$wardrobeItemPatchRequestSubcategoryEnum_clutch;
  @BuiltValueEnumConst(wireName: r'belt')
  static const WardrobeItemPatchRequestSubcategoryEnum belt = _$wardrobeItemPatchRequestSubcategoryEnum_belt;
  @BuiltValueEnumConst(wireName: r'scarf')
  static const WardrobeItemPatchRequestSubcategoryEnum scarf = _$wardrobeItemPatchRequestSubcategoryEnum_scarf;
  @BuiltValueEnumConst(wireName: r'hat')
  static const WardrobeItemPatchRequestSubcategoryEnum hat = _$wardrobeItemPatchRequestSubcategoryEnum_hat;
  @BuiltValueEnumConst(wireName: r'watch')
  static const WardrobeItemPatchRequestSubcategoryEnum watch = _$wardrobeItemPatchRequestSubcategoryEnum_watch;
  @BuiltValueEnumConst(wireName: r'sunglasses')
  static const WardrobeItemPatchRequestSubcategoryEnum sunglasses =
      _$wardrobeItemPatchRequestSubcategoryEnum_sunglasses;
  @BuiltValueEnumConst(wireName: r'unknown_default_open_api', fallback: true)
  static const WardrobeItemPatchRequestSubcategoryEnum unknownDefaultOpenApi =
      _$wardrobeItemPatchRequestSubcategoryEnum_unknownDefaultOpenApi;

  static Serializer<WardrobeItemPatchRequestSubcategoryEnum> get serializer =>
      _$wardrobeItemPatchRequestSubcategoryEnumSerializer;

  const WardrobeItemPatchRequestSubcategoryEnum._(String name) : super(name);

  static BuiltSet<WardrobeItemPatchRequestSubcategoryEnum> get values =>
      _$wardrobeItemPatchRequestSubcategoryEnumValues;
  static WardrobeItemPatchRequestSubcategoryEnum valueOf(String name) =>
      _$wardrobeItemPatchRequestSubcategoryEnumValueOf(name);
}
