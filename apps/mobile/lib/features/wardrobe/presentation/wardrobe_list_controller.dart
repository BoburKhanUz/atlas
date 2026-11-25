import 'dart:async';

import 'package:atlas_api/atlas_api.dart' show WardrobeItem;
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_failure.dart';
import '../../../core/session/providers.dart';
import '../../../core/time/refresh_throttle.dart';
import '../data/wardrobe_repository.dart';
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
    this.refreshFailure,
    this.loadMoreFailure,
  });

  final String category;
  final List<WardrobeItem> items;
  final String? nextCursor;
  final ListStatus status;

  /// The first page could not be loaded (shown instead of the list).
  final ApiFailure? failure;

  /// A refresh (pull-to-refresh or fresh image URLs) failed while items are
  /// shown: they stay, and a banner offers to try again.
  final ApiFailure? refreshFailure;

  /// The next page could not be loaded (shown under the list).
  final ApiFailure? loadMoreFailure;

  bool get hasMore => nextCursor != null;

  WardrobeListState copyWith({
    String? category,
    List<WardrobeItem>? items,
    String? Function()? nextCursor,
    ListStatus? status,
    ApiFailure? Function()? failure,
    ApiFailure? Function()? refreshFailure,
    ApiFailure? Function()? loadMoreFailure,
  }) => WardrobeListState(
    category: category ?? this.category,
    items: items ?? this.items,
    nextCursor: nextCursor != null ? nextCursor() : this.nextCursor,
    status: status ?? this.status,
    failure: failure != null ? failure() : this.failure,
    refreshFailure: refreshFailure != null ? refreshFailure() : this.refreshFailure,
    loadMoreFailure: loadMoreFailure != null ? loadMoreFailure() : this.loadMoreFailure,
  );
}

/// The wardrobe list: server pages (cursor), category filter, refresh.
/// The server is the source of truth; the list is rebuilt per signed-in user.
class WardrobeListController extends Notifier<WardrobeListState> {
  int _generation = 0;

  /// Signed URLs are reloaded at most this often: many tiles report the same
  /// expiry at once, and a wrong device clock must not cause a request loop.
  /// A report inside the interval is done when it is over (never dropped: a
  /// tile reports an expired URL only once).
  static const urlRefreshInterval = signedUrlRefreshInterval;
  late RefreshThrottle _urlRefresh;

  /// An expiry reported while a page was loading: reload when it is done.
  bool _urlRefreshWanted = false;

  /// Inserts and removals made while a reload is running, re-applied to its
  /// result (it was read from the server before them).
  List<List<WardrobeItem> Function(List<WardrobeItem>)>? _edits;

  @override
  WardrobeListState build() {
    ref.watch(authStateProvider.select((s) => s.user?.id)); // new user → new list
    _urlRefresh = RefreshThrottle.forSignedUrls(ref);
    _urlRefreshWanted = false;
    _edits = null;
    Future.microtask(_loadFirst);
    return const WardrobeListState();
  }

  List<WardrobeItem> _withEdits(List<WardrobeItem> items) {
    var result = items;
    for (final edit in _edits ?? const <List<WardrobeItem> Function(List<WardrobeItem>)>[]) {
      result = edit(result);
    }
    return result;
  }

  Future<void> _loadFirst() async {
    final generation = ++_generation;
    final category = state.category;
    try {
      final page = await ref.read(wardrobeRepositoryProvider).list(category: category);
      if (generation != _generation || !ref.mounted) return;
      _urlRefreshWanted = false; // the URLs are fresh
      state = WardrobeListState(
        category: category,
        items: _withEdits(page.items),
        nextCursor: page.nextCursor,
        status: ListStatus.ready,
      );
    } catch (error, stack) {
      final f = failureOf(error, stack);
      if (generation != _generation || !ref.mounted) return;
      _urlRefreshWanted = false; // the banner's retry reloads them
      // A failed refresh keeps what is shown and says so above it.
      state = state.items.isEmpty
          ? state.copyWith(status: ListStatus.ready, failure: () => f)
          : state.copyWith(status: ListStatus.ready, refreshFailure: () => f);
    } finally {
      if (generation == _generation) _edits = null;
    }
  }

