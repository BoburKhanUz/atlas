import 'dart:typed_data';

import 'package:atlas_mobile/core/config/environment_config.dart';
import 'package:atlas_mobile/core/logging/app_log.dart';
import 'package:atlas_mobile/core/widgets/signed_image.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import '../../support/fake_http.dart';
import '../../support/fake_session.dart';
import '../../support/jpeg_fixtures.dart';
import 'wardrobe_fixtures.dart';

SignedImageRef ref(
  String id, {
  String? sig,
  Duration validFor = const Duration(hours: 1),
  bool relative = false,
}) => SignedImageRef(
  imageId: 'img-$id',
  url:
      '${relative ? '' : 'http://api.test'}/api/v1/media/users/u1/${id}_display.webp?exp=1790000000&sig=${sig ?? sigFor(id, 'd')}',
  expiresAt: DateTime.now().toUtc().add(validFor),
);

const mediaPrefix = '/api/v1/media/users/u1/';

Future<SessionHarness> pumpImage(WidgetTester tester, SignedImageRef image, {VoidCallback? onExpired}) async {
  final h = SessionHarness(stored: pair(1));
  final c = ProviderContainer(overrides: appOverrides(h));
  addTearDown(c.dispose);
  await tester.runAsync(h.session.restore);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: c,
      child: MaterialApp(
        home: SizedBox(
          width: 200,
          height: 200,
          child: SignedImage(image: image, onExpired: onExpired),
        ),
      ),
    ),
  );
  return h;
}

Future<void> settleIo(WidgetTester tester) async {
  for (var i = 0; i < 30; i++) {
    await tester.pump(const Duration(milliseconds: 20));
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 5)));
  }
}

void main() {
  setUp(
    () => PaintingBinding.instance.imageCache
      ..clear()
      ..clearLiveImages(),
  );

  group('cache identity', () {
    test('image id + variant only: a refreshed URL (new signature) is the same cache entry', () {
      Future<Uint8List> fetch(String _) async => Uint8List(0);
      final a = SignedImageProvider(ref('a', sig: 'one'), fetch);
      final b = SignedImageProvider(ref('a', sig: 'two'), fetch);
      expect(a, b);
      expect(a.key, const SignedImageKey('img-a', ImageVariant.display));
      expect(a.key.toString(), isNot(contains('sig')));
      final thumb = SignedImageProvider(
        SignedImageRef(imageId: 'img-a', url: 'x', expiresAt: DateTime.now(), variant: ImageVariant.thumbnail),
        fetch,
      );
      expect(thumb == a, isFalse);
    });

    test('descriptions never contain the URL', () {
      final r = ref('a', sig: 'secret-sig-value');
      expect(r.toString(), isNot(contains('secret-sig-value')));
      expect(SignedImageProvider(r, (_) async => Uint8List(0)).toString(), isNot(contains('secret-sig-value')));
      expect(const SignedImageLoadException(404).toString(), isNot(contains('http')));
    });
  });

  testWidgets('loads through the API origin with no Bearer and no cookie; decodes', (tester) async {
    final h = await pumpImage(tester, ref('a'));
    h.backend.handlers['${mediaPrefix}a_display.webp'] = (r) => BytesReply(200, fixtureBytes('plain_landscape.jpg'));
    await settleIo(tester);
    final r = h.backend.to('${mediaPrefix}a_display.webp').single;
    expect(r.header('Authorization'), isNull);
    expect(r.header('Cookie'), isNull);
    expect(r.uri.queryParameters['sig'], sigFor('a', 'd'));
    expect(find.byType(RawImage), findsOneWidget);
  });

  testWidgets('a relative URL resolves against the configured API origin', (tester) async {
    final h = await pumpImage(tester, ref('r', relative: true));
    h.backend.handlers['${mediaPrefix}r_display.webp'] = (r) => BytesReply(200, fixtureBytes('plain_landscape.jpg'));
    await settleIo(tester);
    expect(h.backend.to('${mediaPrefix}r_display.webp').single.uri.origin, 'http://api.test');
  });

  testWidgets('an expired URL is not fetched; the owner is asked for a fresh one', (tester) async {
    var expired = 0;
    final h = await pumpImage(tester, ref('e', validFor: const Duration(seconds: 30)), onExpired: () => expired++);
    await settleIo(tester);
    expect(h.backend.sent.where((r) => r.uri.path.startsWith(mediaPrefix)), isEmpty);
    expect(expired, 1);
  });

  for (final (name, status) in [('tampered signature (400)', 400), ('expired on the server (404)', 404)]) {
    testWidgets('$name → placeholder, owner asked to reload, nothing cached', (tester) async {
      var expired = 0;
      final h = await pumpImage(tester, ref('t'), onExpired: () => expired++);
      h.backend.handlers['${mediaPrefix}t_display.webp'] = (r) => JsonReply(status, errorBody('NOT_FOUND'));
      await settleIo(tester);
      expect(find.byIcon(Icons.image_not_supported_outlined), findsOneWidget);
      expect(expired, 1);
      expect(
        PaintingBinding.instance.imageCache.containsKey(const SignedImageKey('img-t', ImageVariant.display)),
        isFalse,
      );
      expect(tester.takeException(), isNull, reason: 'errors are handled, never reported with the URL');
    });
  }

  testWidgets('signed URLs and signatures never reach the log', (tester) async {
    final lines = <String>[];
    final sink = AppLog.sink;
    final policy = AppLog.policy;
    AppLog.sink = lines.add;
    AppLog.policy = LogPolicy.verbose;
    addTearDown(() {
      AppLog.sink = sink;
      AppLog.policy = policy;
    });
    final h = await pumpImage(tester, ref('l'));
    h.backend.handlers['${mediaPrefix}l_display.webp'] = (r) => JsonReply(404, errorBody('NOT_FOUND'));
    await settleIo(tester);
    expect(lines, isNotEmpty);
    final text = lines.join('\n');
    expect(text, isNot(contains(sigFor('l', 'd'))));
    expect(text, isNot(contains('sig=')));
    expect(text, isNot(contains('exp=')));
  });
}
