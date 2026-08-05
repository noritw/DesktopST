import type { LlmProvider } from '@core/data'

/**
 * 供應商顯示文案與模型建議清單。
 *
 * ⚠️ **與桌面 `SettingsWindow.tsx` 的 `PROVIDER_LABELS` 等常數刻意小幅重複**
 * （比照 `ui/chat/randomLabels.ts` 的先例，計畫書 §4.12）：這些是 UI 文案，
 * 依 roadmap §3.3 不得進 `core/`，而目前沒有「兩個 UI 共用文案」的層可放。
 * 手機版第一層只要「填 API Key ＋ 供應商／模型」，因此**不搬桌面那份完整的
 * 模型目錄與定價提示**——這裡的建議清單只挑幾個常用的當 `<datalist>`，
 * 使用者仍可自行輸入任意模型名稱。
 */

export const PROVIDERS: LlmProvider[] = ['openai', 'claude', 'gemini', 'grok']

export const PROVIDER_LABELS: Record<LlmProvider, string> = {
  openai: 'OpenAI',
  claude: 'Anthropic Claude',
  gemini: 'Google Gemini',
  grok: 'xAI Grok'
}

export const PROVIDER_KEY_PLACEHOLDER: Record<LlmProvider, string> = {
  openai: 'sk-...',
  claude: 'sk-ant-...',
  gemini: 'AIza...',
  grok: 'xai-...'
}

/** 建議值，非完整目錄；使用者可自行輸入其他模型名稱。 */
export const PROVIDER_MODEL_SUGGESTIONS: Record<LlmProvider, string[]> = {
  openai: ['gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.4', 'gpt-4o-mini', 'gpt-4.1-mini'],
  claude: ['claude-sonnet-5', 'claude-fable-5', 'claude-opus-5', 'claude-haiku-4-5'],
  gemini: ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash'],
  grok: ['grok-4.5', 'grok-4.3']
}
