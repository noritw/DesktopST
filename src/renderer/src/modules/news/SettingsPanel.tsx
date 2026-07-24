import { Fragment, useEffect, useRef, useState } from 'react'
import {
  WEIGHT_LABELS, nextWeight, DEFAULT_KEYWORD_GROUP_ID, effectiveGroupId,
  type LangMode, type NewsModuleSettings, type NewsPreviewResult, type NewsReplyModel, type NewsSource, type NewsWeight, type SpeakMode
} from './types'
import type { ReminderSchedule } from '../../types'

const SPEAK_OPTIONS: { value: SpeakMode; label: string; hint: string }[] = [
  { value: 'off', label: '不抓新聞', hint: '按「說點什麼」只會閒聊' },
  { value: 'sometimes', label: '偶爾（推薦）', hint: '有時閒聊、有時帶一則新聞' },
  { value: 'always', label: '每次', hint: '每次都會挑一則新聞來聊' }
]

const REPLY_MODEL_OPTIONS: { value: NewsReplyModel; label: string; hint: string }[] = [
  { value: 'main', label: '主要 LLM（口吻優先・推薦）', hint: '角色講新聞時口吻更自然，但 Token 消耗較高' },
  { value: 'utility', label: '輔助 LLM（成本優先）', hint: '用便宜模型講新聞、省 Token，但口吻可能較平' }
]

const LANG_OPTIONS: { value: LangMode; label: string; hint: string }[] = [
  { value: 'translate', label: '外語也收，請角色翻成繁中講（推薦）', hint: '日文／簡中新聞由角色用繁體中文轉述' },
  { value: 'zh-only', label: '只要繁體中文', hint: '非繁中的新聞直接略過' },
  { value: 'raw', label: '原文照收', hint: '不處理語言' }
]

const WEIGHT_VALUE: Record<NewsWeight, number> = { often: 3, normal: 2, rarely: 1 }

function weightChipClass(weight: NewsWeight): string {
  switch (weight) {
    case 'often': return 'bg-teal text-primary'
    case 'rarely': return 'bg-surface text-secondary border border-border'
    default: return 'bg-mint text-primary'
  }
}

// ── 定時排程小元件 ──────────────────────────────────────────────────────────
function NewsSchedulerSection() {
  const [enabled, setEnabled] = useState(false)
  const [schedType, setSchedType] = useState<'daily' | 'interval'>('daily')
  const [hour, setHour] = useState(9)
  const [minute, setMinute] = useState(0)
  const [intervalHours, setIntervalHours] = useState(3)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void (async () => {
      const res = await window.api.invoke('news:get-scheduler') as { enabled: boolean; schedule?: ReminderSchedule }
      if (res.enabled) {
        setEnabled(true)
        const s = res.schedule
        if (s?.type === 'daily') { setSchedType('daily'); setHour(s.hour); setMinute(s.minute) }
        else if (s?.type === 'interval') { setSchedType('interval'); setIntervalHours(Math.round(s.intervalMs / 3600000)) }
      }
    })()
  }, [])

  const handleSave = async (nextEnabled: boolean) => {
    setSaving(true)
    let schedule: ReminderSchedule | undefined
    if (nextEnabled) {
      schedule = schedType === 'daily'
        ? { type: 'daily', hour, minute }
        : { type: 'interval', intervalMs: intervalHours * 3600000 }
    }
    await window.api.invoke('news:sync-scheduler', { enabled: nextEnabled, schedule })
    setEnabled(nextEnabled)
    setSaving(false)
  }

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          disabled={saving}
          className="accent-teal w-4 h-4"
          onChange={e => void handleSave(e.target.checked)}
        />
        <span className="text-sm text-primary">啟用定時新聞陪聊</span>
      </label>
      {enabled && (
        <div className="ml-6 space-y-2">
          <div className="flex gap-3">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" name="news-sched-type" className="accent-teal" checked={schedType === 'daily'} onChange={() => setSchedType('daily')} />
              <span className="text-xs text-primary">每天固定時間</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" name="news-sched-type" className="accent-teal" checked={schedType === 'interval'} onChange={() => setSchedType('interval')} />
              <span className="text-xs text-primary">每隔幾小時</span>
            </label>
          </div>
          {schedType === 'daily' ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-secondary">觸發時間</span>
              <input type="number" min={0} max={23} value={hour}
                className="input-field w-14 text-sm text-center"
                onChange={e => setHour(Math.max(0, Math.min(23, Number(e.target.value))))} />
              <span className="text-xs text-secondary">:</span>
              <input type="number" min={0} max={59} value={minute}
                className="input-field w-14 text-sm text-center"
                onChange={e => setMinute(Math.max(0, Math.min(59, Number(e.target.value))))} />
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-secondary">每隔</span>
              <input type="number" min={1} max={24} value={intervalHours}
                className="input-field w-16 text-sm text-center"
                onChange={e => setIntervalHours(Math.max(1, Math.min(24, Number(e.target.value))))} />
              <span className="text-xs text-secondary">小時觸發一次</span>
            </div>
          )}
          <button
            type="button"
            disabled={saving}
            className="text-xs px-3 py-1.5 rounded-full bg-mint font-semibold text-primary hover:bg-teal transition-all disabled:opacity-50"
            onClick={() => void handleSave(true)}
          >
            {saving ? '儲存中…' : '套用排程'}
          </button>
        </div>
      )}
    </div>
  )
}

const DEFAULT_TRIGGER_WORDS = [
  '最近', '今天', '昨天', '前天', '這幾天', '剛剛', '剛才',
  '聽說', '看到', '看見', '有沒有', '你知道', '有看到',
  '新聞', '事件', '事情', '消息', '報導',
  '怎麼了', '出事', '發生什麼',
  '知道', '有人說', '網路上說'
]

