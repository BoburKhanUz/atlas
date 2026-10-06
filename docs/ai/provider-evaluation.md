# AI provider design and evaluation proposal

Status: proposal. No vendor is selected or recommended here. The goal is a provider-independent design and a small, repeatable evaluation.

## Current state (Phase 4.0)

- The provider layer is implemented: see [`provider-architecture.md`](provider-architecture.md). `LLMProvider` and `VisionProvider` live in `apps/web/src/lib/ai/providers/`, with REST adapters for Gemini and OpenAI (no SDKs) and a mock. The Z.ai SDK is removed.
- No provider is selected: Gemini and OpenAI are candidates for this evaluation. Development uses the mock.
- Garment vision is still a mock (category from filename) until Phase 4.1.

## Design

### LLMProvider (exists)
Keep as the single text-generation boundary. Implementations are selected via `AI_LLM_PROVIDER`. Call sites must not import vendor SDKs.

### VisionProvider (planned)
Extracts garment attributes from an image and returns schema-validated JSON with per-attribute confidence.

```ts
interface VisionProvider {
  name: string
  analyzeGarment(image: { bytes: Uint8Array; mimeType: string }): Promise<GarmentAnalysis>
}
interface Attr<T> { value: T; confidence: number /* 0..1 */ }
interface GarmentAnalysis {
  category: Attr<string>; colors: Attr<string[]>; pattern: Attr<string>
  fit: Attr<string>; formality: Attr<string>; seasonality?: Attr<string[]>
  provider: string; usage?: Record<string, number>
}
```

Rules: validate every response with a Zod schema; on invalid output retry once, then return an error (never fabricate values); low-confidence attributes are shown to the user for confirmation; images come only from the private storage layer.

### Future AI service boundary
If AI workloads outgrow the Next.js API, move providers behind a separate Python/FastAPI service with a narrow HTTP contract (`/vision/garment`, `/llm/complete`), the same schemas, auth between services, and no direct DB access. Until then the providers live in-process.

## Evaluation criteria

1. **Uzbek-language quality**
2. **Garment recognition accuracy**
3. **Privacy / data-processing terms** (including data location, training use on inputs, retention)
4. **Latency**
5. **Cost**

## Eval set

- **Garment photos:** about 100 consented or licensed photos, including local garments (chapan, do'ppi, atlas fabric), varied lighting, backgrounds and categories. Each is labelled by two reviewers (category, colors, pattern, fit, formality); disagreements are resolved by discussion.
- **Stylist prompts:** about 50 Uzbek prompts (occasion, weather, budget, local dress norms, follow-ups), each with a rubric. Native speakers score responses blind to the provider.
- **Consent rule:** no private user photos or conversations are used without explicit, recorded consent. Production data is not used by default.

## Metrics

- Vision: per-attribute accuracy and macro-F1 for category; color match; calibration (does confidence track correctness); schema-valid rate; failure rate on local garments.
- Language (1-5 each, rubric): grammatical correctness, natural Uzbek (not translationese), cultural appropriateness, usefulness of the outfit advice, instruction/format adherence. Report inter-rater agreement.
- Latency: p50/p95 end to end, same network conditions.
- Cost: per 1,000 garment analyses and per 1,000 chat turns, from measured token/image usage.
- Privacy: checklist answered from the vendor's written terms, with links and dates.

## Procedure

1. Freeze the eval set and rubric; store labels in the repo, images outside it.
2. Implement each candidate behind `LLMProvider` / `VisionProvider` with identical prompts and schemas.
3. Run each candidate three times (temperature as used in product) to measure variance.
4. Score automatically (vision, latency, cost) and by blinded native speakers (language).
5. Review privacy terms with the data owner before any real data is sent.
6. Fill the scoring table and decide with the team; re-run when models or terms change.

## Privacy checklist (per candidate)

Data location/regions; whether inputs are used for training (and opt-out); retention period and deletion options; sub-processors; ability to sign a data-processing agreement; handling of images and EXIF.

## Scoring table template

| Candidate | Uzbek quality (1-5) | Garment accuracy (%) | Privacy terms (pass/notes) | Latency p50 / p95 (s) | Cost per 1k calls | Notes |
|---|---|---|---|---|---|---|
| Candidate A | | | | | | |
| Candidate B | | | | | | |
| Candidate C | | | | | | |
