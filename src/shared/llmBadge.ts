/**
 * 訊息旁那顆「這則是哪個模型生的」小圖示的呈現規則。
 *
 * 桌面（`LogWindow`）與手機（`MessageList`）共用同一份，
 * 不要在兩邊各抄一份字母對照表——加供應商時只改這裡。
 *
 * 判斷「哪個模型」的資料邏輯在 `core/prompt/promptUtils.ts` 的 `messageLlmMeta()`，
 * 這裡只管怎麼顯示。
 */

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  claude: 'Claude',
  gemini: 'Gemini',
  grok: 'Grok'
}

/** 單一字母的圖示內容。認不得的供應商回 `L`（LLM）。 */
export function llmBadgeGlyph(provider?: string): string {
  if (provider === 'openai') return 'O'
  if (provider === 'claude') return 'C'
  if (provider === 'gemini') return 'G'
  if (provider === 'grok') return 'X'
  return 'L'
}

/** `Claude / claude-haiku-4-5`。桌面當 hover title，手機當點開後的文字。 */
export function formatLlmHoverTitle(provider?: string, model?: string): string {
  const label = provider ? (PROVIDER_LABELS[provider] ?? provider) : 'LLM'
  return model ? `${label} / ${model}` : label
}

export { PROVIDER_LABELS }
