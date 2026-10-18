import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/providers.dart';
import '../../core/session/providers.dart';
import 'consent_gate.dart';
import 'data/legal_repository.dart';

final legalRepositoryProvider = Provider<LegalRepository>((ref) => LegalRepository(ref.watch(atlasApiClientProvider)));

final consentGateProvider = Provider<ConsentGate>((ref) {
  final gate = ConsentGate(
    session: ref.watch(sessionControllerProvider),
    consentRequired: ref.watch(legalRepositoryProvider).consentRequired,
    refusals: ref.watch(consentRefusalsProvider).stream,
  );
  ref.onDispose(gate.dispose);
  return gate;
});

/// The current legal documents, loaded while a screen that shows or accepts
/// them is open. No automatic retry: the screens offer one, and registration
/// must not wait on background attempts.
final legalDocumentsProvider = FutureProvider.autoDispose<LegalBundle>(
  (ref) => ref.watch(legalRepositoryProvider).get(),
  retry: (_, _) => null,
);
