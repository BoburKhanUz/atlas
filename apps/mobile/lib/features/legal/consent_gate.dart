import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../core/logging/app_log.dart';
import '../../core/session/auth_state.dart';
import '../../core/session/session_controller.dart';

/// Whether the signed-in user must accept changed legal texts first.
enum ConsentStatus {
  /// No session (the auth state decides everything).
  none,

  /// Signed in; asking the server (splash).
  checking,

  /// Show the consent screen: the server refuses everything else.
  required,

  /// Go on to the app.
  notRequired,
}

/// Decides, once per signed-in user, whether the changed privacy policy or
/// terms must be accepted before the app can be used (`consentRequired` of
/// GET /api/v1/auth/me). A failed check (offline, timeout) lets the user in:
/// the server refuses every request until the texts are accepted, and any
/// such refusal ([refusals], from the HTTP layer) turns the gate on.
class ConsentGate extends ChangeNotifier {
  ConsentGate({
    required this._session,
    required this._consentRequired,
    required Stream<void> refusals,
    this.checkTimeout = const Duration(seconds: 6),
  }) {
    _session.addListener(_onSession);
    _refusals = refusals.listen((_) => _onRefusal());
    _onSession();
  }

  final SessionController _session;
  final Future<bool> Function() _consentRequired;
  late final StreamSubscription<void> _refusals;
  final Duration checkTimeout;

  ConsentStatus _status = ConsentStatus.none;
  String? _userId;
  int _check = 0;
  bool _disposed = false;

  ConsentStatus get status => _status;

  void _set(ConsentStatus next) {
    if (_disposed || next == _status) return;
    _status = next;
    notifyListeners();
  }

  bool get _signedIn => _session.state is Authenticated || _session.state is Refreshing;

  void _onSession() {
    final state = _session.state;
    final user = state.hasSession ? state.user : null;
    if (user == null) {
      _userId = null;
      _check++;
      _set(ConsentStatus.none);
      return;
    }
    if (user.id == _userId) return;
    _userId = user.id;
    final check = ++_check;
    _set(ConsentStatus.checking);
    unawaited(_decide(check));
  }

  Future<void> _decide(int check) async {
    var required = false;
    try {
      required = await _consentRequired().timeout(checkTimeout);
    } on Object catch (e) {
      AppLog.info('consent check skipped (${e.runtimeType})');
    }
    if (check != _check || !_signedIn) return;
    _set(required ? ConsentStatus.required : ConsentStatus.notRequired);
  }

  void _onRefusal() {
    if (_userId == null || !_signedIn) return;
    _check++;
    _set(ConsentStatus.required);
  }

  /// The current texts were accepted (POST /api/v1/legal/consent succeeded).
  void markAccepted() {
    if (_userId == null) return;
    _check++;
    _set(ConsentStatus.notRequired);
  }

  @override
  void dispose() {
    _disposed = true;
    _session.removeListener(_onSession);
    unawaited(_refusals.cancel());
    super.dispose();
  }
}
