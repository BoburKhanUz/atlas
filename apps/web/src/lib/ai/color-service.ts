/**
 * ColorService: selfie colour analysis. Deterministic and in-process (no
 * provider, no network, no AI quota): selfies may count as biometric data and
 * never leave the server. Telemetry carries the outcome and latency only —
 * never image bytes, colours or results.
 */
import { COLOR_ANALYSIS_VERSION, PhotoQualityError, SkinNotVisibleError, analyzeSelfie, type AnalyzeSelfieInput, type ColorAnalysisResult } from './color-analysis'
import { recordAiCall } from './telemetry'

/** Shown with every colour profile: a styling estimate, not a measurement. */
export const COLOR_DISCLAIMER = 'Bu taxminiy styling tavsiyasi — tibbiy yoki ilmiy xulosa emas. Natija yorug‘lik va kameraga bog‘liq.'

export async function analyzeColorSelfie(input: AnalyzeSelfieInput): Promise<ColorAnalysisResult> {
  const started = performance.now()
  const record = (outcome: 'ok' | 'invalid_request' | 'error') =>
    recordAiCall({ feature: 'color_analysis', provider: 'deterministic', model: COLOR_ANALYSIS_VERSION, outcome, latencyMs: performance.now() - started, attempts: 1 })
  try {
    const result = await analyzeSelfie(input)
    record('ok')
    return result
  } catch (err) {
    // A photo the analysis refuses is the user's input, not a failure of the analysis.
    record(err instanceof PhotoQualityError || err instanceof SkinNotVisibleError ? 'invalid_request' : 'error')
    throw err
  }
}

export type { ColorAnalysisResult }
