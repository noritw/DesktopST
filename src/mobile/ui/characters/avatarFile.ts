/**
 * 主圖檔案的前處理（階段 3）。
 *
 * ## ⚠️ 為什麼不直接用 `chat/imageCompress.ts`
 *
 * 那支是給**聊天附件**用的：長邊 1024、鋪白底、輸出 JPEG。
 * 主圖套上去會壞掉兩件事 ——
 *
 *   1. **透明會變成白色方塊。** 角色是站在桌布上的，去背是必要條件，
 *      不是畫質問題。JPEG 沒有透明通道，一轉就回不來
 *   2. **1024 太小。** 桌面版的角色視窗會依縮放放大，糊掉看得出來
 *
 * 所以這裡的規則是：**能不動就不動**，真的太大才縮，而且縮完仍保留透明。
 */

const MAX_BYTES = 10 * 1024 * 1024 // 與桌面 `MAX_MEDIA_BYTES` 一致
const MAX_EDGE = 2048
/** 低於這個大小就原封不動送出（多數去背 PNG 都在這個範圍內）。 */
const REENCODE_OVER_BYTES = 3 * 1024 * 1024

const ALLOWED = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])

/** 失敗原因用代碼，中文由呼叫端決定（比照 core 的錯誤代碼慣例）。 */
export type AvatarFileErrorCode = 'bad-format' | 'too-large' | 'decode'

export class AvatarFileError extends Error {
  constructor(public code: AvatarFileErrorCode) {
    super(code)
    this.name = 'AvatarFileError'
  }
}

export function extOf(filename: string): string {
  const i = filename.lastIndexOf('.')
  return i < 0 ? '' : filename.slice(i).toLowerCase()
}

/** 讀一個檔案 → 可以送給 `characters.saveAvatar()` 的位元組。 */
export async function prepareAvatar(file: File): Promise<{ bytes: Uint8Array; ext: string }> {
  const ext = extOf(file.name)
  if (!ALLOWED.has(ext)) throw new AvatarFileError('bad-format')

  // GIF 一律原檔：重繪只會留下第一格，動圖就死了。太大就直接擋，不要偷偷弄壞它。
  const asIs = async (): Promise<{ bytes: Uint8Array; ext: string }> => {
    if (file.size > MAX_BYTES) throw new AvatarFileError('too-large')
    return { bytes: new Uint8Array(await file.arrayBuffer()), ext }
  }
  if (ext === '.gif') return asIs()

  const img = await decode(file)
  const tooWide = Math.max(img.width, img.height) > MAX_EDGE
  if (!tooWide && file.size <= REENCODE_OVER_BYTES) return asIs()

  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new AvatarFileError('decode')
  // **不鋪底色** —— 這正是與聊天附件相反的地方。
  ctx.drawImage(img, 0, 0, w, h)

  // 來源可能有透明就輸出 PNG；相機來的 JPEG 沒有透明，轉 PNG 只會變成好幾 MB。
  const keepAlpha = ext === '.png' || ext === '.webp'
  const dataUrl = keepAlpha ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.9)
  const bytes = dataUrlToBytes(dataUrl)
  if (bytes.length > MAX_BYTES) throw new AvatarFileError('too-large')
  return { bytes, ext: keepAlpha ? '.png' : '.jpg' }
}

function decode(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new AvatarFileError('decode'))
    }
    img.src = url
  })
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
