import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/router.dart';
import '../../../core/design/tokens.dart';
import '../../../core/widgets/atlas_button.dart';
import '../../../core/widgets/atlas_page.dart';
import '../../outfits/providers.dart';
import '../../stylist/presentation/stylist_screen.dart' show AskStylistButton;
import '../../weather/presentation/weather_card.dart';
import '../../weather/providers.dart';

/// Today: current weather and the entry to outfit suggestions. Weather is
/// refreshed when Home opens or the app resumes and it is older than 30
/// minutes — without a permission prompt (only a stored city or an already
/// granted permission is used).
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

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return AtlasPage(
      title: 'Bugun',
      onRefresh: () => ref.read(weatherControllerProvider.notifier).refresh(),
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.symmetric(horizontal: AtlasSpacing.screen),
          sliver: SliverList.list(
            children: [
              const WeatherCard(),
              const SizedBox(height: AtlasSpacing.lg),
              Text('Bugun nima kiyaman?', style: text.titleLarge),
              const SizedBox(height: AtlasSpacing.xs),
              Text('Garderobingiz va ob-havoga mos obrazlar.', style: text.bodyMedium),
              const SizedBox(height: AtlasSpacing.md),
              AtlasButton(
                key: const Key('home.outfits'),
                label: 'Bugungi obraz',
                icon: Icons.auto_awesome_rounded,
                onPressed: () {
                  ref.read(outfitsTabProvider.notifier).show(OutfitsTab.suggest);
                  context.go(AtlasRoutes.outfits);
                },
              ),
              const SizedBox(height: AtlasSpacing.sm),
              const AskStylistButton(),
            ],
          ),
        ),
      ],
    );
  }
}
