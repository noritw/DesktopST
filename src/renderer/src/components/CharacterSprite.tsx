import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react'
import MonoIcon from './MonoIcon'

interface Props {
  src: string
  name: string
  size?: number
}

export interface CharacterSpriteHandle {
  /** 查詢圖片座標 (x, y) 的 alpha 值（0–255）。座標是相對於顯示尺寸的像素。 */
  getAlphaAt: (x: number, y: number) => number
}

const CharacterSprite = forwardRef<CharacterSpriteHandle, Props>(
  function CharacterSprite({ src, name, size = 1 }, ref) {
    const w = Math.round(180 * size)
    const h = Math.round(260 * size)

    // 存放圖片的原始像素資料（只在圖片載入時建立一次）
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
          // 若 canvas 讀取失敗（不應發生於本地圖片），fallback 為全不透明
          pixelDataRef.current = null
        }
      }
      img.src = src
    }, [src])

    useImperativeHandle(ref, () => ({
      getAlphaAt(clientX: number, clientY: number): number {
        const pd = pixelDataRef.current
        if (!pd) return 255 // 沒有像素資料時視為不透明

        // 把顯示座標換算成原始圖片座標
        const imgX = Math.round((clientX / w) * pd.width)
        const imgY = Math.round((clientY / h) * pd.height)

        if (imgX < 0 || imgY < 0 || imgX >= pd.width || imgY >= pd.height) return 0

        // RGBA 每個像素佔 4 bytes，alpha 在第 4 個
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
        style={{ width: w, height: h, objectFit: 'contain' }}
        className="select-none pointer-events-none"
      />
    )
  }
)

export default CharacterSprite
