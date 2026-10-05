import 'dart:convert';

import 'package:atlas_api/atlas_api.dart' show MobileAuthResponse;
import 'package:flutter/foundation.dart';

/// `SessionUser` of the contract (login / register / refresh responses).
@immutable
class SessionUser {
  const SessionUser({required this.id, required this.email, this.name});

  final String id;
  final String email;
  final String? name;

  Map<String, Object?> toJson() => {'id': id, 'email': email, 'name': name};

  static SessionUser fromJson(Map<String, Object?> json) =>
      SessionUser(id: json['id']! as String, email: json['email']! as String, name: json['name'] as String?);

  @override
  bool operator ==(Object other) =>
      other is SessionUser && other.id == id && other.email == email && other.name == name;
  @override
  int get hashCode => Object.hash(id, email, name);

  @override
  String toString() => 'SessionUser($id)';
}

/// One complete mobile session as issued by login, register or refresh
/// (`MobileAuthResponse`). The access and refresh tokens are ONE pair: they
/// are stored, replaced and deleted together, never individually.
///
/// The three expiries are the server's absolute times (UTC). The server is
/// authoritative; [serverClockOffset] (server time − device time, measured
/// from the response `Date` header) lets the app judge them with a device
/// clock that may be wrong.
@immutable
class SessionTokens {
  const SessionTokens({
    required this.user,
    required this.accessToken,
    required this.accessTokenExpiresAt,
    required this.refreshToken,
    required this.refreshTokenExpiresAt,
    required this.sessionExpiresAt,
    this.serverClockOffset = Duration.zero,
    this.accessTokenIssuedAt,
  });

  /// Schema version of the stored JSON.
  static const storageVersion = 1;

  /// Refresh up to this long before the access token expires (request
  /// latency and clock granularity) — at most a quarter of the token's
  /// lifetime, so a short-lived token is not refreshed before every request.
  static const accessExpirySkew = Duration(seconds: 30);

  final SessionUser user;
  final String accessToken;
  final DateTime accessTokenExpiresAt;
  final String refreshToken;
  final DateTime refreshTokenExpiresAt;

  /// The login's absolute limit (90 days from login). Rotation never extends
  /// it.
  final DateTime sessionExpiresAt;
  final Duration serverClockOffset;

  /// Server time when the access token was received (derived, not a
  /// contract field); sizes the refresh margin.
  final DateTime? accessTokenIssuedAt;

  /// Builds the pair from a mobile auth response. [serverDate] is the
  /// response's `Date` header and [receivedAt] the device time it arrived.
  static SessionTokens fromMobileAuth(MobileAuthResponse r, {DateTime? serverDate, required DateTime receivedAt}) =>
      SessionTokens(
        user: SessionUser(id: r.user.id, email: r.user.email, name: r.user.name),
        accessToken: r.accessToken,
        accessTokenExpiresAt: r.accessTokenExpiresAt.toUtc(),
        refreshToken: r.refreshToken,
        refreshTokenExpiresAt: r.refreshTokenExpiresAt.toUtc(),
        sessionExpiresAt: r.sessionExpiresAt.toUtc(),
        serverClockOffset: serverDate == null ? Duration.zero : serverDate.toUtc().difference(receivedAt.toUtc()),
        accessTokenIssuedAt: (serverDate ?? receivedAt).toUtc(),
      );

  DateTime _serverNow(DateTime deviceNow) => deviceNow.toUtc().add(serverClockOffset);

  /// The margin before [accessTokenExpiresAt] at which the token is renewed.
  Duration get refreshMargin {
    final issued = accessTokenIssuedAt;
    if (issued == null) return accessExpirySkew;
    final quarter = accessTokenExpiresAt.difference(issued) ~/ 4;
    if (quarter.isNegative) return Duration.zero;
    return quarter < accessExpirySkew ? quarter : accessExpirySkew;
  }

  /// The access token can still be sent (with [refreshMargin] to spare).
  bool accessUsableAt(DateTime deviceNow) =>
      _serverNow(deviceNow).isBefore(accessTokenExpiresAt.subtract(refreshMargin));

  /// The login's 90-day limit has passed: refresh is impossible.
  bool sessionExpiredAt(DateTime deviceNow) => !_serverNow(deviceNow).isBefore(sessionExpiresAt);

  bool refreshExpiredAt(DateTime deviceNow) => !_serverNow(deviceNow).isBefore(refreshTokenExpiresAt);

  /// Nothing in this pair can ever be used again.
  bool unusableAt(DateTime deviceNow) =>
      sessionExpiredAt(deviceNow) || (refreshExpiredAt(deviceNow) && !accessUsableAt(deviceNow));

  String encode() => jsonEncode({
    'v': storageVersion,
    'user': user.toJson(),
    'accessToken': accessToken,
    'accessTokenExpiresAt': accessTokenExpiresAt.toIso8601String(),
    'refreshToken': refreshToken,
    'refreshTokenExpiresAt': refreshTokenExpiresAt.toIso8601String(),
    'sessionExpiresAt': sessionExpiresAt.toIso8601String(),
    'serverClockOffsetMs': serverClockOffset.inMilliseconds,
    'accessTokenIssuedAt': accessTokenIssuedAt?.toIso8601String(),
  });

  /// Parses [encode]'s output. Throws [FormatException] for anything else.
  static SessionTokens decode(String raw) {
    try {
      final json = jsonDecode(raw) as Map<String, Object?>;
      if (json['v'] != storageVersion) throw const FormatException('unsupported session version');
      final access = json['accessToken']! as String;
      final refresh = json['refreshToken']! as String;
      if (access.isEmpty || refresh.isEmpty) throw const FormatException('empty token');
      return SessionTokens(
        user: SessionUser.fromJson(json['user']! as Map<String, Object?>),
        accessToken: access,
        accessTokenExpiresAt: DateTime.parse(json['accessTokenExpiresAt']! as String).toUtc(),
        refreshToken: refresh,
        refreshTokenExpiresAt: DateTime.parse(json['refreshTokenExpiresAt']! as String).toUtc(),
        sessionExpiresAt: DateTime.parse(json['sessionExpiresAt']! as String).toUtc(),
        serverClockOffset: Duration(milliseconds: (json['serverClockOffsetMs'] as int?) ?? 0),
        accessTokenIssuedAt: json['accessTokenIssuedAt'] == null
            ? null
            : DateTime.parse(json['accessTokenIssuedAt']! as String).toUtc(),
      );
    } on FormatException {
      rethrow;
    } on Object {
      // Wrong types, missing fields: the same thing to the caller.
      throw const FormatException('malformed stored session');
    }
  }

  /// Same pair (the refresh token identifies it).
  bool samePairAs(SessionTokens other) => other.refreshToken == refreshToken && other.accessToken == accessToken;

  /// Never prints a token.
  @override
  String toString() =>
      'SessionTokens(user: ${user.id}, access until $accessTokenExpiresAt, session until $sessionExpiresAt)';
}
