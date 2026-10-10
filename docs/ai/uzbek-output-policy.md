# Uzbek output policy (user-visible wording)

> **Status: approved policy (2026-10-09), applied by the evaluator only.**
> - Production prompts, context builders and app behaviour are **unchanged**.
> - Enforcing the policy in production is a separate change that needs its own approval.
> - **NO FINAL PROVIDER SELECTED.**

Related:
- [`provider-bakeoff.md`](provider-bakeoff.md): evaluator rubric v3.1;
- [`provider-evaluation.md`](provider-evaluation.md);
- [`real-data-validation-protocol.md`](real-data-validation-protocol.md).

## Policy

1. User-visible AI text (the stylist answer as shown, the outfit explanation) describes clothing and colours in **Uzbek Latin**, using the catalog's Uzbek label whenever one exists.
2. Catalog **identifiers stay internal**: database values, prompt context, structured model output (vision attributes, `referencedItems`, outfit rankings). They are English where the data model requires it.
3. A valid internal identifier is **not** automatically valid user-facing wording. `olive` is a correct vision colour id, and the same word in an answer is a policy violation.
4. These are never penalised without a documented reason:
   - proper names;
   - unavoidable technical terms;
   - a label the app itself shows in that form (a loanword such as *Polo*, *Chinos*, *Smart-casual*).
5. Prose and structured fields are evaluated **separately**. The policy check only ever receives prose.

**Sources of user-facing wording.** The repository has **two**, and they disagree for many ids (see the terminology review below):
- `apps/web/src/lib/ai/catalog.ts`: the web UI, and the labels the stylist itself inserts for `[W…]` references (`src/lib/ai/stylist.ts`).
- The Flutter client: `wardrobe_labels.dart`, `options.dart` and `outfit_labels.dart` under `apps/mobile/lib/features/`.

The evaluator uses both, copied read-only into `scripts/ai-eval/client-labels.ts`. A test checks that copy against the Dart files. The evaluator invents no translation.

## How the evaluator applies it (rubric v3.1)

`catalogWording(text)` in `apps/web/scripts/ai-eval/eval-common.ts`:
- **Scope.** Ids of the clothing and colour lists: categories, subcategories, colours, patterns, materials, styles, sleeve lengths, fits and formality. An id's labels are looked up in every catalog list. Seasons, genders and occasions are not clothing or colour descriptions.
- **Matching.** Whole words. Multi-word ids such as `light blue` and `oxford shirt` are matched first, so `light blue` is not also counted as `blue`. Apostrophes are normalised.
- **Text judged.**
  - Outfit: the explanation.
  - Stylist: the model's own answer with the `[W…]` references removed. The labels the app inserts are canonical by construction, so judging them would only flag review terms the model never wrote.
  - The Uzbek proxy still judges the full text the user sees.
