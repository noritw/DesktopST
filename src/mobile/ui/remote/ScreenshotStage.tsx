import { useEffect, useRef, useState } from 'react'
import type { RemoteScreenshot } from '@core/data'

/**
 * 截圖檢視 ＋ 手勢（清單 H2、H6、H7）。
 *
 * 座標換算逐字沿用 `assets/mobile.html` 的 `ssToScreenCoords()`（2459 行）：
 * 圖片用 `transform: translate(tx,ty) scale(scale)`、預設置中的 `transform-origin`，
 * 換算式因此是 `originX = vpW/2 + tx - imgW*scale/2`，**不要重新推導**。
 *
 * 手勢直接操作 DOM（`imgRef.current.style.transform`），不透過 React state ——
 * `touchmove` 一秒觸發幾十次，若每次都 `setState` 會明顯卡頓。
 * 只有「這次點擊/滾動要送到哪個座標」需要跳出去（呼叫 `onTap` / `onScroll`）。
 */

export interface ScreenshotStageProps {
  shot: RemoteScreenshot | null
  /**
   * 縮放/平移只在這個值改變時重置（比照 `mobile.html` 的 `takeScreenshot()`
   * vs `applySsBlob()` 之分：前者是「換了目標」才重置，後者是手動重整/遙控
   * 動作後的自動重抓，**不重置**）。呼叫端傳「目標＋含角色」的組合字串。
   *
   * ⚠️ 不能用 `shot?.url` 當重置依據——每次抓截圖都是新的 object URL，
   * 若照那個重置，遙控時「放大找位置 → 點擊 → 自動重抓」會把畫面縮回去，
   * 使用者根本點不準（owner 2026-08-07 實機回報）。
   */
  resetKey: string
  remoteMode: boolean
  rightClickMode: boolean
  onTap: (x: number, y: number, double: boolean) => void
  onScroll: (x: number, y: number, deltaX: number, deltaY: number) => void
}

/** 準心與座標徽章的位置（viewport 像素座標）＋ 標到的實際螢幕座標。 */
interface ClickMarker {
  vx: number
  vy: number
  x: number
  y: number
}

