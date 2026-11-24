# Catalog terminology: migration plan (reconstructed)

> **Reconstructed on 2026-11-24.** The original of this file was never committed and was lost with the
> working environment it lived in. Sections 3, 4 and 5 below are the original text, recovered word for word
> (original lines 55–110). Sections 1 and 2 hold the original rows that survived and say what is missing.
> Section 0 is new: it records what has been done since. The companion file is
> [`catalog-terminology-proposal.md`](catalog-terminology-proposal.md), also reconstructed.

## 0. Status on 2026-11-24

| Item | Status |
|---|---|
| **D3** casual → "Kundalik" (style, formality, occasion; `casual_dress` → "Kundalik ko‘ylak") | **Done** on the web (`catalog.ts`), commit 6c77015. Flutter already showed "Kundalik". |
| Section 3, step 1: accept old occasion labels | **Done.** `OCCASION_ALIASES` (`src/server/schemas/catalog.ts`) accepts "Casual" and "Kasual"; apostrophe variants are normalised; `tests/unit/occasion-from-event.test.ts` covers the regression list of section 3. |
| Section 3, step 2: the web sends occasion ids | **Done.** `stylist-screen.tsx` sends the id as `event`. |
| Section 3, step 3: switch the canonical label | **Done** for `casual` (see D3). |
| Section 3, step 4: keep the aliases for one release cycle | **Open.** No release has shipped yet; the aliases stay. |
| Evaluator after D3 | English "casual" in prose stays a *review* term (`POLICY_REVIEW` in `scripts/ai-eval/eval-common.ts`, `REVIEW_ONLY` in `src/lib/ai/catalog-wording.ts`). Making it a violation is a rubric change (stage 4) and needs its own approval. |
| Owner-approved colour names for stylist answers | In code: `APPROVED_COLOR_NAMES` in `src/lib/ai/stylist.ts` (navy "To‘q ko‘k", teal "Ko‘k-yashil", rust "Zang rang", brown "Jigarrang"). The catalog labels themselves are unchanged. |
| Stage 1 (canonical `docs/catalog/catalog.json`, generators) | **Not started.** |
| Every other label difference | **Open.** 54 differences remain, recorded in `tests/unit/catalog-drift.test.ts` and listed in the proposal. |

## 1. Owner decisions

The original table had one row per decision, D1–D10. Only two rows survived. Their cells are the original
text; the column names are reconstructed from the cells:

| Decision | Web today | Flutter today | Recommendation | Alternatives | Dependencies | Risk | Owner decision |
|---|---|---|---|---|---|---|---|
| **D3** casual (style, formality, occasion) | Kasual (style, formality) · Casual (occasion, home chip) | Kundalik (all three) | **Kundalik** | Kasual; Casual (spec section 16) | **API input**: the web sends the occasion label as `event` and `occasionFromEvent` maps label → id. AI: `OCCASION_PHRASE` already says "kundalik kiyinishga". Evaluator review term. | **H** (API input) | **Yes** |
| **D10** Smart-casual, Denim | Smart-casual · Jins naqshi / Jins matosi | Smart-casual · Denim | Smart-casual: owner (no natural Uzbek term found in the repository); denim material: **Jins matosi** | keep "Denim"; translate "Smart-casual" | evaluator: Smart-casual is a loanword, Denim a review term | L | **Yes** |

**D3 is decided** (owner, 2026-10-19: "Kundalik") and implemented. **D10 is open.**

The rows D1, D2 and D4–D9 are lost, and their exact wording cannot be recovered. The questions they covered
are still visible in the repository as open label differences; the reconstructed proposal regroups them as
R1–R9 (its section 4). The owner-approved colour names above suggest that at least the navy / teal / rust /
brown spellings had been decided; which decision number each had is not known.

## 2. Change groups

The original grouped the changes as A, B and C. From the text that survived: group A holds fixes that go into
the catalog once approved (stage 1: "the approved group A fixes"), group B holds rows the owner decides
together with D1–D10 (stage 0), and group C holds changes with a compatibility or behaviour risk. Two rows of
group C survived. Their cells are the original text; the column names are reconstructed:

