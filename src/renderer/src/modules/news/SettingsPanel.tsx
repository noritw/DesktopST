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

export function NewsSettingsPanel() {
  const [settings, setSettings] = useState<NewsModuleSettings | null>(null)
  const [interestInput, setInterestInput] = useState('')
  const [blacklistInput, setBlacklistInput] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
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
      )
    }))
    setActiveGroupId(DEFAULT_KEYWORD_GROUP_ID)
  }

  function cycleSourceWeight(id: string) {
    update(prev => ({
      ...prev,
      sources: prev.sources.map(s => s.id === id ? { ...s, weight: nextWeight(s.weight) } : s)
    }))
  }

  function removeSource(id: string) {
    update(prev => ({ ...prev, sources: prev.sources.filter(s => s.id !== id) }))
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

        <p className="text-xs text-secondary">打字後按 Enter 或逗號變成一顆標籤，會歸到目前選的「{activeGroup.name}」。點標籤可切換「常聊／普通／偶爾」。在「情境」分頁可指定每個情境要用哪一組。</p>
        <div className="flex flex-wrap gap-2 p-2 rounded-2xl bg-surface border border-border min-h-[44px]">
          {keywordSources.map(s => (
            <span key={s.id} className={`flex items-center gap-1 text-xs px-3 py-1 rounded-full ${weightChipClass(s.weight)} ${!s.enabled ? 'opacity-40' : ''}`}>
              <button type="button" className="font-medium" title="切換常聊／普通／偶爾" onClick={() => cycleSourceWeight(s.id)}>
                {s.label}
                <span className="ml-1 opacity-70">· {WEIGHT_LABELS[s.weight]}</span>
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
          <div className="ml-6 flex items-center gap-2">
            <span className="text-xs text-secondary">出現頻率：</span>
            <button
              type="button"
              className={`text-xs px-3 py-1 rounded-full ${weightChipClass(settings.breakout.weight)}`}
              onClick={() => update(prev => ({ ...prev, breakout: { ...prev.breakout, weight: nextWeight(prev.breakout.weight) } }))}
            >
              {WEIGHT_LABELS[settings.breakout.weight]}
            </button>
            <span className="text-[11px] text-secondary">（從 Google 熱搜抽，仍受黑名單過濾）</span>
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
    </div>
  )
}
