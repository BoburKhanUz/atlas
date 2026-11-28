# Lookly — instructions for Claude Code

Lookly is a personal AI stylist: users photograph their own wardrobe and get outfit
recommendations (weather, occasion, colour profile) and a stylist chat. Uzbek-first.
Existing internal identifiers keep the working name `atlas` (Dart packages, env vars
`ATLAS_*`, cookies `atlas_at`/`atlas_rt`, header `X-Atlas-Client`) because clients
depend on them. New code that has no compatibility constraint uses `lookly` (the Go
module and binary). The product name users see is **Lookly**.

## Standing rules (owner decisions — do not override)

1. **Talk to the owner in Uzbek.** Code, commit messages, comments and repo docs are in English.
   The owner is not a programmer: explain outcomes, decisions and risks in plain words.
   Give times to the owner in Tashkent time (UTC+5), not UTC (owner request, 2026-11-28).
2. **Git** (owner approval, 2026-11-25). On the session's assigned branch you may commit
   and push without asking again: (a) a slice whose tests and checks pass locally, so
   work is never lost when the session ends; (b) a stage or bug fix that passed the
   stage gate in `lookly-workflow`. Never push a red build on purpose. Anything else —
   other branches, PRs, force-push, rebase, `reset --hard`, `clean`, stash, destructive
   checkout — needs explicit owner approval.
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
8. **Production and user data:** deploying to production, running migrations there,
   restoring or moving backups, and changing storage need the owner's go-ahead each time.

## Where things are

| Path | What |
|---|---|
| `docs/plan/README.md` | Stages (S0, B0–B8, M1–M7, W1–W2, F1), exit criteria, start commits — read before starting a stage |
| `apps/mobile` | Flutter app (Android + iOS), Riverpod 3, go_router, generated API client in `apps/mobile/packages/atlas_api` |
| `apps/web` | Next.js app: web UI, and until stage B7 the API under `src/app/api/v1` and the Prisma schema |
| `apps/api` | Go backend (stage B0 onward; replaces the Next.js API with the same contract) |
| `docs/api/openapi.json` | The API contract. Until B7 it is generated from `apps/web/src/server/openapi/registry.ts` (see ADR 0003) |
| `docs/adr/` | Architecture decision records — binding; read before changing architecture |
| `docs/architecture/`, `docs/ai/`, `docs/database/`, `docs/deploy/`, `docs/release/` | Design notes, AI design, database cutover, deployment, release checklists |
| `deploy/` | Single-server deployment (Compose overlay, Caddy, backup script) |
| `GLOSSARY.md` | Domain terms and the words to avoid |
| `.claude/skills/` | Project skills (below) |

## Skills — use them

| Skill | When |
|---|---|
| `lookly-workflow` | Start of any feature, stage, bug fix or non-trivial change; before calling anything done |
| `lookly-testing` | Before writing code and before claiming a result |
| `lookly-code-review` | When a slice of work is finished |
| `lookly-go-backend` | Any work in `apps/api` |
| `lookly-flutter` | Any work in `apps/mobile` (it wins over `mobile-design` where they disagree) |
| `mobile-design` | Any screen or visual change in `apps/mobile` |
| `lookly-security` | Auth, sessions, uploads/media, AI calls, quotas, admin, secrets, CI; and before a release |
| `lookly-release` | Preparing a store or production release |

Trail of Bits plugins (enabled in `.claude/settings.json`) are the tools behind the
security gates: `static-analysis`, `sharp-edges`, `insecure-defaults`,
`differential-review`, `supply-chain-risk-auditor`, `variant-analysis`,
`audit-context-building`.

## Commands

```bash
# Flutter (apps/mobile). In cloud sessions: export PATH=/opt/flutter/bin:$PATH
dart format --output=none --set-exit-if-changed lib test tool
flutter analyze
env -u GEMINI_API_KEY -u OPENAI_API_KEY flutter test
tool/openapi/generate_api.sh --check            # generated client matches the contract

# Web and current API (apps/web)
bun install
bun run lint && bun run typecheck
env -u GEMINI_API_KEY -u OPENAI_API_KEY bun run test
bun run openapi:check && bun run openapi:validate
bun run brand:check
bun run test:integration    # needs a PostgreSQL 16 (see .github/workflows/ci.yml, job "integration")
bun run test:e2e            # e2e/run-local.sh: expects a trust-auth PostgreSQL 16 on a Unix socket
                            # (defaults /var/tmp/atlas-pg, port 55432; override PGHOST_DIR/PGPORT_NUM)

# Go backend (apps/api); full list in apps/api/README.md
# -tags nodynamic: always (the WebP encoder must be the built-in one, ADR 0009)
scripts/generate.sh --check && go vet -tags nodynamic ./... \
  && go run honnef.co/go/tools/cmd/staticcheck@v0.8.2 -tags integration,nodynamic ./... \
  && go test -race -tags nodynamic ./...
LOOKLY_TEST_DATABASE_URL=... go test -race -tags integration,nodynamic ./...   # needs a PostgreSQL 16
go run golang.org/x/vuln/cmd/govulncheck@v1.9.0 ./...
```

Tools that may be missing in a fresh cloud session: `semgrep`, a running Docker daemon
(start `dockerd`; Docker Hub may rate-limit pulls). staticcheck and govulncheck run
pinned through `go run`. Say when a gate ran in CI only.

CI (`.github/workflows/ci.yml`) runs the web, e2e, integration, migrations, api (Go),
mobile, docker, secret-scan and repo-rules jobs on every push; `brand:check` is local
until it is added to CI. A red CI on our branch is the next task, before
anything else.
