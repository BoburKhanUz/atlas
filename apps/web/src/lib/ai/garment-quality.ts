/**
 * Deterministic photo-quality check before a garment photo is sent to a
 * vision provider. Models classify strongly blurred photos with confidence
 * instead of answering "unclear" (OpenAI accepted every blurred synthetic case),
 * so a photo without usable detail is refused here as "unclear": no provider
 * call, no quota charge.
 *
 * Calibration (2026-10, variance of the Laplacian on the 320 px analysis canvas):
 * - 38 real product photos (Flutter shrine_images): min 47.6, median 362;
 * - the same photos blurred (σ 6 / σ 12) or smoothly upscaled from 24×32: max 14;
 * - synthetic-v2: sharp renders ≥ 28.2, the blurred case 0.5.
 * A threshold of 20 keeps every real photo and refuses every strongly blurred
 * one. Mild blur (σ 3) and pixelated upscales are left to the model: their
 * measures overlap with sharp photos and flat graphics.
 */
import { loadCanvas, measureQuality } from './color-analysis'

export const GARMENT_MIN_SHARPNESS = 20

/** True when the photo has too little detail to classify. Undecodable input returns false (later steps reject it). */
export async function isTooBlurryForAnalysis(buffer: Buffer): Promise<boolean> {
  try {
    return measureQuality(await loadCanvas(buffer)).sharpness < GARMENT_MIN_SHARPNESS
  } catch {
    return false
  }
}
