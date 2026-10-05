import 'package:atlas_mobile/app/router.dart';
import 'package:atlas_mobile/core/session/auth_state.dart';
import 'package:atlas_mobile/core/session/session_tokens.dart';
import 'package:atlas_mobile/features/onboarding/onboarding_gate.dart';
import 'package:flutter_test/flutter_test.dart';

const _user = SessionUser(id: 'u1', email: 'a@test.local');

const _signedOut = <AuthState>[
  Unauthenticated(),
  Unauthenticated(SignedOutReason.loggedOut),
  SessionExpired(SignedOutReason.reused),
  Authenticating(),
];
const _signedIn = <AuthState>[Authenticated(_user), Refreshing(_user), LoggingOut(_user)];
const _allStates = <AuthState>[AuthRestoring(), ..._signedOut, ..._signedIn];

const _tabs = [AtlasRoutes.home, AtlasRoutes.wardrobe, AtlasRoutes.outfits, AtlasRoutes.stylist, AtlasRoutes.profile];

/// Every route, plus a full-screen route of a later phase.
const _allLocations = [
  AtlasRoutes.splash,
  AtlasRoutes.login,
  AtlasRoutes.register,
  AtlasRoutes.onboarding,
  ..._tabs,
  '/wardrobe-item/abc',
];

String _target(AuthState s, OnboardingStatus o, String loc) => authRedirect(s, o, loc) ?? loc;

void main() {
  test('no loops: for every state × onboarding status × location the target is stable', () {
    for (final s in _allStates) {
      for (final o in OnboardingStatus.values) {
        for (final loc in _allLocations) {
          final target = _target(s, o, loc);
          expect(authRedirect(s, o, target), isNull, reason: '$s/$o: $loc → $target → …');
          expect(_allLocations, contains(target));
        }
      }
    }
  });

  test('restoring → splash, whatever the onboarding status', () {
    for (final o in OnboardingStatus.values) {
      for (final loc in _allLocations) {
        expect(_target(const AuthRestoring(), o, loc), AtlasRoutes.splash);
      }
    }
  });

  test('signed out → only login/register (onboarding and full-screen routes included)', () {
    for (final s in _signedOut) {
      for (final o in OnboardingStatus.values) {
        for (final loc in _allLocations) {
          expect([AtlasRoutes.login, AtlasRoutes.register], contains(_target(s, o, loc)), reason: '$s/$o @ $loc');
        }
      }
    }
  });

  test('signed in, decision pending → splash', () {
    for (final s in _signedIn) {
      for (final o in [OnboardingStatus.none, OnboardingStatus.checking]) {
        for (final loc in _allLocations) {
          expect(_target(s, o, loc), AtlasRoutes.splash, reason: '$s/$o @ $loc');
        }
      }
    }
  });

  test('signed in, onboarding required → onboarding from everywhere', () {
    for (final s in _signedIn) {
      for (final loc in _allLocations) {
        expect(_target(s, OnboardingStatus.required, loc), AtlasRoutes.onboarding, reason: '$s @ $loc');
      }
    }
  });

  test('signed in, onboarding done → never splash, auth pages or onboarding; tabs and full-screen routes stay', () {
    for (final s in _signedIn) {
      for (final loc in [AtlasRoutes.splash, AtlasRoutes.login, AtlasRoutes.register, AtlasRoutes.onboarding]) {
        expect(_target(s, OnboardingStatus.notRequired, loc), AtlasRoutes.home);
      }
      for (final loc in [..._tabs, '/wardrobe-item/abc']) {
        expect(authRedirect(s, OnboardingStatus.notRequired, loc), isNull);
      }
    }
  });

  test('a token refresh never moves the user (Authenticated ↔ Refreshing)', () {
    for (final o in OnboardingStatus.values) {
      for (final loc in _allLocations) {
        expect(
          _target(const Refreshing(_user), o, loc),
          _target(const Authenticated(_user), o, loc),
          reason: '$o @ $loc',
        );
      }
    }
  });

  test('a terminal session error leaves onboarding for sign-in', () {
    expect(
      _target(const SessionExpired(SignedOutReason.revoked), OnboardingStatus.required, AtlasRoutes.onboarding),
      AtlasRoutes.login,
    );
  });
}
