/**
 * ColorService: selfie colour analysis. It stays deterministic and in-process
 * (no provider): selfies may count as biometric data, which must not leave
 * the server without a separate decision (Phase 4.3). Only measured here.
 */
import { analyzeSelfie, type AnalyzeSelfieInput, type ColorAnalysisResult } from './color-analysis'
import { recordAiCall } from './telemetry'

export async function analyzeColorSelfie(input: AnalyzeSelfieInput): Promise<ColorAnalysisResult> {
  const started = performance.now()
  try {
    const result = await analyzeSelfie(input)
    recordAiCall({ feature: 'color_analysis', provider: 'deterministic', model: 'color-heuristic', outcome: 'ok', latencyMs: performance.now() - started, attempts: 1 })
    return result
  } catch (err) {
    recordAiCall({ feature: 'color_analysis', provider: 'deterministic', model: 'color-heuristic', outcome: 'error', latencyMs: performance.now() - started, attempts: 1 })
    throw err
  }
}

export type { ColorAnalysisResult }
