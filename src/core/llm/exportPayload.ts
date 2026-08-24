/**
 * DeST 手機版 → 食記：AI 服務設定的匯出格式。
 * 用於 QR 圖片內容與 Android 分享文字，兩種管道共用同一段編碼字串，
 * 接收端只需要一套解析邏輯。
 *
 * v2（2026-08-25，owner 要求）：**帶走所有已經填金鑰的供應商**，不是只有
 * DeST 目前使用中的那一組——食記自己也能切供應商，只給目前那組的話，
 * 使用者在 DeST 裡另外設定過的其他家金鑰用不到，還是得手動填。
 * `provider` 是 DeST 目前使用中的那家，食記匯入後拿來當預設選取。
 */

import { utf8ToBase64, base64ToUtf8 } from '../util/base64'

const PREFIX = 'deST-llm-export:v2:'

export interface LlmExportPayload {
  /** DeST 目前使用中的供應商，食記匯入後以此為預設選取。 */
  provider: string
  /** provider → API Key，只含有實際填過的。 */
  keys: Record<string, string>
  /** provider → 該供應商選用的型號（有值才附）。 */
  models?: Record<string, string>
  /** provider → 自訂端點（例如本機模型的網址，有值才附）。 */
  endpoints?: Record<string, string>
}

export function encodeLlmExportPayload(payload: LlmExportPayload): string {
  return PREFIX + utf8ToBase64(JSON.stringify(payload))
}

/** 傳入任意文字（QR 掃到的內容、分享或貼上的文字），不是這個格式就回傳 null。 */
export function decodeLlmExportPayload(text: string): LlmExportPayload | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith(PREFIX)) return null
  try {
    const data = JSON.parse(base64ToUtf8(trimmed.slice(PREFIX.length)))
    if (!data || typeof data.provider !== 'string' || typeof data.keys !== 'object' || data.keys === null) return null
    return data as LlmExportPayload
  } catch {
    return null
  }
}
