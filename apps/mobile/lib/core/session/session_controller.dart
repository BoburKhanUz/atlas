import 'dart:async';
import 'dart:io' show HttpDate;
import 'dart:math';

import 'package:atlas_api/atlas_api.dart'
    show AtlasApi, AuthApi, AuthResponse, LoginRequest, MobileLogoutRequest, MobileRefreshRequest, RegisterRequest;
import 'package:built_value/serializer.dart' show DeserializationError;
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../config/environment_config.dart';
import '../logging/app_log.dart';
import '../network/access_token_source.dart';
import '../network/api_error_code.dart';
import '../network/api_failure.dart';
import '../network/auth_response_x.dart';
import '../network/connectivity.dart';
import '../network/error_mapper.dart';
import '../network/interceptors.dart';
import 'auth_state.dart';
import 'recovery.dart';
import 'session_tokens.dart';
import 'token_store.dart';

/// The Dio used for login, register, refresh and logout: contract headers,
/// logging and reachability, but no Bearer, no automatic retries and no
/// session interceptor (recovery runs its own bounded episode, and a refresh
/// must never trigger another refresh).
Dio buildSessionDio({
  required AtlasEnvironmentConfig config,
  required ApiReachability reachability,
  HttpClientAdapter? adapter,
}) {
  final dio = Dio(
    BaseOptions(
      baseUrl: config.apiBaseUrl.toString(),
      connectTimeout: config.timeouts.connect,
      sendTimeout: config.timeouts.refresh,
      receiveTimeout: config.timeouts.refresh,
      headers: {'X-Atlas-Client': 'mobile'},
      validateStatus: (status) => status != null && status >= 200 && status < 300,
      followRedirects: false,
    ),
  );
  if (adapter != null) dio.httpClientAdapter = adapter;
  dio.interceptors.addAll([
    AtlasClientHeadersInterceptor(),
    AtlasLoggingInterceptor(),
    AtlasReachabilityInterceptor(reachability),
  ]);
  return dio;
}

/// Owns the session: the one [AuthState], the active token pair, secure
/// storage, login / register / logout, startup restoration and the
/// single-flight refresh coordinator (client-recovery-vectors.json).
///
/// Tokens never leave this class except as the Bearer value
/// ([currentAccessToken]) and the refresh/logout request bodies.
class SessionController extends ChangeNotifier implements AccessTokenSource {
  SessionController({
    required AtlasEnvironmentConfig config,
    required this._store,
    required this._network,
    required ApiReachability reachability,
    HttpClientAdapter? adapter,
    Future<void> Function(Duration)? sleep,
    Duration Function()? monotonicNow,
    DateTime Function()? clock,
    Random? random,
    this.deviceName,
    this.startupWait = const Duration(seconds: 8),
  }) : _config = config,
       _sleep = sleep ?? Future<void>.delayed,
       _now = monotonicNow ?? _stopwatchClock(),
       _clock = clock ?? DateTime.now,
       _random = random ?? Random() {
    _auth = AtlasApi(
      dio: buildSessionDio(config: config, reachability: reachability, adapter: adapter),
      interceptors: const [],
    ).getAuthApi();
  }

  static Duration Function() _stopwatchClock() {
    final watch = Stopwatch()..start();
    return () => watch.elapsed;
  }

  final AtlasEnvironmentConfig _config;
  final TokenStore _store;
  final DeviceNetwork _network;
  final Future<void> Function(Duration) _sleep;
  final Duration Function() _now;
  final DateTime Function() _clock;
  final Random _random;
  late final AuthApi _auth;

  /// Optional `deviceName` for login/register (shown in the session list).
  final String? deviceName;

  /// The splash screen waits at most this long for a startup refresh.
  final Duration startupWait;

