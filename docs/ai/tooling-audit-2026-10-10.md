# Independent offline audit: real-data tooling gaps A–D (2026-10-10)

> **Verdict: AUDIT PASS WITH LIMITATIONS**
> - Three defects were found: two MEDIUM and one LOW. Each was fixed minimally, within the audit scope, with regression tests.
> - Seven limitations remain. They are documented below and none blocks owner review.
> - Offline only: no provider was called, no network was used, no paid request was made and no real data was used.
> - **NO FINAL PROVIDER SELECTED.** Production AI stays disabled.

**Scope.** The uncommitted working tree on top of `dff3aeb`:
- Gap A: human-review status in `review.ts`, `real-data/validate.ts` and `replay.ts`.
- Gap B: vision intention-to-treat in `vision-itt.ts` and where it is integrated.
- Gap C: dataset-agnostic premise/isolation rubrics in `case-rubric.ts` and every caller.
- Gap D: outfit evaluation on supplied contexts in `outfit-fixtures.ts`, `outfit-rules.ts` and the outfit scoring.

**Method.**
1. Read the code and every caller.
2. Probe edge cases with ad-hoc offline scripts.
3. Mutation-test the key rules (each rule broken on purpose; the tests must fail).
4. Reproduce the historical replays.
5. Check dataset hashes and the stored reports.

## Findings (by severity)

| # | Severity | Gap | Finding | Location | Status |
|---|---|---|---|---|---|
| F1 | **MEDIUM** | D | An explanation that names an **owned but not recommended** item passed grounding. Example: "Oq futbolka va **klassik shim** bilan oq krossovka", with jeans recommended and trousers owned. `inventedGarments` only flags garments the user does not own, and it leaves out ambiguous words such as "shim" on purpose. | `apps/web/scripts/ai-eval/outfit-fixtures.ts` (grounding, line 172) | **FIXED.** `unrecommendedNamed` (line 113) matches every canonical label (web + Flutter) of owned, unrecommended subcategories: longest labels first, and the last word may carry a suffix. Finding: `grounding_explanation_names_unrecommended:<subcategory>`. |
| F2 | **MEDIUM** | C | The rubric identity was checked only when the first case was scored, i.e. **after the first paid provider call**. A changed corpus or a foreign rubric set failed closed, but only after spending a call per provider. This held in `validate.ts` (new code) and in the bake-off (since v2.1). | `apps/web/scripts/ai-eval/real-data/validate.ts:157`, `apps/web/scripts/ai-eval/bakeoff.ts:695`, `apps/web/scripts/ai-eval/case-rubric.ts:65` | **FIXED.** `precheckRubricSet` runs before any provider is built: it throws `RubricIdentityError` on a mismatch and lists undeclared cases. In `validate.ts` it runs only when stylist transmission is enabled; in the bake-off, when the stylist section is selected. |
| F3 | LOW | A | The offline replay ignored `unscorable` from `scoreStylistCase`, so an undeclared case would have counted as an ordinary failure. All 17 synthetic cases are declared, so stored results were not affected. | `apps/web/scripts/ai-eval/replay.ts:203` | **FIXED.** An unscorable case gets its own failure category, `unscorable`, never mixed with the others. |

**Checked and found correct (no change needed):**

- **A**
  - `reviewCase` never returns PASS for a flagged case (`review.ts:71`). The automatic verdict is kept next to `finalStatus`.
  - `summarizeReview` refuses duplicate cases.
  - The counts add up: final pass + final fail + pending + unscorable = cases.
  - `validate.ts` lists pending and unscorable cases under `blockers`.
- **B**
  - Every eligible case is in exactly one outcome bucket, and the buckets sum to `eligible` (`vision-itt.ts:78-90`).
  - Errors, timeouts, malformed and missing outputs and rejected garments count as wrong.
  - A valid abstention is never a garment identification; an abstention on a garment case is never acceptable.
  - Duplicate outputs and outputs for undeclared items are refused (`vision-scoring.ts:277-283`).
  - The old metrics keep their definitions: every existing replay field is identical, and only `itt` is added.
- **C**
  - A missing declaration, or missing required metadata, gives `UNSCORABLE` with `pass` false (`stylist-eval.ts:81-99`).
  - Prototype keys are not treated as declarations (`Object.hasOwn`).
  - JSON rubric sets use a strict schema, and their patterns are compiled and validated.
  - **`lim_ask_missing_item` never passes on keywords.** Every answer below fails:
    - an affirmation with "yo‘q" in it;
    - an answer that does not name the item;
    - a denial followed by "uni … kiysangiz";
    - a negated denial ("yo‘q deb o‘ylamang").
    Only a denial that names the black suit passes.
- **D**
  - The refactor onto `outfit-rules.ts` gives output byte-identical to the `dff3aeb` version of `runOutfitRealistic`.
  - The bake-off outfit scorer (`outfit-scoring.ts`) only gained `export` on two patterns.

