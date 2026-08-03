/**
 * 圖片參照的解析（純邏輯）。
 *
 * app 裡「一張圖」在 prompt 組裝階段一律是**字串**，可能是三種形式：
 *
 *   data:image/png;base64,....   ← 實際上幾乎都是這種
 *   https://... / http://...     ← 遠端網址
 *   C:\...\a.png / file://...    ← 本機路徑（少數防禦性路徑）
 *
 * 桌面版原本在 provider adapter 裡直接 `fs.readFileSync` 處理第三種。
 * 那是 `core/` 唯一碰檔案系統的地方，也是唯一擋住 `llm/` 跨平台的東西。
 *
 * **解法：core 只認得 data 與 remote，本機路徑由平台層在呼叫前先轉成 data URI。**
 * 這符合 B2 定下的慣例——core 收「已讀好的資料」，不自己讀檔
 * （roadmap §4.4b）。手機端的 Filesystem API 是非同步的，先轉也才可行。
 */

export type ImageRef =
  | { kind: 'data'; mimeType: string; base64: string }
  | { kind: 'remote'; url: string }
  /** 平台層沒有先解析掉的本機路徑。core 無法讀取，由呼叫端決定怎麼處理。 */
  | { kind: 'local'; path: string }

/** 副檔名 → MIME。桌面與手機共用同一份對應，避免兩邊判斷不一致。 */
export function mimeTypeFromPath(filePath: string): string {
  const lower = filePath.toLowerCase()
  const dot = lower.lastIndexOf('.')
  const ext = dot >= 0 ? lower.slice(dot) : ''
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.gif') return 'image/gif'
  if (ext === '.webp') return 'image/webp'
  return 'image/png'
}

/** 去掉 `file://` 前綴，其餘原樣回傳。 */
export function stripFileScheme(ref: string): string {
  return ref.startsWith('file://') ? ref.slice(7) : ref
}

export function parseImageRef(ref: string): ImageRef {
  if (ref.startsWith('data:')) {
    const match = ref.match(/^data:([^;]+);base64,(.+)$/)
    if (match) return { kind: 'data', mimeType: match[1], base64: match[2] }
    // 格式不完整時沿用舊行為：取逗號後的內容，MIME 當作 png
    return { kind: 'data', mimeType: 'image/png', base64: ref.split(',')[1] ?? '' }
  }
  if (ref.startsWith('http://') || ref.startsWith('https://')) {
    return { kind: 'remote', url: ref }
  }
  return { kind: 'local', path: stripFileScheme(ref) }
}
