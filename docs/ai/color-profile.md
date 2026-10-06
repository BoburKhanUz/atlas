# Colour profile (Phase 4.3, `color-analysis-v2`)

Status: implemented; a deterministic styling heuristic. **Not** a medical or scientific measurement, and not calibrated on real photos yet. It has no face detection. Its thresholds are first estimates, tuned only on synthetic test images (see Limitations).

## Privacy model

- The selfie is analysed **in-process on the server**. No external AI provider, no network call, no SDK, no AI quota.
- The bytes are decoded into memory, measured on a ≤ 320 px canvas and dropped. Nothing of the image is ever stored, logged or sent anywhere:
  - no file, URL or storage key;
  - no EXIF/GPS;
  - no file name.
  The mobile app also strips EXIF/GPS and downsizes to ≤ 1024 px before upload.
- **Stored:** only the derived profile.
  - On `ColorProfile`: season, undertone, contrast, palettes, confidences and the algorithm version.
  - On `UserProfile`: skin tone, undertone, hair and eye colour.
  - `analysisJson` holds only audit metadata: version, quality score, skin sample size, region count, agreement, and whether hair and eyes were measured. It holds no colour values.
- **Telemetry:** one `ai.call` line with `provider: deterministic`, `model: color-analysis-v2` and the outcome (`ok`, or `invalid_request` for a refused photo), plus latency.
- **One profile per user:**
  - a new analysis replaces it (unique index on `userId`), and no history is kept;
  - `DELETE /api/v1/color-profile` removes the profile and the selfie-derived fields;
  - account deletion removes everything.

## API

| Call | Result |
|---|---|
| `POST /api/v1/color-profile/analyze` (multipart `file`) | 200 with the new profile |
| `GET /api/v1/color-profile` | the current profile, or `not_analyzed` |
| `DELETE /api/v1/color-profile` | `{ ok: true }`, idempotent |

Errors from analyse store nothing:

| Error | Meaning |
|---|---|
| 400 `BAD_REQUEST` | no file |
| 422 `INVALID_IMAGE` | not JPEG/PNG/WebP, > 8 MB, or undecodable (HEIC included) |
| 422 `IMAGE_DIMENSIONS` | shortest side < 256 px or a side > 8000 px |
| 422 `PHOTO_QUALITY_TOO_LOW` | `details: [{path: "reason", message}]` with reason `too_dark`, `overexposed`, `blurry`, `low_detail` or `background` |
| 422 `SKIN_NOT_VISIBLE` | not enough skin to measure |
| 503 `ANALYSIS_UNAVAILABLE` | the analysis itself failed unexpectedly; safe to retry |

**Response fields** (additions are backward compatible):

| Field | Values |
|---|---|
| `undertone` | `warm`, `neutral_warm`, `neutral`, `neutral_cool`, `cool` or `unknown`; profiles from before 4.3 have warm/cool/neutral |
| `undertoneConfidence` | 0–1 |
| `season` | null when no season is supported |
| `secondarySeason`, `secondaryConfidence` | the next closest season and its confidence |
| `confidence` | overall, ≤ 0.8 |
| `hairColor`, `eyeColor` | catalog colour ids, or null when not measurable |
| `contrastLevel` | null when neither hair nor eyes were measured |

Confidences are null on profiles from before 4.3.

## Algorithm

All thresholds are named constants in `apps/web/src/lib/ai/color-analysis.ts`.

1. **Decode check:**
   - format JPEG/PNG/WebP, HEIC refused;
   - real dimensions after EXIF orientation;
   - 40 MP decompression cap.
2. **Canvas:** EXIF-rotated, fitted *inside* 320 px (no crop), transparency flattened.
3. **Quality**, checked on luma; the first failure is reported:

   | Reason | Rule |
   |---|---|
   | `too_dark` | mean < 50, or > 50 % of pixels crushed |
   | `overexposed` | mean > 220, or > 30 % clipped |
   | `low_detail` | luma std < 12 |
   | `blurry` | variance of the Laplacian < 12 |

   A passing photo gets a quality score in [0.6, 1] from its distance to these limits.
