// Prepares docs/api/openapi.json for openapi-generator v7.10.0 (dart-dio).
//
// The contract is OpenAPI 3.1, which marks binary payloads with
// `contentMediaType` (e.g. the multipart `file` part of POST
// /api/v1/wardrobe/items). The pinned generator only understands the
// OpenAPI 3.0 spelling `format: binary` and otherwise types such parts as
// `String`. The OpenAPI 3.1 specification defines the two as equivalent for
// binary content ("type: string, format: binary" ⇔ "type: string,
// contentMediaType: application/octet-stream"), so this step adds
// `format: binary` next to every non-text `contentMediaType` — nothing else is
// changed for binary content.
//
// Second limitation: the generator turns a non-string `const` (e.g.
// `Detection.mock: {type: boolean, const: true}`, `OkResponse.ok`) into a
// *string* enum whose only wire value is "true", so the real JSON boolean
// decodes as "unknown". For generation only, such a `const` is relaxed to its
// plain type (`{type: boolean}`); the value stays documented in the contract
// and is enforced by the server. String `const`s generate correctly and are
// kept.
//
// The input file is never modified; the output is written deterministically
// (same input → byte-identical output).
//
// Usage: dart run tool/openapi/prepare_spec.dart <openapi.json> <out.json>
import 'dart:convert';
import 'dart:io';

/// Adds `format: binary` to binary string schemas. Returns the JSON pointers
/// that were changed (for the log and the tests).
List<String> addBinaryFormat(Object? node, [String pointer = '']) {
  final changed = <String>[];
  if (node is Map<String, Object?>) {
    final media = node['contentMediaType'];
    if (node['type'] == 'string' && media is String && !media.startsWith('text/') && !node.containsKey('format')) {
      node['format'] = 'binary';
      changed.add(pointer.isEmpty ? '/' : pointer);
    }
    for (final entry in node.entries) {
      changed.addAll(addBinaryFormat(entry.value, '$pointer/${_escape(entry.key)}'));
    }
  } else if (node is List<Object?>) {
    for (var i = 0; i < node.length; i++) {
      changed.addAll(addBinaryFormat(node[i], '$pointer/$i'));
    }
  }
  return changed;
}

/// Removes `const` from schemas whose constant is not a string. Returns the
/// JSON pointers that were changed.
List<String> relaxNonStringConst(Object? node, [String pointer = '']) {
  final changed = <String>[];
  if (node is Map<String, Object?>) {
    if (node.containsKey('const') && node['const'] is! String && node['type'] is String) {
      node.remove('const');
      changed.add(pointer.isEmpty ? '/' : pointer);
    }
    for (final entry in node.entries) {
      changed.addAll(relaxNonStringConst(entry.value, '$pointer/${_escape(entry.key)}'));
    }
  } else if (node is List<Object?>) {
    for (var i = 0; i < node.length; i++) {
      changed.addAll(relaxNonStringConst(node[i], '$pointer/$i'));
    }
  }
  return changed;
}

String _escape(String key) => key.replaceAll('~', '~0').replaceAll('/', '~1');

void main(List<String> args) {
  if (args.length != 2) {
    stderr.writeln('usage: prepare_spec.dart <openapi.json> <out.json>');
    exit(64);
  }
  final spec = jsonDecode(File(args[0]).readAsStringSync()) as Map<String, Object?>;
  if (spec['openapi'] is! String || !(spec['openapi']! as String).startsWith('3.1')) {
    stderr.writeln('expected an OpenAPI 3.1 document');
    exit(65);
  }
  final changed = addBinaryFormat(spec);
  final relaxed = relaxNonStringConst(spec);
  File(args[1])
    ..createSync(recursive: true)
    ..writeAsStringSync('${const JsonEncoder.withIndent('  ').convert(spec)}\n');
  stdout.writeln('format: binary added at ${changed.length} schema(s):');
  for (final p in changed) {
    stdout.writeln('  $p');
  }
  stdout.writeln('non-string const relaxed at ${relaxed.length} schema(s):');
  for (final p in relaxed) {
    stdout.writeln('  $p');
  }
}
