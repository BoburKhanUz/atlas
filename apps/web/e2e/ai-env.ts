/**
 * The AI settings every server an e2e run starts gets (playwright.config.ts,
 * playwright.api.config.ts). Playwright starts them with the shell's environment
 * merged in, so these are pinned: whatever the developer's or CI's shell holds,
 * the Go server runs the mock providers, routes no feature elsewhere and sees no
 * provider key (an empty value is unset for Go). Tested in
 * tests/unit/e2e-env-isolation.test.ts.
 */
export const PINNED_AI_ENV = {
  AI_LLM_PROVIDER: 'mock',
  AI_VISION_PROVIDER: 'mock',
  AI_LLM_MODEL: '',
  AI_VISION_MODEL: '',
  AI_STYLIST_PROVIDER: '',
  AI_STYLIST_MODEL: '',
  AI_OUTFIT_PROVIDER: '',
  AI_OUTFIT_MODEL: '',
  AI_APPROVED_PROVIDERS: '',
  GEMINI_API_KEY: '',
  OPENAI_API_KEY: '',
} as const
