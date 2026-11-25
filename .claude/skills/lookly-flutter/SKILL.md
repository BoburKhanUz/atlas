---
name: lookly-flutter
description: Architecture, state, testing, accessibility and performance rules for the Lookly Flutter app in apps/mobile (Riverpod 3, go_router, Dio with the generated OpenAPI client). Use for any code, test, asset or platform-config change under apps/mobile. Use together with mobile-design for anything visual. Do NOT use for backend or web work.
---

# Lookly Flutter app

The app is kept, not rewritten: networking (`lib/core/network`) and navigation
(`lib/app/router.dart`) are solid. New work follows these rules; existing code is moved
towards them stage by stage, never in one big rewrite.

## Structure

```
lib/
  app/                  app widget, router, top-level providers
  core/                 shared by every feature: config, design tokens and theme,
                        network, session, logging, widgets, l10n, utilities
  features/<feature>/
    data/               repositories: call the API, map API models to domain models
    domain/             plain Dart models and pure rules of the feature
    presentation/       screens, widgets, notifiers (Riverpod)
```

- **Features do not import each other.** Anything two features need moves to `core/`
  (image pipeline, list paging, "unknown outcome" classification, photo picking).
- **Screens never see generated API models** (`atlas_api`). Repositories map them to the
  feature's domain models.
- **Widgets do not call repositories or compute rules.** A screen reads a notifier's state
  and calls its methods. Formatting helpers live in `domain/` or `core/`.

## State (Riverpod 3)

- One notifier per screen or flow (`Notifier`/`AsyncNotifier`). State is an immutable
  class (or `AsyncValue`) that represents loading, data, empty and error explicitly.
- Every async method catches **all** failures, not only `ApiFailure`: unknown exceptions
  become an error state with a retry, and are logged. A screen never stays on "loading"
  forever.
- Initial loads start from `build`, not from `Future.microtask` in a widget.
- After an `await`, check that the notifier or widget is still alive before touching
  state or `ref`.
- Retries are user-driven or bounded with backoff; never re-fire on every rebuild.

## Navigation

- go_router with the existing redirect function; add an `errorBuilder` (Uzbek "page not
  found" with a way home).
- Never block system back without giving the user a visible cancel; long operations
  (upload, analysis) offer "Bekor qilish" (cancel).

## Strings and localization

- All user-visible text lives in ARB files (`lib/l10n/app_uz.arb`) via `gen_l10n`, with
  Material and Cupertino localizations for Uzbek. No literal Uzbek strings in widgets,
  notifiers or enums (CI checks this once M3 lands).
- Text compared against user input is normalized first: the Uzbek apostrophes `'` `’` `ʻ`
  `‘` are equivalent.

## Design system

- Colours, spacing, radii, durations and text styles come only from
  `lib/core/design/tokens.dart` and `theme.dart`. No literal colours or magic sizes.
- Light and dark themes both exist and both are tested (golden tests).
- Follow `mobile-design` for every screen: 48dp targets, thumb zone, safe areas,
  skeletons for content loading, haptics on selection and confirmation, motion that
  respects `MediaQuery.disableAnimationsOf`.

## Accessibility

- Support text scale up to 2.0. Layouts use `Flexible`/`Wrap`/scrolling instead of fixed
  heights; test every main screen at 360dp width and 2.0 text scale.
- Every interactive element has a semantic label; decorative images are excluded from
  semantics; dynamic results are announced (live regions).
- Contrast: 4.5:1 for text, 3:1 for icons and large text, in both themes.

## Performance

- Heavy work (hashing, JPEG checks, decoding) runs in an isolate (`Isolate.run`).
- Images are decoded at display size (`cacheWidth`/`cacheHeight`, thumbnails for lists).
- Long or growing lists use builders (`ListView.builder`, `SliverList`); chat included.
- Rebuild scope stays small: `select` on providers, `const` widgets.

## Platform

- Phones only, portrait only (`SystemChrome.setPreferredOrientations` plus the Android
  manifest and iOS plist): the app has no landscape layouts.
- Before showing a changed screen, run `references/ui-checklist.md`.
- Android: pin `minSdk`/`targetSdk`/`compileSdk` explicitly; release signing fails closed;
  R8 keep rules for every platform channel class.
- iOS: iPhone only (`TARGETED_DEVICE_FAMILY = 1`), privacy manifest, usage strings that
  name the real purpose (camera for wardrobe and selfie), no local-networking exception
  in release. iOS builds run on macOS CI; never claim iOS works from a Linux session.
- Platform channels (`uz.lookly.app/...`) have a Dart fallback and tests for both sides.

## Testing

Use `lookly-testing`. Area-specific: the fake backend harness is
`test/support/fake_session.dart`; golden tests at 360×800, light and dark, text scale
1.0 and 2.0; `integration_test/` for the main journeys.

## Done when

- `dart format --set-exit-if-changed lib test`, `flutter analyze` (no issues) and
  `flutter test` pass.
- Changed screens have golden tests in both themes and at 2.0 text scale.
- No cross-feature import, literal colour or literal user-facing string was added.
