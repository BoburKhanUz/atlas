import 'package:flutter/foundation.dart';

import 'session_tokens.dart';
import 'signed_out_reason.dart';

export 'signed_out_reason.dart';

/// The one authoritative authentication state. Screens and the router read
/// it; nothing else decides whether the user is signed in.
@immutable
sealed class AuthState {
  const AuthState();

  /// The user may see the signed-in part of the app.
  bool get hasSession => false;

  SessionUser? get user => null;
}

/// Startup: secure storage is being read / the stored session checked.
final class AuthRestoring extends AuthState {
  const AuthRestoring();
  @override
  String toString() => 'AuthRestoring';
}

/// No session. [reason] explains why (shown on the sign-in screen).
final class Unauthenticated extends AuthState {
  const Unauthenticated([this.reason = SignedOutReason.none]);
  final SignedOutReason reason;
  @override
  bool operator ==(Object other) => other is Unauthenticated && other.reason == reason;
  @override
  int get hashCode => reason.hashCode;
  @override
  String toString() => 'Unauthenticated($reason)';
}

/// The session ended on the server side (terminal code, race twice, local
/// 90-day limit). Same screen as [Unauthenticated], with an explanation.
final class SessionExpired extends AuthState {
  const SessionExpired(this.reason);
  final SignedOutReason reason;
  @override
  bool operator ==(Object other) => other is SessionExpired && other.reason == reason;
  @override
  int get hashCode => reason.hashCode;
  @override
  String toString() => 'SessionExpired($reason)';
}

/// Login or registration in progress.
final class Authenticating extends AuthState {
  const Authenticating();
  @override
  String toString() => 'Authenticating';
}

/// Signed in with a stored session.
final class Authenticated extends AuthState {
  const Authenticated(this.user);
  @override
  final SessionUser user;
  @override
  bool get hasSession => true;
  @override
  bool operator ==(Object other) => other is Authenticated && other.user == user;
  @override
  int get hashCode => user.hashCode;
  @override
  String toString() => 'Authenticated(${user.id})';
}

/// Signed in; the access token is being renewed (requests wait for it).
final class Refreshing extends AuthState {
  const Refreshing(this.user);
  @override
  final SessionUser user;
  @override
  bool get hasSession => true;
  @override
  bool operator ==(Object other) => other is Refreshing && other.user == user;
  @override
  int get hashCode => user.hashCode;
  @override
  String toString() => 'Refreshing(${user.id})';
}

/// Signing out: the access token is already gone from memory.
final class LoggingOut extends AuthState {
  const LoggingOut(this.user);
  @override
  final SessionUser user;
  @override
  bool get hasSession => true;
  @override
  String toString() => 'LoggingOut(${user.id})';
}
