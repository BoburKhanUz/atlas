import 'dart:io';

import 'package:atlas_mobile/app/build_info.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('atlasAppVersion equals the pubspec.yaml version (error reports name the build)', () {
    final line = File('pubspec.yaml').readAsLinesSync().firstWhere((l) => l.startsWith('version:'));
    expect(atlasAppVersion, line.substring('version:'.length).trim());
  });
}
