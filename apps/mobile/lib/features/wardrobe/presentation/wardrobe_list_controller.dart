import 'package:atlas_api/atlas_api.dart' show WardrobeItem;
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_failure.dart';
import '../../../core/session/providers.dart';
import '../providers.dart';

enum ListStatus { loading, ready, refreshing, loadingMore }

@immutable
class WardrobeListState {
  const WardrobeListState({
    this.category = 'all',
    this.items = const [],
    this.nextCursor,
    this.status = ListStatus.loading,
    this.failure,
    this.loadMoreFailure,
  });

  final String category;
  final List<WardrobeItem> items;
  final String? nextCursor;
  final ListStatus status;

  /// The first page could not be loaded (shown instead of the list).
  final ApiFailure? failure;

  /// The next page could not be loaded (shown under the list).
  final ApiFailure? loadMoreFailure;

  bool get hasMore => nextCursor != null;

  WardrobeListState copyWith({
    String? category,
    List<WardrobeItem>? items,
    String? Function()? nextCursor,
    ListStatus? status,
    ApiFailure? Function()? failure,
    ApiFailure? Function()? loadMoreFailure,
  }) => WardrobeListState(
    category: category ?? this.category,
    items: items ?? this.items,
    nextCursor: nextCursor != null ? nextCursor() : this.nextCursor,
    status: status ?? this.status,
    failure: failure != null ? failure() : this.failure,
    loadMoreFailure: loadMoreFailure != null ? loadMoreFailure() : this.loadMoreFailure,
  );
}

/// The wardrobe list: server pages (cursor), category filter, refresh.
/// The server is the source of truth; the list is rebuilt per signed-in user.
class WardrobeListController extends Notifier<WardrobeListState> {
  int _generation = 0;

  @override
  WardrobeListState build() {
    ref.watch(authStateProvider.select((s) => s.user?.id)); // new user → new list
    Future.microtask(_loadFirst);
    return const WardrobeListState();
  }

  Future<void> _loadFirst() async {
    final generation = ++_generation;
    final category = state.category;
    try {
      final page = await ref.read(wardrobeRepositoryProvider).list(category: category);
      if (generation != _generation || !ref.mounted) return;
      state = WardrobeListState(
        category: category,
        items: page.items,
        nextCursor: page.nextCursor,
        status: ListStatus.ready,
      );
    } on ApiFailure catch (f) {
      if (generation != _generation || !ref.mounted) return;
      // A failed refresh keeps what is shown and reports below it.
      state = state.items.isEmpty
          ? state.copyWith(status: ListStatus.ready, failure: () => f)
          : state.copyWith(status: ListStatus.ready, loadMoreFailure: () => f);
    }
  }

  Future<void> setCategory(String category) async {
    if (category == state.category && state.failure == null) return;
    state = WardrobeListState(category: category);
    await _loadFirst();
  }

  /// Pull-to-refresh (also used to get fresh signed URLs).
  Future<void> refresh() async {
    if (state.status == ListStatus.loading || state.status == ListStatus.refreshing) return;
    state = state.copyWith(
      status: state.items.isEmpty ? ListStatus.loading : ListStatus.refreshing,
      failure: () => null,
      loadMoreFailure: () => null,
    );
    await _loadFirst();
  }

  Future<void> loadMore() async {
    final cursor = state.nextCursor;
    if (cursor == null || state.status != ListStatus.ready) return;
    final generation = _generation;
    state = state.copyWith(status: ListStatus.loadingMore, loadMoreFailure: () => null);
    try {
      final page = await ref.read(wardrobeRepositoryProvider).list(category: state.category, cursor: cursor);
      if (generation != _generation || !ref.mounted) return;
      final known = {for (final i in state.items) i.id};
      state = state.copyWith(
        items: [...state.items, ...page.items.where((i) => !known.contains(i.id))],
        nextCursor: () => page.nextCursor,
        status: ListStatus.ready,
      );
    } on ApiFailure catch (f) {
      if (generation != _generation || !ref.mounted) return;
      state = state.copyWith(status: ListStatus.ready, loadMoreFailure: () => f);
    }
  }

  /// A new item from an upload (a replay never duplicates an item).
  void insert(WardrobeItem item) {
    if (state.category != 'all' && state.category != item.category) return;
    state = state.copyWith(items: [item, ...state.items.where((i) => i.id != item.id)], failure: () => null);
  }

  void remove(String id) => state = state.copyWith(items: state.items.where((i) => i.id != id).toList());
}
