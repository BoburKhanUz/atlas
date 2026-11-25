---
name: lookly-security
description: Security gates and checklists for Lookly — authentication and sessions, file uploads and signed media URLs, AI provider calls with untrusted text and images, quotas and rate limits, the admin panel, secrets, dependencies and CI. Use whenever a change touches any of these, at architecture time for those areas, after a security-relevant bug is confirmed, and before every release. Do NOT use for purely visual changes or bugs unrelated to these areas.
---

# Lookly security

Lookly stores accounts, personal photos and selfies-derived data, and sends user text
and images to AI providers. Security work happens at defined gates, with tools, and its
results are written down.

## Gates

| When | What to run | Tool |
|---|---|---|
| Designing auth, tokens, signed URLs, config, admin | Look for dangerous defaults and footguns in the design before code exists | `sharp-edges` (Trail of Bits) |
| Once the Go skeleton exists, and before the release audit | Map trust boundaries and assumptions that nothing enforces | `audit-context-building` |
| A diff touches auth, sessions, uploads, media, AI, quotas, admin or CI | Risk review of the change: removed checks, blast radius, missing tests | `differential-review` |
| Every PR / stage | Static analysis with a fixed rule set, report new findings only | `static-analysis` (semgrep; CodeQL before release) |
| A security-relevant bug is confirmed | Find the same mistake elsewhere and add a rule or test | `variant-analysis` |
| Before every release | Fail-open settings, default secrets, debug leaks, permissive access | `insecure-defaults` |
| Before every release and on dependency changes | Known vulnerabilities and risky packages | `supply-chain-risk-auditor`, `govulncheck`, `npm audit`, OSV |
| Every stage that touches the areas above | The Lookly checklists below for the touched areas | this skill |

The Trail of Bits plugins are enabled in `.claude/settings.json`. If one is not
available in the session, run the underlying tool directly (semgrep, govulncheck) and
say so in the report. Keep their report files out of the repository unless the owner
asks for them.

## Lookly checklists

Read `references/checklists.md` and walk the sections for the areas the change touches:
sessions and auth, uploads and media, AI integration, quotas and abuse, web cookies and
CSRF, Flutter storage and transport, admin, secrets and CI. Every item is a yes/no
question with the place to check.

## Rules that always hold

- **Fail closed.** Missing configuration, unknown provider, failed signature, unparsable
  token, unexpected AI output → refuse, never fall through to "allowed".
- **Deny by default.** Every route declares its auth requirement; ownership is checked in
  the query (`WHERE user_id = $1`), not after loading.
- **Untrusted input everywhere it enters:** request bodies, headers, file bytes, AI output,
  stored text from users. Validate type, size and allowed values at the edge.
- **Secrets never leave the server's environment:** not in the repo, logs, error messages,
  crash reports, client bundles or chat. Compare secrets in constant time.
- **Least data:** AI providers receive catalog ids and the user's own message, never ids,
  emails or other users' data; selfies are not stored.

## Done when

- Every gate that applies to the change has run, or its absence is stated with the reason.
- Every checklist item for the touched areas is answered; each "no" is fixed or accepted
  by the owner.

## Reporting

For each gate: what ran, what it found, what was fixed, what was accepted and why
(accepted risks go into the stage report for the owner, in Uzbek, in plain words).
