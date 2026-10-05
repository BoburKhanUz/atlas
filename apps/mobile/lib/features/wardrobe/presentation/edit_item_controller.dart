import 'dart:async';

import 'package:atlas_api/atlas_api.dart' show WardrobeItem;
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/logging/app_log.dart';
import '../../../core/network/api_error_code.dart';
import '../../../core/network/api_failure.dart';
import '../data/analysis_review.dart';
import '../data/item_edit.dart';
import '../providers.dart';

enum EditStatus { loading, editing, saving, failed, saved, notFound, loadFailed }

@immutable
class EditState {
  const EditState({
    this.status = EditStatus.loading,
    this.original,
    this.draft,
    this.failure,
    this.fieldErrors = const {},
  });

  final EditStatus status;

  /// The item as the server last returned it.
  final WardrobeItem? original;

  /// Unsaved edits (kept after a failed save).
  final ItemDraft? draft;
  final ApiFailure? failure;

  /// VALIDATION_ERROR details mapped to attributes.
  final Map<ItemAttribute, String> fieldErrors;

  Set<ItemAttribute> get changes => draft == null || original == null ? const {} : draft!.changesFrom(original!);

  EditState copyWith({
    EditStatus? status,
    WardrobeItem? original,
    ItemDraft? draft,
    ApiFailure? failure,
    Map<ItemAttribute, String>? fieldErrors,
  }) => EditState(
    status: status ?? this.status,
    original: original ?? this.original,
    draft: draft ?? this.draft,
    failure: failure,
    fieldErrors: fieldErrors ?? const {},
  );
}

/// Edits the detected attributes of one item: one PATCH per Save with only
/// the changed fields (nothing when nothing changed); never retried
/// automatically; 401 goes through the session layer.
class EditItemController extends Notifier<EditState> {
  EditItemController(this.id);
  final String id;

  @override
  EditState build() {
    Future.microtask(_load);
    return const EditState();
  }

  Future<void> _load() async {
    try {
      final item = await ref.read(wardrobeItemProvider(id).future);
      if (!ref.mounted) return;
      state = EditState(status: EditStatus.editing, original: item, draft: ItemDraft.of(item));
    } on ApiFailure catch (f) {
      if (!ref.mounted) return;
      final missing = f is ApiHttpFailure && f.code == ApiErrorCode.notFound;
      state = EditState(status: missing ? EditStatus.notFound : EditStatus.loadFailed, failure: f);
      if (missing) ref.read(wardrobeListProvider.notifier).remove(id);
    }
  }

  void retryLoad() {
    state = const EditState();
    _load();
  }

  void set(ItemAttribute attribute, Object value) {
    final draft = state.draft;
    if (draft == null || state.status == EditStatus.saving) return;
    state = state.copyWith(status: EditStatus.editing, draft: draft.withValue(attribute, value));
  }

  /// Save (also Retry). Ignored while a save is running (double tap).
  Future<void> save() async {
    final original = state.original;
    final draft = state.draft;
    if (original == null || draft == null) return;
    if (state.status != EditStatus.editing && state.status != EditStatus.failed) return;
    if (draft.problem != null) return;
    final Map<String, Object?>? patch;
    try {
      patch = draft.patchFrom(original);
    } on ArgumentError {
      AppLog.warn('edit holds a value outside the contract');
      return;
    }
    if (patch == null) {
      state = state.copyWith(status: EditStatus.saved); // nothing changed: no request
      return;
    }
    state = state.copyWith(status: EditStatus.saving);
    try {
      final updated = await ref.read(wardrobeRepositoryProvider).update(id, patch);
      if (!ref.mounted) return;
      ref.read(wardrobeListProvider.notifier).replace(updated);
      ref.read(wardrobeItemUpdatesProvider.notifier).publish(updated);
      ref.invalidate(wardrobeItemProvider(id));
      state = EditState(status: EditStatus.saved, original: updated, draft: ItemDraft.of(updated));
    } on ApiFailure catch (f) {
      if (!ref.mounted) return;
      AppLog.info('edit not saved: ${f.describe()}');
      if (f is SessionEndedFailure) {
        state = const EditState(status: EditStatus.loadFailed); // edits discarded; sign-in follows
        return;
      }
      if (f is ApiHttpFailure && f.code == ApiErrorCode.notFound) {
        ref.read(wardrobeListProvider.notifier).remove(id);
        unawaited(ref.read(wardrobeListProvider.notifier).refresh());
        state = state.copyWith(status: EditStatus.notFound, failure: f);
        return;
      }
      final errors = <ItemAttribute, String>{
        if (f is ApiHttpFailure)
          for (final e in f.fieldErrors) ?ItemAttribute.fromField(e.path.split('.').first): e.message,
      };
      state = state.copyWith(status: EditStatus.failed, failure: f, fieldErrors: errors);
    }
  }
}
