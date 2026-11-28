---
name: lookly-release
description: Release checklist for Lookly — server (staging then production) and mobile (Google Play internal testing, TestFlight, store submission, staged rollout, rollback). Use when preparing any production deploy, a TestFlight or Play build, a store submission, or when the owner asks whether the app is ready to publish. Do NOT use for ordinary feature work.
---

# Lookly release

A release is a promise to real users. Nothing in this checklist is marked done without
evidence from this release; items that need the owner (accounts, signing keys, store
consoles) are listed for them in Uzbek, with exact steps.

Deploying to production, running migrations there, moving or restoring backups and
changing storage each need the owner's go-ahead for that release (CLAUDE.md rule 8).

## Before any release

- [ ] CI green on the exact commit being released.
- [ ] `lookly-security` release gate done: `insecure-defaults`, dependency audit,
      static analysis; open findings fixed or accepted by the owner in writing.
- [ ] Version bumped (`pubspec.yaml` `version: x.y.z+build`); the server release commit recorded in the release notes.
- [ ] `docs/release/mobile-device-test-plan.md` items run on real devices and recorded.
- [ ] Release notes in Uzbek: what changed for users.

## Server (VPS)

1. Deploy the commit to **staging** (same compose files, separate database, mock AI).
2. Run migrations; run the Playwright smoke suite against staging; open the app on a phone
   against staging.
3. With the owner's go-ahead: back up production (`deploy/backup.sh` covers the database
   and local uploads; R2 objects need their own versioning or copy) and move the backup,
   encrypted, to the off-server destination the owner approved. Backups contain personal
   photos and password hashes: never to a personal device, chat or public bucket.
4. With the owner's go-ahead: deploy to production; run the smoke checks; watch errors
   and latency for 30 minutes.
5. Rollback plan, written before deploying. Images are built on the server today, so a
   rollback redeploys the previous release commit; for migrations, a tested forward fix
   (down migrations only with a fresh backup and the owner's approval).

## Android (Google Play)

- [ ] `minSdk`, `targetSdk` (at least the current Google Play requirement — check it at release time), `compileSdk` pinned.
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
- [ ] Reviewer notes and a demo account with a filled wardrobe (`lookly demo-seed`, docs/plan/B7.md, B7.8).
- [ ] Screenshots and descriptions in Uzbek match the current app.
- [ ] Age rating questionnaire answered consistently with the 18+ confirmation.

## After release

- Watch crash reports, server errors, AI cost and quota events daily for the first week.
- A regression that affects users gets a rollback first, a fix second.
