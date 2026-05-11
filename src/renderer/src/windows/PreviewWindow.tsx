import { useEffect, useState } from 'react'
import MonoIcon from '../components/MonoIcon'

export default function PreviewWindow() {
  const [images, setImages] = useState<string[]>([])
  const [index, setIndex] = useState(0)

  useEffect(() => {
    return window.api.on('preview:set-image', (payload) => {
      if (typeof payload === 'string') {
        setImages(payload ? [payload] : [])
        setIndex(0)
        return
      }
      const data = payload as { images?: string[]; index?: number }
      const nextImages = Array.isArray(data?.images) ? data.images : []
      const maxIndex = Math.max(0, nextImages.length - 1)
      const nextIndexRaw = Number(data?.index ?? 0)
      const nextIndex = Number.isFinite(nextIndexRaw)
        ? Math.min(maxIndex, Math.max(0, Math.floor(nextIndexRaw)))
        : 0
      setImages(nextImages)
      setIndex(nextIndex)
    })
  }, [])

  const src = images[index] ?? null
  const canPrev = index > 0
  const canNext = index < images.length - 1

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#2B3A35',
        overflow: 'hidden',
        userSelect: 'none'
      }}
    >
      {/* Title bar */}
      <div
        className="drag-region"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px 6px',
          background: '#243028',
          flexShrink: 0
        }}
      >
        <span style={{ fontSize: 12, color: '#AAEEDD', fontWeight: 600 }}>截圖預覽</span>
        <button
          type="button"
          className="no-drag"
          onClick={() => window.api.invoke('window:close-self')}
          style={{
            width: 20, height: 20, borderRadius: '50%',
            border: '1px solid #FFB59F', background: '#FFE2D8', color: '#E85D3F',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer'
          }}
          title="關閉"
        >
          <MonoIcon name="close" className="w-3 h-3" />
        </button>
      </div>

      {/* Image area */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 12,
          overflow: 'hidden',
          position: 'relative'
        }}
      >
        {images.length > 1 && (
          <button
            type="button"
            className="no-drag"
            onClick={() => setIndex(i => Math.max(0, i - 1))}
            disabled={!canPrev}
            style={{
              position: 'absolute',
              left: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 28,
              height: 28,
              borderRadius: 999,
              border: '1px solid #6B8F80',
              background: '#243028',
              color: '#AAEEDD',
              opacity: canPrev ? 1 : 0.35,
              cursor: canPrev ? 'pointer' : 'default'
            }}
            title="上一張"
          >
            {'<'}
          </button>
        )}
        {src ? (
          <img
            src={src}
            alt="截圖"
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              borderRadius: 6,
              boxShadow: '0 4px 24px rgba(0,0,0,0.5)'
            }}
          />
        ) : (
          <span style={{ color: '#6B8F80', fontSize: 13 }}>載入中...</span>
        )}
        {images.length > 1 && (
          <button
            type="button"
            className="no-drag"
            onClick={() => setIndex(i => Math.min(images.length - 1, i + 1))}
            disabled={!canNext}
            style={{
              position: 'absolute',
              right: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 28,
              height: 28,
              borderRadius: 999,
              border: '1px solid #6B8F80',
              background: '#243028',
              color: '#AAEEDD',
              opacity: canNext ? 1 : 0.35,
              cursor: canNext ? 'pointer' : 'default'
            }}
            title="下一張"
          >
            {'>'}
          </button>
        )}
        {images.length > 1 && (
          <div
            style={{
              position: 'absolute',
              bottom: 8,
              left: '50%',
              transform: 'translateX(-50%)',
              fontSize: 12,
              color: '#AAEEDD',
              background: '#243028CC',
              border: '1px solid #3A4D44',
              borderRadius: 999,
              padding: '2px 8px'
            }}
          >
            {index + 1} / {images.length}
          </div>
        )}
      </div>
    </div>
  )
}
