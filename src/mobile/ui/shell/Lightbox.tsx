import { useCallback, useEffect, useRef } from 'react'
import MonoIcon from '@shared/MonoIcon'
import { useUiStore } from '../stores/uiStore'

/**
 * 圖片燈箱（清單 B4）。
 *
 * 同一則訊息／同一批附件的圖是**一組**，在燈箱裡直接左右換 ——
 * 看完一張要先關掉再點下一張，是 owner 2026-08-05 實機回報的第一個痛點。
 *
 * ## ⚠️ 沒有「點一下關閉」，這是刻意的
 *
 * 初版有，owner 2026-08-05 指出那既多餘又擋路：關閉本來就有 ✕ 與返回手勢兩條路，
 * 而「點一下」這個動作留給縮放（雙擊放大）遠比再開一條關閉路徑有用。
 * **一個手勢只能有一個意思** —— 點擊同時代表關閉與放大，兩邊都會誤觸。
 *
 * ## 手勢
 *
 * | 動作 | 意思 |
 * |---|---|
 * | 雙指開合 | 縮放（1×–6×） |
 * | 放大後單指拖曳 | 平移 |
 * | 未放大時左右滑 | 上一張／下一張 |
 * | 雙擊 | 在 1× 與 2.5× 之間切換 |
 * | ✕ ／ 返回手勢 ／ Esc | 關閉 |
 *
 * 縮放狀態**換圖時重置** —— 帶著上一張的放大倍率看下一張，位置一定是錯的。
 *
 * 實作上跟著 `assets/mobile.html` 的遙控截圖那份（2157–2232 行）走，
 * 包括一個很容易漏掉的細節：**雙指放開剩一指時要重設平移基準**，
 * 否則畫面會在那一瞬間跳一大段。
 */

/** 超過這個距離才算滑動換頁。 */
const SWIPE_PX = 48
const MIN_SCALE = 1
const MAX_SCALE = 6
const DOUBLE_TAP_SCALE = 2.5
const DOUBLE_TAP_MS = 300

