# Catalog terminology: proposal (reconstructed)

> **Reconstructed on 2026-11-24.** The original of this file was never committed and was lost with the
> working environment it lived in. Eight of its rows survived and are quoted word for word in section 6.
> Everything else here was rebuilt from the repository as it is today. **The recommendations in section 3 are
> the reconstruction's own**, except where a row says the owner approved it or names D3 or D10; they are
> proposals to decide, not decisions. The companion file is
> [`catalog-terminology-migration-plan.md`](catalog-terminology-migration-plan.md).

## 1. The problem

The clothing catalog (categories, subcategories, colours, patterns, materials, styles, sleeves, fits, seasons,
formality, gender, occasions) is one list of ids, shared by the API, the database and both clients. The
**labels** shown to people are written twice: once in the web catalog and once in the Flutter app. They
disagree for 49 of the 114 entries, so the same garment is named differently on the phone, on the web and in
the stylist's answers. Several web labels are English ("Slim", "Formal", "Streetwear") or carry an English
word in parentheses ("Ko‘k (navy)").

Ids are not affected by anything here: they never change.

## 2. Where the labels live

The first two columns of the two outfit rows are the original text (section 6); the rest is rebuilt.

| Surface | File | What it holds |
|---|---|---|
| Web catalog (source of the API ids) | `apps/web/src/lib/ai/catalog.ts` | every list: id, label, colour hex |
| Web occasion aliases | `apps/web/src/server/schemas/catalog.ts` (`OCCASION_ALIASES`) | old labels still accepted as a stylist `event` |
| Flutter wardrobe | `apps/mobile/lib/features/wardrobe/presentation/wardrobe_labels.dart` | categories, subcategories, patterns, materials, sleeves, fits, formality, seasons, genders |
| Flutter onboarding and profile | `apps/mobile/lib/features/onboarding/data/options.dart` | styles, colours (with swatches), fits |
| Flutter outfits | `apps/mobile/lib/features/outfits/presentation/outfit_labels.dart` (+ `outfits_repository.dart` id list) | occasions, roles, weather conditions |
| AI: outfit | `apps/web/src/lib/ai/outfit-intelligence.ts` (`OCCASION_PHRASE`, `BAND_LABEL`; the model context sends ids only) | deterministic explanations, in their own Uzbek phrases |
| AI: stylist | `apps/web/src/lib/ai/stylist.ts` (`itemDisplayName`, `APPROVED_COLOR_NAMES`) | item names in answers; four owner-approved colour names |
| Evaluator | `apps/web/scripts/ai-eval/eval-common.ts` (`CATALOG_TERMS`), `client-labels.ts` | which English words in prose are violations, loanwords or review terms |
| Runtime wording check | `apps/web/src/lib/ai/catalog-wording.ts` | the same rule applied to AI explanations |
| Drift test | `apps/web/tests/unit/catalog-drift.test.ts` | ids must match; every label and swatch difference is recorded and checked |

## 3. Every label difference today

From `KNOWN_LABEL_DIFFERENCES` in the drift test (53 rows: 49 entries, four of them shown on two Flutter
screens). "Plain fix" means a spelling, formatting or plainly wrong label; the others are a choice between
valid forms and belong to an open question of section 4.

