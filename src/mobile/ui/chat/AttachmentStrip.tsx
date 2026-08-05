import MonoIcon from '@shared/MonoIcon'
import { useUiStore } from '../stores/uiStore'

/**
 * 待送出的圖片縮圖列（清單 B3）。
 *
 * 兩個都不能少：**點縮圖能看大圖**（選錯圖時要看得出來），
 * 以及**每張各自的 ✕**（一次選了五張只想拿掉第三張是常事）。
 */
export function AttachmentStrip({
  images,
  onRemove
}: {
  images: string[]
  onRemove: (index: number) => void
}): JSX.Element | null {
  const openLightbox = useUiStore((s) => s.openLightbox)

  if (images.length === 0) return null

  return (
    <div className="scroll-x flex gap-2 border-t border-[var(--border)] bg-[var(--surface)] px-3 pt-2">
      {images.map((src, i) => (
        <div key={`${i}:${src.slice(-24)}`} className="relative shrink-0">
          <img
            src={src}
            alt=""
            // 整組傳進去，燈箱裡才能左右換（不必先關掉再點下一張）。
            onClick={() => openLightbox(images, i)}
            className="h-16 w-16 rounded-[10px] border border-[var(--border)] object-cover"
          />
          <button
            type="button"
            aria-label={`移除第 ${i + 1} 張圖片`}
            onClick={() => onRemove(i)}
            className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white"
          >
            <MonoIcon name="close" className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  )
}