| Id | Change | Why it needs care |
|---|---|---|
| C2 = **D3** | casual / occasion labels | an occasion label is an **API input** (web `event`); needs the compatibility plan in section 3 |
| C5 | Uzbek labels in the model context or prompt (optional) | a **prompt/context change** (the models echo English ids today); needs a new bake-off, separately approved |

The other rows are lost. C2 is done (section 0). C5 has not been started and still needs a separately
approved bake-off.

## 3. Occasion compatibility plan

**Constraints:**
- The ids `work`, `wedding`, `date`, `travel`, `casual` and `other` never change.
- The database stores the occasion as an id. The API validates ids (`occasionSchema`).
- The stylist `event` is free text. `occasionFromEvent` maps an exact id **or** an exact current label (case-insensitive) to an id; anything else stays free text.

**Problem.** `stylist-screen.tsx` sends the occasion **label** (`OCCASIONS.find(...).label`) as `event`. If the `casual` label changes from "Casual" to "Kundalik", a client still running the old bundle would send "Casual". That text would no longer map to an occasion, and the request would silently lose its occasion. It would not error.

**Steps (each one deployable alone):**
1. **Accept old labels, before any rename.**
   - Add an explicit alias table per occasion id, for example `casual: ['Casual', 'Kasual', 'Kundalik']` and `wedding: ['To‘y', "To'y"]`.
   - `occasionFromEvent` accepts the id, the current label and every alias. Apostrophe variants are normalised (‘ ’ ʻ ' are treated the same).
   - No behaviour change for current inputs.
2. **Send ids from the web.** `stylist-screen.tsx` sends the occasion **id** as `event`, as Flutter already does: it sends `OutfitLabels` ids, and `outfits_repository.dart` uses the id list. Labels then stay presentation-only.
3. **Switch the canonical label** (after D3), for example `casual` → "Kundalik" everywhere: the catalog, the home chips and Flutter. The old labels stay as aliases.
4. **Keep the aliases for at least one full web and app release cycle.** Remove an alias only with a separate decision, and only after telemetry shows it is unused. Event text is never logged with personal data.

**Regression tests (for step 1, written before step 3):**
- `occasionFromEvent` maps each id to itself.
- It maps each current label, in any letter case, to its id.
- It maps each retired alias ("Casual", "Kasual", "To'y" with an ASCII apostrophe) to its id.
- Unknown text, empty strings and whitespace still return `undefined` and stay free text.
- No alias maps to two ids; an alias collision fails the test.
- The web request body carries an id (after step 2), checked by a component or unit test.
- Stored conversation metadata from before the change, where `event` was a label, still resolves the same occasion when replayed through `occasionFromEvent`.

## 4. Source-of-truth architecture

| Question | Answer (proposed) |
|---|---|
| **Where does the canonical catalog live?** | One versioned data file at the repository level, next to the existing API contract: `docs/catalog/catalog.json`, with a JSON Schema beside it. Per list (categories, subcategories by category, colours, patterns, materials, styles, sleeves, fits, seasons, formality, genders, occasions, wardrobe tabs) it holds `id → { label, pluralLabel?, aliases?, hex? }`. Ids are copied from today's catalog unchanged. The web owns edits to it, as it does for `docs/api/openapi.json`. |
| **How does the web get labels?** | A generator (`apps/web/scripts/catalog.ts --write / --check`, same pattern as `scripts/openapi.ts`) writes a typed module (`src/lib/ai/catalog.generated.ts`). `catalog.ts` keeps its exports (`CATEGORIES`, `COLORS`, …, `labelById`) but takes labels from the generated module, so callers do not change. The home chips use the catalog labels instead of their own copy. |
| **How does Flutter get labels?** | A Dart generator (`apps/mobile/tool/catalog/generate.dart --check`, same pattern as `tool/openapi/generate_api.sh --check`) writes `lib/core/catalog/catalog_labels.g.dart`. `WardrobeLabels`, `OutfitLabels`, `ProfileLabels.color` and the onboarding `*Option` labels read from it. The wire ids stay checked against OpenAPI. |
| **How is `client-labels.ts` produced?** | It stops being a hand copy. The evaluator imports the canonical file or generated module directly. During the transition, `client-labels.ts` is generated from the canonical file by the same web generator and marked generated. Its existing Dart-parsing test is replaced by a check that the generated Dart file and the generated web module come from the same catalog version. |
| **How do the drift tests work?** | Web: `catalog.ts --check` regenerates in memory and diffs against the committed generated file. Flutter: `generate.dart --check` does the same. Both fail with the first differing id and field. A shared test asserts that every id in the catalog is in the OpenAPI enums and in `WardrobeCatalog`, and the reverse. |
| **What fails CI?** | (1) a generated file differs from the catalog (web or mobile job); (2) an id in the catalog is missing from OpenAPI or `WardrobeCatalog`, or the reverse; (3) a list lacks a label for an id; (4) label lint: Latin-English words in parentheses, spaces inside parentheses, an ASCII `'` instead of `‘`, leading or trailing spaces, two ids sharing a label in one list; (5) an alias collides with another id's label or alias; (6) the JSON Schema rejects the file. The current OpenAPI checks (`openapi:check`, `generate_api.sh --check`) stay as they are. |

CI already runs a web job (lint, typecheck, test, `openapi:check`) and a mobile job (format, analyze, `flutter test`, API client drift check) in `.github/workflows/ci.yml`. The catalog checks fit into those jobs without a new pipeline.

## 5. Migration stages

| Stage | Scope | Tests | Rollback | Separate approval |
|---|---|---|---|---|
| **0. Owner terminology decisions** | Decide D1–D10 and the group B rows. Native-speaker or linguist review of low-confidence terms. Record the decisions in a decision log under `docs/ai/`. **No code.** | — | — | **Yes**: the decisions themselves |
| **1. Canonical catalog and mapping** | Add `docs/catalog/catalog.json` + schema, holding **today's** labels plus the approved group A fixes. Add the web and Dart generators with `--check`, and an alias table for occasions. **No UI wiring yet**, so nothing user-visible changes. | schema validation; id parity with OpenAPI and `WardrobeCatalog`; generator round-trip; label lint (with an allow-list for the not-yet-decided labels) | delete the new files; nothing depends on them yet | **Yes** |
| **2. Web integration** | `catalog.ts` reads the generated labels; the home chips use catalog labels; `occasionFromEvent` gets aliases (section 3, step 1); later, the web sends occasion ids (step 2); apply the decided labels. | existing web unit tests updated for the pinned labels; occasion alias tests; e2e smoke on the wardrobe, outfits, home and stylist screens; `openapi:check` unchanged | revert the web commit; ids unchanged, so stored data is unaffected | **Yes** |
| **3. Flutter integration** | `WardrobeLabels`, `OutfitLabels`, `ProfileLabels` and the onboarding options read `catalog_labels.g.dart`; apply the decided labels. | `flutter test` with updated widget tests; the generator `--check` in CI; the existing OpenAPI wire-value test | revert the mobile commit; ship the previous app build; ids unchanged | **Yes**; app store release timing is the owner's call |
| **4. AI generator and evaluator** | `itemDisplayName` uses the canonical labels (it changes stylist wording); the evaluator reads the canonical file; `GARMENT_WORDS` gains the canonical labels; old labels stay `review` terms for one cycle; new rubric version. **Optional, separately approved:** labels in the model context or prompt, plus a new bake-off. | stylist naming tests (no English, no "/" or parentheses); evaluator unit tests; an offline replay of the stored synthetic runs into a **new** report directory, with every verdict change listed; v2…v3.1 reports untouched | revert; the earlier rubric version and reports remain reproducible | **Yes**; a prompt or context change and any live run each need their own approval |
| **5. Regression tests and final audit** | The full web and mobile suites; label lint over every surface; a cross-surface check (catalog = web UI = Flutter = stylist naming = evaluator); an audit report under `docs/ai/`. | `npx vitest run`, `tsc`, `eslint`, `flutter test`, the generator `--check` jobs, the occasion compatibility tests | — (read-only) | **Yes**: audit sign-off before the stages are released together |

**Order and independence.**
- Stage 1 changes nothing visible.
- Stage 2, step 1 (aliases) must ship **before** any occasion label changes.

*(The original continued after this line; the rest of "Order and independence" and anything after it is lost.)*
