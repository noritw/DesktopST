import * as fs from 'fs'
import * as path from 'path'
import {
  MINIMAL_TRANSPARENT_PNG_BASE64,
  PngCardError,
  extractCharaJson as extractCharaJsonCore,
  embedCharaJson as embedCharaJsonCore
} from '../core/card/pngCard'

/**
 * 角色卡 PNG 的桌面端外殼。
 *
 * chunk 讀寫的純邏輯已搬到 `core/card/pngCard.ts`（用 `Uint8Array`，不依賴 `Buffer`）。
 * 這裡只剩桌面專屬的兩件事：用 `fs` 讀佔位圖、把 core 的錯誤代碼翻成給使用者看的中文
 * （UI 文案依 roadmap §3.3 不得進 `core/`）。
 *
 * 對外簽名與訊息維持原樣，呼叫端一行未改。
 */

/** 1×1 透明 PNG（內建佔位） */
export const MINIMAL_TRANSPARENT_PNG: Buffer = Buffer.from(MINIMAL_TRANSPARENT_PNG_BASE64, 'base64')

function loadPlaceholderFromAssets(appRoot: string): Buffer | null {
  try {
    const p = path.join(appRoot, 'assets', 'icon.png')
    if (fs.existsSync(p)) return fs.readFileSync(p)
  } catch {
    /* ignore */
  }
  return null
}

/** 匯出 PNG 時若無頭像則使用此 buffer（優先讀 assets/icon.png） */
export function getExportPngBaseBuffer(appRoot: string): Buffer {
  return loadPlaceholderFromAssets(appRoot) ?? MINIMAL_TRANSPARENT_PNG
}

/** core 的錯誤代碼 → 使用者看得懂的中文訊息（維持搬移前的字句）。 */
function toUserFacingError(e: unknown): Error {
  if (e instanceof PngCardError && e.code === 'no-chara-chunk') {
    return new Error('此 PNG 不包含 ST 角色卡資料')
  }
  return new Error(e instanceof Error ? e.message : String(e))
}

/**
 * 從 PNG 讀取 ST `chara` tEXt chunk，解碼為 UTF-8 JSON 字串。
 */
export function extractCharaJson(buffer: Buffer): string {
  try {
    return extractCharaJsonCore(buffer)
  } catch (e) {
    throw toUserFacingError(e)
  }
}

/**
 * 將角色 JSON 嵌入 PNG（於第一個 IDAT 之前插入 `chara` tEXt；會移除既有 `chara` chunk）。
 */
export function embedCharaJson(pngBuffer: Buffer, jsonStr: string): Buffer {
  try {
    return Buffer.from(embedCharaJsonCore(pngBuffer, jsonStr))
  } catch (e) {
    throw toUserFacingError(e)
  }
}
