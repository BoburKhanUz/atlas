import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../core/design/tokens.dart';
import '../../../core/widgets/atlas_button.dart';
import '../../../core/widgets/skeleton.dart' show LoadingView;
import '../../../core/widgets/state_views.dart';
import '../../onboarding/data/options.dart';
import '../data/profile_data.dart';
import '../providers.dart';
import 'profile_edit_controller.dart';

/// Name and style/colour preferences. Gender, fit, height and the other
/// body fields are not here: the API does not let the app read them back
/// yet, and they are never overwritten blindly.
class ProfileEditScreen extends ConsumerStatefulWidget {
  const ProfileEditScreen({super.key});

  @override
  ConsumerState<ProfileEditScreen> createState() => _ProfileEditScreenState();
}

class _ProfileEditScreenState extends ConsumerState<ProfileEditScreen> {
  final _name = TextEditingController();
  bool _seeded = false;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(profileEditControllerProvider);
    final c = ref.read(profileEditControllerProvider.notifier);
    ref.listen(profileEditControllerProvider.select((x) => x.status), (_, status) {
      if (status == ProfileEditStatus.saved && context.canPop()) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Profil saqlandi')));
        context.pop();
      }
    });
    final draft = s.draft;
    if (draft != null && !_seeded) {
      _seeded = true;
      _name.text = draft.name;
    }
    final saving = s.status == ProfileEditStatus.saving;
    final text = Theme.of(context).textTheme;

    final Widget body;
    if (s.status == ProfileEditStatus.loading) {
      body = const LoadingView(items: 2);
    } else if (s.status == ProfileEditStatus.loadFailed || draft == null) {
      body = ErrorStateView(message: s.failure?.userMessage ?? 'Yuklab bo‘lmadi.', onRetry: c.retryLoad);
    } else {
      final problem = draft.problem;
      body = Column(
        children: [
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(AtlasSpacing.screen),
              children: [
                TextField(
                  key: const Key('profileEdit.name'),
                  controller: _name,
                  enabled: !saving,
                  maxLength: ProfileLimits.nameMax,
                  textCapitalization: TextCapitalization.words,
                  decoration: InputDecoration(
                    labelText: 'Ism',
                    errorText: problem == ProfileProblem.nameEmpty
                        ? 'Ism bo‘sh bo‘lmasin'
                        : problem == ProfileProblem.nameTooLong
                        ? 'Ko‘pi bilan ${ProfileLimits.nameMax} ta belgi'
                        : null,
                  ),
                  onChanged: (v) => c.edit((d) => d.withName(v)),
                ),
                const SizedBox(height: AtlasSpacing.md),
                _Section(
                  title: 'Yoqadigan uslublar',
                  options: StyleOption.values,
                  label: (o) => o.label,
                  keyPrefix: 'profileEdit.likedStyle',
                  selected: draft.preferredStyles,
                  enabled: !saving,
                  onTap: (o) => c.edit((d) => d.togglePreferredStyle(o)),
                ),
                _Section(
                  title: 'Yoqmaydigan uslublar',
                  options: StyleOption.values,
                  label: (o) => o.label,
                  keyPrefix: 'profileEdit.dislikedStyle',
                  selected: draft.dislikedStyles,
                  enabled: !saving,
                  onTap: (o) => c.edit((d) => d.toggleDislikedStyle(o)),
                ),
                _Section(
                  title: 'Sevimli ranglar',
                  hint: 'Ko‘pi bilan ${ProfileLimits.listMax} ta',
                  options: ColorOption.values,
                  label: (o) => o.label,
                  swatch: (o) => o.swatch,
                  keyPrefix: 'profileEdit.likedColor',
                  selected: draft.favoriteColors,
                  enabled: !saving,
                  onTap: (o) => c.edit((d) => d.toggleFavoriteColor(o)),
                ),
                _Section(
                  title: 'Yoqmaydigan ranglar',
                  hint: 'Ko‘pi bilan ${ProfileLimits.listMax} ta',
                  options: ColorOption.values,
                  label: (o) => o.label,
                  swatch: (o) => o.swatch,
                  keyPrefix: 'profileEdit.dislikedColor',
                  selected: draft.dislikedColors,
                  enabled: !saving,
                  onTap: (o) => c.edit((d) => d.toggleDislikedColor(o)),
                ),
                Text(
                  'Jins, bichim va o‘lchamlarni hozircha bu yerda o‘zgartirib bo‘lmaydi.',
                  key: const Key('profileEdit.bodyNote'),
                  style: text.bodySmall,
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AtlasSpacing.screen,
              AtlasSpacing.xs,
              AtlasSpacing.screen,
              AtlasSpacing.md,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (s.status == ProfileEditStatus.failed)
                  Padding(
                    padding: const EdgeInsets.only(bottom: AtlasSpacing.xs),
                    child: Text(
                      '${s.failure?.userMessage ?? 'Saqlab bo‘lmadi.'} O‘zgarishlaringiz saqlanib qoldi.',
                      key: const Key('profileEdit.failure'),
                      style: const TextStyle(color: AtlasColors.error),
                    ),
                  ),
                AtlasButton(
                  key: const Key('profileEdit.save'),
                  label: s.status == ProfileEditStatus.failed ? 'Qayta urinish' : 'Saqlash',
                  loading: saving,
                  onPressed: problem == null ? c.save : null,
                ),
              ],
            ),
          ),
        ],
      );
    }
    return PopScope(
      canPop: !saving,
      child: Scaffold(
        appBar: AppBar(title: const Text('Profilni tahrirlash')),
        body: SafeArea(child: body),
      ),
    );
  }
}

class _Section<T extends Enum> extends StatelessWidget {
  const _Section({
    required this.title,
    required this.options,
    required this.label,
    required this.keyPrefix,
    required this.selected,
    required this.enabled,
    required this.onTap,
    this.swatch,
    this.hint,
  });

  final String title;
  final List<T> options;
  final String Function(T) label;
  final String keyPrefix;
  final Set<T> selected;
  final bool enabled;
  final void Function(T) onTap;
  final Color Function(T)? swatch;
  final String? hint;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final full = selected.length >= ProfileLimits.listMax;
    return Padding(
      padding: const EdgeInsets.only(bottom: AtlasSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: text.titleSmall),
          if (hint != null) Text(hint!, style: text.bodySmall),
          const SizedBox(height: AtlasSpacing.xs),
          Wrap(
            spacing: AtlasSpacing.xs,
            runSpacing: AtlasSpacing.xs,
            children: [
              for (final o in options)
                FilterChip(
                  key: Key('$keyPrefix.${o.name}'),
                  label: Text(label(o)),
                  selected: selected.contains(o),
                  showCheckmark: swatch == null,
                  avatar: swatch == null
                      ? null
                      : Container(
                          width: 16,
                          height: 16,
                          decoration: BoxDecoration(
                            color: swatch!(o),
                            shape: BoxShape.circle,
                            border: Border.all(color: AtlasColors.hairline),
                          ),
                        ),
                  onSelected: !enabled || (full && !selected.contains(o)) ? null : (_) => onTap(o),
                ),
            ],
          ),
        ],
      ),
    );
  }
}