  AuthState _state = const AuthRestoring();
  SessionTokens? _tokens;
  int _generation = 0;
  int _sessionEpoch = 0;
  SignedOutReason _endReason = SignedOutReason.none;
  Future<EpisodeResult>? _inFlight;
  Duration? _coolDownUntil;
  EpisodeResult? _coolDownResult;
  SessionTokens? _lastPresented;
  CancelToken _requests = CancelToken();
  bool _disposed = false;

  AuthState get state => _state;

  /// Incremented every time a different token pair becomes active (or the
  /// session ends). A request remembers the generation it was sent with.
  int get generation => _generation;

  /// Cancelled when the session ends: authenticated requests still running
  /// with the old token are abandoned.
  CancelToken get requestCancelToken => _requests;

  @override
  Future<String?> currentAccessToken() async => _tokens?.accessToken;

  void _setState(AuthState next) {
    if (_disposed || next == _state) return;
    AppLog.info('auth state: $next');
    _state = next;
    notifyListeners();
  }

  void _activate(SessionTokens tokens) {
    _tokens = tokens;
    _generation++;
  }

  /// Ends the session locally: memory first (no request can pick up the old
  /// token any more), then secure storage. Never calls the server.
  Future<void> _endLocally(AuthState next, SignedOutReason reason) async {
    _tokens = null;
    _generation++;
    _sessionEpoch++;
    _endReason = reason;
    _coolDownUntil = null;
    _coolDownResult = null;
    // Requests still running with the old token fail as "session ended".
    _requests.cancel(SessionEndedFailure(reason));
    _requests = CancelToken();
    try {
      await _store.clear();
    } on TokenStorageException catch (e) {
      AppLog.warn('could not delete the stored session ($e)');
    }
    _setState(next);
  }

  // ─── Startup ──────────────────────────────────────────────────────────────

  /// Restores the stored session. Never waits longer than [startupWait] for
  /// the network; never deletes a session because the network is down.
  Future<void> restore() async {
    final SessionTokens? stored;
    try {
      stored = await _store.read();
    } on TokenStorageException catch (e) {
      // Do not delete: the session may be fine once storage is available.
      AppLog.warn('session restore failed ($e)');
      _endReason = SignedOutReason.storageUnavailable;
      _setState(const Unauthenticated(SignedOutReason.storageUnavailable));
      return;
    }
    if (stored == null) {
      _setState(const Unauthenticated());
      return;
    }
    final now = _clock();
    if (stored.unusableAt(now)) {
      await _endLocally(const SessionExpired(SignedOutReason.expired), SignedOutReason.expired);
      return;
    }
    _sessionEpoch++;
    _activate(stored);
    if (stored.accessUsableAt(now) || !await _network.hasNetwork()) {
      // Offline with an expired access token: keep the session; the first
      // request after the network returns refreshes it.
      _setState(Authenticated(stored.user));
      return;
    }
    final episode = _recover(sentGeneration: _generation);
    final result = await Future.any<EpisodeResult?>([episode, Future<EpisodeResult?>.delayed(startupWait, () => null)]);
    if (result is EpisodeLoginRequired) return; // already SessionExpired
    final tokens = _tokens;
    if (_state is AuthRestoring && tokens != null) _setState(Authenticated(tokens.user));
  }

  // ─── Login / register ─────────────────────────────────────────────────────

  /// POST /api/v1/auth/login (mobile mode). Throws [ApiFailure]. The state
  /// becomes [Authenticated] only after the pair is saved securely.
  Future<void> login({required String email, required String password}) => _signIn(
    () => _auth.login(
      xAtlasClient: 'mobile',
      loginRequest: LoginRequest(
        (b) => b
          ..email = email
          ..password = password
          ..deviceName = deviceName,
      ),
    ),
  );

  /// POST /api/v1/auth/register (mobile mode): 201 with a mobile session,
  /// handled exactly like login.
  Future<void> register({required String email, required String password, String? name}) => _signIn(
    () => _auth.register(
      xAtlasClient: 'mobile',
      registerRequest: RegisterRequest(
        (b) => b
          ..email = email
          ..password = password
          ..name = name
          ..deviceName = deviceName,
      ),
    ),
  );

