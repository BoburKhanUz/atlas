---
name: lookly-workflow
description: How work is planned, built, checked and reported in the Lookly repository. Use at the start of any feature, stage, bug fix or non-trivial change; when writing a spec or plan; when a slice of work is finished; and before telling the owner something is done or committing it. Do NOT use for a quick question or a one-line change that needs no plan.
---

# Lookly workflow

The owner is not a programmer and approves each stage. Your job is to make every
decision visible, every result verifiable, and every finished feature truly finished.

## The order of work

Follow these steps in order. Each has a "done when" check; do not start the next
step until it holds.

1. **Understand.** Read the relevant code, `docs/api/openapi.json`, `docs/adr/`,
   `GLOSSARY.md` and the existing tests. Look facts up yourself; never ask the owner
   something the repository can answer.
   *Done when:* you can state the current behaviour and what must change in two sentences.
2. **Decide.** Collect the open decisions (behaviour, trade-offs, scope). Ask the owner
   only what is theirs to decide (see "Asking the owner").
   *Done when:* every decision is answered or has a recorded default.
3. **Spec** (features and stages; skip for a contained bug fix). Write it with
   `references/spec-template.md` into the stage's plan file or the PR description.
   *Done when:* behaviour, out-of-scope and test seams are written down.
4. **Plan.** Break the work into thin vertical slices (see "Slices"). For each slice:
   files touched, the test that proves it, the "done when".
   *Done when:* the plan has no TODO, "TBD", "handle edge cases" or "add tests later".
5. **Build slice by slice** with `lookly-testing`: failing test, code, passing test,
   whole suite. Use `lookly-go-backend`, `lookly-flutter`, `mobile-design` and
   `lookly-security` for their areas.
   *Done when:* the slice's tests and the full suite pass in this session.
6. **Review** each finished slice with `lookly-code-review`. Fix every blocking finding.
   *Done when:* no blocking finding is open.
7. **Gate, report, commit** (see "Stage gate").

## Asking the owner

- Ask in Uzbek, in plain words, one round with every open decision at once.
- Put your recommendation first and word it so "ha" accepts it. Give the cost or risk
  of each option in one line.
- Never ask technical questions the owner cannot judge (test seams, ticket sizes, library
  versions). Decide them yourself and report what you decided.
- If a decision blocks only one slice, continue with the others while you wait.

## Slices

- A slice is a thin end-to-end path that can be shown working on its own: request in,
  rule applied, stored, response out, test green.
- Prefer many small slices over one big change. A slice fits in one focused session.
- Wide refactors: expand (add the new path), migrate callers in batches, contract (remove
  the old path). Every step leaves the build green.
- Never break working behaviour. If a slice must change behaviour the contract or the
  mobile app relies on, stop and ask.

## Debugging

1. Reproduce first: one fast, deterministic command that shows the bug (ideally a failing test).
2. Write 3–5 ranked hypotheses that the reproduction can falsify. Test them in order.
3. Fix the root cause, not the symptom. Keep the reproduction as a regression test.
4. After three failed fix attempts, stop. Tell the owner what you tried and what you think
   the design problem is; do not keep patching.
5. After any confirmed bug, look for the same mistake elsewhere (`variant-analysis`).

## Architecture decisions

Write an ADR in `docs/adr/NNNN-short-slug.md` (template: `docs/adr/0000-template.md`)
when a decision is hard to reverse, would surprise a newcomer, and involved a real
trade-off. Do not write ADRs for routine choices. Update the ADR's status if a later
decision replaces it.

## Stage gate

A stage (or a self-contained piece of work) is finished only when all of these hold,
each with evidence from this session:

- [ ] All tests and CI checks for the touched apps pass locally (commands in `CLAUDE.md`).
- [ ] `lookly-code-review` ran on the whole diff; blocking findings are fixed.
- [ ] `lookly-security` gate ran if auth, sessions, uploads, AI, quotas, admin, secrets or CI changed.
- [ ] No TODO, stub, placeholder text, fake data or commented-out code in finished features.
- [ ] Docs, ADRs and `GLOSSARY.md` match the code; stale statements were fixed, not left.
- [ ] Nothing was claimed that was not verified; unverified parts are listed for the owner.

Then commit (English message, why before what) and push to the session branch — the
owner pre-approved this for gated stages. After the push, check CI on that commit; red CI
is the next task, before anything else.

## Reporting to the owner

Write in Uzbek, short, in this order:

1. What changed for the user or the product (not file names).
2. Evidence: which tests and checks passed, with numbers.
3. What was not verified and why (device, iOS, live AI, production).
4. Decisions needed, each with your recommendation.

Never write "ishlaydi" (works) for something you did not run. Prefer "testlar o'tdi"
(tests passed) with the count, and name what remains unverified.