| List | Id | Web today | Flutter today | Recommended | Why | Status |
|---|---|---|---|---|---|---|
| category | `shirt` | Ko‘ylak / Rubah | Ko‘ylaklar | **Ko‘ylak (tab: Ko‘ylaklar)** | drop "/ Rubah": two alternatives in one label, and "Rubah" appears nowhere else in the repository | **R1** (open) |
| category | `pants` | Shim | Shimlar | **Shim (tab: Shimlar)** | same word; singular for an item, plural for the filter tab | **R1** (open) |
| category | `dress` | Ko‘ylak ( ayol ) | Ko‘ylak (ayollar) | **Ko‘ylak (ayollar)** | the web label has spaces inside the parentheses; the backend messages write "Ko‘ylak (ayol)" | **R1** (open) |
| category | `shoes` | Oyoq kiyim | Poyabzal | **Poyabzal** | both are Uzbek; Flutter, the outfit roles and the item names already say "Poyabzal" | **R2** (open) |
| category | `bag` | Sumka | Sumkalar | **Sumka (tab: Sumkalar)** | singular / plural | **R1** (open) |
| category | `accessory` | Aksessuar | Aksessuarlar | **Aksessuar (tab: Aksessuarlar)** | singular / plural | **R1** (open) |
| subcategory | `blazer` | Bleyzer | Blazer | **Bleyzer** | Uzbek spelling of the loanword; "Blazer" is the English spelling | **R3** (open) |
| subcategory | `windbreaker` | Vetrovka | Shamoldan himoya kurtka | **Vetrovka** | short and in everyday use; the Flutter label is a description, not a name | **R3** (open) |
| subcategory | `knit` | Nitki | Trikotaj | **Trikotaj** | the web already uses "Trikotaj" for the material; "Nitki" is not Uzbek | **R3** (open) |
| subcategory | `jeans` | Jins | Jinsi | **Jinsi** | the usual Uzbek form ("jinsi shim") | **R3** (open) |
| subcategory | `trousers` | Shim (klasik) | Klassik shim | **Klassik shim** | natural word order; the web label is a parenthetical and misspells "klassik" | plain fix |
| subcategory | `shorts` | Shorts | Shorti | **Shorti** | Uzbek spelling; "Shorts" is English | plain fix |
| subcategory | `loafers` | Mokasin | Lofer | **Lofer** | a moccasin is a different shoe | **R3** (open) |
| subcategory | `oxford_shoes` | Oksford | Oksford tufli | **Oksford tufli** | says what it is; the web "Oksford" alone also names the shirt | plain fix |
| subcategory | `sandals` | Sandalli | Sandal | **Sandal** | alternative Uzbek forms | **R3** (open) |
| subcategory | `crossbody` | Kross-bodi | Yelka sumkasi | **Yelka sumkasi** | Uzbek; "Kross-bodi" is a transliteration | **R3** (open) |
| subcategory | `clutch` | Klutch | Klatch | **Klatch** | alternative loan spellings | **R3** (open) |
| subcategory | `belt` | Remen | Kamar | **Kamar** | the Uzbek word; "Remen" is Russian | plain fix |
| subcategory | `hat` | Shlyapa | Bosh kiyim | **Bosh kiyim** | the id covers any headwear; "Shlyapa" is one kind of hat | **R3** (open) |
| pattern | `striped` | Chiziqli | Yo‘l-yo‘l | **Yo‘l-yo‘l** | the usual Uzbek word for striped cloth | **R4** (open) |
| pattern | `checked` | Katakli | Katak | **Katak** | alternative forms of the same word | **R4** (open) |
| pattern | `plaid` | Plaid | Shotland katak | **Shotland katak** | "Plaid" is English | **R4** (open) |
| pattern | `graphic` | Grafikali | Grafik | **Grafik** | alternative forms | **R4** (open) |
| pattern | `color_block` | Rangli blok | Rang bloklari | **Rang bloklari** | alternative forms | **R4** (open) |
| pattern | `denim` | Jins naqshi | Denim | **Jins naqshi** | follows D10 | **D10** (open) |
| material | `denim` | Jins matosi | Denim | **Jins matosi** | the recommendation of D10 in the original plan | **D10** (open) |
| material | `cashmere` | Kashmir | Kashemir | **Kashemir** | alternative loan spellings | **R5** (open) |
| material | `leather` | Teri | Charm | **Charm** | "charm" is the material; "teri" is skin or hide | **R5** (open) |
| sleeve | `short` | Qisqa yeng | Kalta yeng | **Kalta yeng** | both are Uzbek | **R6** (open) |
| fit | `slim` | Slim | Tor | **Tor** | the web shows the English word | **R7** (open) |
| fit | `regular` | Regular | O‘rtacha | **O‘rtacha** | the web shows the English word | **R7** (open) |
| fit | `relaxed` | Relaxed | Erkin | **Erkin** | the web shows the English word | **R7** (open) |
| fit | `oversized` | Oversize | Keng | **Keng** | the web shows the English word; "oversize" is also widely used | **R7** (open) |
| fit.onboarding | `slim` | Slim | Tor | **Tor** | as fit | **R7** (open) |
| fit.onboarding | `regular` | Regular | O‘rtacha | **O‘rtacha** | as fit | **R7** (open) |
| fit.onboarding | `relaxed` | Relaxed | Erkin | **Erkin** | as fit | **R7** (open) |
| fit.onboarding | `oversized` | Oversize | Keng (oversize) | **Keng** | as fit; one label for both Flutter screens | **R7** (open) |
| formality | `formal` | Formal | Rasmiy | **Rasmiy** | the web shows the English word | **R7** (open) |
| formality | `black_tie` | Black tie | Tantanali | **Tantanali** | the web shows the English word | **R7** (open) |
| gender | `male` | Erkak | Erkaklar | **Erkaklar** | for clothing, "for men" reads more naturally than "man" | **R8** (open) |
| gender | `female` | Ayol | Ayollar | **Ayollar** | as male | **R8** (open) |
| gender | `unisex` | Unisex | Uniseks | **Uniseks** | Uzbek spelling | plain fix |
| style | `formal` | Formal | Rasmiy | **Rasmiy** | the web shows the English word | **R7** (open) |
| style | `bohemian` | Bohemian | Bogema | **Bogema** | the web shows the English word | **R7** (open) |
| style | `minimal` | Minimal | Minimalist | **Minimalist** | the web shows the English word | **R7** (open) |
| style | `streetwear` | Streetwear | Ko‘cha uslubi | **Ko‘cha uslubi** | the web shows the English word | **R7** (open) |
| color | `navy` | Ko‘k (navy) | To‘q ko‘k | **To‘q ko‘k** | owner-approved name in `APPROVED_COLOR_NAMES`; the web label carries an English word in parentheses | **approved by the owner** (code) |
| color | `light_blue` | Och ko‘k | Havorang | **Havorang** | one Uzbek word instead of a description | **R9** (open) |
| color | `brown` | Jigarron | Jigarrang | **Jigarrang** | owner-approved name in `APPROVED_COLOR_NAMES` | **approved by the owner** (code) |
| color | `tan` | Sarg‘ish-jigarron | Och jigarrang | **Och jigarrang** | follows the approved "Jigarrang" | **R9** (open) |
| color | `teal` | Zavorq (teal) | Feruza | **Ko‘k-yashil** | owner-approved name in `APPROVED_COLOR_NAMES`; it is **neither** client's label today (web "Zavorq (teal)", Flutter "Feruza") | **approved by the owner** (code) |
| color | `ivory` | Och krem | Fil suyagi | **Fil suyagi** | the literal colour name; "Och krem" is easy to confuse with `cream` | **R9** (open) |
| color | `rust` | Zang (rust) | Zang rang | **Zang rang** | owner-approved name in `APPROVED_COLOR_NAMES` | **approved by the owner** (code) |

