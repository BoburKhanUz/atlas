import 'package:atlas_mobile/core/logging/app_log.dart';
import 'package:atlas_mobile/core/network/api_failure.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  late List<String> log;
  late List<Object> reported;
  late void Function(String) sink;
  late void Function(Object, StackTrace) report;

  setUp(() {
    log = [];
    reported = [];
    sink = AppLog.sink;
    report = UnexpectedErrors.report;
    AppLog.sink = log.add;
    UnexpectedErrors.report = (error, _) => reported.add(error);
  });
  tearDown(() {
    AppLog.sink = sink;
    UnexpectedErrors.report = report;
  });

  test('an ApiFailure passes through unchanged and is not reported', () {
    const f = TimeoutFailure('receive');
    expect(failureOf(f, StackTrace.current), same(f));
    expect(reported, isEmpty);
  });

  test('anything else becomes a retryable generic failure, logged by type and reported', () {
    final error = StateError('secret detail a@b.uz');
    final f = failureOf(error, StackTrace.current);
    expect(f, isA<UnexpectedErrorFailure>());
    expect(f.retryable, isTrue);
    expect(f.userMessage, isNotEmpty);
    expect(reported, [error]);
    expect(log.join('\n'), contains('StateError'));
    expect(log.join('\n'), isNot(contains('a@b.uz')), reason: 'the log carries the type, not the message');
  });
}
