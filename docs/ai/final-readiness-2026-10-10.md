# ATLAS / HARNESS: final pre-approval readiness review (2026-10-10)

> **Verdict: READY FOR OWNER DECISION**
> - The offline evaluation tooling is ready for the owner to decide on the next step.
> - This verdict approves nothing:
>   - **real-data validation** needs separate, explicit approval of the data source, the handling method (storage, access, consent, retention, deletion, legal review) and the specific run;
>   - **every live provider run** (OpenAI, Gemini or any other) needs its own explicit approval, with call and cost caps;
>   - provider selection and any production experiment are later, separate decisions.
> - **NO FINAL PROVIDER SELECTED.** Production AI stays disabled.
> - Offline only: no provider call, no network, no paid request, no real data.

**Scope.** The seven limitations (L1–L7) left by the audit in [`tooling-audit-2026-10-10.md`](tooling-audit-2026-10-10.md), and the overall readiness. That audit's fixes F1–F3 are in place. Working tree: uncommitted, on top of `dff3aeb`.

## Limitations: behaviour, reproduction, risk, outcome

| # | Question | Behaviour before this review (reproduced) | Risk | Outcome |
|---|---|---|---|---|
| L1 | Is a wrong colour on a recommended item detected? | **No.** With white sneakers recommended, "… **qora** krossovka …" passed grounding; so did "qizil futbolka" for a white t-shirt. | **MEDIUM**: a wrong description is graded correct. | **FIXED.** See L1 below. |
| L2 | Is a generic denial a wrong FAIL? | "Garderobingizda **kostyum** yo‘q. Ko‘k bleyzer …" (for "Qora kostyumim …") was a **silent FAIL**: not the named item, so no review flag. | **MEDIUM**: a possibly correct answer fails with no human look. | **FIXED, routed to review.** See L2 below. |
| L3 | Are `summary.passed` and the final review status clearly separate? | The markdown already separates them ("automatic: … — final (no review pending): … PENDING HUMAN REVIEW"). In JSON, `summary.passed` had no description. | LOW: a JSON reader could take `summary.passed` as final. | **CLARIFIED.** See L3 below. |
| L4 | Do duplicates stop with a clear error? | **Yes.** `duplicate output for fixture x (each case is scored once)`, `duplicate case a in a review summary (a case is counted once)`, `duplicate case … in the evaluation sample`, `duplicate output for item …`. | LOW: a report run stops instead of double-counting; this cannot happen by construction. | **ACCEPTED.** The message is now pinned by a test. |
| L5 | Are lower-case references (w1, o2) detected? | **No.** The fixture safety check used `/\b[WO]\d+\b/`, upper case only; the app's own validator in `outfit-intelligence.ts` is case-insensitive. | LOW–MEDIUM: an internal reference in user text passes the safety metric. | **FIXED.** See L5 below. |
| L6 | Is the isolation check documented as heuristic only? | **Yes**, in `case-rubric.ts` (`ISOLATION_CHECK_KIND = 'HEURISTIC_TEXT_CHECK — not an authorization or access-control test'`), in the validation report (`stylist.corpus.isolationCheck`), in `provider-bakeoff.md` ("The evaluator is not an authorization boundary"), in the protocol (gap C row; API-level tests listed as needing live data) and in the audit. | — | **CONFIRMED.** No change. |
| L7 | Are synthetic results presented as real-world evidence? | **No.** The protocol says "They prove the pipeline, not real-world quality". The fixture report status is `FIXTURE_ONLY — not real-world evidence`. Every replay README says "not real-world quality". The thresholds are "PROPOSED — NOT APPROVED" and "none is backed by measured real-world evidence". | — | **CONFIRMED.** No change. |

**L1 fix: `grounding_colour_mismatch:<subcategory>:<colour word>`.**
- `namedGarments` in `apps/web/scripts/ai-eval/outfit-fixtures.ts` reads the word just before a recommended item's label, skipping "rangli" ("zaytun rangli polo").
- It flags a colour word that names none of that item's colours. The colour words come from the canonical colour labels of both clients.
- "och" and "to‘q" are modifiers, not colours.
- Remaining limit: only the word immediately before the label is read. A colour stated elsewhere in the sentence is not checked.

**L2 fix: generic denials go to human review.**
- `premiseHeadDenied` was added in `apps/web/scripts/ai-eval/stylist-scoring.ts`.
- `premiseNeedsReview` is now also true when a clause denies the head noun without naming the item. Such a case becomes `PENDING_HUMAN_REVIEW`.
- The automatic verdict stays FAIL, and the premise rule itself is unchanged (not loosened).
- A contradiction with no denial stays a plain FAIL, with no review flag.
- Effect on the stored synthetic runs: one extra review flag, OpenAI stylist `nonexistent_item` run 3 ("…kostyumga mos boshqa poyabzal yo‘q"). Its verdict and failure category are unchanged. The flag only asks a human to look.

