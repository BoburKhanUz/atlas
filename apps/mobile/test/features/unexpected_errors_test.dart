// Defect D9: a controller that caught only ApiFailure left its screen on
// "loading" (or busy/saving) forever when anything else was thrown. Each
// test below makes a controller's request throw a bug-type error (a
// StateError from the fake backend reaches the controller as itself, not as
// an ApiFailure) and checks what the screen would show: the controller is
// not stuck, it holds an UnexpectedErrorFailure, and its retry recovers once
// the error is gone.

import 'package:atlas_mobile/core/network/api_failure.dart';
import 'package:atlas_mobile/core/session/auth_state.dart';
import 'package:atlas_mobile/features/onboarding/data/onboarding_marker_store.dart';
import 'package:atlas_mobile/features/onboarding/data/options.dart';
import 'package:atlas_mobile/features/onboarding/onboarding_gate.dart';
import 'package:atlas_mobile/features/onboarding/presentation/onboarding_controller.dart' as onboarding;
import 'package:atlas_mobile/features/onboarding/providers.dart';
import 'package:atlas_mobile/features/outfits/presentation/generate_controller.dart';
import 'package:atlas_mobile/features/outfits/presentation/outfit_detail_controller.dart';
import 'package:atlas_mobile/features/outfits/presentation/outfit_list_controller.dart';
import 'package:atlas_mobile/features/outfits/providers.dart';
import 'package:atlas_mobile/features/profile/data/color_profile_repository.dart';
import 'package:atlas_mobile/features/profile/presentation/color_profile_controller.dart';
import 'package:atlas_mobile/features/profile/presentation/delete_account_controller.dart';
import 'package:atlas_mobile/features/profile/presentation/profile_controller.dart';
import 'package:atlas_mobile/features/profile/presentation/profile_edit_controller.dart';
import 'package:atlas_mobile/features/profile/providers.dart';
import 'package:atlas_mobile/features/stylist/presentation/chat_controller.dart';
import 'package:atlas_mobile/features/stylist/providers.dart';
import 'package:atlas_mobile/features/wardrobe/data/analysis_review.dart';
import 'package:atlas_mobile/features/wardrobe/presentation/edit_item_controller.dart';
import 'package:atlas_mobile/features/wardrobe/providers.dart';
import 'package:atlas_mobile/features/weather/data/cities.dart';
import 'package:atlas_mobile/features/weather/presentation/weather_controller.dart';
import 'package:atlas_mobile/features/weather/providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_http.dart';
import '../support/fake_session.dart';
import 'outfits/outfit_fixtures.dart';
import 'profile/profile_fixtures.dart';
import 'stylist/stylist_fixtures.dart';
import 'wardrobe/wardrobe_fixtures.dart';

/// A bug in the app (not an API answer): what the broken handlers throw.
Never bug() => throw StateError('a bug');

/// The app on the fake backend, signed in as u1.
Future<(ProviderContainer, SessionHarness)> app({
  bool onboarded = true,
  List<Override> extra = const [],
  void Function(SessionHarness h)? before,
  void Function(ProviderContainer c)? beforeRestore,
}) async {
  final h = SessionHarness(stored: pair(1));
  before?.call(h);
  final c = ProviderContainer(
    overrides: [
      ...appOverrides(h, onboarded: onboarded),
      ...extra,
    ],
  );
  addTearDown(c.dispose);
  beforeRestore?.call(c);
  await h.session.restore();
  return (c, h);
}

/// Lets queued work (initial loads from `build`) run until [done] holds.
/// Bounded: a controller stuck on "loading" leaves the loop, and the
/// assertions that follow fail.
Future<void> until(bool Function() done) async {
  for (var i = 0; i < 50 && !done(); i++) {
    await pumpEventQueue();
  }
}

/// Fresh for the weather fetched at 10:00 by [weatherJson].
final weatherClock = weatherClockProvider.overrideWithValue(() => DateTime.utc(2026, 10, 5, 10, 5));

