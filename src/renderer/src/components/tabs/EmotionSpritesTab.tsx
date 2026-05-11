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
  const [editingImagePath, setEditingImagePath] = useState<string | null>(null)

  useEffect(() => {
    setEntries(prev => {
      const base = buildSpriteEntries(draft.emotions ?? {})
      const baseMap = new Map(base.map(b => [b.imagePath, b]))
      const prevMap = new Map(prev.map(p => [p.imagePath, p]))

      // 保持原有順序，只更新情緒和尺寸
      const result = prev
        .filter(p => baseMap.has(p.imagePath))
        .map(p => {
          const updated = baseMap.get(p.imagePath)!
          return { ...updated, dimensions: p.dimensions }
        })

      // 添加新增的圖片
      for (const b of base) {
        if (!prevMap.has(b.imagePath)) {
          result.push(b)
        }
      }

      return result
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

  // 計算每個情緒被哪張圖片占用
  const emotionToImagePath = new Map<string, string>()
  entries.forEach(entry => {
    entry.assignedEmotions.forEach(emo => {
      emotionToImagePath.set(emo, entry.imagePath)
    })
  })

  return (
    <div className="space-y-4">
      <input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.gif,.webp" className="hidden" onChange={onPickFile} />
      <button type="button" className="tab-btn text-sm px-4 py-2 rounded-full bg-mint text-primary font-semibold" onClick={addSprite}>
        新增情緒圖片
      </button>

      <div className="space-y-3 pr-1">
        {entries.length === 0 && <p className="text-sm text-secondary">尚未上傳情緒圖片。</p>}
        {entries.map(entry => {
          const isEditing = editingImagePath === entry.imagePath
          return (
            <div
              key={entry.imagePath}
              className="rounded-2xl border border-border p-3 flex gap-3 bg-white/80 relative"
              onMouseLeave={() => isEditing && setEditingImagePath(null)}
            >
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

                {isEditing ? (
                  <div
                    className="space-y-2 p-2 rounded-lg bg-mint/10 -mx-2"
                  >
                    <div className="flex flex-wrap gap-2">
                      {EMOTION_OPTIONS.map(opt => {
                        const isSelected = entry.assignedEmotions.includes(opt.en)
                        const isUsedByOther = emotionToImagePath.has(opt.en) && emotionToImagePath.get(opt.en) !== entry.imagePath
                        const isDisabled = isUsedByOther && !isSelected

                        return (
                          <button
                            key={opt.en}
                            type="button"
                            disabled={isDisabled}
                            className={`text-[10px] px-2 py-1 rounded-full font-medium transition-all ${
                              isSelected
                                ? 'bg-sky text-white border-2 border-sky'
                                : isDisabled
                                ? 'bg-gray-200 text-gray-400 border border-gray-300 cursor-not-allowed opacity-50'
                                : 'bg-mint text-primary border border-mint hover:bg-[#B5E8B1]'
                            }`}
                            onClick={() => {
                              const nextEmotions = isSelected
                                ? entry.assignedEmotions.filter(e => e !== opt.en)
                                : [...entry.assignedEmotions, opt.en]
                              updateEntryEmotions(entry.imagePath, nextEmotions)
                            }}
                            onMouseDown={e => e.preventDefault()}
                          >
                            {isSelected && '✓ '}
                            {EMOTION_OPTIONS.find(o => o.en === opt.en)?.zh ?? opt.en}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ) : (
                  <>
                    {entry.assignedEmotions.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {entry.assignedEmotions.map(emo => (
                          <span
                            key={emo}
                            className="inline-block text-[10px] px-2 py-1 rounded-full bg-mint text-primary font-medium"
                          >
                            {EMOTION_OPTIONS.find(o => o.en === emo)?.zh ?? emo}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[10px] text-secondary">尚未分配情緒</p>
                    )}
                    <button
                      type="button"
                      className="text-xs text-[#4A9D7D] font-semibold hover:underline"
                      onClick={() => setEditingImagePath(entry.imagePath)}
                    >
                      編輯情緒
                    </button>
                  </>
                )}
              </div>

              <button
                type="button"
                className="absolute bottom-3 right-3 text-xs text-[#C44B34] hover:underline"
                onClick={() => removeEntry(entry.imagePath)}
              >
                移除此圖片
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