4. **Skin:**
   - The skin mask is YCbCr plus luma bounds, inside the central region.
   - Skin-coloured pixels across both the centre and the edges → `background`.
   - The central region is a 4 × 4 grid; only cells that are ≥ 35 % skin count, and at least two are needed.
   - Cells whose lightness differs by more than 15 L* from the most central cells are dropped. This removes dark-brown hair or a wooden wall that also pass the colour test.
   - Shadows (bottom 10 % of L*) and highlights (top 5 %) are trimmed.
   - Colour outliers (more than 3 × the median absolute deviation from the median a\*/b\*) are rejected.
   - The representative colour is the CIELAB mean of what remains.
   - **Agreement** is how consistent the cells' hue angles are, measured before outlier rejection and penalised when many pixels are rejected. A region that disagrees with the rest therefore lowers confidence instead of being silently discarded.
5. **Undertone:** from the skin's CIELAB hue angle.

   | Hue | Undertone |
   |---|---|
   | < 41° | cool |
   | 41–47° | neutral_cool |
   | 47–53° | neutral |
   | 53–59° | neutral_warm |
   | ≥ 59° | warm |

   Confidence = (0.35 + 0.65 × margin to the nearest boundary) × agreement × quality × sample size, capped at 0.75. Below 0.3 the undertone is **unknown**.
6. **Skin tone** from L*: ≥ 68 light, ≥ 57 medium, ≥ 45 tan, otherwise deep.
7. **Hair:**
   - Taken from the band directly above the skin region.
   - Excluded pixels: those close to the measured skin colour, highlights, and blue, green or purple pixels (background or clothing).
   - At least 30 % coverage is required.
   - The result is **unknown** when the band matches the image edges at the same rows (it is background) or when the evidence is weak.
8. **Eyes:**
   - Only when two dark, symmetric regions sit where eyes would be inside the skin region.
   - The darkest 30 % (pupils, lashes) is dropped.
   - Anything less clear is **unknown**, which is common at selfie resolution; no colour is guessed.
9. **Contrast:**
   - Computed from |L\*skin − L\*hair| and 0.8 × |L\*skin − L\*eyes|, whichever is larger.
   - Levels: ≥ 40 high, ≥ 22 medium, otherwise low.
   - Null without hair and eyes.
10. **Season:**
    - Features: warmth, lightness (skin, blended with hair), chroma (clear vs muted) and contrast, each in [−1, 1].
    - The weighted squared distance to the four prototypes (Spring, Summer, Autumn, Winter) goes through a softmax.
    - Missing features (unknown undertone, no contrast) are skipped, never guessed.
    - Confidence = probability × quality × sample size × agreement.
    - Caps: 0.8 overall, 0.45 without an undertone, 0.65 without contrast.
    - Below 0.3 the season is **null**, with no palette.
    - The second-best season is returned as `secondarySeason`.

It is deterministic: the same bytes and the same version always give the same result.

## Limitations

- **No face detection or landmarks.** Regions come from where a selfie's face usually is. Faces off-centre or far from the camera are rejected (`SKIN_NOT_VISIBLE`) or measured with lower confidence.
- **White balance and lighting change skin colour,** and there is no colour reference in the photo. Warm indoor light pushes results warm. Confidence is capped and the disclaimer says so.
- **Deep skin tones in dim light,** and dark-brown hair, overlap in colour. The lightness anchor separates them only when they differ clearly. Very deep skin in poor light may be rejected as `too_dark` or `SKIN_NOT_VISIBLE`. **This must be checked on a diverse, consented test set before launch.**
- **Eye colour** is rarely measurable at selfie resolution and is often null.
- **Thresholds** were set on synthetic images only. Before production, evaluate on consented real selfies across skin tones, lighting and devices. Measure rejection rates, agreement with expert labels, and calibration of the confidences, then tune the constants and bump the version.

## Versions and migration

`20261009000000_color_profile_v2`:
- keeps only each user's current profile (the superseded rows were never read and are deleted);
- makes `userId` unique;
- adds `analysisVersion`, `confidence`, `undertoneConfidence`, `secondarySeason` and `secondaryConfidence`;
- labels existing rows `color-heuristic-v1` with null confidences and clears their raw colour averages.

Rollback: `docs/database/rollback/down-color-profile-v2.sql`, which runs first in the chain (`docs/database/cutover.md`). The deleted superseded rows cannot be restored.

While the new migration is applied, an older build that analyses a selfie for a user who already has a profile fails, because of the unique index. Deploy the new build together with the migration.
