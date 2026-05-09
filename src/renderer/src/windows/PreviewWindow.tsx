import { useEffect, useState } from 'react'
import MonoIcon from '../components/MonoIcon'

export default function PreviewWindow() {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    return window.api.on('preview:set-image', (dataUrl) => {
      setSrc(dataUrl as string)
    })
  }, [])

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
          overflow: 'hidden'
        }}
      >
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
      </div>
    </div>
  )
}
