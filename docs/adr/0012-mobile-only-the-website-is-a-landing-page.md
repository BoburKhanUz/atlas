# 0012. Lookly is a mobile app only; the website is a landing page

- Status: accepted
- Date: 2026-11-28
- Decided by: the owner

## Context

Until now the plan kept a user web app (`apps/web`, Next.js) beside the mobile app,
and stage B7 was to move its pages onto the Go API (W1, ADR 0005). The owner decided
that users use Lookly through the mobile app only, and that lookly.uz shows a landing
page that sends visitors to the stores.

## Decision

- No user web app. The signed-in pages of `apps/web` (wardrobe, outfits, stylist,
  profile, sign-in and sign-up) are retired with the old API in B7, not ported.
- `apps/web` serves: the landing page at `/` (stage W0), the legal pages (`/privacy`,
  `/terms`, which the stores require as public URLs), the pages an e-mail link opens
  (`/reset-password`, until B9 moves the reset into the app) and the store-required
  page for asking to delete an account, and the admin panel (W2). It calls the Go API
  only.
- The store links (Google Play, App Store) are set in the admin panel, not in code;
  until a link is set its badge says "Tez kunda" ("coming soon"). The landing page
  reads them from a public Go endpoint added with the admin API (B8).

## Consequences

- B7 is smaller: the user pages are deleted instead of rewritten; ADR 0005's
  "five files that import server modules are rewritten" no longer applies to them.
- The browser suite (`apps/web/e2e`) tests the user journeys through the web app's
  pages today. In B7 those journeys move to API-level specs against the Go server
  (sessions, uploads, outfits, stylist, colour profile, account deletion), and the
  phone journeys to the Flutter integration tests (M6). No journey loses its test.
- Web session cookies (`atlas_at`, `atlas_rt`) remain for the admin panel only.
- Done in B7.6 (docs/plan/B7.md). The retired pages, the old API and Prisma are in git
  history at **e57764f**, the last commit that has them.

## Alternatives considered

- Keep the web app for users without a phone at hand: declined by the owner.
