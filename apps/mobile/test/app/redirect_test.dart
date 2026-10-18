import 'package:atlas_mobile/app/router.dart';
import 'package:atlas_mobile/core/session/auth_state.dart';
import 'package:atlas_mobile/core/session/session_tokens.dart';
import 'package:atlas_mobile/features/legal/consent_gate.dart';
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
const _legal = [AtlasRoutes.privacy, AtlasRoutes.terms];

/// Every route, plus a full-screen route of a later phase.
const _allLocations = [
  AtlasRoutes.splash,
  AtlasRoutes.login,
  AtlasRoutes.register,
  AtlasRoutes.forgotPassword,
  AtlasRoutes.onboarding,
  AtlasRoutes.consent,
  ..._tabs,
  ..._legal,
  AtlasRoutes.profileDelete,
  '/wardrobe-item/abc',
];

/// The user may use the app (no changed legal texts to accept): onboarding decides.
const _ok = ConsentStatus.notRequired;

String _target(AuthState s, ConsentStatus c, OnboardingStatus o, String loc) => authRedirect(s, c, o, loc) ?? loc;

void main() {
  test('no loops: for every state × consent × onboarding status × location the target is stable', () {
    for (final s in _allStates) {
      for (final c in ConsentStatus.values) {
        for (final o in OnboardingStatus.values) {
          for (final loc in _allLocations) {
            final target = _target(s, c, o, loc);
            expect(authRedirect(s, c, o, target), isNull, reason: '$s/$c/$o: $loc → $target → …');
            expect(_allLocations, contains(target));
          }
        }
      }
    }
  });

  test('restoring → splash, whatever the consent and onboarding status', () {
    for (final c in ConsentStatus.values) {
      for (final o in OnboardingStatus.values) {
        for (final loc in _allLocations) {
          expect(_target(const AuthRestoring(), c, o, loc), AtlasRoutes.splash);
        }
      }
    }
  });

  test(
    'signed out → login/register or a legal document; everything else (consent, onboarding, full-screen) → login',
    () {
      for (final s in _signedOut) {
        for (final c in ConsentStatus.values) {
          for (final o in OnboardingStatus.values) {
            for (final loc in _allLocations) {
              final stays = [
                AtlasRoutes.login,
                AtlasRoutes.register,
                AtlasRoutes.forgotPassword,
                ..._legal,
              ].contains(loc);
              expect(_target(s, c, o, loc), stays ? loc : AtlasRoutes.login, reason: '$s/$c/$o @ $loc');
            }
          }
        }
      }
    },
  );

  test('signed in, either decision pending → splash', () {
    for (final s in _signedIn) {
      for (final loc in _allLocations) {
        for (final c in [ConsentStatus.none, ConsentStatus.checking]) {
          for (final o in OnboardingStatus.values) {
            expect(_target(s, c, o, loc), AtlasRoutes.splash, reason: '$s/$c/$o @ $loc');
          }
        }
        for (final o in [OnboardingStatus.none, OnboardingStatus.checking]) {
          expect(_target(s, _ok, o, loc), AtlasRoutes.splash, reason: '$s/$o @ $loc');
        }
      }
    }
  });

  test('signed in, changed legal texts → the consent screen; only the documents and account deletion stay open', () {
    for (final s in _signedIn) {
      for (final o in OnboardingStatus.values) {
        for (final loc in _allLocations) {
          final stays = [..._legal, AtlasRoutes.profileDelete].contains(loc);
          expect(_target(s, ConsentStatus.required, o, loc), stays ? loc : AtlasRoutes.consent, reason: '$s/$o @ $loc');
        }
      }
    }
  });

  test('accepted: the consent screen leads home, or to onboarding when that is still due', () {
    for (final s in _signedIn) {
      expect(_target(s, _ok, OnboardingStatus.notRequired, AtlasRoutes.consent), AtlasRoutes.home);
      expect(_target(s, _ok, OnboardingStatus.required, AtlasRoutes.consent), AtlasRoutes.onboarding);
    }
  });

  test('signed in, onboarding required → onboarding from everywhere', () {
    for (final s in _signedIn) {
      for (final loc in _allLocations) {
        expect(_target(s, _ok, OnboardingStatus.required, loc), AtlasRoutes.onboarding, reason: '$s @ $loc');
      }
    }
  });

  test(
    'signed in, onboarding done → never splash, auth pages, onboarding or consent; tabs and full-screen routes stay',
    () {
      for (final s in _signedIn) {
        for (final loc in [
          AtlasRoutes.splash,
          AtlasRoutes.login,
          AtlasRoutes.register,
          AtlasRoutes.forgotPassword,
          AtlasRoutes.onboarding,
          AtlasRoutes.consent,
        ]) {
          expect(_target(s, _ok, OnboardingStatus.notRequired, loc), AtlasRoutes.home);
        }
        for (final loc in [..._tabs, ..._legal, AtlasRoutes.profileDelete, '/wardrobe-item/abc']) {
          expect(authRedirect(s, _ok, OnboardingStatus.notRequired, loc), isNull);
        }
      }
    },
  );

  test('a token refresh never moves the user (Authenticated ↔ Refreshing)', () {
    for (final c in ConsentStatus.values) {
      for (final o in OnboardingStatus.values) {
        for (final loc in _allLocations) {
          expect(
            _target(const Refreshing(_user), c, o, loc),
            _target(const Authenticated(_user), c, o, loc),
            reason: '$c/$o @ $loc',
          );
        }
      }
    }
  });

  test('a terminal session error leaves onboarding for sign-in', () {
    expect(
      _target(const SessionExpired(SignedOutReason.revoked), _ok, OnboardingStatus.required, AtlasRoutes.onboarding),
      AtlasRoutes.login,
    );
  });
}