Colour swatches also differ for 17 colours (`KNOWN_HEX_DIFFERENCES` in the same test). The proposal is one
hex per colour in the canonical catalog; which of the two values to keep is a design choice, not a wording
one, and is not decided here.

Fixed since the reconstruction: `three_quarter` was "Uchdan to‘rt yeng" in Flutter, which reads as four
thirds; both clients now show "3/4 yeng" (2026-11-24).

`smart_casual` is "Smart-casual" in both clients. It is identical, but still English; whether to keep it is an
owner decision (D10). *(original sentence)*

## 4. Open questions for the owner

D3 and D10 keep their original numbers. The original D1, D2 and D4–D9 are lost; the questions below (R1–R9)
are regrouped from the differences that are still open, and their numbers are new.

| Id | Question | Recommendation |
|---|---|---|
| **D3** | casual: "Kundalik", "Kasual" or "Casual" for style, formality and occasion | **Decided 2026-10-19: Kundalik.** Implemented on the web; old labels stay as `event` aliases. |
| **D10** | Smart-casual and Denim: keep the loanwords or translate | Smart-casual: the owner's call (no natural Uzbek term found in the repository). Denim: "Jins matosi" for the material, "Jins naqshi" for the pattern. |
| **R1** | Categories: one singular label per item and a plural for the filter tab, and the exact text for `shirt` and `dress` (both are "ko‘ylak" in Uzbek) | Singular label plus `pluralLabel` in the catalog; "Ko‘ylak" and "Ko‘ylak (ayollar)". |
| **R2** | Shoes: "Poyabzal" or "Oyoq kiyim" | Poyabzal. |
| **R3** | Subcategory names where both forms are valid: Bleyzer / Blazer, Vetrovka / Shamoldan himoya kurtka, Trikotaj / Nitki, Jinsi / Jins, Lofer / Mokasin, Sandal / Sandalli, Yelka sumkasi / Kross-bodi, Klatch / Klutch, Bosh kiyim / Shlyapa | As in section 3. |
| **R4** | Pattern names: Yo‘l-yo‘l / Chiziqli, Katak / Katakli, Shotland katak / Plaid, Grafik / Grafikali, Rang bloklari / Rangli blok | The Flutter forms. |
| **R5** | Materials: Charm / Teri, Kashemir / Kashmir | Charm, Kashemir. |
| **R6** | Short sleeve: "Kalta yeng" or "Qisqa yeng" | Kalta yeng. |
| **R7** | Fits, styles and formality that the web shows in English (Slim, Regular, Relaxed, Oversize, Formal, Black tie, Bohemian, Minimal, Streetwear) | The Uzbek labels Flutter already shows. |
| **R8** | Gender: "Erkaklar / Ayollar" (for men / for women) or "Erkak / Ayol" | Erkaklar / Ayollar. |
| **R9** | Colours not yet approved: light blue, tan, ivory | Havorang, Och jigarrang, Fil suyagi. |