- **Status of an id**, computed from all its labels (web and Flutter):

  | Status | Rule | In prose |
  |---|---|---|
  | `uzbek_label` | no label contains the English word | **violation**; the report names the Uzbek label(s) |
  | `loanword` | every label contains the word | allowed |
  | `review` | the labels disagree (one client shows the English word, the other an Uzbek one), or show the word only in parentheses | allowed, and flagged for a human reviewer (`language_review` in the replay's `humanReview`) |
  | `exempt` | the id is also an ordinary Uzbek word | allowed (documented below) |

- **Verdict.**
  - One violation fails the policy. It is an explicit rule, not a share threshold.
  - The policy is part of the Uzbek verdict (`uzbek.pass`) and is reported separately as `uzbek.catalogWording`. The replay labels such a failure `language_policy`, distinct from `uzbek_proxy` (script, alphabet, Uzbek evidence, English share).
- **No double counting.** Catalog ids were removed from the English-share lexicon, so each English catalog word is judged once, by this policy. The lexicon keeps only function words and everyday English (*the, with, nice, outfit, heels, grey…*).

## Canonical mapping

The groups below show the web catalog labels. The Flutter labels are added where they differ: they are in the code table, and the disagreements are listed in the terminology review.

**Uzbek label exists: the English id is a violation in prose.**

| Group | English id → canonical Uzbek label |
|---|---|
| Colours | white → Oq · black → Qora · beige → Bej · gray → Kulrang · blue → Ko‘k · light blue → Och ko‘k · green → Yashil · olive → Zaytun · khaki → Xaki · brown → Jigarron · red → Qizil · burgundy → Bordo · pink → Pushti · orange → To‘q sariq · yellow → Sariq · purple → Binafsha · cream → Krem · ivory → Och krem · mustard → Xantal |
| Categories | outerwear → Ustki kiyim · shirt → Ko‘ylak / Rubah · pants → Shim · dress → Ko‘ylak ( ayol ) · shoes → Oyoq kiyim · bag → Sumka · accessory → Aksessuar |
| Subcategories | jacket → Kurtka · blazer → Bleyzer · coat → Palto · windbreaker → Vetrovka · tshirt → Futbolka · oxford shirt → Oksford ko‘ylak · blouse → Bluzka · knit → Nitki · jeans → Jins · trousers → Shim (klasik) · casual dress → Kasual ko‘ylak · evening dress → Kechki ko‘ylak · midi dress → Midi ko‘ylak · sneakers → Krossovka · loafers → Mokasin · oxford shoes → Oksford · boots → Botinka · sandals → Sandalli · backpack → Ryukzak · crossbody → Kross-bodi · clutch → Klutch · belt → Remen · scarf → Sharf · hat → Shlyapa · watch → Soat · sunglasses → Quyosh ko‘zoynagi |
| Patterns | solid → Bir rangli · striped → Chiziqli · checked → Katakli · floral → Gulli · graphic → Grafikali · color block → Rangli blok · denim → Jins naqshi (pattern) / Jins matosi (material) |
| Materials | cotton → Paxta · linen → Zig‘ir · wool → Jun · cashmere → Kashmir · silk → Ipak · polyester → Poliester · nylon → Neylon · leather → Teri · suede → Zamsh · knit → Trikotaj · blend → Aralash |
| Styles, fits, sleeves | sporty → Sport · classic → Klassik · preppy → Preppi · oversized → Oversize · short → Qisqa yeng · long → Uzun yeng · sleeveless → Yengsiz · three quarter → 3/4 yeng |

**Loanwords: both clients show the English word as the label, so it is allowed.**
Chinos, Polo, Smart-casual, Tote (*Tote sumka*).

**For review: allowed, but flagged for a human reviewer.**

| Id | Web label | Flutter label | Why it is ambiguous |
|---|---|---|---|
| `blazer` | Bleyzer | Blazer | one client shows the English spelling |
| `denim` | Jins naqshi / Jins matosi | Denim | same |
| `formal`, `minimal`, `bohemian`, `streetwear`, `slim`, `regular`, `relaxed`, `shorts`, `plaid`, `black tie` | Formal, Minimal, Bohemian, Streetwear, Slim, Regular, Relaxed, Shorts, Plaid, Black tie | Rasmiy, Minimalist, Bogema, Ko‘cha uslubi, Tor, O‘rtacha, Erkin, Shorti, Shotland katak, Tantanali | the web shows the English word; Flutter shows Uzbek |
| `casual` | Kasual (style, formality) / Casual (occasion) | Kundalik | three forms |
| `navy` | Ko‘k (navy) | To‘q ko‘k | the English word appears only as a parenthetical clarifier |
| `teal` | Zavorq (teal) | Feruza | same |
| `rust` | Zang (rust) | Zang rang | same |

**Exempt.** `tan` (labels *Sarg‘ish-jigarron* on the web, *Och jigarrang* in Flutter). "tan" is also an ordinary Uzbek word ("tan olmoq", "tana"), and a lexical check cannot tell them apart.

## Terminology review (2026-10-09, from repository evidence only)

- **RESOLVED** means the repository settles how the **evaluator** must treat the word.
- **NEEDS OWNER DECISION** means the repository does not establish which user-facing form is canonical. The evaluator then treats every form the app shows as acceptable, flags English forms for review, and changes no catalog data or production behaviour.

| Item | Repository evidence | Classification | Evaluator treatment | Status |
|---|---|---|---|---|
| Jigarron vs Jigarrang (brown) | web `catalog.ts:88` *Jigarron*; Flutter `options.dart:34` *Jigarrang* (tan: *Och jigarrang*); the web *tan* is *Sarg‘ish-jigarron* | two Uzbek spellings of the same colour; neither is English | both accepted; English `brown` is a violation | evaluator: **RESOLVED** · canonical spelling: **NEEDS OWNER DECISION** |
| Kasual vs Casual (and Kundalik) | web style/formality *Kasual* (`catalog.ts:133,170`); web occasion *Casual* (`catalog.ts:189`, home-screen chip; spec section 16 as quoted in `color-theory.ts:232`); Flutter *Kundalik* for style, formality and occasion. The app's own outfit explanations deliberately avoid "Casual" (`outfit-engine.md`, harness test) | *Casual* is an intentional English UI label; *Kasual* is a loan spelling; *Kundalik* is Uzbek | English `casual` in prose: review (never auto-failed); *Kasual* and *Kundalik* accepted | **NEEDS OWNER DECISION** (which form prose should use) |
| navy, teal, rust | web *Ko‘k (navy)*, *Zavorq (teal)*, *Zang (rust)*: English only in parentheses; Flutter *To‘q ko‘k*, *Feruza*, *Zang rang* | an English clarifier inside an Uzbek label; the two clients use different Uzbek words | review (never auto-failed) | **NEEDS OWNER DECISION** |
| Ko‘ylak / Rubah (shirt) | only `catalog.ts:19`; Flutter *Ko‘ylaklar*; "Rubah" appears nowhere else in the repository | unresolved catalog issue (two alternatives in one label, the second unverified) | no effect: English `shirt` is a violation under every label | evaluator: **RESOLVED** · label text: **NEEDS OWNER DECISION** |
| Ko‘ylak ( ayol ) (dress) | `catalog.ts:21` with spaces inside the parentheses; the backend's own messages write *Ko‘ylak (ayol)* (`api/v1/outfits/route.ts:82-83`); Flutter *Ko‘ylak (ayollar)* | formatting inconsistency in the web label | no effect: tokens are identical with or without the spaces | evaluator: **RESOLVED** · label fix is a production catalog change: **NEEDS OWNER DECISION** |
| Sandalli vs Sandal | web *Sandalli*; Flutter *Sandal* | alternative Uzbek forms | both accepted; English `sandals` is a violation | evaluator: **RESOLVED** · canonical form: **NEEDS OWNER DECISION** |
| Klutch vs Klatch | web *Klutch*; Flutter *Klatch* | alternative loan spellings | both accepted; English `clutch` is a violation | evaluator: **RESOLVED** · canonical form: **NEEDS OWNER DECISION** |
| Nitki vs Trikotaj (knit) | web subcategory *Nitki*, web material *Trikotaj*; Flutter *Trikotaj* for both | alternative Uzbek terms (garment vs material in the web catalog) | both accepted; English `knit` is a violation | evaluator: **RESOLVED** · canonical form: **NEEDS OWNER DECISION** |
| Blazer vs Bleyzer; Denim vs Jins | web *Bleyzer*, *Jins naqshi / Jins matosi*; Flutter *Blazer*, *Denim* | one client shows the English spelling | review (v3.1; in v3 a violation, see below) | **NEEDS OWNER DECISION** |
| sneaker, loaferlar, t-shirt, oxford | not catalog ids (the ids are `sneakers`, `loafers`, `tshirt`, `oxford_shirt`, `oxford_shoes`); Flutter shows *Lofer* and *Oksford tufli*, the web *Mokasin* and *Oksford* | English variants or an English stem with an Uzbek suffix | not detected (a documented limitation; the check only under-detects). Adding variants would expand the forbidden list, which was not approved | **NEEDS OWNER DECISION** (whether to add variant detection) |
| All other disagreements (light blue *Och ko‘k* / *Havorang*, ivory *Och krem* / *Fil suyagi*, windbreaker *Vetrovka* / *Shamoldan himoya kurtka*, crossbody *Kross-bodi* / *Yelka sumkasi*, hat *Shlyapa* / *Bosh kiyim*, belt *Remen* / *Kamar*, leather *Teri* / *Charm*, jeans *Jins* / *Jinsi*, loafers *Mokasin* / *Lofer*, shoes *Oyoq kiyim* / *Poyabzal*, …) | web vs Flutter | two Uzbek forms each | all forms accepted; the English id is a violation | evaluator: **RESOLVED** · single label source: **NEEDS OWNER DECISION** |

**The main owner decision is a single canonical source of user-facing labels.** Today the web catalog and the Flutter client disagree for 46 of the 96 ids in scope (some differ only in plural or spacing, e.g. *Shim* / *Shimlar*). Users can therefore see one word in the wardrobe screen (Flutter) and another in a stylist answer (web catalog labels). This is a product and catalog change, outside the evaluator.

## Known limitations of the lexical check

- **Inflected or variant English forms are not detected.** Examples: *sneaker*, *loaferlar*, *t-shirt*, *oxford* (the id is `oxford_shirt` / `oxford_shoes`). The check only under-detects; it never adds a violation for them.
- English words that are not catalog ids are judged by the general English-share proxy only (threshold 5 %).
- It does not judge fluency, grammar or naturalness. Native raters stay the reference.

## Why the models expose English ids (root cause, not fixed here)

- The stylist and outfit contexts send the model **catalog ids only, without labels**: `stylist-context.ts` (wardrobe items and `colorProfile.recommendedColors`) and `outfit-intelligence.ts` (`aiContext`).
- The prompts ask for "Uzbek (Latin script)" but do not ask the model to translate ids into labels.
- In the bake-off, both providers echoed ids such as "olive, khaki, brown va beige" next to correct Uzbek forms (*zaytun, xaki, bej, jigarron*) in the same answer.
- A production fix (labels in the context, or an explicit prompt rule) is a prompt/context change. It needs separate approval and a new bake-off.

## Effect on the 2026-10 synthetic bake-off (offline replay, no provider calls)

**v3 → v3.1** (`revised-evaluator-v3.1-client-labels/`):
- Exactly 4 verdicts changed, FAIL → pass: stylist `work` r1 and r2, for OpenAI and for Gemini. The only exposed word was "blazer", which the Flutter client itself shows as a label.
- All 4 are now flagged `language_review: blazer` for a human, not silently accepted.
- No other verdict changed. Judging only the model's own words removed 28 review flags caused by app-inserted labels (47 → 19); it changed no verdict.

**v2.1 → v3** (kept for the record):

- Reports: `revised-evaluator-v3-language-policy/` next to the preserved v2 and v2.1 replays, under the artifact directory outside the repository.
- 8 verdicts went from pass in v2.1 to fail in v3, all because of `language_policy` alone:
  - OpenAI stylist `work` r1, r2 (*blazer*);
  - OpenAI outfit `rain` r1 (*burgundy*) and `wind` r2 (*olive*);
  - Gemini stylist `work` r1, r2 (*blazer*) and `date` r2 (*olive*);
  - Gemini outfit `wind` r2 (*khaki*).
- 8 verdicts that already failed in v2.1 changed category, from `uzbek_proxy` (English share) to `language_policy`: `color_profile` ×5, and OpenAI outfit `profile_strong` r1, `profile_none` r1, `profile_weak` r2.
- No verdict went from fail to pass.
- These are stricter, explicitly approved wording requirements applied to the same outputs. They are **not** a change in response quality, and they say nothing about fluency.
