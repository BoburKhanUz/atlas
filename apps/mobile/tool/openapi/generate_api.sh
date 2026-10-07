#!/usr/bin/env bash
# Regenerates packages/atlas_api from docs/api/openapi.json.
#
#   apps/mobile$ tool/openapi/generate_api.sh               # regenerate in place
#   apps/mobile$ tool/openapi/generate_api.sh --check       # fail if the committed copy differs
#   apps/mobile$ tool/openapi/generate_api.sh --update-lock # re-resolve the build toolchain, rewrite the lock
#
# The build toolchain (build_runner, analyzer, built_value_generator …) is
# resolved from tool/openapi/atlas_api.pubspec.lock with --enforce-lockfile,
# so generation never picks up a newly published, possibly incompatible
# version. Refresh the lock deliberately with --update-lock and review it.
#
# Steps: prepare the spec (tool/openapi/prepare_spec.dart) → openapi-generator
# v7.10.0 dart-dio (Docker, pinned) → build_runner (built_value .g.dart files)
# → dart format. Never edit files in packages/atlas_api by hand; change the
# contract, the config or this pipeline and regenerate.
set -euo pipefail
cd "$(dirname "$0")/../.."
MOBILE=$PWD
REPO=$(cd ../.. && pwd)
SPEC=$REPO/docs/api/openapi.json
PKG=packages/atlas_api
GENERATOR_IMAGE=openapitools/openapi-generator-cli:v7.10.0
LOCK=tool/openapi/atlas_api.pubspec.lock
CHECK=0
UPDATE_LOCK=0
[ "${1:-}" = "--check" ] && CHECK=1
# --update-lock only rewrites the lock, then checks the client is unchanged (it never rewrites the package).
[ "${1:-}" = "--update-lock" ] && UPDATE_LOCK=1 && CHECK=1

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

dart run tool/openapi/prepare_spec.dart "$SPEC" "$WORK/spec/openapi.json"
cp tool/openapi/generator-config.yaml "$WORK/spec/config.yaml"
mkdir -p "$WORK/out"
cp tool/openapi/openapi-generator-ignore "$WORK/out/.openapi-generator-ignore"

docker run --rm -u "$(id -u):$(id -g)" -v "$WORK:/work" "$GENERATOR_IMAGE" generate \
  -i /work/spec/openapi.json -g dart-dio -c /work/spec/config.yaml -o /work/out \
  --global-property apiTests=false,modelTests=false,apiDocs=false,modelDocs=false >"$WORK/generator.log" 2>&1 ||
  { cat "$WORK/generator.log"; exit 1; }

(
  cd "$WORK/out"
  if [ $UPDATE_LOCK = 1 ]; then
    dart pub get >/dev/null
    cp pubspec.lock "$MOBILE/$LOCK"
  else
    cp "$MOBILE/$LOCK" pubspec.lock
    dart pub get --enforce-lockfile >/dev/null
  fi
  dart run build_runner build --delete-conflicting-outputs >"$WORK/build_runner.log" 2>&1 ||
    { cat "$WORK/build_runner.log"; exit 1; }
  rm -rf .dart_tool pubspec.lock
  # The generator records its own version and file list; keep only the list.
  rm -f .openapi-generator/VERSION
  dart format --page-width 120 lib >/dev/null
)

if [ $CHECK = 1 ]; then
  if diff -r -q --exclude=.dart_tool --exclude=pubspec.lock "$WORK/out" "$PKG"; then
    echo "packages/atlas_api is up to date"
  else
    echo "packages/atlas_api differs from docs/api/openapi.json — run tool/openapi/generate_api.sh" >&2
    exit 1
  fi
else
  rm -rf "$PKG"
  mkdir -p "$(dirname "$PKG")"
  cp -R "$WORK/out" "$PKG"
  echo "regenerated $PKG"
fi
