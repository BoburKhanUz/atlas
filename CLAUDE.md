# Lookly — instructions for Claude Code

Lookly is a personal AI stylist: users photograph their own wardrobe and get outfit
suggestions (weather, occasion, colour profile) and a stylist chat. Uzbek-first.
The repository's internal working name is `atlas` (packages, env vars, cookies);
the product name users see is **Lookly**.

## Standing rules (owner decisions — do not override)

1. **Talk to the owner in Uzbek.** Code, commit messages, comments and repo docs are in English.
   The owner is not a programmer: explain outcomes, decisions and risks in plain words.
2. **Git.** Work on the session's assigned branch. A stage that has passed every gate in
   `lookly-workflow` may be committed and pushed to that branch without asking again
   (owner approval, 2026-11-25). Anything else — other branches, PRs, force-push, rebase,
   `reset --hard`, `clean`, stash, destructive checkout — needs explicit owner approval.
3. **Never claim something works without fresh evidence from this session.** Say plainly
   what was not verified (device, iOS, live AI, production).
4. **Paid AI calls only with owner approval** (count and cost cap stated in advance).
   Run test suites with `env -u GEMINI_API_KEY -u OPENAI_API_KEY`.
5. **Secrets:** never print or commit keys, tokens or passwords; refer to variables by
   name; never ask the owner to paste a secret into chat.
6. **AI prompts and evaluator verdict rules** change only with separate owner approval;
   a prompt change bumps its version constant.
7. **No placeholders in finished work:** no TODO, stub, fake data or dead code in a
   feature called done. No test may be skipped, disabled or weakened to get green.

## Where things are

| Path | What |
|---|---|
| `apps/mobile` | Flutter app (Android + iOS), Riverpod 3, go_router, generated API client in `apps/mobile/packages/atlas_api` |
| `apps/web` | Next.js app: web UI, and (until the Go backend replaces it) the API under `src/app/api/v1` |
| `apps/api` | Go backend (being built; replaces the Next.js API, same contract) |
| `docs/api/openapi.json` | The API contract — the single source of truth for every client and server |
| `docs/adr/` | Architecture decision records — read before changing architecture |
| `docs/architecture/`, `docs/ai/`, `docs/release/` | Design notes, AI design, release checklists |
| `GLOSSARY.md` | Domain terms and the words to avoid |
| `.claude/skills/` | Project skills (below) |

## Skills — use them

| Skill | When |
|---|---|
| `lookly-workflow` | Start of any feature, stage or non-trivial change; before calling anything done |
| `lookly-testing` | Before writing code and before claiming a result |
| `lookly-code-review` | When a slice of work is finished |
| `lookly-go-backend` | Any work in `apps/api` |
| `lookly-flutter` | Any work in `apps/mobile` |
| `mobile-design` | Any screen or visual change in `apps/mobile` |
| `lookly-security` | Auth, sessions, uploads/media, AI calls, quotas, admin, secrets, CI; and before a release |
| `lookly-release` | Preparing a store or production release |

Trail of Bits plugins (enabled in `.claude/settings.json`) are the tools behind the
security gates: `static-analysis`, `sharp-edges`, `insecure-defaults`,
`differential-review`, `supply-chain-risk-auditor`, `variant-analysis`,
`audit-context-building`.

## Commands

```bash
# Flutter (apps/mobile) — Flutter is at /opt/flutter in cloud sessions
dart format --set-exit-if-changed lib test
flutter analyze
flutter test

# Web / current API (apps/web)
bun install
bun run lint && bun run typecheck && bun run test
bun run openapi:check && bun run openapi:validate
bun run brand:check
bun run test:e2e          # needs PostgreSQL; see apps/web/e2e/run-local.sh

# Go backend (apps/api) — once it exists
go vet ./... && go test ./...
```

CI (`.github/workflows/ci.yml`) runs all of these on every push; a red CI on our
branch is work to do now, not later.
