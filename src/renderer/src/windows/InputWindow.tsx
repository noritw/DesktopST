import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore, selectMessages } from '../stores/useAppStore'
import MonoIcon from '../components/MonoIcon'

export default function InputWindow() {
  const sendMessage = useAppStore(s => s.sendMessage)
  const isSending = useAppStore(s => s.isSending)
  const messages = useAppStore(selectMessages)
  const settings = useAppStore(s => s.settings)
  const conversation = useAppStore(s => s.conversation)

  const [text, setText] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [isCapturing, setIsCapturing] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const personaPresets = useAppStore(s => s.personaPresets)

  const maxImages = settings?.llm?.maxImagesPerMessage ?? 4
  const activePersona = personaPresets.find(p => p.id === settings?.activePersonaId)
  const personaName = activePersona?.displayName || activePersona?.nickname || '使用者'
  const conversationTitle = conversation?.title || '新對話'

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

  const handleScreenshot = async (channel: 'desktop:capture-screenshot' | 'desktop:capture-screenshot-with-characters') => {
    if (images.length >= maxImages || isCapturing) return
    setIsCapturing(true)
    try {
      const result = await window.api.invoke(channel) as {
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

  const openLogWindow = (focusTitleInput = false) => {
    window.api.invoke('window:open-log', { focusTitleInput })
  }

  const confirmNoteLimit = (level?: string, count?: number) => {
    const n = Number.isFinite(count) ? count : 0
    if (level === 'double') {
      return window.confirm(`目前已有 ${n} 張便利貼，繼續新增可能讓桌面變慢。確定還要新增嗎？`) &&
        window.confirm('再次確認：便利貼不會被自動清理，電腦撐不住就要自己收拾喔。')
    }
    return window.confirm(`目前已有 ${n} 張便利貼。可以繼續新增，但太多會影響效能。要繼續嗎？`)
  }

  const createNewNote = async (force = false) => {
    const result = await window.api.invoke('pinned-note:create', '', '便利貼', { x: 300, y: 100 }, '', force) as { needsConfirm?: boolean; level?: string; count?: number }
    if (result?.needsConfirm && confirmNoteLimit(result.level, result.count)) {
      await createNewNote(true)
    }
  }

  const openNotesManager = () => {
    window.api.invoke('pinned-note:open-manager')
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'transparent',
        overflow: 'hidden'
      }}
    >
      <div className="relative w-full h-full pt-2">
        <div className="drag-region absolute left-0 right-0 top-0 h-7 z-20" />
        <div className="absolute left-0 right-0 top-0 h-7 z-30 pointer-events-none">
          <div className="absolute left-3 top-0 rounded-full bg-[#3D7D70] border border-[#2E665A] px-3 py-0.5 text-xs text-white font-semibold leading-tight select-none">
            DesktopST
          </div>
          <div className="absolute right-3 top-0 flex gap-1 no-drag shrink-0 pointer-events-auto">
            <button
              type="button"
              className="w-6 h-6 rounded-full border border-border bg-white text-secondary hover:text-primary hover:bg-mint transition-colors flex items-center justify-center cursor-pointer"
              onClick={() => window.api.invoke('window:open-settings')}
              title="開啟詳細設定"
            >
              <MonoIcon name="settings" className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              className="w-6 h-6 rounded-full border border-border bg-white text-secondary hover:text-primary hover:bg-mint transition-colors flex items-center justify-center cursor-pointer"
              onClick={() => window.api.invoke('window:close-self')}
              title="關閉輸入視窗（點角色可重新開啟）"
            >
              <MonoIcon name="close" className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="h-full flex flex-col bg-[#F7FFFC] border border-border rounded-2xl overflow-hidden pt-4 shadow-panel">
          {settings && (settings.ui?.onboardingCompleted !== true || !(settings.llm?.apiKey ?? '').trim()) && (
            <div className="px-3 py-1.5 text-[11px] text-primary bg-[#E8FBF4] border-b border-border no-drag flex items-center justify-between gap-2 shrink-0">
              <span>尚未完成初始設定或缺少 API Key。</span>
              <button
                type="button"
                className="shrink-0 text-[11px] px-2 py-0.5 rounded-full bg-mint font-semibold"
                onClick={() => void window.api.invoke('window:open-settings', 'llm')}
              >
                開啟設定
              </button>
            </div>
          )}

          <div className="flex-1 min-h-0 px-3 pb-1 overflow-hidden">
            <div className="h-full min-w-0 min-h-0 flex flex-col no-drag">
              <div className="flex items-center justify-between px-1 py-0.5 pr-[4.5rem]">
                <button
                  type="button"
                  className="inline-flex items-center text-xs text-secondary font-medium hover:text-primary transition-colors min-w-0"
                  onClick={() => window.api.invoke('window:open-settings', 'persona')}
                  title="前往使用者資訊設定"
                >
                  <span className="truncate">{personaName}：</span>
                </button>
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-xs text-border select-none">──</span>
                  <button
                    type="button"
                    className="text-xs text-secondary font-medium truncate hover:text-primary transition-colors max-w-[180px] text-right"
                    onClick={() => openLogWindow(true)}
                    title="開啟對話記錄並聚焦對話名稱"
                  >
                    {conversationTitle}
                  </button>
                  <button
                    type="button"
                    className="w-5 h-5 rounded-full border border-border bg-surface text-secondary hover:text-primary hover:bg-mint transition-colors flex items-center justify-center"
                    onClick={() => openLogWindow(false)}
                    title={lastError ? `最近錯誤：${lastError.llmModel ?? ''}` : '開啟對話記錄'}
                  >
                    <MonoIcon name="log" className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <div className="flex-1 min-h-0">
                <div className="h-full min-h-[34px] flex items-stretch gap-2">
                  <textarea
                    ref={textareaRef}
                    value={text}
                    onChange={event => setText(event.target.value)}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    placeholder="在這裡輸入訊息... (Ctrl+Enter 送出)"
                    disabled={isSending}
                    className="input-field flex-1 h-full min-h-[34px] resize-none py-1.5"
                    rows={1}
                  />
                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={isSending || (!text.trim() && images.length === 0)}
                    className="shrink-0 w-14 h-full min-h-[34px] rounded-2xl text-primary border border-[#61C9AE]
                           bg-[#8DF1D4] shadow-soft transition-colors
                           hover:bg-[#79E7C7] active:bg-[#69D8B8]
                           disabled:opacity-40 disabled:pointer-events-none
                           no-drag flex items-center justify-center"
                    title={isSending ? '送出中...' : '送出訊息'}
                  >
                    <MonoIcon name="send" className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="flex gap-1.5 px-3 pr-[4.75rem] pb-1.5 no-drag items-center">
            {/* 左側：圖片 / 截圖按鈕 */}
            <div className="flex gap-1.5 items-center shrink-0">
              <button
                type="button"
                className="btn-round w-7 h-7 text-xs"
                title="附加圖片"
                disabled={images.length >= maxImages}
                onClick={() => fileInputRef.current?.click()}
              >
                <MonoIcon name="image" className="w-3.5 h-3.5" />
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
                className="btn-round w-7 h-7 text-xs"
                title={isCapturing ? '截圖中...' : images.length >= maxImages ? `已達圖片上限 (${maxImages})` : '截取螢幕畫面'}
                disabled={images.length >= maxImages || isCapturing}
                onClick={() => handleScreenshot('desktop:capture-screenshot')}
              >
                <MonoIcon name="screenshot" className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                className="btn-round w-7 h-7 text-xs"
                title={isCapturing ? '截圖中...' : images.length >= maxImages ? `已達圖片上限 (${maxImages})` : '保留角色與對白框截圖'}
                disabled={images.length >= maxImages || isCapturing}
                onClick={() => handleScreenshot('desktop:capture-screenshot-with-characters')}
              >
                <MonoIcon name="screenshot-character" className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex-1 min-w-0 flex gap-1.5 items-center overflow-x-auto py-0.5">
              {images.map((src, i) => (
                <div key={i} className="relative shrink-0">
                  <button
                    type="button"
                    className="block rounded-lg border border-border overflow-hidden hover:border-teal transition-colors"
                    onClick={() => window.api.invoke('desktop:show-image-preview', { images, index: i })}
                    title="點擊預覽圖片"
                  >
                    <img src={src} className="w-7 h-7 object-cover" alt="" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeImage(i)}
                    className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center border border-[#FFB59F] bg-[#FFE2D8] text-[#E85D3F]"
                    title="移除圖片"
                  >
                    <MonoIcon name="close" className="w-2 h-2" />
                  </button>
                </div>
              ))}
            </div>

            {/* 右側：便利貼按鈕組，貼齊右下角 */}
            <div className="flex gap-1 items-center shrink-0 ml-auto pl-1 border-l border-border">
              <button
                type="button"
                className="btn-round w-7 h-7 text-xs"
                title="新建便利貼"
                onClick={() => createNewNote()}
              >
                <MonoIcon name="pin" className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                className="btn-round w-7 h-7 text-xs"
                title="管理便利貼"
                onClick={openNotesManager}
              >
                <MonoIcon name="notes" className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