Already approved by the owner, per `APPROVED_COLOR_NAMES` in `stylist.ts`: navy "To‘q ko‘k", teal
"Ko‘k-yashil", rust "Zang rang", brown "Jigarrang". They are used in stylist answers today; the catalog labels
and both clients still show their old labels.

## 5. What does not change, and how to carry it out

- Ids, the database, the API contract and stored data do not change. Only labels do.
- A label that is also an input needs old values to keep working. Today that is only the stylist `event`
  (occasion): the aliases and the regression tests are in place (migration plan, section 3).
- The stylist's item names and the evaluator read the labels. Changing a label changes the stylist's wording
  and can change evaluator verdicts, so those steps are separate and separately approved (migration plan,
  stages 4 and 5).
- The lasting fix is one canonical catalog file that both clients generate their labels from (migration plan,
  section 4). Until then, each agreed label is changed in both clients in one commit, and its row is removed
  from `KNOWN_LABEL_DIFFERENCES`, which fails the drift test if the clients do not match afterwards.

## 6. Rows recovered from the original

These are the original lines, each after its original line number. The column layout of the original tables
is not known beyond what the rows show. Line 141 refers to a "section 7" of the original; its aliases are now
described in the migration plan, section 3.

```text
42:| Flutter outfits | `apps/mobile/lib/features/outfits/presentation/outfit_labels.dart` (+ `outfits_repository.dart` id list) | occasions, roles, weather conditions | labels | occasion `casual` = "Kundalik" |
46:| AI: outfit | `apps/web/src/lib/ai/outfit-intelligence.ts` (`OCCASION_PHRASE`, `BAND_LABEL`; the model context sends ids only) | deterministic explanations | own Uzbek phrases ("kundalik kiyinishga") | does not quote the "Casual" label, by design |
99:| casual (style, formality) | Kasual | Kundalik | O ("kundalik kiyinishga"), E review | language + translation | **Kundalik** (already used by Flutter and by the app's own explanations) | M | **Yes** (spec section 16 uses "Casual" for the occasion) |
106:`smart_casual` is "Smart-casual" in both clients. It is identical, but still English; whether to keep it is an owner decision (D10).
127:| casual_dress | Kasual ko‘ylak | Kundalik ko‘ylak | S, E | follows the casual decision | **Kundalik ko‘ylak** if D3 = Kundalik | M | Follows D3 |
141:| occasion `casual` | Casual (catalog + home chip) | Kundalik | language; **the web sends this label as `event`** | **Kundalik**, *after* aliases (section 7) | M | **Yes** |
149:**Entries that are identical in both clients (not listed above):** the other 59 entries. Examples: Oq, Qora, Bej, Kulrang, Ko‘k, Yashil, Zaytun, Xaki, Qizil, Bordo…; Kurtka, Palto, Futbolka, Oksford ko‘ylak, Polo, Bluzka, Chinos, Krossovka, Botinka, Ryukzak, Sharf, Soat…; Bir rangli, Gulli; Paxta, Zig‘ir, Jun, Ipak…; Sport, Klassik, Preppi, Smart-casual; Uzun yeng, Yengsiz; the seasons.
172:| D3 | **casual: "Kundalik", "Kasual" or "Casual"** for style, formality and occasion | It is also an API input (`event` label) and is in spec section 16 |
```

The original counted 59 identical entries before D3. Today 65 of the 114 entries are identical; D3 made four
more agree (`casual` in three lists and `casual_dress`) and the `three_quarter` fix one more, so the same count
before D3 gives 60. Why the original
says 59 cannot be checked against the lost text.
