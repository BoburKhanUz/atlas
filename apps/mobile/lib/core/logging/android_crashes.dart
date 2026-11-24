import 'dart:convert';
import 'dart:typed_data';

import 'package:atlas_api/atlas_api.dart' show ClientErrorReportKindEnum;
import 'package:flutter/foundation.dart' show visibleForTesting;
import 'package:flutter/services.dart';

/// Crashes that ended an earlier run before Dart could report them, kept by
/// the Android side (android/app/src/main/kotlin/uz/lookly/app/CrashRecords.kt):
/// uncaught Java/Kotlin exceptions, and on Android 11+ native crashes and
/// ANRs from the system's exit history.
abstract interface class AndroidCrashRecords {
  Future<List<AndroidCrash>> pending();

  /// The phone forgets these.
  Future<void> acknowledge(Iterable<String> ids);
}

class MethodChannelAndroidCrashRecords implements AndroidCrashRecords {
  const MethodChannelAndroidCrashRecords();

  static const _channel = MethodChannel('uz.lookly.app/crash_records');

  @override
  Future<List<AndroidCrash>> pending() async {
    final records = await _channel.invokeListMethod<Map<Object?, Object?>>('pending') ?? const [];
    return [for (final r in records) ?AndroidCrash.fromRecord(r)];
  }

  @override
  Future<void> acknowledge(Iterable<String> ids) => _channel.invokeMethod<void>('acknowledge', ids.toList());
}

/// One record in report form. The texts are not scrubbed yet: CrashReporter
/// does that before anything is sent.
class AndroidCrash {
  const AndroidCrash({
    required this.id,
    required this.kind,
    required this.occurredAt,
    required this.errorType,
    required this.message,
    this.appVersion,
    this.stack,
  });

  /// What [AndroidCrashRecords.acknowledge] takes.
  final String id;
  final ClientErrorReportKindEnum kind;
  final DateTime occurredAt;

  /// The version that crashed; null when the record does not say.
  final String? appVersion;
  final String errorType;
  final String message;
  final String? stack;

  /// A record of the Android side: `id`, `kind` (java, native or anr), `time`
  /// (ms since the epoch), `version`, and per kind `trace` (the Java stack
  /// trace text; a tombstone or an ANR trace as bytes), `description` and
  /// `status` (the exit history's). Null for a record it cannot read.
  static AndroidCrash? fromRecord(Map<Object?, Object?> record) {
    final (id, time, trace) = (record['id'], record['time'], record['trace']);
    if (id is! String || time is! int) return null;
    final bytes = trace is Uint8List ? trace : null;
    final description = switch (record['description']) {
      final String d when d.trim().isNotEmpty => d.trim(),
      _ => null,
    };
    final (kind, parts) = switch (record['kind']) {
      'java' => (ClientErrorReportKindEnum.androidJava, parseJavaCrash(trace is String ? trace : '')),
      'native' => (
        ClientErrorReportKindEnum.androidNative,
        parseNativeCrash(
          bytes,
          status: switch (record['status']) {
            final int s => s,
            _ => 0,
          },
          description: description,
        ),
      ),
      'anr' => (ClientErrorReportKindEnum.androidAnr, parseAnr(bytes, description: description)),
      _ => (null, null),
    };
    if (kind == null || parts == null) return null;
    return AndroidCrash(
      id: id,
      kind: kind,
      occurredAt: DateTime.fromMillisecondsSinceEpoch(time, isUtc: true),
      appVersion: switch (record['version']) {
        final String v when v.isNotEmpty => v,
        _ => null,
      },
      errorType: parts.errorType,
      message: parts.message,
      stack: parts.stack,
    );
  }
}

typedef CrashParts = ({String errorType, String message, String? stack});

const _maxFrames = 12;
const _maxNativeFrames = 64;

