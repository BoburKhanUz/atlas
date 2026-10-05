import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../network/providers.dart';
import 'auth_state.dart';
import 'session_controller.dart';
import 'token_store.dart';

/// Platform secure storage (Keystore / Keychain). Tests override it.
final secureKeyValueStoreProvider = Provider<SecureKeyValueStore>((ref) => PlatformSecureKeyValueStore());

final tokenStoreProvider = Provider<TokenStore>((ref) => TokenStore(ref.watch(secureKeyValueStoreProvider)));

/// The one session. Restoration starts as soon as it is first read.
final sessionControllerProvider = Provider<SessionController>((ref) {
  final controller = SessionController(
    config: ref.watch(environmentConfigProvider),
    store: ref.watch(tokenStoreProvider),
    network: ref.watch(deviceNetworkProvider),
    reachability: ref.watch(apiReachabilityProvider),
    deviceName: switch (defaultTargetPlatform) {
      TargetPlatform.android => 'Android',
      TargetPlatform.iOS => 'iPhone',
      _ => null,
    },
  );
  ref.onDispose(controller.dispose);
  unawaited(controller.restore());
  return controller;
});

/// The authoritative [AuthState] for widgets.
final authStateProvider = Provider<AuthState>((ref) {
  final controller = ref.watch(sessionControllerProvider);
  void changed() => ref.invalidateSelf();
  controller.addListener(changed);
  ref.onDispose(() => controller.removeListener(changed));
  return controller.state;
});
