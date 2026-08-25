/**
 * 頭像／臉部裁切畫面的座標數學，抽成純函式。
 *
 * 原本住在 `src/mobile/ui/characters/avatarCropMath.ts`；2026-08-25 搬到
 * `shared/` 是因為桌面版角色庫縮圖也要套用同一套框選範圍（`faceCrop`），
 * 桌面裁切彈窗需要同一套公式——手機端仍 re-export 這裡的東西，既有 import
 * 不用改。
 *
 * 這塊很容易在正負號／除乘順序上出錯，而且**只有真機摸得出手感對不對**——
 * pinch／拖曳這種東西沒辦法用瀏覽器煙測驗證。抽出來才能寫單元測試鎖住
 * 「裁切框對應到原圖哪個矩形」這條公式本身是對的，元件裡只剩下讀 DOM
 * 尺寸、掛觸控/滑鼠事件、寫 `style.transform` 這些沒辦法脫離 React 測的部分。
 *
 * ## 座標系
 *
 * 圖片元素以「左上角螢幕座標 (screenLeft, screenTop) ＋ 縮放倍率 scale」表示，
 * `transform-origin: 0 0`，所以原圖像素座標 (u, v) 對應的螢幕座標是：
 *
 *   screen(u, v) = (screenLeft + scale·u, screenTop + scale·v)
 *
 * 裁切框固定置中，邊長 `frameSize`，中心跟 viewport 中心重合。
 */

export interface CropLayout {
  naturalW: number
  naturalH: number
  frameSize: number
  viewW: number
  viewH: number
  baseScale: number
  userScale: number
  offsetX: number
  offsetY: number
}

/** 覆蓋（cover）填滿裁切框所需的縮放倍率：圖片短邊貼齊框。 */
export function coverScale(frameSize: number, naturalW: number, naturalH: number): number {
  return frameSize / Math.min(naturalW, naturalH)
}

/**
 * 夾住單一軸向的平移量，確保裁切框永遠被圖片完全蓋住（不會裁出透明）。
 *
 * `naturalSize` 是該軸向的原圖像素長度（`naturalW` 或 `naturalH`），
 * `scale` 是當下的總縮放倍率（`baseScale * userScale`）。
 */
export function clampOffset(offset: number, naturalSize: number, frameSize: number, scale: number): number {
  const maxOffset = Math.max(0, (naturalSize * scale - frameSize) / 2)
  return Math.max(-maxOffset, Math.min(maxOffset, offset))
}

/** 圖片元素左上角的螢幕座標（給 `transform: translate(...) scale(...)` 用）。 */
export function imageScreenOrigin(layout: CropLayout): { screenLeft: number; screenTop: number; scale: number } {
  const scale = layout.baseScale * layout.userScale
  return {
    screenLeft: layout.viewW / 2 - (layout.naturalW * scale) / 2 + layout.offsetX,
    screenTop: layout.viewH / 2 - (layout.naturalH * scale) / 2 + layout.offsetY,
    scale
  }
}

/**
 * 反過來：已經有一個比例矩形（`FaceCropRect`），要把它塞滿一個正方形容器，
 * 算出 `<img>` 該用的 `translate(...) scale(...)`（`transform-origin: 0 0`，
 * 圖片本身不用另外設定寬高）。
 *
 * 桌面角色庫縮圖用這個，**不是**先裁成一張新圖再顯示——`local://` 這種
 * Electron 自訂協定沒有註冊成 privileged/CORS-enabled scheme，把它畫上
 * canvas 再 `toDataURL()` 讀回來會被當成「染色」（tainted）而丟
 * `SecurityError`（手機端 `cropImageToFace()` 沒有這個問題是因為餵給它的
 * 是 `data:`/`blob:` 同源圖片，不是自訂協定）。純 CSS transform 完全不碰
 * pixel 讀取，繞開這個限制。
 */
export function cropDisplayTransform(
  naturalW: number,
  naturalH: number,
  containerSize: number,
  rect: { x: number; y: number; size: number }
): { left: number; top: number; scale: number } {
  const denom = Math.min(naturalW, naturalH) || 1
  const cropPx = Math.max(rect.size, 0.0001) * denom
  const scale = containerSize / cropPx
  return {
    left: -rect.x * naturalW * scale,
    top: -rect.y * naturalH * scale,
    scale
  }
}

/** 裁切框對應到原圖的來源矩形，直接餵給 `ctx.drawImage()` 的來源參數。 */
export function computeCropRect(layout: CropLayout): { sx: number; sy: number; sSize: number } {
  const { screenLeft, screenTop, scale } = imageScreenOrigin(layout)
  const cx = layout.viewW / 2
  const cy = layout.viewH / 2
  return {
    sx: (cx - layout.frameSize / 2 - screenLeft) / scale,
    sy: (cy - layout.frameSize / 2 - screenTop) / scale,
    sSize: layout.frameSize / scale
  }
}