  Future<void> _signIn(Future<Response<AuthResponse>> Function() call) async {
    if (_state.hasSession) throw StateError('already signed in');
    if (_state is Authenticating) throw StateError('sign-in already in progress');
    final previous = _state;
    _setState(const Authenticating());
    try {
      final Response<AuthResponse> response;
      try {
        response = await call();
      } on DioException catch (e) {
        throw await _failureOf(e);
      }
      final mobile = response.data?.mobile;
      if (mobile == null) {
        throw UnexpectedResponseFailure(statusCode: response.statusCode, reason: 'no session tokens in the response');
      }
      final tokens = SessionTokens.fromMobileAuth(
        mobile,
        serverDate: _serverDate(response.headers),
        receivedAt: _clock(),
      );
      try {
        await _store.save(tokens);
      } on TokenStorageException catch (e) {
        AppLog.warn('new session could not be saved ($e)');
        // Do not leave an unusable session behind on the server.
        unawaited(_serverLogout(tokens.refreshToken));
        throw const SecureStorageFailure('write');
      }
      _sessionEpoch++;
      _coolDownUntil = null;
      _coolDownResult = null;
      _endReason = SignedOutReason.none;
      _activate(tokens);
      _setState(Authenticated(tokens.user));
    } on Object {
      _setState(previous);
      rethrow;
    }
  }

  // ─── Logout ───────────────────────────────────────────────────────────────

  /// Signs out: drops the tokens from memory at once, tells the server
  /// (best effort, bounded), then deletes them from secure storage — also
  /// when the server cannot be reached.
  Future<void> logout() async {
    final tokens = _tokens;
    final user = _state.user;
    if (tokens == null || user == null) {
      await _endLocally(const Unauthenticated(SignedOutReason.loggedOut), SignedOutReason.loggedOut);
      return;
    }
    _tokens = null;
    _generation++;
    _sessionEpoch++;
    _requests.cancel(const SessionEndedFailure(SignedOutReason.loggedOut));
    _requests = CancelToken();
    _setState(LoggingOut(user));
    try {
      if (await _network.hasNetwork()) await _serverLogout(tokens.refreshToken);
    } finally {
      await _endLocally(const Unauthenticated(SignedOutReason.loggedOut), SignedOutReason.loggedOut);
    }
  }

  /// After a CONFIRMED account deletion (DELETE /api/v1/account answered
  /// 200, or 404 = already gone): the server has already deleted every
  /// session of the account, so /auth/logout is NOT called. Drops the
  /// tokens from memory and secure storage and signs out with
  /// [SignedOutReason.accountDeleted]. Only the account-deletion flow calls
  /// this.
  Future<void> endAfterAccountDeletion() =>
      _endLocally(const Unauthenticated(SignedOutReason.accountDeleted), SignedOutReason.accountDeleted);

  /// POST /api/v1/auth/logout with `{ refreshToken }` (revokes the whole
  /// session family). One retry on SESSION_BUSY. Never throws.
  Future<void> _serverLogout(String refreshToken) async {
    for (var attempt = 0; attempt < 2; attempt++) {
      try {
        await _withDeadline(
          (cancel) => _auth.logout(
            xAtlasClient: 'mobile',
            mobileLogoutRequest: MobileLogoutRequest((b) => b..refreshToken = refreshToken),
            cancelToken: cancel,
          ),
        );
        return;
      } on DioException catch (e) {
        final failure = await _failureOf(e);
        final busy = failure is ApiHttpFailure && failure.code == ApiErrorCode.sessionBusy;
        final wait = failure.retryAfter ?? RecoveryRules.busyDefaultRetryAfter;
        if (!busy || attempt > 0 || wait > const Duration(seconds: 2)) {
          AppLog.warn('logout not confirmed by the server: ${failure.describe()}');
          return;
        }
        await _sleep(wait);
      } on Object catch (e) {
        AppLog.warn('logout not confirmed by the server: ${e.runtimeType}');
        return;
      }
    }
  }

