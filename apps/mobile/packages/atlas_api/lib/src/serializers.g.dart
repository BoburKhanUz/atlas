// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'serializers.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

Serializers _$serializers =
    (Serializers().toBuilder()
          ..add(AuthResponse.serializer)
          ..add(ColorAnalysisResponse.serializer)
          ..add(ColorAnalysisResponseColorProfile.serializer)
          ..add(ColorAnalysisResponseColorProfileContrastLevel.serializer)
          ..add(ColorAnalysisResponseColorProfileSecondaryConfidence.serializer)
          ..add(ColorProfileResponse.serializer)
          ..add(ColorProfileResponseOneOf.serializer)
          ..add(ColorProfileResponseOneOf1.serializer)
          ..add(ColorProfileResponseOneOf1ColorProfile.serializer)
          ..add(ColorProfileResponseOneOf1StatusEnum.serializer)
          ..add(ColorProfileResponseOneOfStatusEnum.serializer)
          ..add(ConversationListResponse.serializer)
          ..add(ConversationListResponseConversationsInner.serializer)
          ..add(ConversationResponse.serializer)
          ..add(ConversationResponseConversation.serializer)
          ..add(ConversationResponseConversationMessagesInner.serializer)
          ..add(CorrectionLogEntry.serializer)
          ..add(Detection.serializer)
          ..add(ErrorResponse.serializer)
          ..add(ErrorResponseCodeEnum.serializer)
          ..add(ErrorResponseDetailsInner.serializer)
          ..add(HealthResponse.serializer)
          ..add(HealthResponseDatabaseEnum.serializer)
          ..add(HealthResponseStatusEnum.serializer)
          ..add(ImageObject.serializer)
          ..add(LoginRequest.serializer)
          ..add(MeResponse.serializer)
          ..add(MeResponseUser.serializer)
          ..add(MediaQuery.serializer)
          ..add(MobileAuthResponse.serializer)
          ..add(MobileLogoutRequest.serializer)
          ..add(MobileRefreshRequest.serializer)
          ..add(OkResponse.serializer)
          ..add(OutfitDetail.serializer)
          ..add(OutfitDetailItem.serializer)
          ..add(OutfitDetailItemItem.serializer)
          ..add(OutfitDetailResponse.serializer)
          ..add(OutfitFeedbackRequest.serializer)
          ..add(OutfitFeedbackRequestFeedbackEnum.serializer)
          ..add(OutfitFeedbackResponse.serializer)
          ..add(OutfitFeedbackResponseFeedback.serializer)
          ..add(OutfitGenerateRequest.serializer)
          ..add(OutfitGenerateRequestOccasionEnum.serializer)
          ..add(OutfitGenerateRequestWeather.serializer)
          ..add(OutfitGenerateResponse.serializer)
          ..add(OutfitGenerateResponseOutfitsInner.serializer)
          ..add(OutfitGenerateResponseOutfitsInnerContrastLevelEnum.serializer)
          ..add(OutfitGenerateResponseOutfitsInnerFactors.serializer)
          ..add(OutfitGenerateResponseOutfitsInnerItemsInner.serializer)
          ..add(OutfitGenerateResponseWeatherUsed.serializer)
          ..add(OutfitGenerateResponseWeatherUsedAnyOf.serializer)
          ..add(OutfitListQuery.serializer)
          ..add(OutfitListQuerySavedEnum.serializer)
          ..add(OutfitListResponse.serializer)
          ..add(OutfitPatchRequest.serializer)
          ..add(OutfitPatchResponse.serializer)
          ..add(OutfitRow.serializer)
          ..add(OutfitSaveRequest.serializer)
          ..add(OutfitSaveRequestItemsInner.serializer)
          ..add(OutfitSaveRequestOccasionEnum.serializer)
          ..add(OutfitSaveResponse.serializer)
          ..add(OutfitSaveResponseOutfit.serializer)
          ..add(OutfitSaveResponseOutfitItemsInner.serializer)
          ..add(OutfitSummary.serializer)
          ..add(OutfitSummaryItem.serializer)
          ..add(PreferencesRow.serializer)
          ..add(ProfilePatchRequest.serializer)
          ..add(ProfilePatchRequestPreferences.serializer)
          ..add(ProfilePatchRequestPreferencesDislikedColorsEnum.serializer)
          ..add(ProfilePatchRequestPreferencesDislikedStylesEnum.serializer)
          ..add(ProfilePatchRequestPreferencesFavoriteColorsEnum.serializer)
          ..add(ProfilePatchRequestPreferencesLanguageEnum.serializer)
          ..add(ProfilePatchRequestPreferencesPreferredStylesEnum.serializer)
          ..add(ProfilePatchRequestProfile.serializer)
          ..add(ProfilePatchRequestProfileGenderEnum.serializer)
          ..add(ProfilePatchRequestProfilePreferredFitEnum.serializer)
          ..add(ProfilePatchResponse.serializer)
          ..add(ProfilePatchResponseUser.serializer)
          ..add(ProfilePreferences.serializer)
          ..add(ProfileResponse.serializer)
          ..add(ProfileRow.serializer)
          ..add(ProfileUser.serializer)
          ..add(RegisterRequest.serializer)
          ..add(SessionUser.serializer)
          ..add(StylistChatRequest.serializer)
          ..add(StylistChatRequestWeather.serializer)
          ..add(StylistChatResponse.serializer)
          ..add(StylistChatResponseContextSummary.serializer)
          ..add(WardrobeItem.serializer)
          ..add(WardrobeItemPatchRequest.serializer)
          ..add(WardrobeItemPatchRequestCategoryEnum.serializer)
          ..add(WardrobeItemPatchRequestColorsEnum.serializer)
          ..add(WardrobeItemPatchRequestFitEnum.serializer)
          ..add(WardrobeItemPatchRequestFormalityEnum.serializer)
          ..add(WardrobeItemPatchRequestGenderEnum.serializer)
          ..add(WardrobeItemPatchRequestMaterialEnum.serializer)
          ..add(WardrobeItemPatchRequestPatternEnum.serializer)
          ..add(WardrobeItemPatchRequestSeasonEnum.serializer)
          ..add(WardrobeItemPatchRequestSleeveLengthEnum.serializer)
          ..add(WardrobeItemPatchRequestStyleEnum.serializer)
          ..add(WardrobeItemPatchRequestSubcategoryEnum.serializer)
          ..add(WardrobeItemResponse.serializer)
          ..add(WardrobeListQuery.serializer)
          ..add(WardrobeListQueryCategoryEnum.serializer)
          ..add(WardrobeListResponse.serializer)
          ..add(WardrobePatchResponse.serializer)
          ..add(WardrobeUploadResponse.serializer)
          ..add(WeatherQuery.serializer)
          ..add(WeatherResponse.serializer)
          ..add(WeatherResponseWeather.serializer)
          ..add(WebAuthResponse.serializer)
          ..addBuilderFactory(
            const FullType(BuiltList, const [const FullType(ConversationListResponseConversationsInner)]),
            () => ListBuilder<ConversationListResponseConversationsInner>(),
          )
          ..addBuilderFactory(
            const FullType(BuiltList, const [const FullType(ConversationResponseConversationMessagesInner)]),
            () => ListBuilder<ConversationResponseConversationMessagesInner>(),
          )
          ..addBuilderFactory(
            const FullType(BuiltList, const [const FullType(CorrectionLogEntry)]),
            () => ListBuilder<CorrectionLogEntry>(),
          )
          ..addBuilderFactory(
            const FullType(BuiltList, const [const FullType(ErrorResponseDetailsInner)]),
            () => ListBuilder<ErrorResponseDetailsInner>(),
          )
          ..addBuilderFactory(
            const FullType(BuiltList, const [const FullType(OutfitDetailItem)]),
            () => ListBuilder<OutfitDetailItem>(),
          )
          ..addBuilderFactory(const FullType(BuiltList, const [const FullType(String)]), () => ListBuilder<String>())
          ..addBuilderFactory(
            const FullType(BuiltList, const [const FullType(OutfitGenerateResponseOutfitsInner)]),
            () => ListBuilder<OutfitGenerateResponseOutfitsInner>(),
          )
          ..addBuilderFactory(
            const FullType(BuiltList, const [const FullType(OutfitGenerateResponseOutfitsInnerItemsInner)]),
            () => ListBuilder<OutfitGenerateResponseOutfitsInnerItemsInner>(),
          )
          ..addBuilderFactory(const FullType(BuiltList, const [const FullType(String)]), () => ListBuilder<String>())
          ..addBuilderFactory(
            const FullType(BuiltList, const [const FullType(OutfitSaveRequestItemsInner)]),
            () => ListBuilder<OutfitSaveRequestItemsInner>(),
          )
          ..addBuilderFactory(const FullType(BuiltList, const [const FullType(String)]), () => ListBuilder<String>())
          ..addBuilderFactory(
            const FullType(BuiltList, const [const FullType(OutfitSaveResponseOutfitItemsInner)]),
            () => ListBuilder<OutfitSaveResponseOutfitItemsInner>(),
          )
          ..addBuilderFactory(
            const FullType(BuiltList, const [const FullType(OutfitSummary)]),
            () => ListBuilder<OutfitSummary>(),
          )
          ..addBuilderFactory(
            const FullType(BuiltList, const [const FullType(OutfitSummaryItem)]),
            () => ListBuilder<OutfitSummaryItem>(),
          )
          ..addBuilderFactory(const FullType(BuiltList, const [const FullType(String)]), () => ListBuilder<String>())
          ..addBuilderFactory(
            const FullType(BuiltList, const [const FullType(ProfilePatchRequestPreferencesDislikedColorsEnum)]),
            () => ListBuilder<ProfilePatchRequestPreferencesDislikedColorsEnum>(),
          )
          ..addBuilderFactory(
            const FullType(BuiltList, const [const FullType(ProfilePatchRequestPreferencesDislikedStylesEnum)]),
            () => ListBuilder<ProfilePatchRequestPreferencesDislikedStylesEnum>(),
          )
          ..addBuilderFactory(
            const FullType(BuiltList, const [const FullType(ProfilePatchRequestPreferencesFavoriteColorsEnum)]),
            () => ListBuilder<ProfilePatchRequestPreferencesFavoriteColorsEnum>(),
          )
          ..addBuilderFactory(
            const FullType(BuiltList, const [const FullType(ProfilePatchRequestPreferencesPreferredStylesEnum)]),
            () => ListBuilder<ProfilePatchRequestPreferencesPreferredStylesEnum>(),
          )
          ..addBuilderFactory(const FullType(BuiltList, const [const FullType(String)]), () => ListBuilder<String>())
          ..addBuilderFactory(
            const FullType(BuiltList, const [const FullType(ImageObject)]),
            () => ListBuilder<ImageObject>(),
          )
          ..addBuilderFactory(const FullType(BuiltList, const [const FullType(String)]), () => ListBuilder<String>())
          ..addBuilderFactory(const FullType(BuiltList, const [const FullType(String)]), () => ListBuilder<String>())
          ..addBuilderFactory(const FullType(BuiltList, const [const FullType(String)]), () => ListBuilder<String>())
          ..addBuilderFactory(const FullType(BuiltList, const [const FullType(String)]), () => ListBuilder<String>())
          ..addBuilderFactory(const FullType(BuiltList, const [const FullType(String)]), () => ListBuilder<String>())
          ..addBuilderFactory(const FullType(BuiltList, const [const FullType(String)]), () => ListBuilder<String>())
          ..addBuilderFactory(const FullType(BuiltList, const [const FullType(String)]), () => ListBuilder<String>())
          ..addBuilderFactory(const FullType(BuiltList, const [const FullType(String)]), () => ListBuilder<String>())
          ..addBuilderFactory(const FullType(BuiltList, const [const FullType(String)]), () => ListBuilder<String>())
          ..addBuilderFactory(const FullType(BuiltList, const [const FullType(String)]), () => ListBuilder<String>())
          ..addBuilderFactory(const FullType(BuiltList, const [const FullType(String)]), () => ListBuilder<String>())
          ..addBuilderFactory(const FullType(BuiltList, const [const FullType(String)]), () => ListBuilder<String>())
          ..addBuilderFactory(const FullType(BuiltList, const [const FullType(String)]), () => ListBuilder<String>())
          ..addBuilderFactory(const FullType(BuiltList, const [const FullType(String)]), () => ListBuilder<String>())
          ..addBuilderFactory(const FullType(BuiltList, const [const FullType(String)]), () => ListBuilder<String>())
          ..addBuilderFactory(const FullType(BuiltList, const [const FullType(String)]), () => ListBuilder<String>())
          ..addBuilderFactory(
            const FullType(BuiltMap, const [const FullType(String), const FullType(num)]),
            () => MapBuilder<String, num>(),
          )
          ..addBuilderFactory(
            const FullType(BuiltList, const [const FullType(CorrectionLogEntry)]),
            () => ListBuilder<CorrectionLogEntry>(),
          )
          ..addBuilderFactory(
            const FullType(BuiltList, const [const FullType(ImageObject)]),
            () => ListBuilder<ImageObject>(),
          )
          ..addBuilderFactory(const FullType(BuiltList, const [const FullType(String)]), () => ListBuilder<String>())
          ..addBuilderFactory(const FullType(BuiltList, const [const FullType(String)]), () => ListBuilder<String>())
          ..addBuilderFactory(
            const FullType(BuiltMap, const [const FullType(String), const FullType(num)]),
            () => MapBuilder<String, num>(),
          )
          ..addBuilderFactory(const FullType(BuiltList, const [const FullType(String)]), () => ListBuilder<String>())
          ..addBuilderFactory(
            const FullType(BuiltList, const [const FullType(WardrobeItem)]),
            () => ListBuilder<WardrobeItem>(),
          )
          ..addBuilderFactory(
            const FullType(BuiltList, const [const FullType(WardrobeItemPatchRequestColorsEnum)]),
            () => ListBuilder<WardrobeItemPatchRequestColorsEnum>(),
          )
          ..addBuilderFactory(
            const FullType(BuiltList, const [const FullType(WardrobeItemPatchRequestSeasonEnum)]),
            () => ListBuilder<WardrobeItemPatchRequestSeasonEnum>(),
          ))
        .build();

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