/// `Throwable.stackTraceToString()`: "type: message" (the message may span
/// lines), then "\tat …" frames, "Caused by: …" sections and "\t... 12 more".
/// At most [_maxFrames] frames per section, so the causes fit as well.
@visibleForTesting
CrashParts parseJavaCrash(String trace) {
  final lines = const LineSplitter().convert(trace.trim());
  final firstFrame = lines.indexWhere(_isJavaFrame);
  final header = (firstFrame < 0 ? lines : lines.take(firstFrame)).join('\n');
  final colon = header.indexOf(': ');
  final type = (colon < 0 ? header : header.substring(0, colon)).trim();
  final stack = <String>[];
  var frames = 0;
  var omitted = 0;
  void noteOmitted() {
    if (omitted > 0) stack.add('\t... $omitted frames omitted');
    omitted = 0;
  }

  for (final line in firstFrame < 0 ? const <String>[] : lines.skip(firstFrame)) {
    if (!_isJavaFrame(line)) {
      noteOmitted();
      frames = 0;
      stack.add(line);
    } else if (frames++ < _maxFrames) {
      stack.add(line);
    } else {
      omitted++;
    }
  }
  noteOmitted();
  return (
    errorType: type.isEmpty ? 'Throwable' : type,
    message: colon < 0 ? '' : header.substring(colon + 2),
    stack: stack.isEmpty ? null : stack.join('\n'),
  );
}

bool _isJavaFrame(String line) => line.trimLeft().startsWith('at ');

const _signalNames = {
  4: 'SIGILL',
  5: 'SIGTRAP',
  6: 'SIGABRT',
  7: 'SIGBUS',
  8: 'SIGFPE',
  11: 'SIGSEGV',
  16: 'SIGSTKFLT',
  31: 'SIGSYS',
};

/// A native crash. Android 12+ keeps a tombstone (protobuf,
/// system/core/debuggerd/proto/tombstone.proto): only the signal, the cause,
/// the abort message and the crashing thread's frames are read from it, never
/// its registers, memory, maps, open files or log lines. Android 11 gives the
/// signal number ([status]) alone. Library paths are cut to the file name
/// (they hold per-install random names).
@visibleForTesting
CrashParts parseNativeCrash(Uint8List? tombstone, {int status = 0, String? description}) {
  final t = tombstone == null ? const <int, List<Object>>{} : _fields(tombstone);
  final signal = _message(t, 10);
  final number = _int(signal, 1);
  // A tombstone always names its signal; bytes without one are not a tombstone.
  if (number < 1 || number > 64) {
    final name = _signalNames[status];
    return (
      errorType: name ?? 'native crash',
      message: [if (status > 0) 'signal $status${name == null ? '' : ' ($name)'}', ?description].join('\n'),
      stack: null,
    );
  }
  final wide = switch (_int(t, 1)) {
    1 || 3 || 4 => true, // ARM64, X86_64, RISCV64
    _ => false,
  };
  final name = switch (_string(signal, 2)) {
    final String n when n.startsWith('SIG') => n,
    _ => _signalNames[number] ?? 'signal $number',
  };
  final fault = _int(signal, 8) != 0 ? '0x${_hex(_int(signal, 9), wide ? 16 : 8)}' : '--------';
  final cause = [for (final c in _messages(t, 15)) ?_string(c, 1)].firstOrNull;
  final abort = _string(t, 14);
  final tid = _int(t, 6);
  final thread = [
    for (final entry in _messages(t, 16))
      if (_int(entry, 1) == tid) _message(entry, 2),
  ].firstOrNull;
  final frames = thread == null ? const <Map<int, List<Object>>>[] : _messages(thread, 4).take(_maxNativeFrames);
  return (
    errorType: name,
    message: [
      'signal $number ($name), code ${_int(signal, 3)} (${_string(signal, 4) ?? '?'}), fault addr $fault',
      if (cause != null && cause.isNotEmpty) 'Cause: $cause',
      if (abort != null && abort.isNotEmpty) "Abort message: '$abort'",
    ].join('\n'),
    stack: frames.isEmpty
        ? null
        : [
            'thread: ${_string(thread!, 2) ?? tid}',
            for (final (i, f) in frames.indexed) _nativeFrame(i, f, wide),
          ].join('\n'),
  );
}

String _nativeFrame(int index, Map<int, List<Object>> f, bool wide) {
  final file = (_string(f, 6) ?? '').split('/').last;
  final mapOffset = _int(f, 7);
  final function = _string(f, 4);
  return [
    '#${index.toString().padLeft(2, '0')} pc ${_hex(_int(f, 1), wide ? 16 : 8)}  ${file.isEmpty ? '<unknown>' : file}',
    if (mapOffset != 0) ' (offset 0x${_hex(mapOffset, 1)})',
    if (function != null && function.isNotEmpty) ' ($function+${_int(f, 5)})',
  ].join();
}

