import { useEffect, useRef, useState } from 'react'
import type { Character } from '../../types'
import { extFromFilename, isAllowedImageExt } from '../../utils/fileValidation'

const MAX_BYTES = 10 * 1024 * 1024

interface Props {
  draft: Character
  setDraft: (next: Character | ((prev: Character) => Character)) => void
  onError: (msg: string) => void
}

export default function BasicInfoTab({ draft, setDraft, onError }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  const pickAvatar = () => inputRef.current?.click()

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const ext = extFromFilename(file.name)
    if (!isAllowedImageExt(ext)) {
      onError('請使用 PNG、JPG、GIF 或 WEBP 格式')
      return
    }
    if (file.size > MAX_BYTES) {
      onError('檔案不可超過 10 MB')
      return
    }
    const buf = await file.arrayBuffer()
    const res = await window.api.invoke('character:save-avatar', {
      id: draft.id,
      buffer: buf,
      ext
    }) as { path?: string; error?: string }
    if (res && typeof res === 'object' && 'error' in res && res.error) {
      onError(res.error)
      return
    }
    if (res && typeof res === 'object' && 'path' in res && res.path) {
      setDraft(prev => ({ ...prev, avatar: res.path as string }))
    }
  }

  const nicknames = draft.nicknames ?? []
  const [nicknameDraft, setNicknameDraft] = useState('')

  const addNickname = () => {
    const v = nicknameDraft.trim()
    if (!v) return
    if (nicknames.includes(v)) {
      setNicknameDraft('')
      return
    }
    setDraft(prev => ({ ...prev, nicknames: [...(prev.nicknames ?? []), v] }))
    setNicknameDraft('')
  }

  const removeNickname = (idx: number) => {
    setDraft(prev => ({
      ...prev,
      nicknames: (prev.nicknames ?? []).filter((_, i) => i !== idx)
    }))
  }

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="text-xs font-semibold text-primary">名稱</span>
        <input
          type="text"
          maxLength={100}
          className="input-field mt-1"
          value={draft.name}
          onChange={e => setDraft(prev => ({ ...prev, name: e.target.value }))}
        />
      </label>

      <div>
        <span className="text-xs font-semibold text-primary">暱稱</span>
        <p className="text-[11px] text-secondary mt-0.5">
          這個角色其他的稱呼、綽號或小名。角色之間互稱、使用者叫角色都可以填。按 Enter 新增。
        </p>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {nicknames.map((n, idx) => (
            <span
              key={`${n}-${idx}`}
              className="inline-flex items-center gap-1 rounded-full bg-mint-30 border border-border px-2.5 py-0.5 text-xs text-primary"
            >
              {n}
              <button
                type="button"
                onClick={() => removeNickname(idx)}
                className="text-secondary hover:text-primary leading-none"
                title="移除"
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <input
          type="text"
          maxLength={40}
          className="input-field mt-2"
          placeholder="輸入暱稱後按 Enter"
          value={nicknameDraft}
          onChange={e => setNicknameDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addNickname()
            }
          }}
          onBlur={addNickname}
        />
      </div>

      <div>
        <span className="text-xs font-semibold text-primary">主圖</span>
        <p className="text-[11px] text-secondary mt-0.5 mb-2">此圖片為角色站在桌面上顯示的主圖。</p>
        <input ref={inputRef} type="file" accept=".png,.jpg,.jpeg,.gif,.webp" className="hidden" onChange={onFile} />
        <button
          type="button"
          onClick={pickAvatar}
          className="w-full rounded-2xl border border-dashed border-border bg-mint-20 hover:bg-mint-40 py-8 flex flex-col items-center gap-2 transition-colors"
        >
          {draft.avatar ? (
            <img src={`local://${encodeURIComponent(draft.avatar)}`} alt="" className="max-h-40 object-contain rounded-xl" />
          ) : (
            <span className="text-sm text-secondary">點擊選擇圖片</span>
          )}
        </button>
        {draft.avatar && (
          <PreviewDims path={`local://${encodeURIComponent(draft.avatar)}`} filename={draft.avatar.split(/[/\\]/).pop() ?? ''} />
        )}
      </div>

      <label className="block">
        <span className="text-xs font-semibold text-primary">簡介</span>
        <p className="text-[11px] text-secondary mt-0.5">
          角色的基本資料,例如外觀、背景、身份。會以 [Description] 區塊注入 prompt。
        </p>
        <textarea
          className="input-field mt-1 min-h-[72px] resize-y"
          value={draft.description}
          onChange={e => setDraft(prev => ({ ...prev, description: e.target.value }))}
        />
      </label>

      <label className="block">
        <span className="text-xs font-semibold text-primary">個性</span>
        <textarea
          className="input-field mt-1 min-h-[88px] resize-y"
          value={draft.personality}
          onChange={e => setDraft(prev => ({ ...prev, personality: e.target.value }))}
        />
      </label>

      <label className="block">
        <span className="text-xs font-semibold text-primary">招呼語</span>
        <textarea
          className="input-field mt-1 min-h-[72px] resize-y"
          value={draft.firstMessage}
          onChange={e => setDraft(prev => ({ ...prev, firstMessage: e.target.value }))}
        />
      </label>

      <label className="block">
        <span className="text-xs font-semibold text-primary">對話範例</span>
        <p className="text-[11px] text-secondary mt-0.5">
          可用標籤：<code>{'{{user}}'}</code>、<code>{'{{char}}'}</code>
        </p>
        <textarea
          className="input-field mt-1 min-h-[88px] resize-y"
          value={draft.exampleDialogue}
          onChange={e => setDraft(prev => ({ ...prev, exampleDialogue: e.target.value }))}
        />
      </label>
    </div>
  )
}

function PreviewDims({ path, filename }: { path: string; filename: string }) {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    const img = new Image()
    img.onload = () => setDims({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => setDims(null)
    img.src = path
    return () => {
      img.onload = null
      img.onerror = null
    }
  }, [path])
  return (
    <p className="text-[11px] text-secondary mt-2" title={dims ? `${dims.w}×${dims.h} px` : ''}>
      {filename}
      {dims ? ` · ${dims.w}×${dims.h} px` : ''}
    </p>
  )
}