export function ScreenshotStage({ shot, resetKey, remoteMode, rightClickMode, onTap, onScroll }: ScreenshotStageProps): JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [marker, setMarker] = useState<ClickMarker | null>(null)
  /** 雙指滾動方向提示（H7）：不然使用者滑了不知道有沒有真的送出去。 */
  const [scrollArrow, setScrollArrow] = useState<string | null>(null)
  const scrollArrowTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 手勢狀態，刻意用 ref 不用 state：見上方檔頭說明。
  const scale = useRef(1)
  const tx = useRef(0)
  const ty = useRef(0)
  const isPinching = useRef(false)
  const initDist = useRef(0)
  const baseScale = useRef(1)
  const baseTx = useRef(0)
  const baseTy = useRef(0)
  const panStartX = useRef(0)
  const panStartY = useRef(0)
  const gestureMoved = useRef(false)
  const lastTap = useRef(0)
  const scrollMidX = useRef(0)
  const scrollMidY = useRef(0)
  const scrollAccX = useRef(0)
  const scrollAccY = useRef(0)
  const scrollLastTime = useRef(0)
  const scrollTarget = useRef<{ x: number; y: number } | null>(null)

  // 換了目標（螢幕/視窗/含角色）才重置縮放/平移；單純重抓同一個目標（手動整理／
  // 遙控動作後的自動重抓）保留使用者當下的縮放，見上方 `resetKey` 的說明。
  useEffect(() => {
    scale.current = 1
    tx.current = 0
    ty.current = 0
    applyTransform(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey])

  // 舊的準心對不上新畫面了，換截圖（含自動重抓）就藏起來——比照 `mobile.html`
  // 的 `applySsBlob()` 在收到新截圖時呼叫 `hideClickMarker()`。
  useEffect(() => {
    setMarker(null)
  }, [shot?.url])

  // 關掉遙控模式時準心也該一起消失，免得切回檢視模式還留著一顆紅點。
  useEffect(() => {
    if (!remoteMode) setMarker(null)
  }, [remoteMode])

  /** 比照 `mobile.html` 的 `showScrollIndicator()`：取位移量較大的軸，顯示一個箭頭，600ms 後自動收回。 */
  function showScrollIndicator(dy: number, dx: number): void {
    setScrollArrow(Math.abs(dy) >= Math.abs(dx) ? (dy < 0 ? '↑' : '↓') : dx < 0 ? '←' : '→')
    if (scrollArrowTimer.current) clearTimeout(scrollArrowTimer.current)
    scrollArrowTimer.current = setTimeout(() => setScrollArrow(null), 600)
  }

  useEffect(() => {
    return () => {
      if (scrollArrowTimer.current) clearTimeout(scrollArrowTimer.current)
    }
  }, [])

  function applyTransform(animate: boolean): void {
    const el = imgRef.current
    if (!el) return
    el.style.transition = animate ? 'transform 0.15s ease' : 'none'
    el.style.transform = `translate(${tx.current}px, ${ty.current}px) scale(${scale.current})`
  }

  /** 逐字對照 `ssToScreenCoords()`：touchX/touchY 是相對 viewport 左上角的座標。 */
  function toScreenCoords(touchX: number, touchY: number): { x: number; y: number } | null {
    const bounds = shot?.bounds
    const vp = viewportRef.current
    const img = imgRef.current
    if (!bounds || !vp || !img) return null
    const vpW = vp.offsetWidth
    const vpH = vp.offsetHeight
    const imgW = img.offsetWidth
    const imgH = img.offsetHeight
    const originX = vpW / 2 + tx.current - (imgW * scale.current) / 2
    const originY = vpH / 2 + ty.current - (imgH * scale.current) / 2
    const relX = (touchX - originX) / (imgW * scale.current)
    const relY = (touchY - originY) / (imgH * scale.current)
    if (relX < 0 || relX > 1 || relY < 0 || relY > 1) return null
    return { x: Math.round(bounds.x + relX * bounds.w), y: Math.round(bounds.y + relY * bounds.h) }
  }

  function dist(a: React.Touch, b: React.Touch): number {
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
  }

  function handleTouchStart(e: React.TouchEvent): void {
    if (e.touches.length === 2) {
      gestureMoved.current = true
      if (remoteMode) {
        isPinching.current = false
        scrollMidX.current = (e.touches[0].clientX + e.touches[1].clientX) / 2
        scrollMidY.current = (e.touches[0].clientY + e.touches[1].clientY) / 2
        scrollAccX.current = 0
        scrollAccY.current = 0
        scrollLastTime.current = 0
        const rect = viewportRef.current?.getBoundingClientRect()
        scrollTarget.current = rect ? toScreenCoords(scrollMidX.current - rect.left, scrollMidY.current - rect.top) : null
      } else {
        isPinching.current = true
        initDist.current = dist(e.touches[0], e.touches[1])
        baseScale.current = scale.current
        baseTx.current = tx.current
        baseTy.current = ty.current
      }
    } else if (e.touches.length === 1) {
      isPinching.current = false
      gestureMoved.current = false
      panStartX.current = e.touches[0].clientX - tx.current
      panStartY.current = e.touches[0].clientY - ty.current
    }
  }

  function handleTouchMove(e: React.TouchEvent): void {
    if (e.touches.length === 2) {
      gestureMoved.current = true
      if (remoteMode) {
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2
        const dx = midX - scrollMidX.current
        const dy = midY - scrollMidY.current
        scrollMidX.current = midX
        scrollMidY.current = midY
        if (Math.abs(dy) > 0.3 || Math.abs(dx) > 0.3) showScrollIndicator(dy, dx)
        const vp = viewportRef.current
        const vpH = vp?.offsetHeight || 400
        const vpW = vp?.offsetWidth || 400
        scrollAccX.current += dx / (vpW / 10)
        scrollAccY.current += dy / (vpH / 10)
        const now = Date.now()
        if ((Math.abs(scrollAccX.current) >= 0.15 || Math.abs(scrollAccY.current) >= 0.15) && now - scrollLastTime.current > 40) {
          if (scrollTarget.current) {
            const sx = scrollAccX.current
            const sy = scrollAccY.current
            scrollAccX.current = 0
            scrollAccY.current = 0
            scrollLastTime.current = now
            onScroll(scrollTarget.current.x, scrollTarget.current.y, sx, sy)
          }
        }
      } else {
        isPinching.current = true
        scale.current = Math.max(1, Math.min(8, (baseScale.current * dist(e.touches[0], e.touches[1])) / initDist.current))
        applyTransform(false)
      }
    } else if (e.touches.length === 1 && !isPinching.current) {
      const dx = e.touches[0].clientX - panStartX.current - tx.current
      const dy = e.touches[0].clientY - panStartY.current - ty.current
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) gestureMoved.current = true
      if (!remoteMode) {
        tx.current = e.touches[0].clientX - panStartX.current
        ty.current = e.touches[0].clientY - panStartY.current
        applyTransform(false)
      }
    }
  }

  function handleTouchEnd(e: React.TouchEvent): void {
    if (e.touches.length === 1 && isPinching.current) {
      panStartX.current = e.touches[0].clientX - tx.current
      panStartY.current = e.touches[0].clientY - ty.current
      return
    }

    if (remoteMode && e.touches.length === 0 && (Math.abs(scrollAccX.current) > 0.05 || Math.abs(scrollAccY.current) > 0.05)) {
      if (scrollTarget.current) {
        onScroll(scrollTarget.current.x, scrollTarget.current.y, scrollAccX.current, scrollAccY.current)
      }
      scrollAccX.current = 0
      scrollAccY.current = 0
      scrollTarget.current = null
      if (scrollArrowTimer.current) clearTimeout(scrollArrowTimer.current)
      setScrollArrow(null)
      return
    }

    if (e.touches.length === 0) {
      isPinching.current = false
      scrollTarget.current = null
    }

    const now = Date.now()

    if (remoteMode && e.touches.length === 0 && !gestureMoved.current && !isPinching.current) {
      const touch = e.changedTouches[0]
      if (touch && viewportRef.current) {
        const rect = viewportRef.current.getBoundingClientRect()
        const vx = touch.clientX - rect.left
        const vy = touch.clientY - rect.top
        const coords = toScreenCoords(vx, vy)
        if (coords) {
          const isDouble = now - lastTap.current < 300
          setMarker({ vx, vy, x: coords.x, y: coords.y })
          onTap(coords.x, coords.y, isDouble && !rightClickMode)
          lastTap.current = isDouble ? 0 : now
        }
      }
      return
    }

    // 雙擊縮放（非遙控模式）：1 ↔ 2 倍，還原時 tx/ty 一併歸零。
    if (!remoteMode && e.touches.length === 0 && !gestureMoved.current && now - lastTap.current < 280) {
      scale.current = scale.current > 1.2 ? 1 : 2
      tx.current = 0
      ty.current = 0
      applyTransform(true)
      lastTap.current = 0
      return
    }
    if (!gestureMoved.current && e.touches.length === 0) lastTap.current = now
  }

  return (
    <div
      ref={viewportRef}
      className="relative flex h-full w-full items-center justify-center overflow-hidden bg-black/5 touch-none"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {shot ? (
        // eslint-disable-next-line jsx-a11y/alt-text
        <img
          ref={imgRef}
          src={shot.url}
          className={`max-h-full max-w-full select-none ${remoteMode ? (rightClickMode ? 'cursor-context-menu' : 'cursor-crosshair') : ''}`}
          draggable={false}
        />
      ) : (
        <p className="px-6 text-center text-sm text-[var(--text-sub)]">還沒有截圖，點上方按鈕截一張</p>
      )}

      {/* 點擊準心 ＋ 座標徽章（H6）：定在點下去那一刻的 viewport 像素位置，
          不隨後續縮放/平移跟著移動——比照 `mobile.html` 的 `showClickMarker()`，
          只是「剛剛點在這裡」的視覺回饋，不是即時游標。 */}
      {marker && (
        <>
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2"
            style={{ left: marker.vx, top: marker.vy }}
          >
            <div
              className="h-6 w-6 rounded-full border-2"
              style={{ borderColor: rightClickMode ? 'rgba(80,160,255,0.9)' : 'rgba(255,60,60,0.9)' }}
            />
            <div
              className="absolute left-1/2 top-1/2 h-4 w-px -translate-x-1/2 -translate-y-1/2"
              style={{ backgroundColor: rightClickMode ? 'rgba(80,160,255,0.9)' : 'rgba(255,60,60,0.9)' }}
            />
            <div
              className="absolute left-1/2 top-1/2 h-px w-4 -translate-x-1/2 -translate-y-1/2"
              style={{ backgroundColor: rightClickMode ? 'rgba(80,160,255,0.9)' : 'rgba(255,60,60,0.9)' }}
            />
          </div>
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] text-white"
            style={{ left: marker.vx, top: marker.vy + 16 }}
          >
            ({marker.x}, {marker.y})
          </div>
        </>
      )}

      {/* 雙指滾動方向提示（H7）：滑了要有反應，不然使用者不知道有沒有送出去。 */}
      {scrollArrow && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/50 text-3xl text-white">
            {scrollArrow}
          </span>
        </div>
      )}

      {/* 手勢說明：只在遙控模式顯示，放在角落用小字，不擋操作區域。 */}
      {remoteMode && (
        <p className="pointer-events-none absolute left-2 top-2 z-10 max-w-[70%] rounded-md bg-black/45 px-2 py-1 text-[10px] leading-snug text-white/90">
          單指點一下＝{rightClickMode ? '右鍵' : '點擊'}．快速點兩下＝雙擊．雙指滑動＝捲動
        </p>
      )}
    </div>
  )
}