export function NewsSettingsPanel() {
  const [settings, setSettings] = useState<NewsModuleSettings | null>(null)
  const [interestInput, setInterestInput] = useState('')
  const [blacklistInput, setBlacklistInput] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [convSearchOpen, setConvSearchOpen] = useState(false)
  const [triggerInput, setTriggerInput] = useState('')
  const [rssInput, setRssInput] = useState('')
  const [jsonInput, setJsonInput] = useState('')
  const [preview, setPreview] = useState<NewsPreviewResult | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [showWeights, setShowWeights] = useState(false)
  const [cityInput, setCityInput] = useState('')
  const [detecting, setDetecting] = useState(false)
  // 關鍵字分組：目前正在編輯哪一組、新增 / 重新命名暫存
  const [activeGroupId, setActiveGroupId] = useState<string>(DEFAULT_KEYWORD_GROUP_ID)
  const [addingGroup, setAddingGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [renamingGroup, setRenamingGroup] = useState(false)
  const [groupRenameValue, setGroupRenameValue] = useState('')
  const [packBusy, setPackBusy] = useState(false)
  const [packMsg, setPackMsg] = useState<string | null>(null)
  const [dragKwId, setDragKwId] = useState<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    void (async () => {
      const loaded = await window.api.invoke('news:get-settings') as NewsModuleSettings
      setSettings(loaded)
    })()
  }, [])

  // 變更後防抖存檔
  function update(mutator: (prev: NewsModuleSettings) => NewsModuleSettings) {
    setSettings(prev => {
      if (!prev) return prev
      const next = mutator(prev)
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        void window.api.invoke('news:save-settings', next)
      }, 300)
      return next
    })
  }

  if (!settings) {
    return <p className="text-sm text-secondary">讀取中…</p>
  }

  const groups = settings.keywordGroups.length > 0 ? settings.keywordGroups : [{ id: DEFAULT_KEYWORD_GROUP_ID, name: '預設組' }]
  const activeGroup = groups.find(g => g.id === activeGroupId) ?? groups[0]
  const isDefaultGroup = activeGroup.id === DEFAULT_KEYWORD_GROUP_ID
  // 只顯示目前所選組的興趣標籤（取代式情境靠這個分組）
  const keywordSources = settings.sources.filter(
    s => s.type === 'keyword' && s.origin !== 'location' && effectiveGroupId(s.groupId) === activeGroup.id
  )
  const feedSources = settings.sources.filter(s => s.type === 'rss' || s.type === 'json')

  function addInterest(raw: string) {
    const labels = raw.split(/[,，\n]/).map(s => s.trim()).filter(Boolean)
    if (labels.length === 0) return
    const targetGroupId = activeGroup.id === DEFAULT_KEYWORD_GROUP_ID ? undefined : activeGroup.id
    update(prev => {
      // 同名標籤在不同組可並存，去重僅限同組內
      const existing = new Set(
        prev.sources.filter(s => s.type === 'keyword' && effectiveGroupId(s.groupId) === activeGroup.id).map(s => s.label)
      )
      const additions: NewsSource[] = labels
        .filter(l => !existing.has(l))
        .map(label => ({
          id: crypto.randomUUID(),
          type: 'keyword' as const,
          label,
          weight: 'normal' as const,
          enabled: true,
          origin: 'user' as const,
          groupId: targetGroupId
        }))
      return { ...prev, sources: [...prev.sources, ...additions] }
    })
    setInterestInput('')
  }

  // ── 關鍵字分組管理 ────────────────────────────────────────
  function addGroup(name: string) {
    const n = name.trim()
    if (!n) { setAddingGroup(false); setNewGroupName(''); return }
    const id = crypto.randomUUID()
    update(prev => ({ ...prev, keywordGroups: [...prev.keywordGroups, { id, name: n }] }))
    setActiveGroupId(id)
    setAddingGroup(false)
    setNewGroupName('')
  }

  function renameGroup(id: string, name: string) {
    const n = name.trim()
    if (n) update(prev => ({ ...prev, keywordGroups: prev.keywordGroups.map(g => g.id === id ? { ...g, name: n } : g) }))
    setRenamingGroup(false)
  }

  function deleteGroup(id: string) {
    if (id === DEFAULT_KEYWORD_GROUP_ID) return
    if (!window.confirm('刪除這個關鍵字組？組內的標籤會移回「預設組」。')) return
    update(prev => ({
      ...prev,
      keywordGroups: prev.keywordGroups.filter(g => g.id !== id),
      sources: prev.sources.map(s =>
        s.type === 'keyword' && effectiveGroupId(s.groupId) === id ? { ...s, groupId: undefined } : s
      ),
      readerKeywordGroupIds: (prev.readerKeywordGroupIds ?? []).filter(gid => gid !== id)
    }))
    setActiveGroupId(DEFAULT_KEYWORD_GROUP_ID)
  }

  function cycleSourceWeight(id: string) {
    update(prev => ({
      ...prev,
      sources: prev.sources.map(s => s.id === id ? { ...s, weight: nextWeight(s.weight) } : s)
    }))
  }

  /** 新聞報則數：未設 → 1 → 2 → 3 → 4 → 5 → 未設（跟全域） */
  function cycleReaderQuota(id: string) {
    update(prev => ({
      ...prev,
      sources: prev.sources.map(s => {
        if (s.id !== id) return s
        const cur = s.readerQuota
        if (cur == null) return { ...s, readerQuota: 1 }
        if (cur >= 5) {
          const { readerQuota: _drop, ...rest } = s
          return rest
        }
        return { ...s, readerQuota: cur + 1 }
      })
    }))
  }

  function removeSource(id: string) {
    update(prev => ({ ...prev, sources: prev.sources.filter(s => s.id !== id) }))
  }

  /** 同組內拖拉調整關鍵字順序（寫入 sources 陣列順序） */
  function reorderKeywordInActiveGroup(fromId: string, toId: string) {
    if (!fromId || !toId || fromId === toId) return
    update(prev => {
      const groupIds = prev.sources
        .filter(s => s.type === 'keyword' && s.origin !== 'location' && effectiveGroupId(s.groupId) === activeGroup.id)
        .map(s => s.id)
      const fromPos = groupIds.indexOf(fromId)
      const toPos = groupIds.indexOf(toId)
      if (fromPos < 0 || toPos < 0) return prev

      const indices = prev.sources
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => s.type === 'keyword' && s.origin !== 'location' && effectiveGroupId(s.groupId) === activeGroup.id)
      const fromGlobal = indices[fromPos]?.i
      const toGlobal = indices[toPos]?.i
      if (fromGlobal == null || toGlobal == null) return prev

      const next = [...prev.sources]
      const [moved] = next.splice(fromGlobal, 1)
      next.splice(toGlobal, 0, moved)
      return { ...prev, sources: next }
    })
  }

  function toggleSource(id: string, enabled: boolean) {
    update(prev => ({ ...prev, sources: prev.sources.map(s => s.id === id ? { ...s, enabled } : s) }))
  }

  function addBlacklist(raw: string) {
    const words = raw.split(/[,，\n]/).map(s => s.trim()).filter(Boolean)
    if (words.length === 0) return
    update(prev => {
      const set = new Set([...prev.blacklist, ...words])
      return { ...prev, blacklist: [...set] }
    })
    setBlacklistInput('')
  }

  function removeBlacklist(word: string) {
    update(prev => ({ ...prev, blacklist: prev.blacklist.filter(w => w !== word) }))
  }

  function addFeedSource(type: 'rss' | 'json', url: string) {
    const trimmed = url.trim()
    if (!trimmed) return
    update(prev => ({
      ...prev,
      sources: [...prev.sources, {
        id: crypto.randomUUID(),
        type,
        label: trimmed,
        url: trimmed,
        weight: 'normal' as const,
        enabled: true,
        origin: 'user' as const
      }]
    }))
    if (type === 'rss') setRssInput('')
    else setJsonInput('')
  }

  async function runPreview() {
    setPreviewing(true)
    setPreview(null)
    try {
      const result = await window.api.invoke('news:preview') as NewsPreviewResult
      setPreview(result)
    } finally {
      setPreviewing(false)
    }
  }

  // ── 地方新聞 ──────────────────────────────────────────────
  function addLocation(name: string, fromDetection = false) {
    const n = name.trim()
    if (!n) return
    update(prev => {
      if (prev.localNews.locations.some(l => l.name === n)) return prev
      return {
        ...prev,
        localNews: {
          ...prev.localNews,
          locations: [...prev.localNews.locations, { name: n, weight: 'normal', fromDetection }]
        }
      }
    })
    setCityInput('')
  }

  function removeLocation(name: string) {
    update(prev => ({
      ...prev,
      localNews: { ...prev.localNews, locations: prev.localNews.locations.filter(l => l.name !== name) }
    }))
  }

  function cycleLocationWeight(name: string) {
    update(prev => ({
      ...prev,
      localNews: {
        ...prev.localNews,
        locations: prev.localNews.locations.map(l => l.name === name ? { ...l, weight: nextWeight(l.weight) } : l)
      }
    }))
  }

  async function detectMyCounty() {
    setDetecting(true)
    try {
      const result = await window.api.invoke('weather:detect-ip') as { city: string } | null
      if (result?.city) addLocation(result.city, true)
    } finally {
      setDetecting(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* 興趣標籤 */}
      <section className="space-y-2">
        <p className="text-sm font-semibold text-primary">🗞️ 想聊哪方面的消息？</p>

        {/* 關鍵字組切換 */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-secondary">組：</span>
          {groups.map(g => (
            <button
              key={g.id}
              type="button"
              className={`text-xs px-2.5 py-1 rounded-full transition-all ${g.id === activeGroup.id ? 'bg-teal text-primary font-semibold' : 'bg-surface text-secondary border border-border hover:bg-mint-40'}`}
              onClick={() => { setActiveGroupId(g.id); setRenamingGroup(false) }}
            >
              {g.name}
            </button>
          ))}
          {addingGroup ? (
            <input
              type="text"
              autoFocus
              value={newGroupName}
              placeholder="組名"
              className="input-field text-xs w-24"
              onChange={e => setNewGroupName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); addGroup(newGroupName) }
                if (e.key === 'Escape') { setAddingGroup(false); setNewGroupName('') }
              }}
              onBlur={() => addGroup(newGroupName)}
            />
          ) : (
            <button
              type="button"
              className="text-xs px-2 py-1 rounded-full border border-dashed border-border text-secondary hover:bg-mint-40"
              onClick={() => { setAddingGroup(true); setNewGroupName('') }}
            >
              ＋組
            </button>
          )}
          {!isDefaultGroup && !renamingGroup && (
            <>
              <button type="button" className="text-xs px-1.5 opacity-60 hover:opacity-100" title="重新命名這個組" onClick={() => { setRenamingGroup(true); setGroupRenameValue(activeGroup.name) }}>✎</button>
              <button type="button" className="text-xs px-1.5 opacity-60 hover:opacity-100 text-[#E85D3F]" title="刪除這個組" onClick={() => deleteGroup(activeGroup.id)}>✕</button>
            </>
          )}
        </div>
        {renamingGroup && !isDefaultGroup && (
          <input
            type="text"
            autoFocus
            value={groupRenameValue}
            className="input-field text-xs w-40"
            onChange={e => setGroupRenameValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); renameGroup(activeGroup.id, groupRenameValue) }
              if (e.key === 'Escape') setRenamingGroup(false)
            }}
            onBlur={() => renameGroup(activeGroup.id, groupRenameValue)}
          />
        )}

        <p className="text-xs text-secondary">打字後按 Enter 或逗號變成一顆標籤，會歸到目前選的「{activeGroup.name}」。點標籤名稱可切換「常聊／普通／偶爾」；點「報·N」可單獨設定新聞報則數。可拖拉標籤調整順序（新聞報欄位順序跟著變）。在「情境」分頁可指定每個情境要用哪一組。</p>
        <div className="flex flex-wrap gap-2 p-2 rounded-2xl bg-surface border border-border min-h-[44px]">
          {keywordSources.map(s => (
            <span
              key={s.id}
              draggable
              onDragStart={e => {
                setDragKwId(s.id)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', s.id)
              }}
              onDragEnd={() => setDragKwId(null)}
              onDragOver={e => {
                if (!dragKwId || dragKwId === s.id) return
                e.preventDefault()
              }}
              onDrop={e => {
                e.preventDefault()
                const from = dragKwId || e.dataTransfer.getData('text/plain')
                if (from) reorderKeywordInActiveGroup(from, s.id)
                setDragKwId(null)
              }}
              className={`flex items-center gap-1 text-xs px-3 py-1 rounded-full cursor-grab active:cursor-grabbing ${weightChipClass(s.weight)} ${!s.enabled ? 'opacity-40' : ''} ${dragKwId === s.id ? 'opacity-60 ring-2 ring-teal' : ''}`}
              title="拖拉可調整順序"
            >
              <button type="button" className="font-medium" title="切換常聊／普通／偶爾（聊天用）" onClick={() => cycleSourceWeight(s.id)}>
                {s.label}
                <span className="ml-1 opacity-70">· {WEIGHT_LABELS[s.weight]}</span>
              </button>
              <button
                type="button"
                className="ml-0.5 px-1 rounded-full border border-border/60 bg-surface/50 opacity-80 hover:opacity-100"
                title="新聞報此關鍵字抓幾則（點擊循環；回到「報·—」＝跟全域預設）"
                onClick={() => cycleReaderQuota(s.id)}
              >
                報·{s.readerQuota ?? '—'}
              </button>
              <button type="button" className="ml-0.5 opacity-60 hover:opacity-100" title="移除" onClick={() => removeSource(s.id)}>×</button>
            </span>
          ))}
          <input
            type="text"
            value={interestInput}
            placeholder={keywordSources.length === 0 ? '例如：獨立遊戲、AI、貓咪' : '＋ 新增'}
            className="flex-1 min-w-[100px] bg-transparent outline-none text-sm text-primary"
            onChange={e => setInterestInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addInterest(interestInput) }
            }}
            onBlur={() => interestInput.trim() && addInterest(interestInput)}
          />
        </div>
      </section>

      {/* 個人新聞報：獨立關鍵字組多選（與聊天情境組分開） */}
      <section className="space-y-2">
        <p className="text-sm font-semibold text-primary">📰 個人新聞報要看哪些組？</p>
        <p className="text-xs text-secondary">
          可多選。不勾任何組＝全部組一起抓（逛書店感）。聊天／「說點什麼」仍只用情境綁定的那一組，互不干擾。
        </p>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className={`text-xs px-2.5 py-1 rounded-full transition-all border ${
              (settings.readerKeywordGroupIds ?? []).length === 0
                ? 'bg-teal text-primary font-semibold border-teal'
                : 'bg-surface text-secondary border-border hover:bg-mint-40'
            }`}
            onClick={() => update(prev => ({ ...prev, readerKeywordGroupIds: [] }))}
          >
            全部組
          </button>
          {groups.map(g => {
            const selected = (settings.readerKeywordGroupIds ?? []).includes(g.id)
            const allMode = (settings.readerKeywordGroupIds ?? []).length === 0
            return (
              <button
                key={g.id}
                type="button"
                className={`text-xs px-2.5 py-1 rounded-full transition-all border ${
                  !allMode && selected
                    ? 'bg-mint border-teal text-primary font-semibold'
                    : 'bg-surface text-secondary border-border hover:bg-mint-40'
                }`}
                onClick={() => {
                  update(prev => {
                    const current = prev.readerKeywordGroupIds ?? []
                    // 從「全部」切到單組：只勾這組
                    if (current.length === 0) {
                      return { ...prev, readerKeywordGroupIds: [g.id] }
                    }
                    const next = selected
                      ? current.filter(id => id !== g.id)
                      : [...current, g.id]
                    // 全不勾 → 回到全部組
                    return { ...prev, readerKeywordGroupIds: next }
                  })
                }}
              >
                {selected && !allMode ? '✓ ' : ''}{g.name}
              </button>
            )
          })}
        </div>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <label className="flex items-center gap-1.5 text-xs text-primary">
            <span className="text-secondary shrink-0">每關鍵字</span>
            <input
              type="number"
              min={1}
              max={20}
              value={settings.readerPerKeyword ?? 3}
              className="input-field w-14 text-sm text-center"
              onChange={e => {
                const v = Math.max(1, Math.min(20, Math.floor(Number(e.target.value))))
                if (Number.isFinite(v)) update(prev => ({ ...prev, readerPerKeyword: v }))
              }}
            />
            <span className="text-secondary">則</span>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-primary">
            <span className="text-secondary shrink-0">熱門話題</span>
            <input
              type="number"
              min={0}
              max={20}
              value={settings.readerBreakoutQuota ?? 3}
              className="input-field w-14 text-sm text-center"
              onChange={e => {
                const v = Math.max(0, Math.min(20, Math.floor(Number(e.target.value))))
                if (Number.isFinite(v)) update(prev => ({ ...prev, readerBreakoutQuota: v }))
              }}
            />
            <span className="text-secondary">則</span>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-primary">
            <span className="text-secondary shrink-0">總上限</span>
            <input
              type="number"
              min={5}
              max={100}
              value={settings.readerMaxItems ?? 30}
              className="input-field w-14 text-sm text-center"
              onChange={e => {
                const v = Math.max(5, Math.min(100, Math.floor(Number(e.target.value))))
                if (Number.isFinite(v)) update(prev => ({ ...prev, readerMaxItems: v }))
              }}
            />
            <span className="text-secondary">則</span>
          </label>
        </div>
        <p className="text-xs text-secondary">
          上方標籤旁的「報·N」可單獨覆蓋該關鍵字則數（點一下循環 1→5，再點回到跟全域）。聊天權重（常聊／普通／偶爾）不受影響。
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            disabled={packBusy}
            className="text-xs px-3 py-1.5 rounded-full bg-mint font-semibold text-primary hover:bg-teal transition-all disabled:opacity-50"
            onClick={() => {
              void (async () => {
                setPackBusy(true)
                setPackMsg(null)
                const res = await window.api.invoke('news:export-reader-settings') as {
                  ok?: boolean
                  canceled?: boolean
                  error?: string
                  path?: string
                }
                setPackBusy(false)
                if (res.canceled) return
                if (!res.ok) {
                  setPackMsg(res.error ?? '匯出失敗')
                  return
                }
                setPackMsg('已匯出設定檔')
              })()
            }}
          >
            匯出設定
          </button>
          <button
            type="button"
            disabled={packBusy}
            className="text-xs px-3 py-1.5 rounded-full bg-surface border border-border font-semibold text-primary hover:bg-mint-40 transition-all disabled:opacity-50"
            onClick={() => {
              if (!window.confirm('匯入後會覆蓋本機的關鍵字組、興趣標籤、RSS／JSON、新聞報則數、黑名單與破圈設定。已讀紀錄與學習權重不會動。確定？')) {
                return
              }
              void (async () => {
                setPackBusy(true)
                setPackMsg(null)
                const res = await window.api.invoke('news:import-reader-settings') as {
                  ok?: boolean
                  canceled?: boolean
                  error?: string
                  settings?: NewsModuleSettings
                  summary?: { groups: number; sources: number; keywords: number }
                }
                setPackBusy(false)
                if (res.canceled) return
                if (!res.ok || !res.settings) {
                  setPackMsg(res.error ?? '匯入失敗')
                  return
                }
                if (saveTimer.current) clearTimeout(saveTimer.current)
                setSettings(res.settings)
                const s = res.summary
                setPackMsg(
                  s
                    ? `已匯入：${s.groups} 組、${s.keywords} 個關鍵字` + (s.sources > s.keywords ? `（含 ${s.sources - s.keywords} 個訂閱）` : '')
                    : '已匯入設定'
                )
              })()
            }}
          >
            匯入設定
          </button>
          {packMsg && <span className="text-xs text-secondary">{packMsg}</span>}
        </div>
        <p className="text-xs text-secondary">
          換電腦可匯出／匯入 JSON。含關鍵字組、標籤、新聞報則數、黑名單、破圈與 RSS／JSON；不含已讀與學習權重。
        </p>
      </section>

      {/* 黑名單 */}
      <section className="space-y-2">
        <p className="text-sm font-semibold text-primary">🚫 不想看到（黑名單）</p>
        <p className="text-xs text-secondary">標題、摘要、來源等任一處含這些字就不會出現。</p>
        <div className="flex flex-wrap gap-2 p-2 rounded-2xl bg-surface border border-border min-h-[44px]">
          {settings.blacklist.map(word => (
            <span key={word} className="flex items-center gap-1 text-xs px-3 py-1 rounded-full bg-blush text-primary">
              {word}
              <button type="button" className="ml-0.5 opacity-60 hover:opacity-100" onClick={() => removeBlacklist(word)}>×</button>
            </span>
          ))}
          <input
            type="text"
            value={blacklistInput}
            placeholder={settings.blacklist.length === 0 ? '例如：政治、選舉' : '＋ 新增'}
            className="flex-1 min-w-[100px] bg-transparent outline-none text-sm text-primary"
            onChange={e => setBlacklistInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addBlacklist(blacklistInput) }
            }}
            onBlur={() => blacklistInput.trim() && addBlacklist(blacklistInput)}
          />
        </div>
      </section>

      {/* 新聞新鮮度 */}
      <section className="space-y-2">
        <p className="text-sm font-semibold text-primary">🕐 只聊多新的新聞？</p>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.maxAgeDays > 0}
              className="accent-teal w-4 h-4"
              onChange={e => update(prev => ({ ...prev, maxAgeDays: e.target.checked ? 30 : 0 }))}
            />
            <span className="text-sm text-primary">只聊</span>
          </label>
          <input
            type="number"
            min={1}
            max={365}
            disabled={settings.maxAgeDays === 0}
            value={settings.maxAgeDays || 30}
            className="input-field w-16 text-sm text-center disabled:opacity-40"
            onChange={e => {
              const v = Math.max(1, Math.min(365, Math.floor(Number(e.target.value))))
              if (Number.isFinite(v)) update(prev => ({ ...prev, maxAgeDays: v }))
            }}
          />
          <span className={`text-sm ${settings.maxAgeDays === 0 ? 'text-secondary opacity-40' : 'text-primary'}`}>天內發布的新聞（0 = 不限）</span>
        </div>
        <p className="text-xs text-secondary">超過天數的舊文章不會被抽到，避免聊到已經結束的活動。沒標發布日期的文章不受此限制。</p>
      </section>

      {/* 說點什麼抓新聞 */}
      <section className="space-y-2">
        <p className="text-sm font-semibold text-primary">按「說點什麼」時</p>
        <div className="space-y-1.5">
          {SPEAK_OPTIONS.map(opt => (
            <label key={opt.value} className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="news-speak"
                className="accent-teal mt-0.5"
                checked={settings.speakButton === opt.value}
                onChange={() => update(prev => ({ ...prev, speakButton: opt.value }))}
              />
              <span>
                <span className="block text-sm text-primary">{opt.label}</span>
                <span className="block text-xs text-secondary">{opt.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      {/* 聊新聞用的模型 */}
      <section className="space-y-2">
        <p className="text-sm font-semibold text-primary">聊新聞時用的模型</p>
        <div className="space-y-1.5">
          {REPLY_MODEL_OPTIONS.map(opt => (
            <label key={opt.value} className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="news-reply-model"
                className="accent-teal mt-0.5"
                checked={settings.replyModel === opt.value}
                onChange={() => update(prev => ({ ...prev, replyModel: opt.value }))}
              />
              <span>
                <span className="block text-sm text-primary">{opt.label}</span>
                <span className="block text-xs text-secondary">{opt.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      {/* 地方新聞 */}
      <section className="space-y-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            className="accent-teal w-4 h-4"
            checked={settings.localNews.enabled}
            onChange={e => update(prev => ({ ...prev, localNews: { ...prev.localNews, enabled: e.target.checked } }))}
          />
          <span className="text-sm font-semibold text-primary">📍 也聊地方新聞</span>
        </label>
        {settings.localNews.enabled && (
          <div className="ml-6 space-y-2">
            <p className="text-xs text-secondary">加入你關心的縣市（可多個，點縣市切換常聊／普通／偶爾）。</p>
            <div className="flex flex-wrap gap-2">
              {settings.localNews.locations.map(loc => (
                <span key={loc.name} className={`flex items-center gap-1 text-xs px-3 py-1 rounded-full ${weightChipClass(loc.weight)}`}>
                  <button type="button" onClick={() => cycleLocationWeight(loc.name)}>
                    {loc.name}{loc.fromDetection ? ' 📍' : ''}
                    <span className="ml-1 opacity-70">· {WEIGHT_LABELS[loc.weight]}</span>
                  </button>
                  <button type="button" className="ml-0.5 opacity-60 hover:opacity-100" onClick={() => removeLocation(loc.name)}>×</button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={cityInput}
                placeholder="輸入縣市，例如：台北、新北、台南"
                className="input-field flex-1 text-sm"
                onChange={e => setCityInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLocation(cityInput) } }}
              />
              <button type="button" className="text-xs px-3 py-1.5 rounded-full bg-mint font-semibold text-primary shrink-0" onClick={() => addLocation(cityInput)}>加入</button>
            </div>
            <button
              type="button"
              disabled={detecting}
              className="text-xs px-3 py-1.5 rounded-full border border-border text-primary hover:bg-mint-40 disabled:opacity-50"
              onClick={detectMyCounty}
            >
              {detecting ? '偵測中…' : '📍 自動偵測我的縣市'}
            </button>
          </div>
        )}
      </section>

      {/* 破圈話題 */}
      <section className="space-y-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            className="accent-teal w-4 h-4"
            checked={settings.breakout.enabled}
            onChange={e => update(prev => ({ ...prev, breakout: { ...prev.breakout, enabled: e.target.checked } }))}
          />
          <span className="text-sm font-semibold text-primary">💡 偶爾也丟我沒設過的熱門話題</span>
        </label>
        {settings.breakout.enabled && (
          <div className="ml-6 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-secondary">聊天出現頻率：</span>
              <button
                type="button"
                className={`text-xs px-3 py-1 rounded-full ${weightChipClass(settings.breakout.weight)}`}
                onClick={() => update(prev => ({ ...prev, breakout: { ...prev.breakout, weight: nextWeight(prev.breakout.weight) } }))}
              >
                {WEIGHT_LABELS[settings.breakout.weight]}
              </button>
              <span className="text-[11px] text-secondary">（從 Google 熱搜抽，仍受黑名單過濾）</span>
            </div>
            <label className="flex items-center gap-1.5 text-xs text-primary">
              <span className="text-secondary shrink-0">新聞報熱門則數</span>
              <input
                type="number"
                min={0}
                max={20}
                value={settings.readerBreakoutQuota ?? 3}
                className="input-field w-14 text-sm text-center"
                onChange={e => {
                  const v = Math.max(0, Math.min(20, Math.floor(Number(e.target.value))))
                  if (Number.isFinite(v)) update(prev => ({ ...prev, readerBreakoutQuota: v }))
                }}
              />
              <span className="text-secondary">則（0＝新聞報不顯示熱門；與聊天權重分開）</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="accent-teal w-4 h-4"
                checked={settings.breakout.zhOnly !== false}
                onChange={e => update(prev => ({
                  ...prev,
                  breakout: { ...prev.breakout, zhOnly: e.target.checked }
                }))}
              />
              <span className="text-xs text-primary">熱門話題只要中文標題</span>
              <span className="text-[11px] text-secondary">（推薦；關掉才會出現外文熱搜相關新聞）</span>
            </label>
          </div>
        )}
      </section>

      {/* 試抓一則 */}
      <section className="space-y-2">
        <button
          type="button"
          disabled={previewing}
          className="text-xs px-4 py-2 rounded-full bg-mint font-semibold text-primary hover:bg-teal transition-all disabled:opacity-50"
          onClick={runPreview}
        >
          {previewing ? '抓取中…' : '🔍 試抓一則（測試目前設定）'}
        </button>
        {preview && (
          <div className="text-xs rounded-2xl bg-surface border border-border p-3 space-y-1">
            {preview.ok && preview.item ? (
              <>
                <p className="text-sm font-medium text-primary">{preview.item.title}</p>
                {preview.item.summary && <p className="text-secondary">{preview.item.summary}</p>}
                <p className="text-secondary">來源：{preview.item.source}{preview.item.breakout ? '（破圈話題）' : ''}</p>
                <p className="text-secondary">通過篩選的候選共 {preview.candidateCount} 則</p>
              </>
            ) : preview.ok ? (
              <p className="text-secondary">目前抓不到符合條件的新聞（候選 {preview.candidateCount ?? 0} 則）。可調整興趣或黑名單再試。</p>
            ) : (
              <p className="text-[#E85D3F]">抓取失敗：{preview.error}</p>
            )}
          </div>
        )}
      </section>

      {/* 進階 */}
      <section className="border-t border-border pt-3">
        <button type="button" className="text-xs text-teal" onClick={() => setAdvancedOpen(o => !o)}>
          {advancedOpen ? '▾ 收合進階設定' : '▸ 進階設定（RSS／JSON 來源、語言、重置學習）'}
        </button>
        {advancedOpen && (
          <div className="mt-3 space-y-4">
            {/* 語言 */}
            <div className="space-y-1.5">
              <p className="text-sm font-semibold text-primary">語言處理</p>
              {LANG_OPTIONS.map(opt => (
                <label key={opt.value} className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="news-lang"
                    className="accent-teal mt-0.5"
                    checked={settings.langMode === opt.value}
                    onChange={() => update(prev => ({ ...prev, langMode: opt.value }))}
                  />
                  <span>
                    <span className="block text-sm text-primary">{opt.label}</span>
                    <span className="block text-xs text-secondary">{opt.hint}</span>
                  </span>
                </label>
              ))}
            </div>

            {/* RSS / JSON 來源 */}
            <div className="space-y-2">
              <p className="text-sm font-semibold text-primary">自訂來源</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={rssInput}
                  placeholder="貼上 RSS／Atom 網址"
                  className="input-field flex-1 text-sm"
                  onChange={e => setRssInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addFeedSource('rss', rssInput) } }}
                />
                <button type="button" className="text-xs px-3 py-1.5 rounded-full bg-mint font-semibold text-primary shrink-0" onClick={() => addFeedSource('rss', rssInput)}>加 RSS</button>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={jsonInput}
                  placeholder="貼上聚合站 news.json 網址"
                  className="input-field flex-1 text-sm"
                  onChange={e => setJsonInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addFeedSource('json', jsonInput) } }}
                />
                <button type="button" className="text-xs px-3 py-1.5 rounded-full bg-mint font-semibold text-primary shrink-0" onClick={() => addFeedSource('json', jsonInput)}>加 JSON</button>
              </div>
              {feedSources.length > 0 && (
                <ul className="space-y-1">
                  {feedSources.map(s => (
                    <li key={s.id} className="flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={s.enabled} className="accent-teal" onChange={e => toggleSource(s.id, e.target.checked)} />
                      <span className="px-2 py-0.5 rounded-full bg-aqua text-primary uppercase">{s.type}</span>
                      <span className="flex-1 truncate text-secondary" title={s.url}>{s.url}</span>
                      <button type="button" className="opacity-60 hover:opacity-100" onClick={() => removeSource(s.id)}>×</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* 權重檢視 */}
            <div className="space-y-2">
              <button
                type="button"
                className="text-xs px-3 py-1.5 rounded-full border border-border text-primary hover:bg-mint-40"
                onClick={() => setShowWeights(o => !o)}
              >
                {showWeights ? '收合目前權重' : '🔢 查看目前權重'}
              </button>
              {showWeights && (() => {
                const adj = settings.feedback.adjustments
                const rows = settings.sources.map(s => {
                  const base = WEIGHT_VALUE[s.weight]
                  const a = adj[s.id] ?? 0
                  const eff = Math.max(0.25, base + a)
                  return { key: s.id, label: s.label, type: s.type, base, a, eff, enabled: s.enabled }
                })
                // 不在來源清單裡的調整（地方 / 破圈 / 已移除來源）
                const known = new Set(settings.sources.map(s => s.id))
                const orphans = Object.entries(adj).filter(([k]) => !known.has(k))
                return (
                  <div className="rounded-2xl bg-surface border border-border p-3 text-xs space-y-1.5">
                    <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-1 items-center">
                      <span className="text-secondary font-medium">來源</span>
                      <span className="text-secondary text-right">基礎</span>
                      <span className="text-secondary text-right">學習</span>
                      <span className="text-primary text-right font-medium">有效</span>
                      {rows.map(r => (
                        <Fragment key={r.key}>
                          <span className={`truncate ${r.enabled ? 'text-primary' : 'text-secondary line-through'}`} title={r.label}>{r.label}</span>
                          <span className="text-right text-secondary">{r.base}</span>
                          <span className={`text-right ${r.a > 0 ? 'text-teal' : r.a < 0 ? 'text-[#E85D3F]' : 'text-secondary'}`}>{r.a > 0 ? `+${r.a}` : r.a}</span>
                          <span className="text-right text-primary font-medium">{r.eff.toFixed(2)}</span>
                        </Fragment>
                      ))}
                      {orphans.map(([k, v]) => (
                        <Fragment key={k}>
                          <span className="truncate text-secondary" title={k}>{k.startsWith('loc-') ? `地方：${k.slice(4)}` : k === '__breakout__' ? '破圈話題' : k}</span>
                          <span className="text-right text-secondary">—</span>
                          <span className={`text-right ${v > 0 ? 'text-teal' : v < 0 ? 'text-[#E85D3F]' : 'text-secondary'}`}>{v > 0 ? `+${v}` : v}</span>
                          <span className="text-right text-secondary">—</span>
                        </Fragment>
                      ))}
                    </div>
                    <p className="text-secondary leading-snug pt-1 border-t border-border">
                      基礎：常聊 3 / 普通 2 / 偶爾 1。學習＝回饋微調。有效＝max(0.25, 基礎＋學習)，抽選時若該則有摘要脈絡再 ×1.6。數字越大越常被抽到。
                    </p>
                  </div>
                )
              })()}
            </div>

            {/* 重置學習 */}
            <div>
              <button
                type="button"
                className="text-xs px-3 py-1.5 rounded-full border border-border text-primary hover:bg-mint-40"
                onClick={async () => {
                  const updated = await window.api.invoke('news:reset-feedback') as NewsModuleSettings
                  setSettings(updated)
                }}
              >
                重置學習權重
              </button>
              <p className="text-xs text-secondary mt-1">把回饋微調歸零，回到你手動設定的權重。</p>
            </div>

            {/* 封鎖來源管理 */}
            {settings.excludedSources.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-sm font-semibold text-primary">封鎖的來源</p>
                <div className="flex flex-wrap gap-2">
                  {settings.excludedSources.map(src => (
                    <span key={src} className="flex items-center gap-1 text-xs px-3 py-1 rounded-full bg-blush text-primary">
                      {src}
                      <button type="button" className="ml-0.5 opacity-60 hover:opacity-100" onClick={() =>
                        update(prev => ({ ...prev, excludedSources: prev.excludedSources.filter(s => s !== src) }))
                      }>×</button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 降低顯示來源管理 */}
            {settings.reducedSources.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-sm font-semibold text-primary">降低顯示的來源</p>
                <p className="text-xs text-secondary">不會完全消失，只是被抽到的機率變低。</p>
                <div className="flex flex-wrap gap-2">
                  {settings.reducedSources.map(src => (
                    <span key={src} className="flex items-center gap-1 text-xs px-3 py-1 rounded-full bg-butter text-primary">
                      {src}
                      <button type="button" className="ml-0.5 opacity-60 hover:opacity-100" onClick={() =>
                        update(prev => ({ ...prev, reducedSources: prev.reducedSources.filter(s => s !== src) }))
                      }>×</button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 排除類別管理 */}
            {settings.excludedCategories.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-sm font-semibold text-primary">排除的類別</p>
                <div className="flex flex-wrap gap-2">
                  {settings.excludedCategories.map(cat => (
                    <span key={cat} className="flex items-center gap-1 text-xs px-3 py-1 rounded-full bg-surface border border-border text-primary">
                      {cat}
                      <button type="button" className="ml-0.5 opacity-60 hover:opacity-100" onClick={() =>
                        update(prev => ({ ...prev, excludedCategories: prev.excludedCategories.filter(c => c !== cat) }))
                      }>×</button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 定時排程 */}
            <div className="space-y-2">
              <p className="text-sm font-semibold text-primary">定時抽一則新聞聊</p>
              <p className="text-xs text-secondary">啟用後角色會定時主動聊一則新聞（依新聞設定篩選），預設關閉。</p>
              <NewsSchedulerSection />
            </div>
          </div>
        )}
      </section>

      {/* 對話新聞搜尋 */}
      <section className="border-t border-border pt-3">
        <button type="button" className="text-xs text-teal" onClick={() => setConvSearchOpen(o => !o)}>
          {convSearchOpen ? '▾ 收合對話新聞搜尋（進階）' : '▸ 對話新聞搜尋（進階）'}
        </button>
        {convSearchOpen && (() => {
          const cs = settings.conversationSearch ?? { enabled: false, triggerWords: DEFAULT_TRIGGER_WORDS, maxAgeHours: 48 }
          function updateCs(patch: Partial<NonNullable<NewsModuleSettings['conversationSearch']>>) {
            update(prev => ({ ...prev, conversationSearch: { ...cs, ...patch } }))
          }
          function addTriggerWord(raw: string) {
            const words = raw.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean)
            if (words.length === 0) return
            const next = [...new Set([...cs.triggerWords, ...words])]
            updateCs({ triggerWords: next })
            setTriggerInput('')
          }
          function removeTriggerWord(word: string) {
            updateCs({ triggerWords: cs.triggerWords.filter(w => w !== word) })
          }
          return (
            <div className="mt-3 space-y-3">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cs.enabled}
                  className="accent-teal w-4 h-4 mt-0.5"
                  onChange={e => updateCs({ enabled: e.target.checked })}
                />
                <span>
                  <span className="block text-sm text-primary">啟用對話新聞搜尋</span>
                  <span className="block text-xs text-secondary">使用者提到時事時，自動搜尋 Google 新聞並提供角色參考。每次搜尋會額外呼叫一次 LLM 判斷意圖。</span>
                </span>
              </label>

              {cs.enabled && (
                <>
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-primary">觸發詞（含任一詞才送 LLM 判斷）</p>
                    <p className="text-xs text-secondary">清單清空後，每則訊息都會送 LLM 判斷（成本較高）。</p>
                    <div className="flex flex-wrap gap-1.5 p-2 rounded-2xl bg-surface border border-border min-h-[40px]">
                      {cs.triggerWords.map(word => (
                        <span key={word} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-mint text-primary">
                          {word}
                          <button type="button" className="ml-0.5 opacity-60 hover:opacity-100" onClick={() => removeTriggerWord(word)}>×</button>
                        </span>
                      ))}
                      <input
                        type="text"
                        value={triggerInput}
                        placeholder="＋ 新增觸發詞"
                        className="flex-1 min-w-[80px] bg-transparent outline-none text-xs text-primary"
                        onChange={e => setTriggerInput(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTriggerWord(triggerInput) }
                        }}
                        onBlur={() => triggerInput.trim() && addTriggerWord(triggerInput)}
                      />
                    </div>
                    <button
                      type="button"
                      className="text-xs px-2.5 py-1 rounded-full border border-dashed border-border text-secondary hover:bg-mint-40"
                      onClick={() => updateCs({ triggerWords: DEFAULT_TRIGGER_WORDS })}
                    >
                      還原預設觸發詞
                    </button>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={cs.maxAgeHours > 0}
                        className="accent-teal w-4 h-4"
                        onChange={e => updateCs({ maxAgeHours: e.target.checked ? 48 : 0 })}
                      />
                      <span className="text-sm text-primary">只收</span>
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={720}
                      disabled={cs.maxAgeHours === 0}
                      value={cs.maxAgeHours || 48}
                      className="input-field w-16 text-sm text-center disabled:opacity-40"
                      onChange={e => {
                        const v = Math.max(1, Math.min(720, Number(e.target.value)))
                        if (Number.isFinite(v)) updateCs({ maxAgeHours: v })
                      }}
                    />
                    <span className={`text-sm ${cs.maxAgeHours === 0 ? 'text-secondary opacity-40' : 'text-primary'}`}>小時內的文章（0 = 不限）</span>
                  </div>
                </>
              )}
            </div>
          )
        })()}
      </section>
    </div>
  )
}
