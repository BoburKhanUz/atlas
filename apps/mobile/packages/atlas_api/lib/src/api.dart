//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

import 'package:dio/dio.dart';
import 'package:built_value/serializer.dart';
import 'package:atlas_api/src/serializers.dart';
import 'package:atlas_api/src/auth/api_key_auth.dart';
import 'package:atlas_api/src/auth/basic_auth.dart';
import 'package:atlas_api/src/auth/bearer_auth.dart';
import 'package:atlas_api/src/auth/oauth.dart';
import 'package:atlas_api/src/api/account_api.dart';
import 'package:atlas_api/src/api/auth_api.dart';
import 'package:atlas_api/src/api/media_api.dart';
import 'package:atlas_api/src/api/outfits_api.dart';
import 'package:atlas_api/src/api/profile_api.dart';
import 'package:atlas_api/src/api/service_api.dart';
import 'package:atlas_api/src/api/stylist_api.dart';
import 'package:atlas_api/src/api/wardrobe_api.dart';
import 'package:atlas_api/src/api/weather_api.dart';

class AtlasApi {
  static const String basePath = r'http://localhost';

  final Dio dio;
  final Serializers serializers;

  AtlasApi({Dio? dio, Serializers? serializers, String? basePathOverride, List<Interceptor>? interceptors})
    : this.serializers = serializers ?? standardSerializers,
      this.dio =
          dio ??
          Dio(
            BaseOptions(
              baseUrl: basePathOverride ?? basePath,
              connectTimeout: const Duration(milliseconds: 5000),
              receiveTimeout: const Duration(milliseconds: 3000),
            ),
          ) {
    if (interceptors == null) {
      this.dio.interceptors.addAll([
        OAuthInterceptor(),
        BasicAuthInterceptor(),
        BearerAuthInterceptor(),
        ApiKeyAuthInterceptor(),
      ]);
    } else {
      this.dio.interceptors.addAll(interceptors);
    }
  }

  void setOAuthToken(String name, String token) {
    if (this.dio.interceptors.any((i) => i is OAuthInterceptor)) {
      (this.dio.interceptors.firstWhere((i) => i is OAuthInterceptor) as OAuthInterceptor).tokens[name] = token;
    }
  }

  void setBearerAuth(String name, String token) {
    if (this.dio.interceptors.any((i) => i is BearerAuthInterceptor)) {
      (this.dio.interceptors.firstWhere((i) => i is BearerAuthInterceptor) as BearerAuthInterceptor).tokens[name] =
          token;
    }
  }

  void setBasicAuth(String name, String username, String password) {
    if (this.dio.interceptors.any((i) => i is BasicAuthInterceptor)) {
      (this.dio.interceptors.firstWhere((i) => i is BasicAuthInterceptor) as BasicAuthInterceptor).authInfo[name] =
          BasicAuthInfo(username, password);
    }
  }

  void setApiKey(String name, String apiKey) {
    if (this.dio.interceptors.any((i) => i is ApiKeyAuthInterceptor)) {
      (this.dio.interceptors.firstWhere(
        (element) => element is ApiKeyAuthInterceptor,
      ) as ApiKeyAuthInterceptor).apiKeys[name] = apiKey;
    }
  }

  /// Get AccountApi instance, base route and serializer can be overridden by a given but be careful,
  /// by doing that all interceptors will not be executed
  AccountApi getAccountApi() {
    return AccountApi(dio, serializers);
  }

  /// Get AuthApi instance, base route and serializer can be overridden by a given but be careful,
  /// by doing that all interceptors will not be executed
  AuthApi getAuthApi() {
    return AuthApi(dio, serializers);
  }

  /// Get MediaApi instance, base route and serializer can be overridden by a given but be careful,
  /// by doing that all interceptors will not be executed
  MediaApi getMediaApi() {
    return MediaApi(dio, serializers);
  }

  /// Get OutfitsApi instance, base route and serializer can be overridden by a given but be careful,
  /// by doing that all interceptors will not be executed
  OutfitsApi getOutfitsApi() {
    return OutfitsApi(dio, serializers);
  }

  /// Get ProfileApi instance, base route and serializer can be overridden by a given but be careful,
  /// by doing that all interceptors will not be executed
  ProfileApi getProfileApi() {
    return ProfileApi(dio, serializers);
  }

  /// Get ServiceApi instance, base route and serializer can be overridden by a given but be careful,
  /// by doing that all interceptors will not be executed
  ServiceApi getServiceApi() {
    return ServiceApi(dio, serializers);
  }

  /// Get StylistApi instance, base route and serializer can be overridden by a given but be careful,
  /// by doing that all interceptors will not be executed
  StylistApi getStylistApi() {
    return StylistApi(dio, serializers);
  }

  /// Get WardrobeApi instance, base route and serializer can be overridden by a given but be careful,
  /// by doing that all interceptors will not be executed
  WardrobeApi getWardrobeApi() {
    return WardrobeApi(dio, serializers);
  }

  /// Get WeatherApi instance, base route and serializer can be overridden by a given but be careful,
  /// by doing that all interceptors will not be executed
  WeatherApi getWeatherApi() {
    return WeatherApi(dio, serializers);
  }
}
