import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../core/logging/app_log.dart';
import '../../core/session/auth_state.dart';
import '../../core/session/session_controller.dart';
import '../legal/consent_gate.dart';
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
/// account has no style or colour preferences on the server → yes. The
/// server is asked only once [ConsentGate] lets the user in: until changed
/// legal texts are accepted it refuses every request, and a refusal must not
/// read as "no onboarding". Any failure (offline, timeout) → no: the user is
/// never blocked. A refresh or a request never changes the decision; only a
/// different user (or the end of the session) does.
class OnboardingGate extends ChangeNotifier {
  OnboardingGate({
    required this._session,
    required this._consent,
    required this._markers,
    required this._hasStylePreferences,
    this.checkTimeout = const Duration(seconds: 6),
  }) {
    _session.addListener(_onSession);
    _consent.addListener(_askServer);
    _onSession();
  }

  final SessionController _session;
  final ConsentGate _consent;
  final OnboardingMarkerStore _markers;
  final Future<bool> Function() _hasStylePreferences;
  final Duration checkTimeout;

  OnboardingStatus _status = OnboardingStatus.none;
  String? _userId;
  int _check = 0;

  /// The check that waits for [_consent] before asking the server.
  int? _waiting;
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

  bool get _signedIn => _session.state is Authenticated || _session.state is Refreshing;

  Future<void> _decide(String userId, int check) async {
    if (await _markers.read(userId) != null) {
      if (check == _check && _signedIn) _set(OnboardingStatus.notRequired);
      return;
    }
    if (check != _check) return;
    _waiting = check;
    _askServer();
  }

  void _askServer() {
    final check = _waiting;
    if (check == null || check != _check || _consent.status != ConsentStatus.notRequired) return;
    _waiting = null;
    unawaited(_decideFromServer(check));
  }

  Future<void> _decideFromServer(int check) async {
    var required = false;
    try {
      required = !await _hasStylePreferences().timeout(checkTimeout);
    } on Object catch (e) {
      AppLog.info('onboarding check skipped (${e.runtimeType})');
    }
    if (check != _check || !_signedIn) return;
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
    _consent.removeListener(_askServer);
    super.dispose();
  }
}