export function Lightbox(): JSX.Element | null {
  const box = useUiStore((s) => s.lightbox)
  const close = useUiStore((s) => s.closeLightbox)
  const step = useUiStore((s) => s.stepLightbox)

  const viewRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  /**
   * 手勢狀態全部放 ref、直接寫 DOM style。
   *
   * 走 React state 的話每一幀都要重繪整棵樹，縮放會頓 ——
   * 這是 `mobile.html` 那份的作法，沿用。
   */
  const g = useRef({
    scale: 1,
    tx: 0,
    ty: 0,
    baseScale: 1,
    initDist: 0,
    pinching: false,
    panBaseX: 0,
    panBaseY: 0,
    startX: 0,
    startY: 0,
    lastTapAt: 0
  })

  const apply = useCallback((): void => {
    const el = imgRef.current
    if (!el) return
    const s = g.current
    el.style.transform = `translate(${s.tx}px, ${s.ty}px) scale(${s.scale})`
  }, [])

  const reset = useCallback((): void => {
    const s = g.current
    s.scale = 1
    s.tx = 0
    s.ty = 0
    apply()
  }, [apply])

  // 換圖就把縮放歸零（帶著上一張的倍率看下一張，位置必定是錯的）。
  useEffect(reset, [box?.index, reset])

  // 鍵盤（掃 QR 用電腦瀏覽器開的路徑，roadmap §4.5）。
  useEffect(() => {
    if (!box) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowLeft') step(-1)
      else if (e.key === 'ArrowRight') step(1)
      else if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [box, step, close])

  /**
   * 觸控與滾輪都自己掛，不用 React 的 `onTouchMove`／`onWheel`。
   *
   * ⚠️ 這兩者都需要 `preventDefault()`（擋掉瀏覽器自己的縮放與上下捲動），
   * 而 React 對 touch 與 wheel 掛的是 **passive** 監聽器 ——
   * 在裡面呼叫 `preventDefault()` 沒有作用，而且不會報錯，
   * 只會看到「手勢有時候會把整頁一起捲走」。
   */
  useEffect(() => {
    const view = viewRef.current
    if (!box || !view) return

    const dist = (a: Touch, b: Touch): number =>
      Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)

    const onStart = (e: TouchEvent): void => {
      const s = g.current
      if (e.touches.length === 2) {
        s.pinching = true
        s.initDist = dist(e.touches[0], e.touches[1])
        s.baseScale = s.scale
        return
      }
      if (e.touches.length !== 1) return
      s.pinching = false
      s.startX = e.touches[0].clientX
      s.startY = e.touches[0].clientY
      s.panBaseX = e.touches[0].clientX - s.tx
      s.panBaseY = e.touches[0].clientY - s.ty
    }

    const onMove = (e: TouchEvent): void => {
      const s = g.current
      e.preventDefault()
      if (e.touches.length === 2) {
        s.pinching = true
        const ratio = dist(e.touches[0], e.touches[1]) / (s.initDist || 1)
        s.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, s.baseScale * ratio))
        apply()
        return
      }
      // 沒放大時的單指拖曳留給「換頁」，這裡不動 —— 一個手勢一個意思。
      if (e.touches.length === 1 && !s.pinching && s.scale > 1) {
        s.tx = e.touches[0].clientX - s.panBaseX
        s.ty = e.touches[0].clientY - s.panBaseY
        apply()
      }
    }

    const onEnd = (e: TouchEvent): void => {
      const s = g.current

      // 雙指放開剩一指：重設平移基準，否則畫面會跳一大段（mobile.html 的教訓）。
      if (e.touches.length === 1 && s.pinching) {
        s.panBaseX = e.touches[0].clientX - s.tx
        s.panBaseY = e.touches[0].clientY - s.ty
        return
      }
      if (e.touches.length > 0) return

      if (s.pinching) {
        s.pinching = false
        // 縮回原大小就順手把位移歸零，免得停在一個歪掉的位置。
        if (s.scale <= 1.02) reset()
        return
      }

      const t = e.changedTouches[0]
      const dx = t.clientX - s.startX
      const dy = t.clientY - s.startY

      // 雙擊放大／還原。判斷擺在滑動之後，因為滑動的位移一定比較大。
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
        const now = Date.now()
        if (now - s.lastTapAt < DOUBLE_TAP_MS) {
          s.lastTapAt = 0
          if (s.scale > 1) reset()
          else {
            s.scale = DOUBLE_TAP_SCALE
            apply()
          }
        } else {
          s.lastTapAt = now
        }
        return
      }

      // 放大狀態下的拖曳是平移，不換頁。
      if (s.scale > 1) return
      // 直向位移比橫向大就不算換頁 —— 上下甩動時不該跳圖。
      if (Math.abs(dx) < SWIPE_PX || Math.abs(dy) > Math.abs(dx)) return
      step(dx < 0 ? 1 : -1)
    }

    // 滾輪縮放（網頁版）。手機不會走到這裡。
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const s = g.current
      s.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, s.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))
      if (s.scale <= 1.02) reset()
      else apply()
    }

    view.addEventListener('touchstart', onStart, { passive: true })
    view.addEventListener('touchmove', onMove, { passive: false })
    view.addEventListener('touchend', onEnd, { passive: true })
    view.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      view.removeEventListener('touchstart', onStart)
      view.removeEventListener('touchmove', onMove)
      view.removeEventListener('touchend', onEnd)
      view.removeEventListener('wheel', onWheel)
    }
  }, [box, apply, reset, step])

  if (!box) return null

  const { images, index } = box

  return (
    <div className="anim-fade-in fixed inset-0 z-[60] bg-black/90" role="dialog" aria-label="圖片檢視">
      <div
        ref={viewRef}
        className="flex h-full w-full items-center justify-center overflow-hidden"
        // 交給我們自己處理，不讓瀏覽器搶去做捲動與縮放。
        style={{ touchAction: 'none' }}
      >
        <img
          ref={imgRef}
          src={images[index]}
          alt=""
          // 用 src 當 key：換圖時強制換掉 <img>，避免舊圖停留到新圖載完。
          key={images[index]}
          draggable={false}
          className="max-h-full max-w-full object-contain p-4"
        />
      </div>

      <button
        type="button"
        aria-label="關閉"
        onClick={close}
        className="absolute right-4 flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-white"
        style={{ top: 'calc(var(--safe-top) + 8px)' }}
      >
        <MonoIcon name="close" className="h-5 w-5" />
      </button>

      {images.length > 1 && (
        <>
          <NavButton side="left" disabled={index === 0} onClick={() => step(-1)} />
          <NavButton side="right" disabled={index === images.length - 1} onClick={() => step(1)} />
          <div
            className="absolute left-1/2 -translate-x-1/2 rounded-full bg-black/45 px-3 py-1 text-xs text-white"
            style={{ bottom: 'calc(var(--safe-bottom) + 16px)' }}
          >
            {index + 1} / {images.length}
          </div>
        </>
      )}
    </div>
  )
}

function NavButton({
  side,
  disabled,
  onClick
}: {
  side: 'left' | 'right'
  disabled: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={side === 'left' ? '上一張' : '下一張'}
      disabled={disabled}
      onClick={onClick}
      className={`absolute top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white transition-opacity ${
        side === 'left' ? 'left-2' : 'right-2'
      } ${disabled ? 'pointer-events-none opacity-0' : ''}`}
    >
      <MonoIcon name={side === 'left' ? 'chevron-left' : 'chevron-right'} className="h-5 w-5" />
    </button>
  )
}
