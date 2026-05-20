import { useEffect, useState } from 'react'
import type { Character } from '../types'
import { useAppStore, selectCharacter } from '../stores/useAppStore'
import BasicInfoTab from './tabs/BasicInfoTab'
import EmotionSpritesTab from './tabs/EmotionSpritesTab'
import AdvancedTab from './tabs/AdvancedTab'
import ImportExportTab from './tabs/ImportExportTab'

import MonoIcon from './MonoIcon'

export type EditorTab = 'basic' | 'emotions' | 'advanced' | 'importexport'

const TAB_LABEL: Record<EditorTab, string> = {
  basic: '基本資訊',
  emotions: '情緒圖片',
  advanced: '進階',
  importexport: '匯入／匯出'
}

interface Props {
  characterId: string
  onClose: () => void
}

export default function CharacterEditor({ characterId, onClose }: Props) {
  const character = useAppStore(selectCharacter(characterId))
  const saveCharacter = useAppStore(s => s.saveCharacter)

  const [draft, setDraft] = useState<Character | null>(null)
  const [dirty, setDirty] = useState(false)
  const [activeTab, setActiveTab] = useState<EditorTab>('basic')
  const [isSaving, setIsSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [saveOk, setSaveOk] = useState(false)

  useEffect(() => {
    if (!character) return
    if (!dirty) {
      setDraft(JSON.parse(JSON.stringify(character)))
    }
  }, [character, dirty])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 3000)
    return () => window.clearTimeout(t)
  }, [toast])

  useEffect(() => {
    if (!saveOk) return
    const t = window.setTimeout(() => setSaveOk(false), 2000)
    return () => window.clearTimeout(t)
  }, [saveOk])

  // 自動儲存防抖（800ms）
  useEffect(() => {
    if (!dirty || !draft) return
    const timer = window.setTimeout(() => {
      void doSave(draft)
    }, 800)
    return () => window.clearTimeout(timer)
  }, [draft, dirty])

  const patchDraft = (next: Character | ((prev: Character) => Character)) => {
    setDirty(true)
    setDraft(prev => {
      if (!prev) return prev
      return typeof next === 'function' ? next(prev) : next
    })
  }

  const doSave = async (data: Character) => {
    setIsSaving(true)
    try {
      const next = { ...data, updatedAt: Date.now() }
      await saveCharacter(next)
      setDraft(next)
      setDirty(false)
      setSaveOk(true)
    } catch (e) {
      setToast(e instanceof Error ? e.message : '儲存失敗')
    } finally {
      setIsSaving(false)
    }
  }

  const changeTab = async (t: EditorTab) => {
    if (t === activeTab || !draft) return
    if (dirty) {
      try {
        const next = { ...draft, updatedAt: Date.now() }
        await saveCharacter(next)
        setDraft(next)
        setDirty(false)
        setSaveOk(true)
      } catch {
        setToast('儲存失敗，無法切換分頁')
        return
      }
    }
    setActiveTab(t)
  }

  if (!character) {
    return (
      <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/20 p-4">
        <p className="text-sm text-secondary bg-surface rounded-2xl px-4 py-3 border border-border">找不到角色資料</p>
      </div>
    )
  }

  if (!draft) {
    return (
      <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/20 p-4">
        <p className="text-sm text-secondary">載入中…</p>
      </div>
    )
  }

  return (
    <div className="absolute inset-0 z-50 flex items-stretch justify-center bg-black/20 p-4">
      <div className="flex flex-col w-full max-w-4xl max-h-full rounded-3xl border border-border bg-bg shadow-soft overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-border shrink-0 min-w-0">
          <span className="min-w-0 flex-1 text-base font-semibold text-primary truncate pr-2">
            編輯：{draft.name}
          </span>
          <button
            type="button"
            className="btn-round no-drag min-w-[44px] min-h-[44px] w-11 h-11 shrink-0 text-primary"
            title="關閉"
            onClick={onClose}
          >
            <span className="sr-only">關閉</span>
            <MonoIcon name="close" className="w-4 h-4" />
          </button>
        </div>

        <div className="flex gap-2 px-4 pt-3 flex-wrap shrink-0">
          {(Object.keys(TAB_LABEL) as EditorTab[]).map(tab => (
            <button
              key={tab}
              type="button"
              onClick={() => void changeTab(tab)}
              className={`text-sm px-4 py-2 rounded-full transition-colors ${
                activeTab === tab ? 'bg-mint text-primary font-semibold' : 'text-secondary hover:bg-mint-30'
              }`}
            >
              {TAB_LABEL[tab]}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0 text-sm [&_span]:text-sm [&_p]:text-sm [&_label]:text-sm [&_input]:text-sm [&_textarea]:text-sm [&_select]:text-sm [&_button]:text-sm">
          {activeTab === 'basic' && <BasicInfoTab draft={draft} setDraft={patchDraft} onError={setToast} />}
          {activeTab === 'emotions' && <EmotionSpritesTab draft={draft} setDraft={patchDraft} onError={setToast} />}
          {activeTab === 'advanced' && <AdvancedTab draft={draft} setDraft={patchDraft} />}
          {activeTab === 'importexport' && (
            <ImportExportTab draft={draft} onError={setToast} onNotify={msg => { setToast(msg) }} />
          )}
        </div>

        <div className="px-6 py-3 border-t border-border flex items-center justify-between shrink-0">
          <span className="text-sm text-secondary">
            {isSaving ? '儲存中…' : dirty ? '有未儲存的變更' : '已儲存'}
          </span>
        </div>
      </div>

      {toast && (
        <div
          className="fixed bottom-6 right-6 z-[60] max-w-xs rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-primary shadow-soft"
          role="status"
        >
          {toast}
        </div>
      )}
    </div>
  )
}