  // ─── Refresh / recovery ───────────────────────────────────────────────────

  /// Null when the access token can be sent now; otherwise refreshes it
  /// first (single flight) and returns the failure if that did not work.
  Future<ApiFailure?> ensureAccess() async {
    final tokens = _tokens;
    if (tokens == null) return SessionEndedFailure(_endReason);
    if (tokens.accessUsableAt(_clock())) return null;
    return failureFor(await recover(sentGeneration: _generation));
  }

  /// Recovers after a 401 (or an expired access token). Concurrent callers
  /// share one episode; a caller whose request used an older pair than the
  /// active one just retries. [retryOriginal] re-sends the caller's request
  /// (used as the probe on the SESSION_RACE path).
  Future<EpisodeResult> recover({required int sentGeneration, Future<Object> Function()? retryOriginal}) async {
    if (_tokens == null) return EpisodeLoginRequired(_endReason);
    return _recover(sentGeneration: sentGeneration, retryOriginal: retryOriginal);
  }

  Future<EpisodeResult> _recover({required int sentGeneration, Future<Object> Function()? retryOriginal}) async {
    if (sentGeneration != _generation) return const EpisodeRecovered();
    final inFlight = _inFlight;
    if (inFlight != null) {
      final shared = await inFlight;
      // A probe answer belongs to the caller that started the episode.
      return shared is EpisodeRecovered ? const EpisodeRecovered() : shared;
    }
    final until = _coolDownUntil;
    if (until != null && _now() < until && _coolDownResult != null) return _coolDownResult!;
    final episode = _runEpisode(retryOriginal);
    _inFlight = episode;
    try {
      return await episode;
    } finally {
      if (identical(_inFlight, episode)) _inFlight = null;
    }
  }

  Future<EpisodeResult> _runEpisode(Future<Object> Function()? retryOriginal) async {
    final epoch = _sessionEpoch;
    final user = _tokens?.user;
    if (_state is Authenticated && user != null) _setState(Refreshing(user));
    final result = await runRecoveryEpisode(
      EpisodeDeps(
        refresh: () => _refreshOnce(epoch),
        adoptNewerStoredPair: _adoptNewerStoredPair,
        retryOriginal: retryOriginal,
        sleep: _sleep,
        now: _now,
        random: _random,
      ),
    );
    AppLog.info('session recovery: ${result.runtimeType}');
    if (epoch != _sessionEpoch) return result; // logged out meanwhile
    switch (result) {
      case EpisodeLoginRequired(:final reason):
        // Never call logout because of a failure (recovery vectors).
        await _endLocally(SessionExpired(reason), reason);
        return result;
      case EpisodeBusy() || EpisodeOffline():
        _coolDownUntil = _now() + RecoveryRules.coolDownAfterFailedEpisode;
        _coolDownResult = result;
      case EpisodeRecovered() || EpisodeStorageFailure():
        break;
    }
    final tokens = _tokens;
    if (_state is Refreshing && tokens != null) _setState(Authenticated(tokens.user));
    return result;
  }

