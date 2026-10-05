import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../design/tokens.dart';
import '../network/connectivity.dart';
import '../network/providers.dart';

/// Thin banner above the bottom navigation when the device is offline or
/// the API cannot be reached. Hidden while online (and while unknown).
class NetworkBanner extends ConsumerWidget {
  const NetworkBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final status = ref.watch(networkStatusProvider).value ?? NetworkStatus.online;
    final message = switch (status) {
      NetworkStatus.online => null,
      NetworkStatus.noNetwork => 'Internet aloqasi yo‘q',
      NetworkStatus.apiUnreachable => 'Serverga ulanib bo‘lmayapti',
    };
    return AnimatedSize(
      duration: AtlasMotion.of(context, AtlasMotion.normal),
      curve: AtlasMotion.curve,
      child: message == null
          ? const SizedBox(width: double.infinity)
          : Semantics(
              liveRegion: true,
              child: Container(
                width: double.infinity,
                color: AtlasColors.warningSoft,
                padding: const EdgeInsets.symmetric(horizontal: AtlasSpacing.screen, vertical: AtlasSpacing.xs),
                child: Row(
                  children: [
                    const Icon(Icons.cloud_off_rounded, size: 18, color: AtlasColors.warning),
                    const SizedBox(width: AtlasSpacing.xs),
                    Expanded(
                      child: Text(
                        message,
                        style: Theme.of(context).textTheme.labelLarge?.copyWith(color: AtlasColors.warning),
                      ),
                    ),
                  ],
                ),
              ),
            ),
    );
  }
}
