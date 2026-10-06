#!/usr/bin/env bash
# Proves the Android release signing guard fails closed (Gradle dry runs, so
# nothing is compiled or signed):
#
#   apps/mobile$ tool/check_release_signing_guard.sh
#
# Needs the Gradle wrapper that `flutter build apk` generates (android/gradlew,
# git-ignored). Uses a throwaway, incomplete key.properties for the negative
# cases and always removes it; refuses to run if a real one is present.
set -euo pipefail
cd "$(dirname "$0")/../android"

[ -x ./gradlew ] || { echo "android/gradlew missing: run 'flutter build apk --debug' first" >&2; exit 2; }
[ -e key.properties ] && { echo "android/key.properties exists; refusing to touch a real signing config" >&2; exit 2; }
trap 'rm -f key.properties' EXIT

fail=0
LOG=$(mktemp)
# expect <pass|fail> <expected message or -> <description> <gradle args...>
expect() {
  local want=$1 msg=$2 what=$3
  shift 3
  if ./gradlew "$@" -m -q >"$LOG" 2>&1; then got=pass; else got=fail; fi
  if [ "$got" != "$want" ] || { [ "$msg" != - ] && ! grep -q -- "$msg" "$LOG"; }; then
    echo "FAIL: $what (expected $want${msg:+ with \"$msg\"}, got $got)" >&2
    tail -20 "$LOG" >&2
    fail=1
  else
    echo "ok:   $what"
  fi
}

missing='Release signing is not configured'
expect fail "$missing" 'assembleRelease without key.properties' :app:assembleRelease
expect fail "$missing" 'bundleRelease without key.properties' :app:bundleRelease
expect fail "$missing" '-PallowDebugSigning=yes is not "true"' :app:assembleRelease -PallowDebugSigning=yes
ORG_GRADLE_PROJECT_allowDebugSigning=true \
  expect fail "$missing" 'ORG_GRADLE_PROJECT_ env var cannot opt in' :app:assembleRelease
expect fail "$missing" '-Dorg.gradle.project. system property cannot opt in' \
  :app:assembleRelease -Dorg.gradle.project.allowDebugSigning=true
expect pass - 'explicit -PallowDebugSigning=true opts in (local test builds only)' \
  :app:assembleRelease -PallowDebugSigning=true
expect pass - 'debug builds need no release key' :app:assembleDebug

printf 'storeFile=does-not-exist.jks\n' >key.properties
expect fail 'incomplete; missing: storePassword, keyAlias, keyPassword' 'incomplete key.properties' :app:assembleRelease
expect fail 'incomplete' 'incomplete key.properties even with the opt-in' :app:assembleRelease -PallowDebugSigning=true
printf 'storeFile=does-not-exist.jks\nstorePassword=x\nkeyAlias=x\nkeyPassword=x\n' >key.properties
expect fail 'storeFile does not exist' 'key.properties pointing at a missing keystore' :app:assembleRelease

rm -f "$LOG"
exit $fail
