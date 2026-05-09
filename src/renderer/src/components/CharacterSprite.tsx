import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react'
import MonoIcon from './MonoIcon'

interface Props {
  /** 主圖本機路徑（未編碼） */
  avatarPath: string
  emotion?: string
  emotions?: Record<string, string>
  name: string
  size?: number
  flipped?: boolean
}

export interface CharacterSpriteHandle {
  getAlphaAt: (x: number, y: number) => number
}

function resolveDisplayPath(avatarPath: string, emotion: string | undefined, emotions: Record<string, string> | undefined): string {
  const map = emotions ?? {}
  const em = emotion?.trim()
  if (em && map[em]?.trim()) return map[em].trim()
  return avatarPath ?? ''
}

const CharacterSprite = forwardRef<CharacterSpriteHandle, Props>(
  function CharacterSprite({ avatarPath, emotion, emotions, name, size = 1, flipped = false }, ref) {
    const w = Math.round(180 * size)
    const h = Math.round(260 * size)

    const displayPath = resolveDisplayPath(avatarPath, emotion, emotions)
    const src = displayPath ? `local://${encodeURIComponent(displayPath)}` : ''

    const pixelDataRef = useRef<{ data: Uint8ClampedArray; width: number; height: number } | null>(null)
    const prevSrcRef = useRef<string>('')

    useEffect(() => {
      if (!src || src === prevSrcRef.current) return
      prevSrcRef.current = src

      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = img.naturalWidth
          canvas.height = img.naturalHeight
          const ctx = canvas.getContext('2d')
          if (!ctx) return
          ctx.drawImage(img, 0, 0)
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
          pixelDataRef.current = {
            data: imageData.data,
            width: canvas.width,
            height: canvas.height
          }
        } catch {
          pixelDataRef.current = null
        }
      }
      img.src = src
    }, [src])

    useImperativeHandle(ref, () => ({
      getAlphaAt(clientX: number, clientY: number): number {
        const pd = pixelDataRef.current
        if (!pd) return 255

        const localX = flipped ? (w - clientX) : clientX
        const imgX = Math.round((localX / w) * pd.width)
        const imgY = Math.round((clientY / h) * pd.height)

        if (imgX < 0 || imgY < 0 || imgX >= pd.width || imgY >= pd.height) return 0

        const idx = (imgY * pd.width + imgX) * 4 + 3
        return pd.data[idx] ?? 0
      }
    }), [w, h])

    if (!src) {
      return (
        <div
          className="rounded-full bg-mint flex items-center justify-center shadow-soft"
          style={{ width: w, height: h }}
        >
          <MonoIcon name="user" className="w-10 h-10 text-primary" />
          <span className="sr-only">{name}</span>
        </div>
      )
    }

    return (
      <img
        src={src}
        alt={name}
        draggable={false}
        style={{ width: w, height: h, objectFit: 'contain', transform: flipped ? 'scaleX(-1)' : 'none' }}
        className="select-none pointer-events-none"
      />
    )
  }
)

export default CharacterSprite
