import 'package:atlas_mobile/core/config/environment_config.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_http.dart';
import '../../support/fake_session.dart';

void main() {
  const normal = Duration(seconds: 20);
  const ai = Duration(seconds: 70);

  test('defaults: 20 s for requests, 70 s for the AI operations', () {
    const t = NetworkTimeouts();
    expect(t.receive, normal);
    expect(t.ai, ai);
  });

  Future<SessionHarness> harness() async {
    final h = SessionHarness(stored: pair(1));
    await h.session.restore();
    return h;
  }

  Future<Duration?> receiveTimeoutOf(SessionHarness h, String method, String path) async {
    h.backend.handlers[path] = (_) => JsonReply(200, {'ok': true});
    await h.dio.request<Object>(
      path,
      data: method == 'GET' ? null : {},
      options: Options(method: method),
    );
    return h.backend.to(path).last.options.receiveTimeout;
  }

  test(
    'only POST /stylist/chat, /outfits/generate and /wardrobe/items (upload + analysis) get the AI timeout',
    () async {
      final h = await harness();
      expect(await receiveTimeoutOf(h, 'POST', P.chat), ai);
      expect(await receiveTimeoutOf(h, 'POST', P.generate), ai);
      expect(await receiveTimeoutOf(h, 'POST', P.wardrobe), ai);
      expect(await receiveTimeoutOf(h, 'PATCH', '${P.wardrobe}/i1'), normal, reason: 'only the upload');
      expect(await receiveTimeoutOf(h, 'GET', P.conversations), normal);
      expect(await receiveTimeoutOf(h, 'GET', '${P.conversations}/c1'), normal);
      expect(await receiveTimeoutOf(h, 'POST', P.outfits), normal);
      expect(await receiveTimeoutOf(h, 'GET', P.wardrobe), normal);
      expect(await receiveTimeoutOf(h, 'GET', P.weather), normal);
      expect(await receiveTimeoutOf(h, 'GET', P.chat), normal, reason: 'method matters');
      expect(await receiveTimeoutOf(h, 'POST', '${P.chat}x'), normal, reason: 'exact path');
    },
  );

  for (final path in [P.chat, P.generate]) {
    test('$path: a receive timeout is NOT retried automatically (one POST)', () async {
      final h = await harness();
      h.backend.script(path, [
        TransportFailure(DioExceptionType.receiveTimeout),
        JsonReply(200, {'ok': true}),
      ]);
      await expectLater(
        h.dio.request<Object>(
          path,
          data: {},
          options: Options(method: 'POST'),
        ),
        throwsA(isA<DioException>()),
      );
      expect(h.backend.calls(path), 1);
    });

    test('$path: the 401 re-send keeps the AI timeout', () async {
      final h = await harness();
      h.backend.script(P.refresh, [JsonReply(200, pairJson(2))]);
      h.backend.script(path, [
        JsonReply(401, errorBody('UNAUTHORIZED')),
        JsonReply(200, {'ok': true}),
      ]);
      // As the generated client marks a bearer-secured operation.
      await h.dio.request<Object>(
        path,
        data: {},
        options: Options(
          method: 'POST',
          extra: {
            'secure': [
              {'type': 'http', 'scheme': 'bearer', 'name': 'bearerAuth'},
            ],
          },
        ),
      );
      expect(h.backend.to(path).map((r) => r.options.receiveTimeout), [ai, ai]);
      expect(h.bearers(path), ['Bearer ${access(1)}', 'Bearer ${access(2)}']);
    });
  }
}
