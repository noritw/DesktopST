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
  grok: 'Grok',
  local: '本機'
}

/** 單一字母的圖示內容。認不得的供應商回 `L`（LLM）。 */
export function llmBadgeGlyph(provider?: string): string {
  if (provider === 'openai') return 'O'
  if (provider === 'claude') return 'C'
  if (provider === 'gemini') return 'G'
  if (provider === 'grok') return 'X'
  // 本機沒有品牌字母可用（Ollama／LM Studio 都可能）；用「本」比 'L' 好認，
  // 而且 'L' 已經是「認不得的供應商」的後備值，不能撞。
  if (provider === 'local') return '本'
  return 'L'
}

/**
 * 訊息時間戳記的顯示格式，供 `formatLlmHoverTitle()` 內嵌使用。
 * 同一天只顯示時:分，跨天补上月/日——與手機 `reminderFormat.ts` 的
 * `formatDateTime()` 同一套邏輯（那支吃不到，這裡是共用檔，自己輕量重寫一份）。
 */
function formatMessageTimestamp(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (sameDay) return time
  return `${d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })} ${time}`
}

/**
 * `Claude / claude-haiku-4-5`。桌面當 hover title，手機當點開後的文字。
 *
 * `timestamp` 選填：附上這則訊息的發話時間（`· 14:32` 或跨天 `· 8/29 14:32`）。
 * 用途是提醒觸發後想知道「這則是哪次提醒發的」——時間戳記本來就藏在這顆小標籤
 * 展開後才看得到，不佔對話泡泡版面（owner 2026-08-29 提出）。
 */
export function formatLlmHoverTitle(provider?: string, model?: string, timestamp?: number): string {
  const label = provider ? (PROVIDER_LABELS[provider] ?? provider) : 'LLM'
  const base = model ? `${label} / ${model}` : label
  return timestamp ? `${base} · ${formatMessageTimestamp(timestamp)}` : base
}

export { PROVIDER_LABELS }
