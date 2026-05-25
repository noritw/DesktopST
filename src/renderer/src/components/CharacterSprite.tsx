import { useEffect, useRef, useImperativeHandle, forwardRef, useState } from 'react'
import MonoIcon from './MonoIcon'
import { buildSpriteIdMap, stemFromFilename } from '../utils/emotionUtils'

const MAX_W = 180
const MAX_H = 260

interface Props {
  /** 主圖本機路徑（未編碼） */
  avatarPath: string
  emotion?: string
  emotions?: Record<string, string>
  spriteIds?: Record<string, string>
  name: string
  size?: number
  flipped?: boolean
  onActualHChange?: (h: number) => void
}

export interface CharacterSpriteHandle {
  getAlphaAt: (x: number, y: number) => number
}

function resolveDisplayPath(
  avatarPath: string,
  emotion: string | undefined,
  emotions: Record<string, string> | undefined,
  spriteIds?: Record<string, string>
): string {
  const map = emotions ?? {}
  const em = emotion?.trim()
  if (!em) return avatarPath ?? ''
  // Standard lookup (28-emotion keys)
  if (map[em]?.trim()) return map[em].trim()
  // Custom ID lookup via spriteIds or filename stem
  const idMap = buildSpriteIdMap(map, spriteIds)
  const byId = idMap.get(em)
  if (byId) return byId
  // Fallback: match by filename stem
  for (const [imagePath] of Object.entries(map).filter(([, p]) => p)) {
    const filename = imagePath.split(/[/\\]/).pop() ?? imagePath
    if (stemFromFilename(filename) === em) return imagePath
  }
  return avatarPath ?? ''
}

const CharacterSprite = forwardRef<CharacterSpriteHandle, Props>(
  function CharacterSprite({ avatarPath, emotion, emotions, spriteIds, name, size = 1, flipped = false, onActualHChange }, ref) {
    const [naturalDims, setNaturalDims] = useState<{ w: number; h: number } | null>(null)

    // Compute actual rendered size preserving natural aspect ratio within MAX_W × MAX_H
    const scale = naturalDims
      ? Math.min(MAX_W / naturalDims.w, MAX_H / naturalDims.h) * size
      : size
    const w = naturalDims ? Math.round(naturalDims.w * scale) : Math.round(MAX_W * size)
    const h = naturalDims ? Math.round(naturalDims.h * scale) : Math.round(MAX_H * size)

    const displayPath = resolveDisplayPath(avatarPath, emotion, emotions, spriteIds)
    const src = displayPath ? `local://${encodeURIComponent(displayPath)}` : ''

    const pixelDataRef = useRef<{ data: Uint8ClampedArray; width: number; height: number } | null>(null)
    const prevSrcRef = useRef<string>('')

    useEffect(() => {
      if (!src || src === prevSrcRef.current) return
      prevSrcRef.current = src
      pixelDataRef.current = null
      setNaturalDims(null)

      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        setNaturalDims({ w: img.naturalWidth, h: img.naturalHeight })
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

    useEffect(() => {
      onActualHChange?.(h)
    }, [h, onActualHChange])

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
    }), [w, h, flipped])

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
        style={{ width: w, height: h, transform: flipped ? 'scaleX(-1)' : 'none' }}
        className="select-none pointer-events-none"
      />
    )
  }
)

export default CharacterSprite
