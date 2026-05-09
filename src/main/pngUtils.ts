import * as fs from 'fs'
import * as path from 'path'
import extractChunks from 'png-chunks-extract'
import encodeChunks from 'png-chunks-encode'
import * as pngChunkText from 'png-chunk-text'

/** 1×1 透明 PNG（內建佔位） */
export const MINIMAL_TRANSPARENT_PNG: Buffer = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)

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

/**
 * 從 PNG 讀取 ST `chara` tEXt chunk，解碼為 UTF-8 JSON 字串。
 */
export function extractCharaJson(buffer: Buffer): string {
  try {
    const chunks = extractChunks(buffer)
    for (const ch of chunks) {
      if (ch.name !== 'tEXt') continue
      try {
        const { keyword, text } = pngChunkText.decode(ch.data)
        if (keyword !== 'chara') continue
        const jsonUtf8 = Buffer.from(text, 'base64').toString('utf8')
        return jsonUtf8
      } catch {
        continue
      }
    }
    throw new Error('此 PNG 不包含 ST 角色卡資料')
  } catch (e) {
    if (e instanceof Error && e.message === '此 PNG 不包含 ST 角色卡資料') throw e
    throw new Error(e instanceof Error ? e.message : String(e))
  }
}

/**
 * 將角色 JSON 嵌入 PNG（於第一個 IDAT 之前插入 `chara` tEXt；會移除既有 `chara` chunk）。
 */
export function embedCharaJson(pngBuffer: Buffer, jsonStr: string): Buffer {
  try {
    const chunks = extractChunks(pngBuffer)
    const base64Payload = Buffer.from(jsonStr, 'utf8').toString('base64')
    const textChunk = pngChunkText.encode('chara', base64Payload)

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

    return Buffer.from(encodeChunks(filtered))
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : String(e))
  }
}
