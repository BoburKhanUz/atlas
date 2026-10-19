import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/router.dart';
import '../../../core/design/tokens.dart';
import '../../../core/design/typography.dart';
import '../../../core/session/providers.dart';
import '../../../core/widgets/atlas_brand.dart';
import '../../../core/widgets/atlas_card.dart';
import '../../../core/widgets/atlas_page.dart';
import '../../outfits/data/outfits_repository.dart' show outfitOccasions;
import '../../outfits/presentation/outfit_labels.dart';
import '../../outfits/providers.dart';
import '../../wardrobe/presentation/wardrobe_list_controller.dart' show ListStatus;
import '../../wardrobe/providers.dart';
import '../../weather/presentation/weather_card.dart';
import '../../weather/providers.dart';

/// Today: a greeting, the way into today's outfit, the weather, quick
/// occasions, the wardrobe and the stylist. Weather is refreshed when Home
/// opens or the app resumes and it is older than 30 minutes — without a
/// permission prompt (only a stored city or an already granted permission is
/// used).
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  late final AppLifecycleListener _lifecycle;

  @override
  void initState() {
    super.initState();
    _lifecycle = AppLifecycleListener(onResume: _refreshIfStale);
    WidgetsBinding.instance.addPostFrameCallback((_) => _refreshIfStale());
  }

  void _refreshIfStale() {
    if (mounted) ref.read(weatherControllerProvider.notifier).refreshIfStale();
  }

  @override
  void dispose() {
    _lifecycle.dispose();
    super.dispose();
  }

  void _openSuggestions({String? occasion, bool generate = false}) {
    final outfits = ref.read(generateControllerProvider.notifier);
    if (occasion != null) outfits.chooseOccasion(occasion);
    ref.read(outfitsTabProvider.notifier).show(OutfitsTab.suggest);
    context.go(AtlasRoutes.outfits);
    if (generate) outfits.generate();
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return AtlasPage(
      title: 'Bugun',
      header: _Greeting(now: DateTime.now()),
      onRefresh: () => ref.read(weatherControllerProvider.notifier).refresh(),
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.symmetric(horizontal: AtlasSpacing.screen),
          sliver: SliverList.list(
            children: [
              _TodayCard(onOpen: _openSuggestions),
              const SizedBox(height: AtlasSpacing.md),
              const WeatherCard(),
              const SizedBox(height: AtlasSpacing.lg),
              Text('Qayerga borasiz?', style: text.titleLarge),
              const SizedBox(height: AtlasSpacing.xxs),
              Text('Vaziyatni tanlang — obrazlar shunga mos tanlanadi.', style: text.bodyMedium),
              const SizedBox(height: AtlasSpacing.sm),
            ],
          ),
        ),
        SliverToBoxAdapter(
          child: _Occasions(onPick: (o) => _openSuggestions(occasion: o, generate: true)),
        ),
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(
            AtlasSpacing.screen,
            AtlasSpacing.lg,
            AtlasSpacing.screen,
            AtlasSpacing.xl,
          ),
          sliver: SliverList.list(
            children: const [
              _WardrobeCard(),
              SizedBox(height: AtlasSpacing.md),
              _StylistCard(),
            ],
          ),
        ),
      ],
    );
  }
}

/// "Xayrli tong" … by the hour of the day.
String greetingFor(int hour) => switch (hour) {
  >= 5 && < 12 => 'Xayrli tong',
  >= 12 && < 18 => 'Xayrli kun',
  >= 18 && < 23 => 'Xayrli kech',
  _ => 'Xayrli tun',
};

const _weekdays = ['Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba', 'Yakshanba'];
const _months = [
  'yanvar',
  'fevral',
  'mart',
  'aprel',
  'may',
  'iyun',
  'iyul',
  'avgust',
  'sentabr',
  'oktabr',
  'noyabr',
  'dekabr',
];

/// "Dushanba, 19-oktabr".
String uzbekDate(DateTime d) => '${_weekdays[d.weekday - 1]}, ${d.day}-${_months[d.month - 1]}';

