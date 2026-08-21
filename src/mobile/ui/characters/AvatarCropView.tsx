import { useCallback, useEffect, useRef, useState } from 'react'
import MonoIcon from '@shared/MonoIcon'
import { useUiStore } from '../stores/uiStore'
import { decode } from './avatarFile'
import { describeCharacterError } from './characterErrors'
import { clampOffset, computeCropRect, coverScale, imageScreenOrigin } from './avatarCropMath'

/**
 * 選頭像後的裁切畫面（owner 2026-08-13 提案：真機拿手機相簿測試才發現，
 * 沒有裁切的話塞進去的常常是一張構圖完全不對的原圖）。
 *
 * ## 互動
 *
 * | 動作 | 意思 |
 * |---|---|
 * | 雙指開合 | 縮放 |
 * | 單指拖曳 | 平移 |
 * | 完成 ／ ✕ ／ 返回手勢 | 確認裁切 ／ 取消（回原本選圖前的狀態） |
 *
 * 裁切框固定正方形——頭像存檔本來就是方的（`avatarFile.ts`），圓形只是
 * **顯示時**用 CSS `rounded-full` 裁出來的（`Avatar.tsx`）。所以這裡疊一個
 * 虛線圓形當「預覽參考」，讓使用者知道方框四個角在真正顯示時會被裁掉，
 * 但**不會**真的把那四個角從存檔裡挖掉——裁切框本身還是方的，跟桌面版一致，
 * 使用者之後想調整還留得住完整的方形構圖。
 *
 * ## 手勢與縮放數學跟著 `Lightbox.tsx` 的套路走，但座標系不同
 *
 * `Lightbox` 只是「看圖」，縮放中心是元件自己的中心，不需要精確知道
 * 螢幕上哪個矩形對應原圖的哪塊像素。這裡要真的算出裁切框對應原圖的哪個
 * 矩形（`canvas.drawImage` 的來源矩形），所以用的是「圖片左上角螢幕座標
 * ＋ 縮放倍率」這組表示法（不是 CSS `translate` 那種相對位移），公式：
 *
 *   screen(u, v) = (screenLeft + s·u, screenTop + s·v)　　（u,v 是原圖像素座標）
 *
 * 平移／縮放都會夾在「裁切框必須被圖片完全蓋住」的範圍內——**故意的**，
 * 不夾的話使用者拖出邊界會裁出一塊透明，存成頭像會很難看。
 */

/** 裁切框佔螢幕短邊的比例。留一點邊界，按鈕跟提示文字才有地方放。 */
const FRAME_RATIO = 0.78
const MIN_USER_SCALE = 1
const MAX_USER_SCALE = 4
/** 輸出正方形的邊長（px）。夠大不會糊，`prepareAvatar()` 之後還會視情況再縮。 */
const OUTPUT_SIZE = 1024

