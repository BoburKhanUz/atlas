import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/providers.dart';
import '../../core/session/providers.dart';
import 'data/city_store.dart';
import 'data/device_locator.dart';
import 'data/weather_repository.dart';
import 'presentation/weather_controller.dart';

final deviceLocatorProvider = Provider<DeviceLocator>((ref) => PlatformDeviceLocator());

final cityStoreProvider = Provider<CityStore>((ref) => CityStore(ref.watch(secureKeyValueStoreProvider)));

final weatherRepositoryProvider = Provider<WeatherRepository>(
  (ref) => WeatherRepository(ref.watch(atlasApiClientProvider)),
);

/// Wall clock (tests use a fake one).
final weatherClockProvider = Provider<DateTime Function()>(
  (ref) =>
      () => DateTime.now().toUtc(),
);

/// Location and current weather of the signed-in user (rebuilt per user:
/// nothing carries over to another account).
final weatherControllerProvider = NotifierProvider<WeatherController, WeatherState>(WeatherController.new);