## Limitations (documented, not fixed)

> **Update (final pre-approval review, same day):** L1, L2 and L5 have since been fixed or routed to human review; L3 is documented in code; L4, L6 and L7 are confirmed. See [`final-readiness-2026-10-10.md`](final-readiness-2026-10-10.md).

| # | Gap | Limitation |
|---|---|---|
| L1 | D | **A colour mismatch is not detected.** "qora krossovka" passes when the recommended sneakers are white, and so does an unrecommended item named only by a word outside the catalog labels. The check is lexical. |
| L2 | C | **Conservative premise false failures.** "Garderobingizda kostyum yo‘q…" (a correct denial that omits "qora") fails without a review flag, because the item must be named in the denial. Same design as the synthetic `nonexistent_item`; human review is listed in the protocol. |
| L3 | A | **`summary.passed` is the AUTOMATIC count.** In the stylist summary it includes cases pending human review. The authoritative final status is the `review` block. A reader must not treat `summary.passed` as final. |
| L4 | B | **A duplicate output throws** inside `summarize` or `scoreVision`. That cannot happen by construction (one output per item per run), but it would stop report generation rather than silently double-count. |
| L5 | D | **Internal references are matched in upper case only.** `/\b[WO]\d+\b/` does not catch "w1". The production explanation validator already rejects references; this is a secondary check. |
| L6 | C | **The isolation check is a text heuristic** (`HEURISTIC_TEXT_CHECK`). It does not replace API-level authorization tests. |
| L7 | all | **Synthetic and artificial evidence only.** Nothing in this audit measures real-world quality. |

## Tests (from `apps/web`)

| Command | Result | Exit code |
|---|---|---|
| `npx vitest run tests/unit/ai/tooling-audit.test.ts tests/unit/ai/real-data-tooling-gaps.test.ts tests/unit/ai/real-data-validation.test.ts tests/unit/ai/uzbek-output-policy.test.ts tests/unit/ai/eval-rubric-v2.test.ts tests/unit/ai/vision-eval.test.ts` | 6 files, 111/111 | 0 |
| `npx vitest run tests/unit/ai` | 31 files, 639/639 | 0 |
| `npx vitest run` | 53 files, 980/980 | 0 |
| `npx tsc --noEmit -p .` | — | 0 |
| `npx eslint scripts/ai-eval tests/unit/ai` | — | 0 |

**New regression tests: `tests/unit/ai/tooling-audit.test.ts`, 8 tests.**
- F1: "klassik shim", an inflected label, longest-label-first, a label shared by two items.
- F2: the precheck itself; a foreign rubric set in `validate.ts` stops the run with 0 providers built; an undeclared case is reported `UNSCORABLE` in the review block, the summary and the blockers.
- C: the `lim_ask_missing_item` keyword traps.

**Mutation checks** (rule removed on purpose; the tests fail; source restored):
- the `validate.ts` precheck;
- the unrecommended-garment check;
- the `lim_ask_missing_item` premise patterns;
- earlier: A (a flagged case counted as final), B (errors dropped from the denominator), C (keyword fallback), D (foreign items ignored).

## Integrity

| Check | Result |
|---|---|
| Synthetic datasets | vision `synthetic-v2` `9e023ad2…`, stylist `synthetic-v1` `8733e67c…`, outfit `7a16530b…`: all match |
| `source-runs/SHA256SUMS` | passes (exit 0) |
| Stored replays v2, v2.1, v3, v3.1-client-labels | file timestamps unchanged (2026-10-09) |
| Stored replay `revised-evaluator-v3.1-itt` (2026-10-10) | reproduced exactly by the current code, 4 of 4 |
| v3.1-client-labels replay | reproduced exactly apart from the added `itt` field, 4 of 4 |
| Replay identity fail-closed | 5 tampering scenarios refused (`ReplayIdentityError` / `RubricIdentityError`) |
| Cross-user probes | 5/5 disclosures fail; safe refusals pass (stored 6/6, synthetic 1/1) |
| Network / providers | `fetch` trapped: 0 calls; no provider constructed in the replay or the new modules; API keys unset during the replays |
| Scope | changes only under `apps/web/scripts/ai-eval/`, `apps/web/tests/unit/ai/` and `docs/ai/`; no change to `apps/web/src`, `apps/mobile` or `prisma` |

## Files changed by this audit

- `apps/web/scripts/ai-eval/outfit-fixtures.ts`: F1.
- `apps/web/scripts/ai-eval/case-rubric.ts`: `precheckRubricSet`, for F2.
- `apps/web/scripts/ai-eval/real-data/validate.ts`: the F2 precheck, plus the `stylistRubricSet` test injection option.
- `apps/web/scripts/ai-eval/bakeoff.ts`: the F2 precheck.
- `apps/web/scripts/ai-eval/replay.ts`: F3.
- `apps/web/tests/unit/ai/tooling-audit.test.ts` (new).
- This report.

Nothing was committed or pushed.
