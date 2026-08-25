import type { FaceCropRect } from '@core/character/displayImage'

/**
 * 依比例矩形（0–1）裁切一張圖片（`data:`、`blob:`、`local://` 等同源 URL 皆可），
 * 輸出正方形 PNG data URL。`rect` 是對「來源圖」框選當下算出的比例，套到不同
 * 尺寸的圖片（例如另一張表情圖）會依該圖片自己的寬高重新換算——構圖差異大時
 * 可能會歪，這是已知風險（見 `docs/mobile-character-expression-plan.md` §7），
 * 不是 bug。
 *
 * 原本住在 `src/mobile/runtime/faceCropConfig.ts`；2026-08-25 搬到 `shared/`
 * 是因為桌面版角色庫縮圖也要套用同一套裁切（純 `Image`/`canvas` 邏輯，跟
 * Capacitor 無關，桌面 renderer 可以直接用）。手機端仍 re-export 這裡的函式，
 * 既有 import 不用改。
 */
export function cropImageToFace(imageSrc: string, rect: FaceCropRect): Promise<string> {
  const OUTPUT_SIZE = 512
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      try {
        const sx = rect.x * img.naturalWidth
        const sy = rect.y * img.naturalHeight
        const sSize = rect.size * Math.min(img.naturalWidth, img.naturalHeight)
        const canvas = document.createElement('canvas')
        canvas.width = OUTPUT_SIZE
        canvas.height = OUTPUT_SIZE
        const ctx = canvas.getContext('2d')
        if (!ctx) { reject(new Error('no-2d-context')); return }
        ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE)
        resolve(canvas.toDataURL('image/png'))
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    }
    img.onerror = () => reject(new Error('decode-failed'))
    img.src = imageSrc
  })
}
