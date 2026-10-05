import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../../core/design/tokens.dart';
import '../../../core/widgets/atlas_card.dart';
import '../../outfits/presentation/outfit_labels.dart';
import '../data/cities.dart';
import '../data/device_locator.dart';
import '../providers.dart';
import 'weather_controller.dart';

/// Current weather on Home (and above outfit suggestions). Location is never
/// asked for until the user taps; a manual city is always offered.
class WeatherCard extends ConsumerWidget {
  const WeatherCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(weatherControllerProvider);
    final c = ref.read(weatherControllerProvider.notifier);
    final text = Theme.of(context).textTheme;
    final weather = s.weather;
    final busy = s.status == WeatherStatus.locating || s.status == WeatherStatus.loading;
    final where = s.source == LocationSource.city
        ? s.city?.name
        : (s.source == LocationSource.device ? 'Joylashuvingiz' : null);

    Widget body;
    if (weather != null) {
      body = Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                OutfitLabels.temperature(weather.temperature),
                key: const Key('weather.temp'),
                style: text.displaySmall,
              ),
              const SizedBox(width: AtlasSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(weather.conditionLabel, style: text.titleMedium),
                    Text(
                      'His etiladi ${OutfitLabels.temperature(weather.feelsLike)} · Yog‘ingarchilik ${weather.precipitationProbability.round()}%',
                      style: text.bodySmall,
                    ),
                  ],
                ),
              ),
              if (busy) const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2)),
            ],
          ),
          if (c.isStale || s.status == WeatherStatus.failed)
            Padding(
              padding: const EdgeInsets.only(top: AtlasSpacing.xs),
              child: Text(
                'Eskirgan ma’lumot (${_time(weather.fetchedAt.toLocal())})',
                key: const Key('weather.stale'),
                style: text.bodySmall?.copyWith(color: AtlasColors.warning),
              ),
            ),
        ],
      );
    } else if (busy) {
      body = Row(
        children: [
          const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2)),
          const SizedBox(width: AtlasSpacing.sm),
          Text(s.status == WeatherStatus.locating ? 'Joylashuv aniqlanmoqda…' : 'Ob-havo yuklanmoqda…'),
        ],
      );
    } else {
      body = Text(_prompt(s), key: const Key('weather.message'), style: text.bodyMedium);
    }

    return AtlasCard(
      key: const Key('weather.card'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.wb_sunny_outlined, size: 18, color: AtlasColors.accent),
              const SizedBox(width: AtlasSpacing.xs),
              Expanded(child: Text(where == null ? 'Ob-havo' : 'Ob-havo · $where', style: text.labelLarge)),
            ],
          ),
          const SizedBox(height: AtlasSpacing.sm),
          body,
          const SizedBox(height: AtlasSpacing.sm),
          Wrap(
            spacing: AtlasSpacing.xs,
            runSpacing: AtlasSpacing.xs,
            children: [
              if (weather == null && !busy && s.status != WeatherStatus.noLocation)
                FilledButton.tonal(
                  key: const Key('weather.locate'),
                  onPressed: c.locate,
                  child: const Text('Ob-havoni ko‘rish'),
                ),
              if (s.status == WeatherStatus.failed)
                TextButton(
                  key: const Key('weather.retry'),
                  onPressed: busy ? null : c.refresh,
                  child: const Text('Qayta urinish'),
                ),
              if (s.issue == LocationIssue.deniedForever || s.issue == LocationIssue.serviceDisabled)
                TextButton(
                  key: const Key('weather.settings'),
                  onPressed: c.openSettings,
                  child: const Text('Sozlamalarni ochish'),
                ),
              if (s.issue == LocationIssue.denied ||
                  s.issue == LocationIssue.timeout ||
                  s.issue == LocationIssue.unavailable)
                TextButton(
                  key: const Key('weather.useDevice'),
                  onPressed: busy ? null : c.useDeviceLocation,
                  child: const Text('Qayta aniqlash'),
                ),
              TextButton(
                key: const Key('weather.city'),
                onPressed: busy ? null : () => showCityPicker(context, ref),
                child: Text(s.source == LocationSource.city ? 'Shaharni o‘zgartirish' : 'Shaharni tanlash'),
              ),
              if (s.source == LocationSource.city)
                TextButton(
                  key: const Key('weather.myLocation'),
                  onPressed: busy ? null : c.useDeviceLocation,
                  child: const Text('Joylashuvim'),
                ),
            ],
          ),
        ],
      ),
    );
  }

  static String _time(DateTime t) => '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

  static String _prompt(WeatherState s) => switch (s.issue) {
    LocationIssue.denied => 'Joylashuvga ruxsat berilmadi. Shaharni tanlang — ob-havo shunga qarab olinadi.',
    LocationIssue.deniedForever => 'Joylashuv ruxsati o‘chirilgan. Sozlamalardan yoqing yoki shaharni tanlang.',
    LocationIssue.serviceDisabled => 'Qurilmada joylashuv xizmati o‘chiq. Uni yoqing yoki shaharni tanlang.',
    LocationIssue.timeout => 'Joylashuv aniqlanmadi (vaqt tugadi). Qayta urinib ko‘ring yoki shaharni tanlang.',
    LocationIssue.unavailable => 'Joylashuv aniqlanmadi. Shaharni tanlang.',
    null when s.status == WeatherStatus.failed => s.failure?.userMessage ?? 'Ob-havo yuklanmadi.',
    null => 'Obrazlar ob-havoga mos bo‘lishi uchun joylashuvingiz yoki shahringiz kerak. Joylashuv faqat siz ruxsat berganda bir marta olinadi.',
  };
}

/// The manual city list (no geocoding service).
Future<void> showCityPicker(BuildContext context, WidgetRef ref) async {
  final city = await showModalBottomSheet<City>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (context) => SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.7),
        child: ListView(
          shrinkWrap: true,
          children: [
            const ListTile(title: Text('Shaharni tanlang')),
            for (final c in Cities.all)
              ListTile(key: Key('city.${c.id}'), title: Text(c.name), onTap: () => Navigator.pop(context, c)),
          ],
        ),
      ),
    ),
  );
  if (city != null) await ref.read(weatherControllerProvider.notifier).chooseCity(city);
}
