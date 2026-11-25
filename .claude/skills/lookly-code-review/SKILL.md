---
name: lookly-code-review
description: Independent review of a finished slice or stage in the Lookly repository, run by fresh-context subagents on the diff. Use when a slice of work is complete and its tests pass, before the stage gate, and when receiving review feedback from a person or a bot. Do NOT use for reviewing work still in progress or for a style-only question.
---

# Lookly code review

You wrote the code, so you are the worst person to judge it. Review is done by fresh
subagents that see the diff and the requirements, not your reasoning.

## When

- After each slice whose tests pass.
- On the whole stage diff before the stage gate in `lookly-workflow`.
- Again after fixing blocking findings, on the fix diff only.

## How

1. Fix the base: for a stage, its "Started at" commit in `docs/plan/README.md`; for a
   slice, the commit before the slice's first change. Review `git diff $BASE...HEAD` plus
   untracked files you created.
2. Start **two subagents in parallel**, each with only the diff, the paths to read and its
   axis below. Do not pass your conclusions.
3. Read both reports. Verify every finding against the code before acting; a finding can
   be wrong. Fix the confirmed ones, test, and record the rest with a reason.

### Axis 1 — standards

Brief the agent to check the diff against `CLAUDE.md`, the area skill
(`lookly-go-backend`, `lookly-flutter`, `mobile-design`) and these:

- Correctness: edge cases, error paths, nil/null, empty collections, time zones, races,
  resource leaks, unchecked errors.
- Errors are never swallowed: every failure is returned, shown to the user or logged
  with context.
- No duplicated business logic; no logic in widgets or HTTP handlers that belongs in a
  service or notifier.
- No new dependency without a reason stated in the diff or an ADR.
- No TODO, stub, placeholder, fake data or dead code in finished features.
- Tests: do they fail without the change? Do they assert behaviour, not implementation?
  Are refusal paths tested?
- Names match `GLOSSARY.md`.

### Axis 2 — spec and contract

Brief the agent with the spec (or plan) and `docs/api/openapi.json`:

- **Missing:** a user story or contract element with no implementation or no test.
- **Extra:** behaviour nobody asked for.
- **Wrong:** behaviour that contradicts the spec, the contract, an ADR or the error codes
  the mobile app relies on.

### Severity

- **Blocking:** wrong behaviour, data loss, security weakness, broken contract, missing
  test for a changed rule, placeholder in finished work. Fix before the gate.
- **Should fix:** maintainability problems that will cost later. Fix in this stage unless
  the owner agrees otherwise.
- **Note:** style or preference. Fix if cheap, otherwise leave.

## Receiving feedback

- Verify a suggestion before applying it; explain with evidence when you disagree.
- No performative agreement: respond with what you changed or why not.
- A finding from a review bot is a bug report: reproduce it, then fix or refute it.

## Reporting

Tell the owner (Uzbek) how many findings each axis raised, how many were blocking, and
that all blocking ones are fixed — or which remain and why.
