import { useCallback, useEffect, useRef, useState } from 'react'
import { clampOffset, computeCropRect, coverScale, imageScreenOrigin } from '@shared/avatarCropMath'
import type { FaceCropRect } from '@core/character/displayImage'

/**
 * 桌面版「框選顯示縮圖範圍」，跟手機版 `mobile/ui/characters/FaceCropView.tsx`
 * 共用同一套裁切數學（`@shared/avatarCropMath.ts`），只是手勢換成滑鼠拖曳
 * 平移 + 滾輪縮放（手機是觸控 pinch/拖曳）。輸出一樣是比例矩形 `{x,y,size}`，
 * 不是真的裁切檔案——真正裁切成縮圖是 `CharacterCard.tsx` 用
 * `@shared/faceCrop.ts` 的 `cropImageToFace()` 做的。
 */

const FRAME_RATIO = 0.78
const MIN_USER_SCALE = 1
const MAX_USER_SCALE = 4

interface Props {
  imageUrl: string
  /** 已經有框選過時才傳，讓使用者可以一鍵清除退回原圖。 */
  hasExistingCrop?: boolean
  onConfirm: (rect: FaceCropRect) => void
  onClear?: () => void
  onClose: () => void
}

export default function FaceCropModal({ imageUrl, hasExistingCrop, onConfirm, onClear, onClose }: Props): JSX.Element {
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
    dragging: false,
    dragStartX: 0,
    dragStartY: 0,
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

    img.addEventListener('load', onLoad)
    img.src = imageUrl
    if (img.complete && img.naturalWidth > 0) onLoad()

    return () => img.removeEventListener('load', onLoad)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl])

  useEffect(() => {
    const view = viewRef.current
    if (!view || !ready) return

    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const s = g.current
      const ratio = Math.exp(-e.deltaY * 0.001)
      s.userScale = Math.max(MIN_USER_SCALE, Math.min(MAX_USER_SCALE, s.userScale * ratio))
      clamp()
      apply()
    }

    const onMouseDown = (e: MouseEvent): void => {
      const s = g.current
      s.dragging = true
      s.dragStartX = e.clientX
      s.dragStartY = e.clientY
      s.offsetXStart = s.offsetX
      s.offsetYStart = s.offsetY
    }

    const onMouseMove = (e: MouseEvent): void => {
      const s = g.current
      if (!s.dragging) return
      s.offsetX = s.offsetXStart + (e.clientX - s.dragStartX)
      s.offsetY = s.offsetYStart + (e.clientY - s.dragStartY)
      clamp()
      apply()
    }

    const onMouseUp = (): void => {
      g.current.dragging = false
    }

    view.addEventListener('wheel', onWheel, { passive: false })
    view.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      view.removeEventListener('wheel', onWheel)
      view.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [ready, apply, clamp])

  const handleConfirm = (): void => {
    const { sx, sy, sSize } = computeCropRect(g.current)
    const { naturalW, naturalH } = g.current
    const denom = Math.min(naturalW, naturalH) || 1
    onConfirm({
      x: sx / (naturalW || 1),
      y: sy / (naturalH || 1),
      size: sSize / denom
    })
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70" role="dialog" aria-label="框選顯示縮圖範圍">
      <div className="flex w-[min(560px,92vw)] flex-col gap-3 rounded-2xl bg-surface p-4 shadow-soft">
        <p className="text-sm font-semibold text-primary">框選顯示縮圖範圍</p>
        <p className="text-[11px] text-secondary">滾輪縮放、拖曳調整位置——這只影響角色庫縮圖，不會裁切原圖。</p>
        <div
          ref={viewRef}
          className="relative h-[360px] w-full cursor-move select-none overflow-hidden rounded-xl bg-black"
        >
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
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)'
              }}
            >
              <div className="absolute inset-0 rounded-full border-2 border-dashed border-white/70" />
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2">
          {hasExistingCrop && onClear && (
            <button
              type="button"
              className="mr-auto rounded-full px-3 py-1.5 text-xs text-secondary hover:bg-mint-40 hover:text-primary"
              onClick={onClear}
            >
              清除框選範圍
            </button>
          )}
          <button type="button" className="rounded-full border border-border px-4 py-1.5 text-sm text-primary hover:bg-mint-40" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            disabled={!ready}
            className="rounded-full bg-mint px-4 py-1.5 text-sm font-medium text-primary shadow-soft hover:bg-teal-30 disabled:opacity-40"
            onClick={handleConfirm}
          >
            完成
          </button>
        </div>
      </div>
    </div>
  )
}
