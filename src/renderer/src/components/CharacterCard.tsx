import { useEffect, useRef, useState } from 'react'
import type { Character } from '../types'
import type { FaceCropRect } from '@core/character/displayImage'
import { cropDisplayTransform } from '@shared/avatarCropMath'
import MonoIcon from './MonoIcon'

interface Props {
  character: Character
  isOnDesktop: boolean
  /** 框選的臉部顯示範圍（`character:get-face-crop`），沒有就顯示原圖。 */
  faceCrop?: FaceCropRect | null
  onClick: (e: React.MouseEvent) => void
  onContextMenu: (e: React.MouseEvent) => void
  onSummonToDesktop?: () => void
}

/** 縮圖容器邊長（`h-20 w-20`）。裁切位移公式需要這個當目標容器尺寸。 */
const AVATAR_BOX_PX = 80

export default function CharacterCard({ character, isOnDesktop, faceCrop, onClick, onContextMenu, onSummonToDesktop }: Props) {
  const avatarSrc = character.avatar ? `local://${encodeURIComponent(character.avatar)}` : ''
  const imgRef = useRef<HTMLImageElement>(null)
  const [cropTransform, setCropTransform] = useState<string | null>(null)

  useEffect(() => {
    if (!avatarSrc || !faceCrop) {
      setCropTransform(null)
      return
    }
    const img = imgRef.current
    if (!img) return
    const apply = (): void => {
      const { left, top, scale } = cropDisplayTransform(img.naturalWidth, img.naturalHeight, AVATAR_BOX_PX, faceCrop)
      setCropTransform(`translate(${left}px, ${top}px) scale(${scale})`)
    }
    if (img.complete && img.naturalWidth > 0) {
      apply()
      return
    }
    setCropTransform(null)
    img.addEventListener('load', apply)
    return () => img.removeEventListener('load', apply)
  }, [avatarSrc, faceCrop])

  return (
    <div className="relative flex h-[160px] min-w-[120px] flex-col rounded-2xl border border-border bg-surface-90 shadow-soft transition-transform hover:scale-[1.02] hover:border-teal-40">
      <button
        type="button"
        className="flex min-h-0 flex-1 flex-col rounded-t-2xl p-2 pb-1 text-left"
        onClick={onClick}
        onContextMenu={onContextMenu}
      >
        <div className="mb-1 flex shrink-0 justify-center">
          <div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-mint">
            {avatarSrc ? (
              faceCrop ? (
                <img
                  ref={imgRef}
                  src={avatarSrc}
                  alt=""
                  draggable={false}
                  className="absolute left-0 top-0 max-w-none"
                  style={{ transformOrigin: '0 0', transform: cropTransform ?? undefined, visibility: cropTransform ? 'visible' : 'hidden' }}
                />
              ) : (
                <img ref={imgRef} src={avatarSrc} alt="" className="h-full w-full object-cover" draggable={false} />
              )
            ) : (
              <MonoIcon name="user" className="h-10 w-10 text-primary" />
            )}
          </div>
        </div>
        <span className="line-clamp-2 px-1 text-center text-xs font-semibold text-primary">{character.name}</span>
      </button>
      <div className="flex shrink-0 flex-col items-center justify-center gap-1 px-2 pb-2 pt-1">
        {isOnDesktop ? (
          <span className="rounded-full bg-teal-25 px-2 py-0.5 text-[10px] font-medium text-primary" title="點右鍵可收回">桌面中</span>
        ) : (
          <button
            type="button"
            title="召喚到桌面"
            aria-label="召喚到桌面"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-teal-40 bg-mint text-lg font-light leading-none text-primary shadow-soft transition-colors hover:bg-teal-30 no-drag"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onSummonToDesktop?.()
            }}
          >
            +
          </button>
        )}
      </div>
    </div>
  )
}
