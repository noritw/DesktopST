import extractChunks from 'png-chunks-extract'
import encodeChunks from 'png-chunks-encode'
import * as pngChunkText from 'png-chunk-text'
import { utf8ToBase64, base64ToUtf8 } from '../util/base64'

/**
 * SillyTavern 角色卡 PNG 的讀寫（`chara` tEXt chunk）。
 *
 * 原本在 `src/main/pngUtils.ts`，這裡是**去掉 `fs` 與 `Buffer` 之後的純邏輯版**：
 * - `Buffer` → `Uint8Array`（`Buffer` 是 `Uint8Array` 的子類別，桌面端可直接傳入；
 *   手機端沒有 `Buffer`）
 * - base64 走 `core/util/base64`，不依賴 `Buffer` 或 `atob`
 * - 檔案讀寫留在呼叫端（桌面用 `fs`，手機用 Filesystem plugin）
 *
 * 錯誤訊息刻意**不寫中文**——那是要顯示給使用者看的 UI 文案，依 roadmap §3.3
 * 不得進 `core/`。這裡只給錯誤代碼，由各平台的 UI 層決定怎麼講。
 */

export type PngCardErrorCode = 'no-chara-chunk' | 'decode-failed'

export class PngCardError extends Error {
  readonly code: PngCardErrorCode
  constructor(code: PngCardErrorCode, message: string) {
    super(message)
    this.name = 'PngCardError'
    this.code = code
  }
}

/** 1×1 透明 PNG（內建佔位）。 */
export const MINIMAL_TRANSPARENT_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

/**
 * 從 PNG 讀取 `chara` tEXt chunk，解碼為 UTF-8 JSON 字串。
 *
 * @throws {PngCardError} code `'no-chara-chunk'`：此 PNG 不含角色卡資料
 * @throws {PngCardError} code `'decode-failed'`：PNG 結構本身解不開
 */
export function extractCharaJson(bytes: Uint8Array): string {
  let chunks: Array<{ name: string; data: Uint8Array }>
  try {
    chunks = extractChunks(bytes)
  } catch (e) {
    throw new PngCardError('decode-failed', e instanceof Error ? e.message : String(e))
  }
  for (const ch of chunks) {
    if (ch.name !== 'tEXt') continue
    try {
      const { keyword, text } = pngChunkText.decode(ch.data)
      if (keyword !== 'chara') continue
      return base64ToUtf8(text)
    } catch {
      continue
    }
  }
  throw new PngCardError('no-chara-chunk', 'PNG contains no SillyTavern chara chunk')
}

/**
 * 將角色 JSON 嵌入 PNG（於第一個 IDAT 之前插入 `chara` tEXt；會移除既有 `chara` chunk）。
 *
 * @throws {PngCardError} code `'decode-failed'`
 */
export function embedCharaJson(pngBytes: Uint8Array, jsonStr: string): Uint8Array {
  try {
    const chunks = extractChunks(pngBytes)
    const textChunk = pngChunkText.encode('chara', utf8ToBase64(jsonStr))

    const filtered: Array<{ name: string; data: Uint8Array }> = []
    for (const ch of chunks) {
      if (ch.name === 'tEXt') {
        try {
          const { keyword } = pngChunkText.decode(ch.data)
          if (keyword === 'chara') continue
        } catch {
          /* keep chunk */
        }
      }
      filtered.push({ name: ch.name, data: ch.data })
    }

    const idatIdx = filtered.findIndex(c => c.name === 'IDAT')
    const insertAt = idatIdx >= 0 ? idatIdx : filtered.length
    filtered.splice(insertAt, 0, textChunk)

    return encodeChunks(filtered)
  } catch (e) {
    if (e instanceof PngCardError) throw e
    throw new PngCardError('decode-failed', e instanceof Error ? e.message : String(e))
  }
}
