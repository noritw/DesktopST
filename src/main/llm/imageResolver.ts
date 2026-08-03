import * as fs from 'fs'
import { parseImageRef, mimeTypeFromPath } from '../../core/llm/imageRef'
import type { ChatLLMParams } from '../../core/llm'

/**
 * 把 prompt 參數裡的**本機圖片路徑**先讀成 data URI，再交給 `core/llm`。
 *
 * 搬移前是各家 provider adapter 自己 `fs.readFileSync`；那是 `llm/` 唯一
 * 碰檔案系統的地方，也是唯一擋住跨平台的東西。改成呼叫前先解析，
 * `core/` 就完全不需要知道檔案系統存在（roadmap §4.4b 的慣例）。
 *
 * 實務上使用者附加的圖片一律已經是 `data:` URI
 * （輸入視窗走 `FileReader.readAsDataURL`、截圖走 `dataUrl`、手機端也是），
 * 所以這支通常是**原樣回傳、一個檔案都不會讀**。它是防禦性路徑。
 *
 * MIME 判斷沿用搬移前的副檔名對應（`core/llm/imageRef` 的 `mimeTypeFromPath`），
 * 讀不到檔案時比照搬移前直接讓例外往上拋。
 */

function resolveOne(ref: string): string {
  const parsed = parseImageRef(ref)
  if (parsed.kind !== 'local') return ref
  const base64 = fs.readFileSync(parsed.path).toString('base64')
  return `data:${mimeTypeFromPath(parsed.path)};base64,${base64}`
}

function resolveList(refs: string[] | undefined): string[] | undefined {
  if (!refs || refs.length === 0) return refs
  let changed = false
  const out = refs.map(r => {
    const resolved = resolveOne(r)
    if (resolved !== r) changed = true
    return resolved
  })
  return changed ? out : refs
}

/**
 * 回傳一份新的 params。
 *
 * ⚠️ 一定要複製而不是就地修改——`params.messages` 是**存在記憶體裡的對話物件**，
 * 就地改會把整段 base64 寫進對話記錄。沒有變動的物件則原樣沿用，不做多餘複製。
 */
export function resolveLocalImages(params: ChatLLMParams): ChatLLMParams {
  const images = resolveList(params.images)

  let messagesChanged = false
  const messages = params.messages.map(m => {
    const resolved = resolveList(m.images)
    if (resolved === m.images) return m
    messagesChanged = true
    return { ...m, images: resolved }
  })

  if (images === params.images && !messagesChanged) return params
  return { ...params, images, messages }
}
