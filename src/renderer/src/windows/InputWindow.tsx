import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore, selectMessages } from '../stores/useAppStore'
import MonoIcon from '../components/MonoIcon'

export default function InputWindow() {
  const sendMessage = useAppStore(s => s.sendMessage)
  const isSending = useAppStore(s => s.isSending)
  const messages = useAppStore(selectMessages)
  const settings = useAppStore(s => s.settings)

  const [text, setText] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [isCapturing, setIsCapturing] = useState(false)
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const maxImages = settings?.llm?.maxImagesPerMessage ?? 4

  const lastError = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role === 'system' && typeof m.content === 'string' && m.content.startsWith('[錯誤]')) return m
    }
    return null
  }, [messages])

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  useEffect(() => {
    const onDown = () => window.api.invoke('ui:aux-activated')
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('focus', onDown, true)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('focus', onDown, true)
    }
  }, [])

  const handleSend = async () => {
    const trimmed = text.trim()
    if ((!trimmed && images.length === 0) || isSending) return
    setText('')
    setImages([])
    await sendMessage(trimmed || 'Image attached.', images.length > 0 ? images : undefined)
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && event.ctrlKey) {
      event.preventDefault()
      handleSend()
    }
  }

  const appendImageFiles = (files: File[]) => {
    const imageFiles = files.filter(file => file.type.startsWith('image/'))
    if (imageFiles.length === 0) return
    const readers = imageFiles.map(file => new Promise<string>(resolve => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.readAsDataURL(file)
    }))
    Promise.all(readers).then(urls => setImages(prev => [...prev, ...urls].slice(0, maxImages)))
  }

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    appendImageFiles(Array.from(event.target.files ?? []))
    event.target.value = ''
  }

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files ?? [])
    const imageFiles = files.filter(file => file.type.startsWith('image/'))
    if (imageFiles.length === 0) return
    event.preventDefault()
    appendImageFiles(imageFiles)
  }

  const removeImage = (idx: number) => {
    setImages(prev => prev.filter((_, i) => i !== idx))
  }

  const handleScreenshot = async () => {
    if (images.length >= maxImages || isCapturing) return
    setIsCapturing(true)
    try {
      const result = await window.api.invoke('desktop:capture-screenshot') as {
        ok: boolean
        dataUrl?: string
        error?: string
      }
      if (result.ok && result.dataUrl) {
        setImages(prev => [...prev, result.dataUrl!].slice(0, maxImages))
      } else {
        console.error('[Screenshot]', result.error)
      }
    } catch (err) {
      console.error('[Screenshot] IPC error:', err)
    } finally {
      setIsCapturing(false)
    }
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#F7FFFC',
        border: '1px solid #D8F5EC',
        borderRadius: 16,
        overflow: 'hidden',
        position: 'relative'
      }}
    >
      {/* Image preview overlay */}
      {previewSrc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 no-drag cursor-pointer"
          onClick={() => setPreviewSrc(null)}
        >
          <div className="relative" onClick={e => e.stopPropagation()}>
            <img
              src={previewSrc}
              className="max-w-full max-h-full object-contain rounded-lg"
              style={{ maxWidth: 'calc(100vw - 16px)', maxHeight: 'calc(100vh - 16px)' }}
              alt="截圖預覽"
            />
            <button
              type="button"
              onClick={() => setPreviewSrc(null)}
              className="absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center border border-[#FFB59F] bg-[#FFE2D8] text-[#E85D3F]"
            >
              <MonoIcon name="close" className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      <div className="drag-region flex items-center justify-between px-3 pt-2 pb-1">
        <span className="text-xs text-secondary font-medium no-drag select-none">DesktopST</span>
        <div className="flex gap-1 no-drag">
          <button
            type="button"
            className="tab-btn text-xs px-2 py-1 inline-flex items-center gap-1.5"
            onClick={() => window.api.invoke('window:toggle-log')}
            title={lastError ? `最近錯誤：${lastError.llmModel ?? ''}` : '開啟對話記錄'}
          >
            <MonoIcon name="log" className="w-3.5 h-3.5" />
            記錄
          </button>
          <button
            type="button"
            className="w-5 h-5 rounded-full border border-border bg-white/80 text-secondary hover:text-primary hover:bg-mint transition-colors flex items-center justify-center"
            onClick={() => window.api.invoke('window:close-self')}
            title="關閉輸入視窗"
          >
            <MonoIcon name="close" className="w-3 h-3" />
          </button>
        </div>
      </div>

      {images.length > 0 && (
        <div className="flex gap-2 px-3 pb-1 flex-wrap no-drag">
          {images.map((src, i) => (
            <div key={i} className="relative">
              <img
                src={src}
                className="w-12 h-12 object-cover rounded-lg border border-border cursor-pointer hover:opacity-80 transition-opacity"
                alt=""
                onClick={() => setPreviewSrc(src)}
                title="點擊預覽"
              />
              <button
                type="button"
                onClick={() => removeImage(i)}
                className="absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center border border-[#FFB59F] bg-[#FFE2D8] text-[#E85D3F]"
                title="移除圖片"
              >
                <MonoIcon name="close" className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 px-3 no-drag">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={event => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="在這裡輸入訊息... (Ctrl+Enter 送出)"
          disabled={isSending}
          className="input-field h-full resize-none py-2 min-h-0"
          rows={1}
        />
      </div>

      <div className="flex items-center justify-between px-3 py-2 no-drag">
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-round w-8 h-8 text-sm"
            title="附加圖片"
            disabled={images.length >= maxImages}
            onClick={() => fileInputRef.current?.click()}
          >
            <MonoIcon name="image" className="w-4 h-4" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
          <button
            type="button"
            className="btn-round w-8 h-8 text-sm"
            title={isCapturing ? '截圖中...' : images.length >= maxImages ? `已達圖片上限 (${maxImages})` : '截取螢幕畫面'}
            disabled={images.length >= maxImages || isCapturing}
            onClick={handleScreenshot}
          >
            <MonoIcon name="screenshot" className="w-4 h-4" />
          </button>
        </div>

        <button
          type="button"
          onClick={handleSend}
          disabled={isSending || (!text.trim() && images.length === 0)}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-semibold
                     bg-mint text-primary shadow-soft transition-colors
                     hover:bg-teal active:bg-teal/70
                     disabled:opacity-40 disabled:pointer-events-none"
        >
          <MonoIcon name="send" className="w-4 h-4" />
          {isSending ? '送出中...' : '送出'}
        </button>
      </div>
    </div>
  )
}