class _Greeting extends ConsumerWidget {
  const _Greeting({required this.now});
  final DateTime now;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final text = Theme.of(context).textTheme;
    final name = ref.watch(authStateProvider.select((s) => s.user?.name?.trim()));
    final first = name == null || name.isEmpty ? null : name.split(RegExp(r'\s+')).first;
    return Padding(
      padding: const EdgeInsets.fromLTRB(AtlasSpacing.screen, AtlasSpacing.md, AtlasSpacing.screen, AtlasSpacing.lg),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(uzbekDate(now), key: const Key('home.date'), style: text.bodyMedium),
                const SizedBox(height: AtlasSpacing.xxs),
                Text(
                  first == null ? '${greetingFor(now.hour)}!' : '${greetingFor(now.hour)}, $first!',
                  key: const Key('home.greeting'),
                  style: text.headlineMedium,
                ),
              ],
            ),
          ),
          Semantics(
            button: true,
            label: 'Profil',
            excludeSemantics: true,
            child: InkWell(
              key: const Key('home.profile'),
              customBorder: const CircleBorder(),
              onTap: () => context.go(AtlasRoutes.profile),
              child: CircleAvatar(
                radius: 24,
                backgroundColor: AtlasColors.accentSoft,
                foregroundColor: AtlasColors.accentStrong,
                child: first == null
                    ? const Icon(Icons.person_outline_rounded)
                    : Text(
                        first.characters.first.toUpperCase(),
                        style: text.titleLarge?.copyWith(color: AtlasColors.accentStrong),
                      ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The brand card that leads to today's outfit (with the latest suggestion's
/// clothes when there is one).
class _TodayCard extends ConsumerWidget {
  const _TodayCard({required this.onOpen});
  final void Function({String? occasion, bool generate}) onOpen;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final text = Theme.of(context).textTheme;
    final weather = ref.watch(weatherControllerProvider.select((s) => s.weather));
    final result = ref.watch(generateControllerProvider.select((s) => s.result));
    final ready = result != null && result.outfits.isNotEmpty;
    final line = weather == null
        ? 'Garderobingizdagi kiyimlardan ob-havo va vaziyatga mos 3 ta obraz.'
        : '${OutfitLabels.temperature(weather.temperature)}, ${weather.conditionLabel.toLowerCase()} — '
              '${_advice(weather.temperature, weather.precipitationProbability)}';
    return Container(
      key: const Key('home.today'),
      decoration: const BoxDecoration(
        gradient: AtlasColors.heroGradient,
        borderRadius: BorderRadius.all(Radius.circular(28)),
        boxShadow: AtlasShadows.card,
      ),
      clipBehavior: Clip.antiAlias,
      child: Stack(
        children: [
          const Positioned.fill(child: HeroDecoration()),
          Padding(
            padding: const EdgeInsets.all(AtlasSpacing.lg),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Icon(Icons.auto_awesome_rounded, size: 16, color: AtlasColors.onInkMuted),
                    const SizedBox(width: AtlasSpacing.xs),
                    Flexible(
                      child: Text('BUGUNGI OBRAZ', style: AtlasType.overline.copyWith(color: AtlasColors.onInkMuted)),
                    ),
                  ],
                ),
                const SizedBox(height: AtlasSpacing.sm),
                Text(
                  ready ? 'Obrazlaringiz tayyor' : 'Bugun nima kiyamiz?',
                  style: text.headlineMedium?.copyWith(color: AtlasColors.onAccent),
                ),
                const SizedBox(height: AtlasSpacing.xs),
                Text(line, style: text.bodyLarge?.copyWith(color: AtlasColors.onInkMuted)),
                const SizedBox(height: AtlasSpacing.lg),
                FilledButton.icon(
                  key: const Key('home.outfits'),
                  style: FilledButton.styleFrom(
                    backgroundColor: AtlasColors.onAccent,
                    foregroundColor: AtlasColors.ink,
                    minimumSize: const Size(0, 52),
                    padding: const EdgeInsets.symmetric(horizontal: AtlasSpacing.lg),
                  ),
                  onPressed: () => onOpen(),
                  icon: Icon(ready ? Icons.arrow_forward_rounded : Icons.auto_awesome_rounded, size: 20),
                  label: Text(ready ? 'Obrazlarni ko‘rish' : 'Bugungi obraz'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  static String _advice(num temperature, num rainChance) {
    if (rainChance >= 50) return 'soyabon yoki suv o‘tkazmaydigan kiyim kerak bo‘ladi.';
    if (temperature < 5) return 'issiq palto va yopiq poyabzal kiying.';
    if (temperature < 15) return 'ustiga kurtka yoki trikotaj oling.';
    if (temperature < 25) return 'yengil, qatlamli kiyim ayni muddao.';
    return 'yengil va ochiq rangli kiyim tanlang.';
  }
}

class _Occasions extends StatelessWidget {
  const _Occasions({required this.onPick});
  final ValueChanged<String> onPick;

  static const _icons = {
    'work': Icons.work_outline_rounded,
    'date': Icons.favorite_outline_rounded,
    'wedding': Icons.celebration_outlined,
    'travel': Icons.flight_takeoff_rounded,
    'casual': Icons.weekend_outlined,
    'other': Icons.more_horiz_rounded,
  };

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return SizedBox(
      height: 92 + MediaQuery.textScalerOf(context).scale(18),
      child: ListView.separated(
        padding: const EdgeInsets.symmetric(horizontal: AtlasSpacing.screen),
        scrollDirection: Axis.horizontal,
        itemCount: outfitOccasions.length,
        separatorBuilder: (_, _) => const SizedBox(width: AtlasSpacing.sm),
        itemBuilder: (context, i) {
          final o = outfitOccasions[i];
          return SizedBox(
            width: 96,
            child: AtlasCard(
              key: Key('home.occasion.$o'),
              padding: const EdgeInsets.symmetric(vertical: AtlasSpacing.sm, horizontal: AtlasSpacing.xs),
              onTap: () => onPick(o),
              child: Column(
                children: [
                  Container(
                    width: 44,
                    height: 44,
                    decoration: const BoxDecoration(color: AtlasColors.accentSoft, shape: BoxShape.circle),
                    child: Icon(_icons[o] ?? Icons.checkroom_outlined, color: AtlasColors.accent, size: 22),
                  ),
                  const SizedBox(height: AtlasSpacing.xs),
                  Text(OutfitLabels.occasion(o), style: text.labelLarge, maxLines: 1, overflow: TextOverflow.ellipsis),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

class _WardrobeCard extends ConsumerWidget {
  const _WardrobeCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final text = Theme.of(context).textTheme;
    final s = ref.watch(wardrobeListProvider);
    final loaded = s.status != ListStatus.loading && s.failure == null && s.category == 'all';
    final count = s.items.length;
    final empty = loaded && count == 0;
    final String title;
    final String subtitle;
    if (!loaded) {
      title = 'Garderob';
      subtitle = 'Kiyimlaringiz bir joyda — har biri rasm va xususiyatlari bilan.';
    } else if (empty) {
      title = 'Garderobingizni yarating';
      subtitle = 'Kamida 3 ta kiyim (ustki, pastki, poyabzal) rasmini yuklang — obrazlar shulardan tuziladi.';
    } else {
      title = s.hasMore ? '$count+ ta kiyim' : '$count ta kiyim';
      final groups = <String, int>{};
      for (final item in s.items) {
        groups[item.category] = (groups[item.category] ?? 0) + 1;
      }
      final top = groups.entries.toList()..sort((a, b) => b.value.compareTo(a.value));
      subtitle = top.take(3).map((e) => '${_category(e.key)} ${e.value}').join(' · ');
    }
    return AtlasCard(
      key: const Key('home.wardrobe'),
      onTap: () => context.go(AtlasRoutes.wardrobe),
      child: Row(
        children: [
          Container(
            width: 52,
            height: 52,
            decoration: const BoxDecoration(color: AtlasColors.sand, borderRadius: AtlasRadii.field),
            child: const Icon(Icons.checkroom_rounded, color: AtlasColors.ink),
          ),
          const SizedBox(width: AtlasSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, key: const Key('home.wardrobe.title'), style: text.titleMedium),
                const SizedBox(height: 2),
                Text(subtitle, style: text.bodySmall, maxLines: 2, overflow: TextOverflow.ellipsis),
              ],
            ),
          ),
          const SizedBox(width: AtlasSpacing.xs),
          IconButton.filled(
            key: const Key('home.addItem'),
            style: IconButton.styleFrom(
              backgroundColor: AtlasColors.accentSoft,
              foregroundColor: AtlasColors.accentStrong,
            ),
            tooltip: 'Kiyim qo‘shish',
            onPressed: () => context.push(AtlasRoutes.wardrobeAdd),
            icon: const Icon(Icons.add_a_photo_outlined),
          ),
        ],
      ),
    );
  }

  static String _category(String c) => switch (c) {
    'outerwear' => 'ustki',
    'shirt' => 'ko‘ylak',
    'pants' => 'shim',
    'dress' => 'ko‘ylak',
    'shoes' => 'poyabzal',
    'bag' => 'sumka',
    'accessory' => 'aksessuar',
    _ => c,
  };
}

class _StylistCard extends StatelessWidget {
  const _StylistCard();

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return AtlasCard(
      key: const Key('home.stylist'),
      onTap: () => context.push(AtlasRoutes.stylistNew),
      child: Row(
        children: [
          Container(
            width: 52,
            height: 52,
            decoration: const BoxDecoration(gradient: AtlasColors.heroGradient, shape: BoxShape.circle),
            child: const Icon(Icons.chat_bubble_outline_rounded, color: AtlasColors.onAccent),
          ),
          const SizedBox(width: AtlasSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Stilistdan so‘rang', style: text.titleMedium),
                const SizedBox(height: 2),
                Text(
                  '«Ertaga uchrashuvga nima kiyay?» — garderobingizni biladigan maslahatchi.',
                  style: text.bodySmall,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          const Icon(Icons.chevron_right_rounded, color: AtlasColors.textSecondary),
        ],
      ),
    );
  }
}
