import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../core/logging/app_log.dart';
import '../../core/session/auth_state.dart';
import '../../core/session/session_controller.dart';
import 'data/onboarding_marker_store.dart';

/// Whether the signed-in user should see onboarding.
enum OnboardingStatus {
  /// No session (the auth state decides everything).
  none,

  /// Signed in; checking the marker / server preferences (splash).
  checking,

  /// Show onboarding.
  required,

  /// Go to the app.
  notRequired,
}

/// Decides, once per signed-in user, whether onboarding is shown:
/// a local "completed/skipped" marker for this user → no; otherwise the
/// account has no style or colour preferences on the server → yes. Any
/// failure (offline, timeout) → no: the user is never blocked. A refresh or
/// a request never changes the decision; only a different user (or the end
/// of the session) does.
class OnboardingGate extends ChangeNotifier {
  OnboardingGate({
    required this._session,
    required this._markers,
    required this._hasStylePreferences,
    this.checkTimeout = const Duration(seconds: 6),
  }) {
    _session.addListener(_onSession);
    _onSession();
  }

  final SessionController _session;
  final OnboardingMarkerStore _markers;
  final Future<bool> Function() _hasStylePreferences;
  final Duration checkTimeout;

  OnboardingStatus _status = OnboardingStatus.none;
  String? _userId;
  int _check = 0;
  bool _disposed = false;

  OnboardingStatus get status => _status;

  void _set(OnboardingStatus next) {
    if (_disposed || next == _status) return;
    _status = next;
    notifyListeners();
  }

  void _onSession() {
    final state = _session.state;
    final user = state.hasSession ? state.user : null;
    if (user == null) {
      // Restoring keeps the previous decision out of the way too.
      _userId = null;
      _check++;
      _set(OnboardingStatus.none);
      return;
    }
    if (user.id == _userId) return;
    _userId = user.id;
    final check = ++_check;
    _set(OnboardingStatus.checking);
    unawaited(_decide(user.id, check));
  }

  Future<void> _decide(String userId, int check) async {
    var required = false;
    if (await _markers.read(userId) == null) {
      try {
        required = !await _hasStylePreferences().timeout(checkTimeout);
      } on Object catch (e) {
        AppLog.info('onboarding check skipped (${e.runtimeType})');
      }
    }
    if (check != _check || _session.state is! Authenticated && _session.state is! Refreshing) return;
    _set(required ? OnboardingStatus.required : OnboardingStatus.notRequired);
  }

  /// Onboarding finished or was skipped for the current user.
  Future<void> markDone(OnboardingMarker marker) async {
    final userId = _userId;
    if (userId == null) return;
    _check++;
    _set(OnboardingStatus.notRequired);
    await _markers.write(userId, marker);
  }

  @override
  void dispose() {
    _disposed = true;
    _session.removeListener(_onSession);
    super.dispose();
  }
}
