import { useRef, useState, useEffect } from 'react'
import { useAppStore } from '../stores/useAppStore'

export default function InputWindow() {
  const { sendMessage, isSending } = useAppStore(s => ({
    sendMessage: s.sendMessage,
    isSending: s.isSending
  }))

  const [text, setText] = useState('')
  const [images, setImages] = useState<string[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const handleSend = async () => {
    const trimmed = text.trim()
    if (!trimmed || isSending) return
    setText('')
    setImages([])
    await sendMessage(trimmed, images.length > 0 ? images : undefined)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    const readers = files.map(file => new Promise<string>(resolve => {
      const r = new FileReader()
      r.onload = () => resolve(r.result as string)
      r.readAsDataURL(file)
    }))
    Promise.all(readers).then(urls => setImages(prev => [...prev, ...urls].slice(0, 4)))
    e.target.value = ''
  }

  const removeImage = (idx: number) => {
    setImages(prev => prev.filter((_, i) => i !== idx))
  }

  return (
    <div className="w-full h-full flex flex-col bg-bg border border-border rounded-2xl shadow-panel overflow-hidden">
      {/* Title bar / drag region */}
      <div className="drag-region flex items-center justify-between px-3 pt-2 pb-1">
        <span className="text-xs text-secondary font-medium no-drag select-none">Desktop Familiar</span>
        <div className="flex gap-1 no-drag">
          <button
            className="tab-btn text-xs px-2 py-1"
            onClick={() => window.api.invoke('window:toggle-log')}
            title="對話記錄"
          >
            📋 記錄
          </button>
          <button
            className="btn-round w-6 h-6 text-xs"
            onClick={() => window.api.invoke('window:close-self')}
            title="關閉"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Image previews */}
      {images.length > 0 && (
        <div className="flex gap-2 px-3 pb-1 flex-wrap no-drag">
          {images.map((src, i) => (
            <div key={i} className="relative">
              <img src={src} className="w-12 h-12 object-cover rounded-lg border border-border" alt="" />
              <button
                onClick={() => removeImage(i)}
                className="absolute -top-1 -right-1 w-4 h-4 bg-blush text-white rounded-full text-xs flex items-center justify-center"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="flex-1 px-3 no-drag">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="在這裡輸入訊息... (Ctrl+Enter 送出)"
          disabled={isSending}
          className="input-field h-full resize-none py-2 min-h-[60px]"
          rows={3}
        />
      </div>

      {/* Bottom toolbar */}
      <div className="flex items-center justify-between px-3 py-2 no-drag">
        <div className="flex gap-2">
          <button
            className="btn-round w-8 h-8 text-sm"
            title="上傳圖片"
            onClick={() => fileInputRef.current?.click()}
          >
            🖼️
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>

        <button
          onClick={handleSend}
          disabled={isSending || !text.trim()}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-semibold
                     bg-mint text-primary shadow-soft transition-all
                     hover:bg-teal hover:scale-105 active:scale-95
                     disabled:opacity-40 disabled:pointer-events-none"
        >
          {isSending ? '傳送中...' : '➤ 送出'}
        </button>
      </div>
    </div>
  )
}