**L3 clarification.**
- `StylistSummary.passed` is now documented in code as AUTOMATIC verdicts that "include cases pending human review; the final status is in a review summary, never here".
- In the validation JSON, the final status is `stylist.live[].review` (`finalPass`, `finalFail`, `pendingHumanReview`, `unscorable`).

**L5 fix.** The fixture safety check now uses `/\b[WO]\d+\b/i`, the same as the app validator.

## Test results (from `apps/web`)

| Command | Result | Exit code |
|---|---|---|
| `npx vitest run tests/unit/ai` | 31 files, 644/644 | 0 |
| `npx vitest run` | 53 files, 985/985 | 0 |
| `npx tsc --noEmit -p .` | — | 0 |
| `npx eslint scripts/ai-eval tests/unit/ai` | — | 0 |

**New regression tests: 5, in `tests/unit/ai/tooling-audit.test.ts` (13 tests in total).**
- L1: wrong colour fails; correct colours pass, including "X rangli", "to‘q ko‘k" and the labels of both clients.
- L2: a generic denial is FAIL and `PENDING_HUMAN_REVIEW`; a contradiction is a plain FAIL; a named denial needs no review.
- L4: the exact duplicate error messages.
- L5: lower-case and upper-case references both fail the safety metric.

**Mutation checks** (rule removed on purpose; tests fail; source restored and verified): the L1 colour check, the L2 generic-denial routing, the L5 case-insensitive pattern.

## Integrity

| Check | Result |
|---|---|
| Synthetic datasets | vision `synthetic-v2` `9e023ad2…`, stylist `synthetic-v1` `8733e67c…`, outfit `7a16530b…`: all match |
| `source-runs/SHA256SUMS` | passes (exit 0) |
| Stored replays | v2, v2.1, v3, v3.1-client-labels, v3.1-itt: all files unchanged (timestamps 2026-10-09 / 2026-10-10 00:43) |
| Replay with the current code vs stored `v3.1-itt` | every verdict, failure category and metric identical; the only difference is the one extra L2 review flag above |
| Outfit engine validation | byte-identical to the `dff3aeb` version |
| Fail-closed identity | 5 tampering scenarios refused (`ReplayIdentityError` / `RubricIdentityError`) |
| Cross-user probes | 5/5 disclosures fail; safe refusals pass (stored 6/6, synthetic 1/1) |
| Network / providers | `fetch` trapped: 0 calls; API keys unset during the replays |
| Scope (`git status` / `git diff`) | changes only under `apps/web/scripts/ai-eval/`, `apps/web/tests/unit/ai/` and `docs/ai/`; nothing under `apps/web/src`, `apps/mobile` or `prisma`; no secrets or personal data |

## Issues found in this review

| Severity | Issue | Status |
|---|---|---|
| MEDIUM | L1: a wrong colour on a recommended item was graded correct | fixed + tested |
| MEDIUM | L2: a generic premise denial failed silently, without review | routed to human review + tested (verdict unchanged) |
| LOW–MEDIUM | L5: lower-case internal references passed the fixture safety metric | fixed + tested |
| LOW | L3: `summary.passed` not described as automatic in JSON | documented in code |
| LOW | L4: a duplicate stops report generation | accepted; message pinned by a test |
| — | L6, L7 | documentation confirmed correct |

**Still open (accepted limitations):**
- The checks are lexical: colour only right before a label; premise and disclosure checks by pattern.
- The isolation check is a text heuristic.
- All evidence is synthetic or artificial.

## Decisions not yet made (owner)

1. **Real-data validation**: the data source, the handling method (storage, access list, consent form, retention, deletion), the legal review outcome, and the specific run. Nothing may be collected, uploaded or processed before this.
2. **Live provider runs**: each run separately (provider, models, capability, `--runs`, `--max-calls`, `--max-cost-usd`), with verified exact-model prices (Gemini's is not yet verified).
3. **The proposed thresholds** in [`real-data-validation-protocol.md`](real-data-validation-protocol.md): all PROPOSED — NOT APPROVED.
4. **Catalog terminology** ([`uzbek-output-policy.md`](uzbek-output-policy.md)): a single source of user-facing labels (web vs Flutter, 46 of 96 ids differ), then the open spellings (Jigarron/Jigarrang, Kasual/Casual/Kundalik, navy/teal/rust, Rubah, "( ayol )", Sandalli/Klutch/Nitki), and whether to detect English variant spellings.
5. **Rubric sets for any future dataset**, written and reviewed with the dataset.
6. **A commit of the current uncommitted work**: not done; it needs its own approval, and pushing needs another.

Provider selection, production enablement and any production experiment come after these, each with its own approval.