void main() {
  // Account deletion clears the in-memory image cache (present in the app).
  TestWidgetsFlutterBinding.ensureInitialized();

  test('outfit list: an unexpected error ends loading with a retryable failure; refresh recovers', () async {
    var broken = true;
    final (c, _) = await app(
      before: (h) =>
          h.backend.handlers[P.outfits] = (_) => broken ? bug() : JsonReply(200, listJson([summaryJson('o1')])),
    );
    final saved = outfitListProvider(true);
    c.listen(saved, (_, _) {});
    await until(() => c.read(saved).status != OutfitListStatus.loading);
    expect(c.read(saved).status, OutfitListStatus.failed, reason: 'never left on loading');
    expect(c.read(saved).failure, isA<UnexpectedErrorFailure>());
    expect(c.read(saved).failure!.retryable, isTrue);

    broken = false;
    await c.read(saved.notifier).refresh();
    expect(c.read(saved).status, OutfitListStatus.ready);
    expect(c.read(saved).outfits.map((o) => o.id), ['o1']);
    expect(c.read(saved).failure, isNull);
  });

  test('outfit detail: load and an action end with a retryable failure, never busy; reload recovers', () async {
    var brokenGet = true;
    var brokenPatch = false;
    final (c, _) = await app(
      before: (h) {
        h.backend.handlers['${P.outfits}/o1'] = (r) => switch (r.method) {
          'GET' => brokenGet ? bug() : JsonReply(200, detailJson('o1')),
          _ => brokenPatch ? bug() : JsonReply(200, rowJson('o1', isSaved: false)),
        };
        h.backend.handlers[P.outfits] = (_) => JsonReply(200, listJson([summaryJson('o1')]));
      },
    );
    final detail = outfitDetailControllerProvider('o1');
    c.listen(detail, (_, _) {});
    await until(() => c.read(detail).status != OutfitDetailStatus.loading);
    expect(c.read(detail).status, OutfitDetailStatus.loadFailed, reason: 'never left on loading');
    expect(c.read(detail).failure, isA<UnexpectedErrorFailure>());

    brokenGet = false;
    await c.read(detail.notifier).reload();
    expect(c.read(detail).status, OutfitDetailStatus.ready);
    expect(c.read(detail).outfit!.id, 'o1');

    brokenPatch = true;
    await c.read(detail.notifier).setSaved(saved: false);
    expect(c.read(detail).running, isNull, reason: 'the action is not left running');
    expect(c.read(detail).status, OutfitDetailStatus.ready, reason: 'the outfit stays on screen');
    expect(c.read(detail).outfit!.isSaved, isTrue, reason: 'nothing changed');
    expect(c.read(detail).failure, isA<UnexpectedErrorFailure>());

    brokenPatch = false;
    await c.read(detail.notifier).setSaved(saved: false);
    expect(c.read(detail).outfit!.isSaved, isFalse);
    expect(c.read(detail).failure, isNull);
  });

  test('generate: an unexpected error ends generating with a retryable failure; generating again recovers', () async {
    var broken = true;
    final (c, _) = await app(
      extra: [weatherClock],
      before: (h) {
        h.backend.script(P.weather, [JsonReply(200, weatherJson())]);
        h.backend.handlers[P.generate] = (_) =>
            broken ? bug() : JsonReply(200, generateJson(weatherUsed: weatherUsedJson()));
      },
    );
    c.listen(generateControllerProvider, (_, _) {});
    final gen = c.read(generateControllerProvider.notifier);
    await gen.generate();
    expect(c.read(generateControllerProvider).phase, GeneratePhase.failed, reason: 'never left on generating');
    expect(c.read(generateControllerProvider).failure, isA<UnexpectedErrorFailure>());

    broken = false;
    await gen.generate();
    expect(c.read(generateControllerProvider).phase, GeneratePhase.ready);
    expect(c.read(generateControllerProvider).result!.outfits, hasLength(2));
    expect(c.read(generateControllerProvider).failure, isNull);
  });

  test('profile: an unexpected error ends loading with a retryable failure; refresh recovers', () async {
    var broken = true;
    final (c, _) = await app(
      before: (h) => h.backend.handlers[P.profile] = (_) => broken ? bug() : JsonReply(200, profileJson()),
    );
    c.listen(profileProvider, (_, _) {});
    await until(() => c.read(profileProvider).status != ProfileStatus.loading);
    expect(c.read(profileProvider).status, ProfileStatus.failed, reason: 'never left on loading');
    expect(c.read(profileProvider).failure, isA<UnexpectedErrorFailure>());

    broken = false;
    await c.read(profileProvider.notifier).refresh();
    expect(c.read(profileProvider).status, ProfileStatus.ready);
    expect(c.read(profileProvider).profile!.name, 'Aziza');
  });

  test('colour profile: load and delete end with a retryable failure, never refreshing; retries recover', () async {
    var brokenGet = true;
    var brokenDelete = false;
    final (c, _) = await app(
      before: (h) => h.backend.handlers[P.colorProfile] = (r) => switch (r.method) {
        'GET' => brokenGet ? bug() : JsonReply(200, analysedJson()),
        _ => brokenDelete ? bug() : JsonReply(200, {'ok': true}),
      },
    );
    c.listen(colorProfileProvider, (_, _) {});
    await until(() => c.read(colorProfileProvider).status != ColorProfileStatus.loading);
    expect(c.read(colorProfileProvider).status, ColorProfileStatus.failed, reason: 'never left on loading');
    expect(c.read(colorProfileProvider).failure, isA<UnexpectedErrorFailure>());

    brokenGet = false;
    await c.read(colorProfileProvider.notifier).refresh();
    expect(c.read(colorProfileProvider).status, ColorProfileStatus.ready);
    expect(c.read(colorProfileProvider).current, isA<Analysed>());

    brokenDelete = true;
    await c.read(colorProfileProvider.notifier).delete();
    expect(c.read(colorProfileProvider).status, ColorProfileStatus.ready, reason: 'never left refreshing');
    expect(c.read(colorProfileProvider).current, isA<Analysed>(), reason: 'the profile stays shown');
    expect(c.read(colorProfileProvider).failure, isA<UnexpectedErrorFailure>());

    brokenDelete = false;
    await c.read(colorProfileProvider.notifier).delete();
    expect(c.read(colorProfileProvider).current, isA<NotAnalysed>());
    expect(c.read(colorProfileProvider).failure, isNull);
  });

  test('profile edit: an unexpected error on save ends saving, keeps the edits; Retry saves', () async {
    var broken = true;
    final (c, h) = await app(
      before: (h) => h.backend.handlers[P.profile] = (r) => r.method == 'GET'
          ? JsonReply(200, profileJson())
          : broken
          ? bug()
          : JsonReply(200, patchResponseJson()),
    );
    c.listen(profileEditControllerProvider, (_, _) {});
    await until(() => c.read(profileEditControllerProvider).status != ProfileEditStatus.loading);
    final editor = c.read(profileEditControllerProvider.notifier);
    expect(c.read(profileEditControllerProvider).status, ProfileEditStatus.editing);
    editor.edit((d) => d.withName('Dilnoza'));
    await editor.save();
    final failed = c.read(profileEditControllerProvider);
    expect(failed.status, ProfileEditStatus.failed, reason: 'never left on saving');
    expect(failed.failure, isA<UnexpectedErrorFailure>());
    expect(failed.draft!.name, 'Dilnoza', reason: 'the edits are kept for the retry');

    broken = false;
    await editor.save();
    expect(c.read(profileEditControllerProvider).status, ProfileEditStatus.saved);
    expect(h.backend.to(P.profile).where((r) => r.method == 'PATCH'), hasLength(2));
  });

  test(
    'delete account: an unexpected error ends deleting as "unknown" (nothing claimed); Tekshirish confirms',
    () async {
      var broken = true;
      final (c, h) = await app(
        before: (h) => h.backend.handlers[P.account] = (_) => broken ? bug() : JsonReply(200, {'ok': true}),
      );
      c.listen(deleteAccountControllerProvider, (_, _) {});
      final d = c.read(deleteAccountControllerProvider.notifier);
      await d.delete(typed: deleteConfirmationWord);
      expect(c.read(deleteAccountControllerProvider).phase, DeletePhase.unknown, reason: 'never left on deleting');
      expect(c.read(deleteAccountControllerProvider).failure, isA<UnexpectedErrorFailure>());
      expect(h.session.state, isA<Authenticated>(), reason: 'nothing claimed, still signed in');

      broken = false;
      await d.delete(); // Tekshirish
      expect(c.read(deleteAccountControllerProvider).phase, DeletePhase.deleted);
      expect(h.session.state, isA<Unauthenticated>());
    },
  );

  test('chat load: an unexpected error ends loading with a retryable failure; retry recovers', () async {
    var broken = true;
    final (c, _) = await app(
      before: (h) => h.backend.handlers['${P.conversations}/c1'] = (_) => broken
          ? bug()
          : JsonReply(200, conversationJson('c1', const [('user', 'Salom'), ('assistant', 'Va alaykum')])),
    );
    final chat = chatControllerProvider('c1');
    c.listen(chat, (_, _) {});
    await until(() => c.read(chat).status != ChatStatus.loading);
    expect(c.read(chat).status, ChatStatus.loadFailed, reason: 'never left on loading');
    expect(c.read(chat).failure, isA<UnexpectedErrorFailure>());

    broken = false;
    await c.read(chat.notifier).retryLoad();
    expect(c.read(chat).status, ChatStatus.ready);
    expect(c.read(chat).messages.map((m) => m.content), ['Salom', 'Va alaykum']);
  });

  test('chat send: an unexpected error ends sending (never busy); a confirmed re-send succeeds', () async {
    var broken = true;
    final (c, _) = await app(
      extra: [weatherClock],
      before: (h) {
        h.backend.script(P.weather, [JsonReply(200, weatherJson())]);
        h.backend.handlers[P.chat] = (_) => broken ? bug() : JsonReply(200, chatJson('c1'));
      },
    );
    final chat = chatControllerProvider(newChatKey);
    c.listen(chat, (_, _) {});
    final ctl = c.read(chat.notifier);
    expect(await ctl.send('Bugun nima kiyay?'), SendResult.unknown);
    final after = c.read(chat);
    expect(after.send, SendStatus.unknown, reason: 'never left on sending');
    expect(after.busy, isFalse);
    expect(after.failure, isA<UnexpectedErrorFailure>());
    expect(after.pending, 'Bugun nima kiyay?', reason: 'the text is still shown');

    broken = false;
    expect(await ctl.send('Bugun nima kiyay?'), SendResult.needsConfirmation);
    expect(await ctl.send('Bugun nima kiyay?', confirmResend: true), SendResult.sent);
    expect(c.read(chat).send, SendStatus.idle);
    expect(c.read(chat).messages.map((m) => m.role), ['user', 'assistant']);
  });

  test('edit item: an unexpected error on save ends saving, keeps the edits; Retry saves', () async {
    var broken = true;
    final (c, h) = await app(
      before: (h) => h.backend.handlers['${P.wardrobe}/i1'] = (r) => r.method == 'GET'
          ? JsonReply(200, {'item': itemJson('i1')})
          : broken
          ? bug()
          : JsonReply(200, {
              'item': {...itemJson('i1'), 'fit': 'slim'},
            }),
    );
    final edit = editItemControllerProvider('i1');
    c.listen(edit, (_, _) {});
    await until(() => c.read(edit).status != EditStatus.loading);
    expect(c.read(edit).status, EditStatus.editing);
    c.read(edit.notifier).set(ItemAttribute.fit, 'slim');
    await c.read(edit.notifier).save();
    expect(c.read(edit).status, EditStatus.failed, reason: 'never left on saving');
    expect(c.read(edit).failure, isA<UnexpectedErrorFailure>());
    expect(c.read(edit).changes, {ItemAttribute.fit}, reason: 'the edit is kept for the retry');

    broken = false;
    await c.read(edit.notifier).save();
    expect(c.read(edit).status, EditStatus.saved);
    expect(c.read(edit).original!.fit, 'slim');
    expect(h.backend.to('${P.wardrobe}/i1').where((r) => r.method == 'PATCH'), hasLength(2));
  });

  test('weather: an unexpected error ends loading with a retryable failure; refresh recovers', () async {
    var broken = true;
    final (c, _) = await app(
      extra: [weatherClock],
      before: (h) => h.backend.handlers[P.weather] = (_) => broken ? bug() : JsonReply(200, weatherJson()),
    );
    c.listen(weatherControllerProvider, (_, _) {});
    final weather = c.read(weatherControllerProvider.notifier);
    await weather.chooseCity(Cities.all.first);
    expect(c.read(weatherControllerProvider).status, WeatherStatus.failed, reason: 'never left on loading');
    expect(c.read(weatherControllerProvider).failure, isA<UnexpectedErrorFailure>());

    broken = false;
    await weather.refresh();
    expect(c.read(weatherControllerProvider).status, WeatherStatus.ready);
    expect(c.read(weatherControllerProvider).weather!.temperature, 18);
    expect(c.read(weatherControllerProvider).failure, isNull);
  });

  test('onboarding finish: an unexpected error ends saving, keeps the answers; Finish again completes', () async {
    var broken = true;
    final (c, h) = await app(
      onboarded: false,
      before: (h) => h.backend.handlers[P.profile] = (r) => r.method == 'GET'
          ? JsonReply(200, defaultProfileJson())
          : broken
          ? bug()
          : JsonReply(200, patchResponseJson()),
      // The gate listens to the session from its creation (as in the app).
      beforeRestore: (c) => c.read(onboardingGateProvider),
    );
    final gate = c.read(onboardingGateProvider);
    await until(() => gate.status != OnboardingStatus.checking);
    expect(gate.status, OnboardingStatus.required);
    c.listen(onboardingControllerProvider, (_, _) {});
    final ctl = c.read(onboardingControllerProvider.notifier)
      ..next()
      ..update((a) => a.togglePreferredStyle(StyleOption.minimal))
      ..next()
      ..next()
      ..next();
    await ctl.finish();
    final failed = c.read(onboardingControllerProvider);
    expect(failed.save, onboarding.SaveStatus.failed, reason: 'never left on saving');
    expect(failed.failure, isA<UnexpectedErrorFailure>());
    expect(failed.answers.preferredStyles, {StyleOption.minimal}, reason: 'the answers are kept for the retry');
    expect(gate.status, OnboardingStatus.required);

    broken = false;
    await ctl.finish();
    expect(gate.status, OnboardingStatus.notRequired);
    expect(h.kv.values[OnboardingMarkerStore.keyFor('u1')], OnboardingMarker.completed.name);
  });
}
