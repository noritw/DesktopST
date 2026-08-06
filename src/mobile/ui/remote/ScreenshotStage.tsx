import { useEffect, useRef } from 'react'
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
  remoteMode: boolean
  rightClickMode: boolean
  onTap: (x: number, y: number, double: boolean) => void
  onScroll: (x: number, y: number, deltaX: number, deltaY: number) => void
}

export function ScreenshotStage({ shot, remoteMode, rightClickMode, onTap, onScroll }: ScreenshotStageProps): JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)

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

  // 換截圖後舊的縮放/平移已經對不上新畫面，重置。
  useEffect(() => {
    scale.current = 1
    tx.current = 0
    ty.current = 0
    applyTransform(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shot?.url])

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
        const coords = toScreenCoords(touch.clientX - rect.left, touch.clientY - rect.top)
        if (coords) {
          const isDouble = now - lastTap.current < 300
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
    </div>
  )
}