export function AvatarCropView(): JSX.Element | null {
  const box = useUiStore((s) => s.avatarCrop)
  const close = useUiStore((s) => s.closeAvatarCrop)
  const toast = useUiStore((s) => s.toast)

  const viewRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)

  /**
   * 手勢與版面狀態全放 ref，直接寫 DOM style——理由同 `Lightbox.tsx`：
   * 走 React state 每一幀都要重繪整棵樹，pinch 縮放會頓。
   */
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

  /** 平移／縮放後都要重新夾範圍，確保裁切框永遠被圖片蓋滿（公式見 `avatarCropMath.ts`）。 */
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

  // 選了新圖就重新解碼、算初始版面。失敗（真的解不開的格式）直接收掉畫面。
  useEffect(() => {
    if (!box) {
      setReady(false)
      return
    }
    let cancelled = false
    let displayUrl = ''
    setReady(false)
    void decode(box.file, false)
      .then((decoded) => {
        if (cancelled) return
        const view = viewRef.current
        if (!view) return
        const rect = view.getBoundingClientRect()
        const frameSize = Math.min(rect.width, rect.height) * FRAME_RATIO
        const s = g.current
        s.naturalW = decoded.naturalWidth
        s.naturalH = decoded.naturalHeight
        s.viewW = rect.width
        s.viewH = rect.height
        s.frameSize = frameSize
        // 覆蓋（cover）填滿裁切框：短邊貼齊框，長邊超出的部分留給使用者拖曳取捨。
        s.baseScale = coverScale(frameSize, decoded.naturalWidth, decoded.naturalHeight)
        s.userScale = 1
        s.offsetX = 0
        s.offsetY = 0
        if (imgRef.current) {
          // ⚠️ **不能直接拿 `decoded.src` 塞進這裡。** `decode()` 內部一解完
          // 就 `revokeObjectURL()` 了那顆 blob URL——已經載入的那個 `<img>`
          // （也就是 `decoded` 自己）繼續看得到圖沒問題，但把同一條字串
          // 塞給另一個全新的 `<img>` 元素，瀏覽器會當成失效連結載不出來。
          // 這裡自己開一條新的、自己管生命週期（下面的 cleanup 負責 revoke）。
          displayUrl = URL.createObjectURL(box.file)
          imgRef.current.src = displayUrl
          imgRef.current.width = decoded.naturalWidth
          imgRef.current.height = decoded.naturalHeight
        }
        setReady(true)
        apply()
      })
      .catch((e) => {
        if (cancelled) return
        toast(describeCharacterError(e, '開啟圖片'), 'error')
        close(null)
      })
    return () => {
      cancelled = true
      if (displayUrl) URL.revokeObjectURL(displayUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box?.file])

  /**
   * 觸控自己掛，不用 React 的 `onTouchMove`——原因同 `Lightbox.tsx`：
   * React 掛的是 passive listener，裡面 `preventDefault()` 沒有用，
   * 手勢會被瀏覽器自己的捲動／縮放搶走。
   */
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
      // 雙指放開剩一指：重設平移基準，否則畫面會跳一大段（`Lightbox.tsx` 的教訓）。
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

  const onConfirm = async (): Promise<void> => {
    const img = imgRef.current
    if (!img) return
    setBusy(true)
    try {
      const { sx, sy, sSize } = computeCropRect(g.current)

      const canvas = document.createElement('canvas')
      canvas.width = OUTPUT_SIZE
      canvas.height = OUTPUT_SIZE
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no-2d-context')
      ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE)

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('toBlob-failed')
      close(new File([blob], 'avatar-crop.png', { type: 'image/png' }))
    } catch {
      toast('裁切失敗，請再試一次', 'error')
    } finally {
      setBusy(false)
    }
  }

  if (!box) return null

  return (
    <div className="anim-fade-in fixed inset-0 z-[60] bg-black/90" role="dialog" aria-label="裁切頭像">
      <div
        ref={viewRef}
        className="relative h-full w-full overflow-hidden"
        style={{ touchAction: 'none' }}
      >
        {/*
          ⚠️ **這顆 `<img>` 不能掛在 `ready &&` 底下。**
          之前踩過：解碼完成的 callback 裡靠 `imgRef.current` 存不存在來決定
          要不要設 `src`／`width`／`height`，但當時 `ready` 還是 `false`，
          這顆 `<img>` 根本還沒掛進 DOM——`imgRef.current` 是 `null`，
          `src` 從頭到尾沒被設過。等 `setReady(true)` 讓它真的掛上去時，
          設定 src 的那段程式碼早就跑完了，不會重跑。結果畫面全黑
          （看到的只是外層的黑底遮罩），確認裁切時 `drawImage` 對著一張
          沒有 `src` 的圖裁，出來的東西當然也是空的。
          現在一律掛著，讓 ref 從一開始就抓得到，解碼完成後才補上 `src`。
        */}
        <img
          ref={imgRef}
          alt=""
          draggable={false}
          className="absolute left-0 top-0 max-w-none"
          style={{ visibility: ready ? 'visible' : 'hidden' }}
        />

        {/* 裁切框：用超大 box-shadow 把框外全部暗下去，比另外疊遮罩層簡單。 */}
        {ready && (
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 border-2 border-white/85"
            style={{
              width: g.current.frameSize,
              height: g.current.frameSize,
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.6)'
            }}
          >
            {/* 圓形預覽參考：頭像顯示時是圓的（`Avatar.tsx` 的 `rounded-full`），
                虛線圈起來的部分才是實際看得到的範圍；四個角仍會存進檔案，
                只是顯示時被裁掉，不是這裡就把它們丟棄。 */}
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
        disabled={busy}
        onClick={() => close(null)}
        className="absolute left-4 flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-white disabled:opacity-40"
        style={{ top: 'calc(var(--safe-top) + 8px)' }}
      >
        <MonoIcon name="close" className="h-5 w-5" />
      </button>

      <button
        type="button"
        aria-label="完成裁切"
        disabled={busy || !ready}
        onClick={() => void onConfirm()}
        className="absolute right-4 flex items-center gap-1.5 rounded-full bg-[var(--mint)] px-4 py-2 text-sm font-medium text-[var(--text)] disabled:opacity-40"
        style={{ top: 'calc(var(--safe-top) + 8px)' }}
      >
        <MonoIcon name="check" className="h-4 w-4" />
        {busy ? '處理中⋯⋯' : '完成'}
      </button>
    </div>
  )
}
