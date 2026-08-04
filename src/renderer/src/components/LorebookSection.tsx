import { useCallback, useEffect, useRef, useState } from 'react'
import type { Lorebook, LoreEntry } from '../types'

/**
 * 用語解說（Lorebook）編輯器 —— 設定 → 世界觀分頁底下的區塊（docs/future-lorebook.md §7.2）。
 *
 * 條目**只暴露四個欄位**：關鍵字／內容／常駐／啟用（§7.1）。
 * `priority` / `insertion_order` / `secondary_keys` 存在於資料與引擎，但刻意不出現在 UI。
 *
 * 這是進階功能：沒建立任何一本時 prompt 完全不受影響（§6.1），
 * 所以本區塊預設收合，新手不會撞見。
 */

const DEBOUNCE_MS = 400

export function LorebookSection({
  boundIds,
  onToggleBound
}: {
  /** 目前世界觀綁定的 lorebook id（疊加式；未綁的書就是存在但不使用） */
  boundIds: string[]
  onToggleBound: (id: string, next: boolean) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [books, setBooks] = useState<Lorebook[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const reload = useCallback(async () => {
    const list = await window.api.invoke('lorebook:list') as Lorebook[]
    setBooks(list ?? [])
    return list ?? []
  }, [])

  useEffect(() => {
    if (!open) return
    void reload()
    const off = window.api.on('lorebooks:updated', () => { void reload() })
    return off
  }, [open, reload])

  // 未存檔的變更在關閉視窗前也要落地，故改用 debounce 後直接寫檔
  const queueSave = useCallback((book: Lorebook) => {
    setBooks(prev => prev.map(b => b.id === book.id ? book : b))
    clearTimeout(saveTimers.current[book.id])
    saveTimers.current[book.id] = setTimeout(() => {
      window.api.invoke('lorebook:save', book).catch(() => {})
    }, DEBOUNCE_MS)
  }, [])

  useEffect(() => () => {
    for (const t of Object.values(saveTimers.current)) clearTimeout(t)
  }, [])

  const selected = books.find(b => b.id === selectedId) ?? null

  const editEntry = (entryId: string, fn: (e: LoreEntry) => LoreEntry) => {
    if (!selected) return
    queueSave({ ...selected, entries: selected.entries.map(e => e.id === entryId ? fn(e) : e) })
  }

  const addBook = async () => {
    const book = await window.api.invoke('lorebook:create', `用語解說 ${books.length + 1}`) as Lorebook
    await reload()
    setSelectedId(book.id)
  }

  const addEntry = () => {
    if (!selected) return
    const entry: LoreEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      keys: [],
      content: '',
      enabled: true,
      constant: false,
      insertion_order: selected.entries.length
    }
    queueSave({ ...selected, entries: [...selected.entries, entry] })
  }

  const deleteBook = async () => {
    if (!selected) return
    if (!confirm(`確定要刪除「${selected.name}」嗎？裡面的 ${selected.entries.length} 條用語會一起刪掉。`)) return
    await window.api.invoke('lorebook:delete', selected.id)
    setSelectedId(null)
    await reload()
  }

  const importSt = async () => {
    setMsg(null)
    const r = await window.api.invoke('lorebook:import-st') as
      { ok?: true; book?: Lorebook; canceled?: true; error?: string }
    if (r?.canceled) return
    if (r?.error) { setMsg(r.error); return }
    await reload()
    if (r?.book) setSelectedId(r.book.id)
    setMsg(`已匯入「${r?.book?.name}」（${r?.book?.entries.length ?? 0} 條）`)
  }

  const exportSt = async () => {
    if (!selected) return
    setMsg(null)
    const r = await window.api.invoke('lorebook:export-st', selected.id) as
      { ok?: true; path?: string; canceled?: true; error?: string }
    if (r?.canceled) return
    setMsg(r?.error ?? `已匯出至 ${r?.path}`)
  }

  return (
    <div className="border-t border-border pt-3 space-y-3">
      <button
        type="button"
        className="flex items-center gap-1.5 text-sm font-semibold text-primary"
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-xs">{open ? '▾' : '▸'}</span>
        用語解說
        {books.length > 0 && <span className="text-[11px] text-secondary font-normal">（{books.length} 本）</span>}
      </button>

      {open && (
        <div className="space-y-3">
          <p className="text-[11px] text-secondary leading-snug">
            讓角色聽得懂你世界裡的專有名詞。聊天時掃描最近的訊息，提到才注入 —— 沒建立任何一本就完全不影響對話。
          </p>

          {/* 「使用哪幾本」與「編輯哪一本」是兩件事，刻意分開兩個區塊，
              避免重蹈新聞關鍵字組那個 chip 被誤讀成「使用中的組」的覆轍 */}
          {books.length > 0 && (
            <div className="rounded-2xl bg-mint-40/40 p-2.5 space-y-1">
              <p className="text-xs font-semibold text-primary">這個世界觀使用哪幾本</p>
              <p className="text-[11px] text-secondary leading-snug">
                可以複選。勾起來的會一起掃描，任何一本命中關鍵字就注入。
              </p>
              {books.map(b => (
                <label key={b.id} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={boundIds.includes(b.id)}
                    onChange={e => onToggleBound(b.id, e.target.checked)}
                    className="accent-teal w-4 h-4"
                  />
                  <span className="text-xs text-primary truncate">{b.name}</span>
                  <span className="text-[11px] text-secondary shrink-0">（{b.entries.length} 條）</span>
                </label>
              ))}
              {boundIds.length === 0 && (
                <p className="text-[11px] text-secondary leading-snug">
                  目前一本都沒勾 —— 這個世界觀不會注入任何用語解說。
                </p>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-secondary shrink-0">編輯：</span>
            <select
              className="input-field flex-1 min-w-[120px]"
              value={selectedId ?? ''}
              onChange={e => setSelectedId(e.target.value || null)}
            >
              <option value="">（選擇一本來編輯）</option>
              {books.map(b => (
                <option key={b.id} value={b.id}>{b.name}（{b.entries.length}）</option>
              ))}
            </select>
            <button type="button" className="text-xs px-2.5 py-1.5 rounded-full bg-mint font-semibold text-primary hover:bg-teal transition-all" onClick={addBook}>新增</button>
            <button type="button" className="text-xs px-2.5 py-1.5 rounded-full border border-border text-primary hover:bg-mint-40 transition-all" onClick={importSt}>匯入 ST</button>
            {selected && (
              <>
                <button type="button" className="text-xs px-2.5 py-1.5 rounded-full border border-border text-primary hover:bg-mint-40 transition-all" onClick={exportSt}>匯出</button>
                <button type="button" className="text-xs px-2.5 py-1.5 rounded-full border border-[#FFBBBB] text-[#E85D3F] hover:bg-[#FFBBBB]/30 transition-all" onClick={deleteBook}>刪除</button>
              </>
            )}
          </div>

          {msg && <p className="text-[11px] text-secondary leading-snug">{msg}</p>}

          {selected && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="text"
                  className="input-field text-xs flex-1 min-w-[120px]"
                  value={selected.name}
                  onChange={e => queueSave({ ...selected, name: e.target.value })}
                  placeholder="這本的名稱"
                />
              </div>

              {selected.entries.length === 0 && (
                <p className="text-xs text-secondary">還沒有任何用語，點下面的「新增用語」開始。</p>
              )}

              {selected.entries.map(entry => (
                <LoreEntryCard
                  key={entry.id}
                  entry={entry}
                  onChange={fn => editEntry(entry.id, fn)}
                  onDelete={() => queueSave({ ...selected, entries: selected.entries.filter(e => e.id !== entry.id) })}
                />
              ))}

              <button
                type="button"
                className="text-xs px-3 py-1.5 rounded-full bg-mint font-semibold text-primary hover:bg-teal transition-all"
                onClick={addEntry}
              >
                ＋ 新增用語
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** 單一條目：只有關鍵字／內容／常駐／啟用四個欄位（§7.1）。 */
function LoreEntryCard({
  entry,
  onChange,
  onDelete
}: {
  entry: LoreEntry
  onChange: (fn: (e: LoreEntry) => LoreEntry) => void
  onDelete: () => void
}): React.JSX.Element {
  const [keyInput, setKeyInput] = useState('')

  const addKey = () => {
    const k = keyInput.trim()
    if (!k) return
    setKeyInput('')
    onChange(e => e.keys.includes(k) ? e : { ...e, keys: [...e.keys, k] })
  }

  return (
    <div className={`rounded-2xl border border-border p-3 space-y-2 ${entry.enabled ? '' : 'opacity-50'}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        {entry.keys.map(k => (
          <span key={k} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-mint-40 text-primary">
            {k}
            <button
              type="button"
              className="text-secondary hover:text-[#E85D3F]"
              onClick={() => onChange(e => ({ ...e, keys: e.keys.filter(x => x !== k) }))}
            >
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          className="input-field text-xs flex-1 min-w-[100px]"
          value={keyInput}
          onChange={e => setKeyInput(e.target.value)}
          onBlur={addKey}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addKey() } }}
          placeholder="輸入關鍵字後按 Enter"
        />
      </div>
      <p className="text-[11px] text-secondary leading-snug">
        同一件事的不同叫法都填進來，任一個被提到就生效。
      </p>

      <textarea
        className="input-field min-h-[60px] resize-none text-xs"
        value={entry.content}
        onChange={e => onChange(prev => ({ ...prev, content: e.target.value }))}
        placeholder="這個詞是什麼？寫給角色看的解說。"
      />

      <div className="flex items-center gap-4 flex-wrap">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={entry.constant}
            onChange={e => onChange(prev => ({ ...prev, constant: e.target.checked }))}
            className="accent-teal w-4 h-4"
          />
          <span className="text-xs text-primary">常駐</span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={entry.enabled}
            onChange={e => onChange(prev => ({ ...prev, enabled: e.target.checked }))}
            className="accent-teal w-4 h-4"
          />
          <span className="text-xs text-primary">啟用</span>
        </label>
        <button
          type="button"
          className="ml-auto text-[11px] text-secondary hover:text-[#E85D3F]"
          onClick={onDelete}
        >
          刪除這條
        </button>
      </div>
      <p className="text-[11px] text-secondary leading-snug">
        勾選「常駐」後永遠注入，不需在對話中提到。核心術語建議勾選 ——
        只靠關鍵字觸發的話，太久沒提到的詞（超出近期記憶範圍）就不會再生效。
      </p>
    </div>
  )
}
