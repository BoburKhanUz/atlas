import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import '../../tool/openapi/prepare_spec.dart';

Object? _load() => jsonDecode(File('../../docs/api/openapi.json').readAsStringSync());

/// Removes every `format: binary` this step may have added.
Object? _withoutAddedFormats(Object? node) {
  if (node is Map<String, Object?>) {
    return {
      for (final e in node.entries)
        if (!(e.key == 'format' && e.value == 'binary' && node.containsKey('contentMediaType')))
          e.key: _withoutAddedFormats(e.value),
    };
  }
  if (node is List<Object?>) return node.map(_withoutAddedFormats).toList();
  return node;
}

void main() {
  test('adds format: binary to exactly the binary schemas of the contract', () {
    final spec = _load();
    final changed = addBinaryFormat(spec);
    expect(changed, [
      '/paths/~1api~1v1~1color-profile~1analyze/post/requestBody/content/multipart~1form-data/schema/properties/file',
      '/paths/~1api~1v1~1media~1{key}/get/responses/200/content/image~1jpeg/schema',
      '/paths/~1api~1v1~1media~1{key}/get/responses/200/content/image~1png/schema',
      '/paths/~1api~1v1~1media~1{key}/get/responses/200/content/image~1webp/schema',
      '/paths/~1api~1v1~1wardrobe~1items/post/requestBody/content/multipart~1form-data/schema/properties/file',
    ]);
    final file =
        (((((spec! as Map)['paths'] as Map)['/api/v1/wardrobe/items'] as Map)['post'] as Map)['requestBody'] as Map);
    final schema = ((file['content'] as Map)['multipart/form-data'] as Map)['schema'] as Map;
    expect((schema['properties'] as Map)['file'], containsPair('format', 'binary'));
    expect((schema['properties'] as Map)['file'], containsPair('contentMediaType', 'application/octet-stream'));
  });

  test('changes nothing else in the contract', () {
    final original = _load();
    final prepared = _load();
    addBinaryFormat(prepared);
    expect(jsonEncode(_withoutAddedFormats(prepared)), jsonEncode(original));
  });

  test(
    'relaxes exactly the one boolean const (OkResponse.ok; Detection.mock is a plain boolean now); string consts stay',
    () {
      final spec = _load();
      expect(relaxNonStringConst(spec), ['/components/schemas/OkResponse/properties/ok']);
      final schemas = ((spec! as Map)['components'] as Map)['schemas'] as Map;
      expect(((schemas['Detection'] as Map)['properties'] as Map)['mock'], containsPair('type', 'boolean'));
      expect(((schemas['Detection'] as Map)['properties'] as Map)['mock'], isNot(contains('const')));
      final status =
          ((((schemas['ColorProfileResponse'] as Map)['oneOf'] as List)[0] as Map)['properties'] as Map)['status'];
      expect(status, containsPair('const', 'not_analyzed'));
      expect(relaxNonStringConst(spec), isEmpty); // idempotent
    },
  );

  test('is idempotent (a second run adds nothing)', () {
    final spec = _load();
    addBinaryFormat(spec);
    expect(addBinaryFormat(spec), isEmpty);
  });

  test('leaves text media and existing formats alone', () {
    final doc = <String, Object?>{
      'a': {'type': 'string', 'contentMediaType': 'text/plain'},
      'b': {'type': 'string', 'contentMediaType': 'image/png', 'format': 'byte'},
      'c': {'type': 'integer', 'contentMediaType': 'image/png'},
    };
    expect(addBinaryFormat(doc), isEmpty);
    expect((doc['b']! as Map)['format'], 'byte');
  });
}
