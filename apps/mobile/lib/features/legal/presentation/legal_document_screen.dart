import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../../core/design/tokens.dart';
import '../../../core/network/api_failure.dart';
import '../../../core/widgets/skeleton.dart' show LoadingView;
import '../../../core/widgets/state_views.dart';
import '../data/legal_repository.dart';
import '../providers.dart';

/// One legal document (privacy policy or terms of use), readable signed in
/// or out: the register screen and the profile link here.
class LegalDocumentScreen extends ConsumerWidget {
  const LegalDocumentScreen({super.key, required this.kind});

  final LegalDocumentKind kind;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final legal = ref.watch(legalDocumentsProvider);
    void retry() => ref.invalidate(legalDocumentsProvider);
    return Scaffold(
      appBar: AppBar(title: Text(legal.value?.documents[kind]?.title ?? kind.label)),
      body: switch (legal) {
        AsyncData(:final value) when value.documents[kind] != null => _Document(
          bundle: value,
          document: value.documents[kind]!,
        ),
        AsyncData() => const EmptyStateView(icon: Icons.description_outlined, title: 'Hujjat topilmadi'),
        AsyncError(error: NoNetworkFailure()) => OfflineStateView(onRetry: retry),
        AsyncError(:final error) => ErrorStateView(
          message: error is ApiFailure ? error.userMessage : 'Hujjatni yuklab bo‘lmadi. Qayta urinib ko‘ring.',
          onRetry: retry,
        ),
        _ => const LoadingView(),
      },
    );
  }
}

/// 2026-10-17 → 17.10.2026
String formatLegalDate(String isoDate) {
  final parts = isoDate.split('-');
  return parts.length == 3 ? '${parts[2]}.${parts[1]}.${parts[0]}' : isoDate;
}

class _Document extends StatelessWidget {
  const _Document({required this.bundle, required this.document});

  final LegalBundle bundle;
  final LegalDocumentData document;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return SafeArea(
      child: ListView(
        key: const Key('legal.document'),
        padding: const EdgeInsets.all(AtlasSpacing.screen),
        children: [
          Text(
            'Kuchga kirish sanasi: ${formatLegalDate(bundle.effectiveDate)} · Versiya: ${bundle.version}',
            style: text.bodySmall,
          ),
          if (bundle.draft) ...[
            const SizedBox(height: AtlasSpacing.md),
            Container(
              key: const Key('legal.draft'),
              padding: const EdgeInsets.all(AtlasSpacing.sm),
              decoration: const BoxDecoration(color: AtlasColors.warningSoft, borderRadius: AtlasRadii.field),
              child: const Text(
                'Loyiha: bu matnni hali yurist ko‘rib chiqmagan, u o‘zgarishi mumkin. '
                'Kvadrat qavs ichidagi joylar keyinroq to‘ldiriladi.',
                style: TextStyle(color: AtlasColors.warning),
              ),
            ),
          ],
          for (final section in document.sections) ...[
            const SizedBox(height: AtlasSpacing.lg),
            Semantics(header: true, child: Text(section.heading, style: text.titleMedium)),
            for (final p in section.paragraphs)
              Padding(
                padding: const EdgeInsets.only(top: AtlasSpacing.xs),
                child: p.startsWith(LegalSectionData.listItemPrefix)
                    ? Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          ExcludeSemantics(child: Text('•', style: text.bodyMedium)),
                          const SizedBox(width: AtlasSpacing.xs),
                          Expanded(
                            child: Text(p.substring(LegalSectionData.listItemPrefix.length), style: text.bodyMedium),
                          ),
                        ],
                      )
                    : Text(p, style: text.bodyMedium),
              ),
          ],
          const SizedBox(height: AtlasSpacing.xl),
        ],
      ),
    );
  }
}
