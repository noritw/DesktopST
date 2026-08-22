import { useCallback, useEffect, useRef, useState } from 'react'
import MonoIcon from '@shared/MonoIcon'
import { useUiStore } from '../stores/uiStore'
import { clampOffset, computeCropRect, coverScale, imageScreenOrigin } from './avatarCropMath'

/**
 * 框選臉部顯示範圍（`docs/mobile-character-expression-plan.md` §3.1／§6.3）。
 *
 * 跟 `AvatarCropView.tsx` 共用同一套手勢／座標數學（`avatarCropMath.ts`），
 * 但**目的不一樣**：那支輸出一張真的裁切過的檔案（新頭像）；這支只算一個
 * 比例矩形（`{x,y,size}`，0–1）存進 `character-display-config.json`，
 * 之後套到主圖與每一張表情圖——所以這裡完全不用 canvas／`toBlob`，
 * 直接讀 `<img>` 的 `naturalWidth/naturalHeight` 就夠了，也因此不受
 * 遙控模式跨來源圖片的 canvas「已污染」限制（沒有讀取像素）。
 */

const FRAME_RATIO = 0.78
const MIN_USER_SCALE = 1
const MAX_USER_SCALE = 4

export function FaceCropView(): JSX.Element | null {
  const box = useUiStore((s) => s.faceCrop)
  const close = useUiStore((s) => s.closeFaceCrop)
  const toast = useUiStore((s) => s.toast)

  const viewRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [ready, setReady] = useState(false)

  const g = useRef({
    naturalW: 0,
    naturalH: 0,
    frameSize: 0,
    viewW: 0,
    viewH: 0,
    baseScale: 1,
    userScale: 1,
    offsetX: 0,
    offsetY: 0,
    pinching: false,
    initDist: 0,
    userScaleAtPinchStart: 1,
    panStartX: 0,
    panStartY: 0,
    offsetXStart: 0,
    offsetYStart: 0
  })

  const clamp = useCallback((): void => {
    const s = g.current
    const scale = s.baseScale * s.userScale
    s.offsetX = clampOffset(s.offsetX, s.naturalW, s.frameSize, scale)
    s.offsetY = clampOffset(s.offsetY, s.naturalH, s.frameSize, scale)
  }, [])

  const apply = useCallback((): void => {
    const img = imgRef.current
    if (!img) return
    const { screenLeft, screenTop, scale } = imageScreenOrigin(g.current)
    img.style.transformOrigin = '0 0'
    img.style.transform = `translate(${screenLeft}px, ${screenTop}px) scale(${scale})`
  }, [])

  useEffect(() => {
    if (!box) {
      setReady(false)
      return
    }
    setReady(false)
    const img = imgRef.current
    if (!img) return

    const onLoad = (): void => {
      const view = viewRef.current
      if (!view) return
      const rect = view.getBoundingClientRect()
      const frameSize = Math.min(rect.width, rect.height) * FRAME_RATIO
      const s = g.current
      s.naturalW = img.naturalWidth
      s.naturalH = img.naturalHeight
      s.viewW = rect.width
      s.viewH = rect.height
      s.frameSize = frameSize
      s.baseScale = coverScale(frameSize, img.naturalWidth, img.naturalHeight)
      s.userScale = 1
      s.offsetX = 0
      s.offsetY = 0
      setReady(true)
      apply()
    }
    const onError = (): void => {
      toast('圖片讀取失敗', 'error')
      close(null)
    }

    img.addEventListener('load', onLoad)
    img.addEventListener('error', onError)
    img.src = box.imageUrl
    // 圖片可能已經被瀏覽器快取住，`load` 事件不會再觸發一次。
    if (img.complete && img.naturalWidth > 0) onLoad()

    return () => {
      img.removeEventListener('load', onLoad)
      img.removeEventListener('error', onError)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box?.imageUrl])

  useEffect(() => {
    const view = viewRef.current
    if (!box || !view || !ready) return

    const dist = (a: Touch, b: Touch): number =>
      Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)

    const onStart = (e: TouchEvent): void => {
      const s = g.current
      if (e.touches.length === 2) {
        s.pinching = true
        s.initDist = dist(e.touches[0], e.touches[1])
        s.userScaleAtPinchStart = s.userScale
        return
      }
      if (e.touches.length !== 1) return
      s.pinching = false
      s.panStartX = e.touches[0].clientX
      s.panStartY = e.touches[0].clientY
      s.offsetXStart = s.offsetX
      s.offsetYStart = s.offsetY
    }

    const onMove = (e: TouchEvent): void => {
      const s = g.current
      e.preventDefault()
      if (e.touches.length === 2) {
        s.pinching = true
        const ratio = dist(e.touches[0], e.touches[1]) / (s.initDist || 1)
        s.userScale = Math.max(MIN_USER_SCALE, Math.min(MAX_USER_SCALE, s.userScaleAtPinchStart * ratio))
        clamp()
        apply()
        return
      }
      if (e.touches.length === 1 && !s.pinching) {
        s.offsetX = s.offsetXStart + (e.touches[0].clientX - s.panStartX)
        s.offsetY = s.offsetYStart + (e.touches[0].clientY - s.panStartY)
        clamp()
        apply()
      }
    }

    const onEnd = (e: TouchEvent): void => {
      const s = g.current
      if (e.touches.length === 1 && s.pinching) {
        s.panStartX = e.touches[0].clientX
        s.panStartY = e.touches[0].clientY
        s.offsetXStart = s.offsetX
        s.offsetYStart = s.offsetY
      }
      if (e.touches.length === 0) s.pinching = false
    }

    view.addEventListener('touchstart', onStart, { passive: true })
    view.addEventListener('touchmove', onMove, { passive: false })
    view.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      view.removeEventListener('touchstart', onStart)
      view.removeEventListener('touchmove', onMove)
      view.removeEventListener('touchend', onEnd)
    }
  }, [box, ready, apply, clamp])

  const onConfirm = (): void => {
    const { sx, sy, sSize } = computeCropRect(g.current)
    const { naturalW, naturalH } = g.current
    const denom = Math.min(naturalW, naturalH) || 1
    close({
      x: sx / (naturalW || 1),
      y: sy / (naturalH || 1),
      size: sSize / denom
    })
  }

  if (!box) return null

  return (
    <div className="anim-fade-in fixed inset-0 z-[60] bg-black/90" role="dialog" aria-label="框選臉部顯示範圍">
      <div ref={viewRef} className="relative h-full w-full overflow-hidden" style={{ touchAction: 'none' }}>
        <img
          ref={imgRef}
          alt=""
          draggable={false}
          className="absolute left-0 top-0 max-w-none"
          style={{ visibility: ready ? 'visible' : 'hidden' }}
        />

        {ready && (
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 border-2 border-white/85"
            style={{
              width: g.current.frameSize,
              height: g.current.frameSize,
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.6)'
            }}
          >
            <div className="absolute inset-0 rounded-full border-2 border-dashed border-white/70" />
          </div>
        )}
      </div>

      <p
        className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-center text-[11px] text-white/80"
        style={{ top: 'calc(var(--safe-top) + 12px)' }}
      >
        雙指縮放、拖曳調整位置
      </p>

      <button
        type="button"
        aria-label="取消"
        onClick={() => close(null)}
        className="absolute left-4 flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-white"
        style={{ top: 'calc(var(--safe-top) + 8px)' }}
      >
        <MonoIcon name="close" className="h-5 w-5" />
      </button>

      <button
        type="button"
        aria-label="完成框選"
        disabled={!ready}
        onClick={onConfirm}
        className="absolute right-4 flex items-center gap-1.5 rounded-full bg-[var(--mint)] px-4 py-2 text-sm font-medium text-[var(--text)] disabled:opacity-40"
        style={{ top: 'calc(var(--safe-top) + 8px)' }}
      >
        <MonoIcon name="check" className="h-4 w-4" />
        完成
      </button>
    </div>
  )
}