final _buildId = RegExp(r' \(BuildId: [0-9A-Fa-f]+\)');
final _directory = RegExp(r'(\s)/\S*/');

/// An ANR that ended the app: the system's reason ([description], else the
/// trace's "Subject:") and the main thread's frames of the first process in
/// the trace (ours). Nothing else of the trace is kept: no other thread, no
/// other process, no memory figures.
@visibleForTesting
CrashParts parseAnr(Uint8List? trace, {String? description}) {
  final lines = trace == null
      ? const <String>[]
      : const LineSplitter().convert(utf8.decode(trace, allowMalformed: true));
  final subject = lines.where((l) => l.startsWith('Subject: ')).firstOrNull?.substring('Subject: '.length).trim();
  final main = lines.indexWhere((l) => l.startsWith('"main" '));
  String? stack;
  if (main >= 0) {
    final frames = lines
        .skip(main + 1)
        .takeWhile((l) => l.trim().isNotEmpty)
        .map((l) => l.trim())
        .where((l) => l.startsWith('at ') || l.startsWith('- ') || l.startsWith('native: '))
        .map((l) => l.replaceAll(_buildId, '').replaceAllMapped(_directory, (m) => m[1]!))
        .take(_maxNativeFrames);
    stack = [lines[main].trim(), ...frames].join('\n');
  }
  return (errorType: 'ANR', message: description ?? subject ?? '', stack: stack);
}

/// [value] as unsigned hex, at least [digits] long (Dart ints are signed).
String _hex(int value, int digits) {
  final high = value >>> 32;
  final low = (value & 0xffffffff).toRadixString(16);
  final hex = high == 0 ? low : '${high.toRadixString(16)}${low.padLeft(8, '0')}';
  return hex.padLeft(digits, '0');
}

// ─── Protocol buffers wire format, as far as the tombstone needs it ─────────

/// The fields of one message: number → values, an int for varint and fixed
/// fields, a view of the bytes for length-delimited ones. A truncated or
/// damaged message keeps the fields before the damage.
Map<int, List<Object>> _fields(Uint8List b) {
  final fields = <int, List<Object>>{};
  var i = 0;
  int? varint() {
    var result = 0;
    for (var shift = 0; shift < 64 && i < b.length; shift += 7) {
      final byte = b[i++];
      result |= (byte & 0x7f) << shift;
      if (byte & 0x80 == 0) return result;
    }
    return null;
  }

  while (i < b.length) {
    final key = varint();
    if (key == null) break;
    final Object value;
    switch (key & 7) {
      case 0:
        final v = varint();
        if (v == null) return fields;
        value = v;
      case 1:
        if (i + 8 > b.length) return fields;
        value = ByteData.sublistView(b, i, i + 8).getInt64(0, Endian.little);
        i += 8;
      case 2:
        final length = varint();
        if (length == null || length < 0 || length > b.length - i) return fields;
        value = Uint8List.sublistView(b, i, i + length);
        i += length;
      case 5:
        if (i + 4 > b.length) return fields;
        value = ByteData.sublistView(b, i, i + 4).getUint32(0, Endian.little);
        i += 4;
      default: // groups: not in the tombstone format
        return fields;
    }
    (fields[key >>> 3] ??= []).add(value);
  }
  return fields;
}

// The last value of a scalar field wins, as in protobuf.
int _int(Map<int, List<Object>> f, int number) => switch (f[number]?.lastOrNull) {
  final int v => v,
  _ => 0,
};

String? _string(Map<int, List<Object>> f, int number) => switch (f[number]?.lastOrNull) {
  final Uint8List v => utf8.decode(v, allowMalformed: true),
  _ => null,
};

Map<int, List<Object>> _message(Map<int, List<Object>> f, int number) => switch (f[number]?.lastOrNull) {
  final Uint8List v => _fields(v),
  _ => const {},
};

List<Map<int, List<Object>>> _messages(Map<int, List<Object>> f, int number) => [
  for (final v in f[number] ?? const <Object>[])
    if (v is Uint8List) _fields(v),
];
