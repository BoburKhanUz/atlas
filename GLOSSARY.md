# Glossary

Domain terms used across code, API and docs. One meaning per term. The Uzbek column
is the word users see in the app; code and API use the English term.

| Term | Uzbek (UI) | Meaning | Avoid |
|---|---|---|---|
| **Wardrobe** | Garderob | All clothing items one user owns in Lookly. | closet, collection |
| **Item** (wardrobe item) | Kiyim | One physical garment, shoe or accessory, with its photo and attributes. | product, piece, garment record |
| **Attributes** | Xususiyatlar | Catalog values of an item: category, subcategory, colours, pattern, material, sleeve length, fit, style, season, gender, formality. Always catalog ids, never free text. | tags, labels |
| **Catalog** | — | The fixed lists of allowed attribute values and their Uzbek labels (`apps/web/src/lib/ai/catalog.ts` today). | taxonomy |
| **Analysis** | Tahlil | Turning an item photo into attributes (AI vision, with a deterministic fallback). | detection, recognition |
| **Correction** | Tuzatish | A user's change to an analysed attribute; kept in the item's correction log. | edit, override |
| **Cut-out** | Fonni olib tashlash | The item photo with its background removed on the device (Android only today). | mask, segmentation |
| **Outfit** | Obraz | A set of the user's own items worn together (top, bottom, shoes, optional layers). | look, combo, set |
| **Candidate** | Variant | An outfit the engine proposes in one generate request, before the user saves it. | suggestion, option |
| **Outfit engine** | — | The deterministic rules that build and score candidates from the wardrobe, weather and occasion. | algorithm, recommender |
| **Occasion** | Vaziyat | What the outfit is for: work, wedding, meeting, walk, sport, and so on. | event, context |
| **Stylist** | Stilist | The AI chat that answers using only the user's wardrobe. | assistant, bot, chatbot |
| **Conversation** | Suhbat | One stylist chat thread with its messages. | chat session, thread |
| **Colour profile** | Rang profili | Undertone and season derived from a selfie by a deterministic analyser; the selfie is never stored. | skin analysis |
| **Consent** | Rozilik | The user's acceptance of the current legal version and age confirmation; required for every authenticated feature. | agreement, terms acceptance |
| **Quota** | Kvota | Per-user daily limit of AI calls per feature (Tashkent day). | rate limit (that is a different mechanism) |
| **Session family** | — | All refresh tokens descended from one login; reuse of an old token revokes the whole family. | token chain |
| **Contract** | — | `docs/api/openapi.json`: the API every client and server must match exactly. | spec, schema (ambiguous) |
