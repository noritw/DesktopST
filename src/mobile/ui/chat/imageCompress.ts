/**
 * 前端縮圖壓縮（清單 B2）。
 *
 * ⚠️ **這一項不可省略。** 手機相機一張動輒 4000px／好幾 MB，
 * 直接轉 base64 送出去會塞爆請求本體（`/api/send` 的上限是 24 MB），
 * 而且**獨立模式直接打 LLM API 也一樣要壓** —— 那邊付的是 token 與流量。
 *
 * 參數與作法逐字沿用 `assets/mobile.html:1311-1343`，包含那個容易漏掉的白底：
 * JPEG 沒有透明通道，不鋪白底的話 PNG 的透明處會變成黑色。
 *
 * 放在 UI 層而不是 core：它需要 `Image`／`canvas`／`URL.createObjectURL`，
 * 全部是 DOM API，core 不得碰（roadmap §3.3）。
 */

const MAX_EDGE = 1024
const QUALITY = 0.8

/** 壓縮失敗的原因。UI 自行翻成中文（比照 core 的錯誤代碼慣例）。 */
export class ImageCompressError extends Error {
  constructor(public fileName: string) {
    super(`decode failed: ${fileName}`)
    this.name = 'ImageCompressError'
  }
}

/** 讀一個檔案 → 縮到長邊 1024、鋪白底、輸出 JPEG 0.8 的 data URI。 */
export function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()

    img.onload = () => {
      URL.revokeObjectURL(url)
      // 只縮不放大：本來就小於 1024 的圖再放大只會變糊又變大。
      const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height))
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))

      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new ImageCompressError(file.name))
        return
      }
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', QUALITY))
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new ImageCompressError(file.name))
    }

    img.src = url
  })
}