  /// One POST /api/v1/auth/refresh with the latest stored refresh token.
  Future<RefreshOutcome> _refreshOnce(int epoch) async {
    var current = _tokens;
    try {
      final stored = await _store.read();
      if (stored != null && (current == null || !stored.samePairAs(current))) {
        _activate(stored);
        current = stored;
      }
    } on TokenStorageException catch (e) {
      AppLog.warn('refresh: secure storage unreadable, using the pair in memory ($e)');
    }
    if (current == null || epoch != _sessionEpoch) {
      return RefreshRejected(_endReason, SessionEndedFailure(_endReason));
    }
    final presented = current;
    _lastPresented = presented;
    final Response<AuthResponse> response;
    try {
      response = await _withDeadline(
        (cancel) => _auth.refreshSession(
          xAtlasClient: 'mobile',
          mobileRefreshRequest: MobileRefreshRequest((b) => b..refreshToken = presented.refreshToken),
          cancelToken: cancel,
        ),
      );
    } on DioException catch (e) {
      return classifyRefreshFailure(await _failureOf(e));
    }
    final mobile = response.data?.mobile;
    if (mobile == null) {
      // A 200 without tokens: the server may have rotated; presenting the
      // same token again within 60 s is a grace replay.
      return RefreshNetworkError(
        UnexpectedResponseFailure(statusCode: response.statusCode, reason: 'no session tokens in the response'),
      );
    }
    final next = SessionTokens.fromMobileAuth(mobile, serverDate: _serverDate(response.headers), receivedAt: _clock());
    if (epoch != _sessionEpoch) return RefreshRejected(_endReason, SessionEndedFailure(_endReason));
    try {
      await _store.save(next); // the complete new pair, before it is used
    } on TokenStorageException catch (e) {
      AppLog.warn('refreshed session could not be saved; keeping the previous pair ($e)');
      return const RefreshNotSaved();
    }
    if (epoch != _sessionEpoch) return RefreshRejected(_endReason, SessionEndedFailure(_endReason));
    _activate(next); // only now is the old pair dropped from memory
    return RefreshSucceeded(next);
  }

  /// After SESSION_RACE: does secure storage hold a newer pair than the one
  /// just presented? If so it becomes the active pair.
  Future<bool> _adoptNewerStoredPair() async {
    final SessionTokens? stored;
    try {
      stored = await _store.read();
    } on TokenStorageException {
      return false;
    }
    final presented = _lastPresented;
    if (stored == null || presented == null || stored.refreshToken == presented.refreshToken) return false;
    _activate(stored);
    return true;
  }

  /// The failure a request gets when recovery did not make its session
  /// usable again (null: recovered).
  ApiFailure? failureFor(EpisodeResult result) => switch (result) {
    EpisodeRecovered() => null,
    EpisodeLoginRequired(:final reason) => SessionEndedFailure(reason),
    EpisodeBusy(:final failure) || EpisodeOffline(:final failure) => failure,
    EpisodeStorageFailure() => const SecureStorageFailure('write'),
  };

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /// Runs one auth call with an overall deadline (the refresh timeout); a
  /// call cut off by the deadline is a timeout.
  Future<T> _withDeadline<T>(Future<T> Function(CancelToken cancel) call) async {
    final cancel = CancelToken();
    var timedOut = false;
    final timer = Timer(_config.timeouts.refresh, () {
      timedOut = true;
      cancel.cancel('deadline');
    });
    try {
      return await call(cancel);
    } on DioException catch (e) {
      if (timedOut && e.type == DioExceptionType.cancel) {
        throw DioException(
          requestOptions: e.requestOptions,
          type: DioExceptionType.receiveTimeout,
          error: const TimeoutFailure('deadline'),
        );
      }
      rethrow;
    } finally {
      timer.cancel();
    }
  }

  Future<ApiFailure> _failureOf(DioException e) async {
    final cause = e.error;
    if (cause is DeserializationError) {
      return UnexpectedResponseFailure(
        statusCode: e.response?.statusCode,
        reason: 'response does not match the contract',
      );
    }
    if (cause is Error) Error.throwWithStackTrace(cause, e.stackTrace);
    return ApiErrorMapper.fromDio(e, deviceHasNetwork: await _network.hasNetwork());
  }

  static DateTime? _serverDate(Headers headers) {
    final raw = headers.value('date');
    if (raw == null) return null;
    try {
      return HttpDate.parse(raw);
    } on Object {
      return null;
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _requests.cancel('disposed');
    super.dispose();
  }
}
