import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../config/environment_config.dart';
import 'access_token_source.dart';
import 'api_client.dart';
import 'connectivity.dart';

/// Overridden in main.dart (and tests) with the validated configuration.
final environmentConfigProvider = Provider<AtlasEnvironmentConfig>(
  (ref) => throw UnimplementedError('environmentConfigProvider must be overridden'),
);

/// Phase 3.3 overrides this with the secure-storage session.
final accessTokenSourceProvider = Provider<AccessTokenSource>((ref) => const NoAccessToken());

final deviceNetworkProvider = Provider<DeviceNetwork>((ref) => PlatformDeviceNetwork());

final apiReachabilityProvider = Provider<ApiReachability>((ref) {
  final reachability = ApiReachability();
  ref.onDispose(reachability.dispose);
  return reachability;
});

final dioProvider = Provider<Dio>((ref) {
  final dio = buildAtlasDio(
    config: ref.watch(environmentConfigProvider),
    tokens: ref.watch(accessTokenSourceProvider),
    reachability: ref.watch(apiReachabilityProvider),
  );
  ref.onDispose(dio.close);
  return dio;
});

final atlasApiClientProvider = Provider<AtlasApiClient>(
  (ref) => AtlasApiClient(dio: ref.watch(dioProvider), network: ref.watch(deviceNetworkProvider)),
);

/// Device connectivity combined with whether the API answered recently.
final networkStatusProvider = StreamProvider<NetworkStatus>((ref) {
  final device = ref.watch(deviceNetworkProvider);
  final reachability = ref.watch(apiReachabilityProvider);
  final controller = StreamController<NetworkStatus>();
  var deviceOnline = true;
  void emit() => controller.add(combineStatus(deviceOnline: deviceOnline, apiReachable: reachability.reachable));

  final subs = [
    device.changes.listen((online) {
      deviceOnline = online;
      // Back online: give the API the benefit of the doubt until a request
      // says otherwise.
      if (online) reachability.report(reachable: true);
      emit();
    }),
    reachability.changes.listen((_) => emit()),
  ];
  unawaited(
    device.hasNetwork().then((online) {
      deviceOnline = online;
      if (!controller.isClosed) emit();
    }),
  );
  ref.onDispose(() async {
    for (final s in subs) {
      await s.cancel();
    }
    await controller.close();
  });
  return controller.stream;
});
