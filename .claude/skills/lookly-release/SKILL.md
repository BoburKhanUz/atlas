---
name: lookly-release
description: Release checklist for Lookly — server (staging then production) and mobile (Google Play internal testing, TestFlight, store submission, staged rollout, rollback). Use when preparing any production deploy, a TestFlight or Play build, a store submission, or when the owner asks whether the app is ready to publish. Do NOT use for ordinary feature work.
---

# Lookly release

A release is a promise to real users. Nothing in this checklist is marked done without
evidence from this release; items that need the owner (accounts, signing keys, store
consoles) are listed for them in Uzbek, with exact steps.

## Before any release

- [ ] CI green on the exact commit being released.
- [ ] `lookly-security` release gate done: `insecure-defaults`, dependency audit,
      static analysis; open findings fixed or accepted by the owner in writing.
- [ ] Version bumped (`pubspec.yaml` `version: x.y.z+build`; server image tag = git SHA).
- [ ] `docs/release/mobile-device-test-plan.md` items run on real devices and recorded.
- [ ] Release notes in Uzbek: what changed for users.

## Server (VPS)

1. Deploy the commit to **staging** (same compose files, separate database, mock AI).
2. Run migrations; run the Playwright smoke suite against staging; open the app on a phone
   against staging.
3. Back up production (`deploy/backup.sh`) and copy the backup off the server.
4. Deploy to production; run the smoke checks; watch errors and latency for 30 minutes.
5. Rollback plan, written before deploying: previous image tag, and for migrations either
   a tested down migration or a forward fix. Never deploy a migration you cannot undo or
   fix forward.

## Android (Google Play)

- [ ] `minSdk`, `targetSdk` (≥ the Play requirement of the day, at least 35), `compileSdk` pinned.
- [ ] Signed with the upload key kept outside the repository; release build fails closed without it.
- [ ] R8 on; platform channel classes kept; the release build tested on a device.
- [ ] Data safety form matches what the binary and SDKs collect (photos, account, crash data).
- [ ] Internal testing track first, then closed testing, then production.
- [ ] Staged rollout 1% → 5% → 20% → 100%, advancing only while the crash-free rate and
      ANR rate stay healthy.

## iOS (App Store)

- [ ] Built and signed on macOS CI; never claimed from a Linux session.
- [ ] iPhone only; deployment target set; `PrivacyInfo.xcprivacy` present and accurate;
      `ITSAppUsesNonExemptEncryption` declared; no local-networking exception in release.
- [ ] Usage strings state the real purpose (camera and photos for the wardrobe and the
      selfie colour profile, location for local weather).
- [ ] TestFlight build installed and checked by the owner on their iPhone.
- [ ] Phased release on.

## Store review requirements (both stores)

- [ ] Account deletion available inside the app and working (tested with real keyboard input).
- [ ] Privacy policy and terms published at a live URL and linked in the app and listing.
- [ ] AI-generated content labelled in the app.
- [ ] Reviewer notes and a demo account with a filled wardrobe (`apps/web/scripts/demo-seed.ts`).
- [ ] Screenshots and descriptions in Uzbek match the current app.
- [ ] Age rating questionnaire answered consistently with the 18+ confirmation.

## After release

- Watch crash reports, server errors, AI cost and quota events daily for the first week.
- A regression that affects users gets a rollback first, a fix second.
