import { useCallback, useEffect, useRef, useState } from 'react'
import type { Lorebook, LoreEntry } from '@core/lore'
import MonoIcon from '@shared/MonoIcon'
import { getData } from '../stores/appStore'
import { useUiStore } from '../stores/uiStore'
import { describeSettingsError } from '../settings/settingsErrors'

/**
 * 用語解說內容編輯（B3 階段 9）。
 *
 * 條目只暴露四個欄位（關鍵字／內容／常駐／啟用），比照桌面版
 * `LorebookSection.tsx` 的 §7.1 決議：`priority` / `insertion_order` /
 * `secondary_keys` 存在於資料裡但不進 UI，存檔時原樣帶著走（spread 保留）。
 */
export function LorebookEditor({ bookId }: { bookId: string }): JSX.Element {
  const pop = useUiStore((s) => s.pop)
  const toast = useUiStore((s) => s.toast)
  const confirm = useUiStore((s) => s.confirm)
  const setCloseGuard = useUiStore((s) => s.setCloseGuard)

  const [draft, setDraft] = useState<Lorebook | null>(null)
  const [busy, setBusy] = useState(false)
  const dirty = useRef(false)
  const [isDirty, setIsDirty] = useState(false)
  const mark = (): void => { dirty.current = true; setIsDirty(true) }

  const load = useCallback(async () => {
    try {
      setDraft(await getData().lorebooks.get(bookId))
    } catch (e) {
      toast(describeSettingsError(e, '載入用語解說'), 'error')
      pop()
    }
  }, [bookId, toast, pop])
  useEffect(() => { void load() }, [load])

  useEffect(() => {
    setCloseGuard(() => {
      if (!dirty.current) return true
      void (async () => {
        if (await confirm({ title: '還沒儲存', message: '要捨棄這些改動嗎？', confirmLabel: '捨棄', destructive: true })) {
          dirty.current = false
          pop()
        }
      })()
      return false
    })
    return () => setCloseGuard(null)
  }, [confirm, pop, setCloseGuard])

  const change = (next: Lorebook): void => { setDraft(next); mark() }

  const save = async (): Promise<void> => {
    if (!draft) return
    if (!draft.name.trim()) { toast('名稱不可空白', 'error'); return }
    setBusy(true)
    try {
      await getData().lorebooks.save(draft)
      dirty.current = false; setIsDirty(false)
      toast('已儲存')
      pop()
    } catch (e) {
      toast(describeSettingsError(e, '儲存'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!draft) return
    const ok = await confirm({
      title: `刪除「${draft.name}」`,
      message: `裡面的 ${draft.entries.length} 條用語會一起刪掉，而且不能復原。`,
      confirmLabel: '刪除',
      destructive: true
    })
    if (!ok) return
    setBusy(true)
    try {
      await getData().lorebooks.remove(draft.id)
      dirty.current = false; setIsDirty(false)
      toast('已刪除')
      pop()
    } catch (e) {
      toast(describeSettingsError(e, '刪除'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const addEntry = (): void => {
    if (!draft) return
    const entry: LoreEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      keys: [],
      content: '',
      enabled: true,
      constant: false,
      insertion_order: draft.entries.length
    }
    change({ ...draft, entries: [...draft.entries, entry] })
  }

  const editEntry = (entryId: string, fn: (e: LoreEntry) => LoreEntry): void => {
    if (!draft) return
    change({ ...draft, entries: draft.entries.map((e) => (e.id === entryId ? fn(e) : e)) })
  }

  const deleteEntry = (entryId: string): void => {
    if (!draft) return
    change({ ...draft, entries: draft.entries.filter((e) => e.id !== entryId) })
  }

  if (!draft) return <div className="py-8 text-center text-sm text-[var(--text-sub)]">載入中⋯⋯</div>

  return (
    <div className="space-y-4 pb-2">
      {isDirty && <p className="text-xs text-[var(--text-sub)]">＊ 有未儲存的變更</p>}

      <label className="block text-sm text-[var(--text)]">
        <span className="mb-1 block font-medium">名稱</span>
        <input className="field" maxLength={60} value={draft.name} onChange={(e) => change({ ...draft, name: e.target.value })} />
      </label>

      {draft.entries.length === 0 && (
        <p className="text-xs text-[var(--text-sub)]">還沒有任何用語，點下面的「新增用語」開始。</p>
      )}

      <div className="space-y-3">
        {draft.entries.map((entry) => (
          <LoreEntryCard key={entry.id} entry={entry} onChange={(fn) => editEntry(entry.id, fn)} onDelete={() => deleteEntry(entry.id)} />
        ))}
      </div>

      <button
        type="button"
        onClick={addEntry}
        className="flex w-full items-center justify-center gap-1 rounded-full border border-[var(--border)] bg-[var(--bg)] py-2 text-xs text-[var(--text)]"
      >
        <MonoIcon name="plus" className="h-3.5 w-3.5" />
        新增用語
      </button>

      <button type="button" disabled={busy} onClick={() => void save()} className="w-full rounded-full bg-[var(--mint)] py-2.5 text-sm text-[var(--text)] disabled:opacity-50">
        儲存
      </button>
      <button type="button" disabled={busy} onClick={() => void remove()} className="w-full rounded-full border border-[var(--danger)] py-2.5 text-sm text-[var(--danger)] disabled:opacity-50">
        刪除這本用語解說
      </button>
    </div>
  )
}

function LoreEntryCard({
  entry,
  onChange,
  onDelete
}: {
  entry: LoreEntry
  onChange: (fn: (e: LoreEntry) => LoreEntry) => void
  onDelete: () => void
}): JSX.Element {
  const [keyInput, setKeyInput] = useState('')

  const addKey = (): void => {
    const k = keyInput.trim()
    if (!k) return
    setKeyInput('')
    onChange((e) => (e.keys.includes(k) ? e : { ...e, keys: [...e.keys, k] }))
  }

  return (
    <div className={`rounded-[14px] border border-[var(--border)] p-3 space-y-2 ${entry.enabled ? '' : 'opacity-50'}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        {entry.keys.map((k) => (
          <span key={k} className="inline-flex items-center gap-1 rounded-full bg-[var(--mint2)] px-2 py-0.5 text-[11px] text-[var(--text)]">
            {k}
            <button
              type="button"
              aria-label={`移除關鍵字 ${k}`}
              className="text-[var(--text-sub)]"
              onClick={() => onChange((e) => ({ ...e, keys: e.keys.filter((x) => x !== k) }))}
            >
              <MonoIcon name="close" className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          type="text"
          className="field min-w-[100px] flex-1 text-xs"
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          onBlur={addKey}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addKey() } }}
          placeholder="輸入關鍵字後按 Enter"
        />
      </div>
      <p className="text-[11px] leading-relaxed text-[var(--text-sub)]">同一件事的不同叫法都填進來，任一個被提到就生效。</p>

      <textarea
        className="field min-h-[60px] resize-none text-xs"
        value={entry.content}
        onChange={(e) => onChange((prev) => ({ ...prev, content: e.target.value }))}
        placeholder="這個詞是什麼？寫給角色看的解說。"
      />

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" className="h-4 w-4 accent-[var(--mint2)]" checked={entry.constant} onChange={(e) => onChange((prev) => ({ ...prev, constant: e.target.checked }))} />
          <span className="text-xs text-[var(--text)]">常駐</span>
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" className="h-4 w-4 accent-[var(--mint2)]" checked={entry.enabled} onChange={(e) => onChange((prev) => ({ ...prev, enabled: e.target.checked }))} />
          <span className="text-xs text-[var(--text)]">啟用</span>
        </label>
        <button type="button" className="ml-auto text-[11px] text-[var(--danger)]" onClick={onDelete}>
          刪除這條
        </button>
      </div>
      <p className="text-[11px] leading-relaxed text-[var(--text-sub)]">
        勾選「常駐」後永遠注入，不需在對話中提到。核心術語建議勾選——只靠關鍵字觸發的話，太久沒提到的詞就不會再生效。
      </p>
    </div>
  )
}
