import type { LlmProvider } from '@core/data'
import { MODELS_BY_PROVIDER, modelPriceText, splitModelsByPrice } from '@core/llm/modelCatalog'

/**
 * 供應商顯示文案。
 *
 * ⚠️ **模型清單與價格不在這裡** —— 那份在 `@core/llm/modelCatalog`，與桌面版共用同一份
 * （owner 2026-08-06：「模型清單應該跟桌面版同步，並且把價錢都標上去」）。
 * 本檔原本自己列了四五個常用型號，桌面加新型號時手機不會跟上，正是 roadmap §4.1 的 drift。
 *
 * 留在這一層的只有**中文文案**（供應商顯示名、金鑰格式提示、高單價警告字樣），
 * 依 roadmap §3.3 這些不得進 `core/`。
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

/** 該供應商的完整模型清單（與桌面同步）。 */
export function modelsFor(provider: LlmProvider): string[] {
  return MODELS_BY_PROVIDER[provider] ?? []
}

/**
 * 下拉選單的顯示字串：`gpt-5.4-mini（$0.75 / $4.5）`。
 *
 * 價格是**每百萬 tokens 的美金價（輸入 / 輸出）**，
 * 手機畫面窄，單位說明放在欄位下方的 hint 而不是每一列都寫。
 */
export function modelOptionLabel(m: string): string {
  const price = modelPriceText(m)
  return price ? `${m}（${price}）` : m
}

/** 一般／高單價分組。分組本身的規則在 core，這裡只給中文標籤。 */
export { splitModelsByPrice }

export const HIGH_PRICE_GROUP_LABEL = '⚠ 高單價'
export const NORMAL_PRICE_GROUP_LABEL = '一般'
