import { useEffect, useRef, useState } from 'react'
import type { Character } from '../../types'
import {
  EMOTION_OPTIONS,
  buildSpriteEntries,
  emotionLabel,
  removeEmotionSprite,
  updateEmotionAssignment,
  type SpriteEntry
} from '../../utils/emotionUtils'
import { extFromFilename, isAllowedImageExt } from '../../utils/fileValidation'

const MAX_BYTES = 10 * 1024 * 1024

interface Props {
  draft: Character
  setDraft: (next: Character | ((prev: Character) => Character)) => void
  onError: (msg: string) => void
}

export default function EmotionSpritesTab({ draft, setDraft, onError }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [entries, setEntries] = useState<SpriteEntry[]>(() => buildSpriteEntries(draft.emotions ?? {}))

  useEffect(() => {
    setEntries(prev => {
      const base = buildSpriteEntries(draft.emotions ?? {})
      return base.map(b => {
        const old = prev.find(p => p.imagePath === b.imagePath)
        return old ? { ...b, dimensions: old.dimensions } : b
      })
    })
  }, [draft.emotions])

  const addSprite = () => fileRef.current?.click()

  const onPickFile = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0]
    ev.target.value = ''
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
    const res = await window.api.invoke('character:save-emotion-sprite', {
      id: draft.id,
      filename: file.name,
      buffer: buf,
      ext
    }) as { path?: string; error?: string }
    if (res && typeof res === 'object' && 'error' in res && res.error) {
      onError(res.error)
      return
    }
    const newPath = (res as { path?: string }).path
    if (!newPath) return
    setEntries(prev => [...prev, { imagePath: newPath, filename: newPath.split(/[/\\]/).pop() ?? '', dimensions: null, assignedEmotions: [] }])
  }

  const updateEntryEmotions = (imagePath: string, selected: string[]) => {
    const nextEmotions = updateEmotionAssignment(draft.emotions ?? {}, imagePath, selected)
    setDraft(prev => ({ ...prev, emotions: nextEmotions }))
  }

  const removeEntry = (imagePath: string) => {
    setDraft(prev => ({ ...prev, emotions: removeEmotionSprite(prev.emotions ?? {}, imagePath) }))
    setEntries(prev => prev.filter(e => e.imagePath !== imagePath))
  }

  const setDims = (imagePath: string, w: number, h: number) => {
    setEntries(list => list.map(x => (x.imagePath === imagePath ? { ...x, dimensions: { w, h } } : x)))
  }

  return (
    <div className="space-y-4">
      <input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.gif,.webp" className="hidden" onChange={onPickFile} />
      <button type="button" className="tab-btn text-sm px-4 py-2 rounded-full bg-mint text-primary font-semibold" onClick={addSprite}>
        新增情緒圖片
      </button>

      <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
        {entries.length === 0 && <p className="text-sm text-secondary">尚未上傳情緒圖片。</p>}
        {entries.map(entry => (
          <div key={entry.imagePath} className="rounded-2xl border border-border p-3 flex gap-3 bg-white/80">
            <div className="w-16 h-16 rounded-xl overflow-hidden bg-mint shrink-0 flex items-center justify-center">
              <img
                src={`local://${encodeURIComponent(entry.imagePath)}`}
                alt=""
                className="w-full h-full object-cover"
                draggable={false}
                onLoad={e => setDims(entry.imagePath, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
              />
            </div>
            <div className="flex-1 min-w-0 space-y-2">
              <div className="text-xs font-medium text-primary truncate" title={entry.filename}>
                {entry.filename}
              </div>
              <div className="text-[10px] text-secondary" title={entry.dimensions ? `${entry.dimensions.w}×${entry.dimensions.h}` : ''}>
                {entry.dimensions ? `${entry.dimensions.w}×${entry.dimensions.h} px` : '讀取尺寸中…'}
              </div>
              <select
                multiple
                size={6}
                className="w-full text-xs rounded-xl border border-border bg-white text-primary px-2 py-1"
                value={entry.assignedEmotions}
                onChange={e => {
                  const sel = Array.from(e.target.selectedOptions).map(o => o.value)
                  updateEntryEmotions(entry.imagePath, sel)
                }}
              >
                {EMOTION_OPTIONS.map(opt => (
                  <option key={opt.en} value={opt.en}>
                    {emotionLabel(opt.en)}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-secondary">按住 Ctrl／⌘ 可多選情緒。</p>
              <button type="button" className="text-xs text-[#C44B34] hover:underline" onClick={() => removeEntry(entry.imagePath)}>
                移除此圖片
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