  Future<void> setCategory(String category) async {
    if (category == state.category && state.failure == null) return;
    _urlRefreshWanted = false;
    _edits = null; // a new list: edits of the old one do not apply
    state = WardrobeListState(category: category);
    await _loadFirst();
  }

  /// Pull-to-refresh (also used to get fresh signed URLs).
  Future<void> refresh() async {
    if (state.status == ListStatus.loading || state.status == ListStatus.refreshing) return;
    state = state.copyWith(
      status: state.items.isEmpty ? ListStatus.loading : ListStatus.refreshing,
      failure: () => null,
      refreshFailure: () => null,
      loadMoreFailure: () => null,
    );
    _edits = [];
    await _loadFirst();
  }

  /// The next page. The grid calls this whenever its last tiles are built;
  /// after a failure only an explicit [retry] (the footer button) asks again,
  /// so a failing server is not hit on every rebuild.
  Future<void> loadMore({bool retry = false}) async {
    final cursor = state.nextCursor;
    if (cursor == null || state.status != ListStatus.ready) return;
    if (state.loadMoreFailure != null && !retry) return;
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
    } catch (error, stack) {
      final f = failureOf(error, stack);
      if (generation != _generation || !ref.mounted) return;
      state = state.copyWith(status: ListStatus.ready, loadMoreFailure: () => f);
    }
    if (_urlRefreshWanted) unawaited(refreshUrls());
  }

  /// Fresh signed URLs for everything already loaded, keeping every loaded
  /// page (a pull-to-refresh would go back to the first page only). One
  /// request for the loaded range (up to the contract's largest page),
  /// further pages only beyond that. [retry] (the banner's button) skips the
  /// interval.
  Future<void> refreshUrls({bool retry = false}) {
    if (_urlRefresh.running) return _urlRefresh.run(_reloadLoadedRange, later: _refreshUrlsLater);
    if (state.items.isEmpty) return Future.value();
    if (state.status != ListStatus.ready) {
      _urlRefreshWanted = true;
      return Future.value();
    }
    return _urlRefresh.run(
      () {
        _urlRefreshWanted = false;
        return _reloadLoadedRange();
      },
      later: _refreshUrlsLater,
      force: retry,
    );
  }

  void _refreshUrlsLater() {
    if (ref.mounted) unawaited(refreshUrls());
  }

  Future<void> _reloadLoadedRange() async {
    final generation = _generation;
    final category = state.category;
    final wanted = state.items.length;
    final repository = ref.read(wardrobeRepositoryProvider);
    state = state.copyWith(status: ListStatus.refreshing);
    _edits = [];
    final items = <WardrobeItem>[];
    final seen = <String>{};
    String? cursor;
    try {
      do {
        final page = await repository.list(
          category: category,
          cursor: cursor,
          limit: (wanted - items.length).clamp(WardrobeRepository.pageSize, WardrobeRepository.maxPageSize),
        );
        if (generation != _generation || !ref.mounted) return;
        items.addAll(page.items.where((i) => seen.add(i.id)));
        cursor = page.nextCursor;
      } while (cursor != null && items.length < wanted);
      state = state.copyWith(
        items: _withEdits(items),
        nextCursor: () => cursor,
        status: ListStatus.ready,
        failure: () => null,
        refreshFailure: () => null,
      );
    } catch (error, stack) {
      final f = failureOf(error, stack);
      if (generation != _generation || !ref.mounted) return;
      state = state.copyWith(status: ListStatus.ready, refreshFailure: () => f);
    } finally {
      if (generation == _generation) _edits = null;
    }
  }

  /// A new item from an upload (a replay never duplicates an item).
  void insert(WardrobeItem item) {
    if (state.category != 'all' && state.category != item.category) return;
    _edit((items) => [item, ...items.where((i) => i.id != item.id)], clearFailure: true);
  }

  /// An item changed on the server (e.g. corrected attributes).
  void replace(WardrobeItem item) => _edit((items) => [for (final i in items) i.id == item.id ? item : i]);

  void remove(String id) => _edit((items) => items.where((i) => i.id != id).toList());

  void _edit(List<WardrobeItem> Function(List<WardrobeItem>) change, {bool clearFailure = false}) {
    _edits?.add(change);
    state = state.copyWith(items: change(state.items), failure: clearFailure ? () => null : null);
  }
}
