import { useEffect, useRef, useState } from 'react'
import {
  WEIGHT_LABELS, nextWeight,
  type LangMode, type NewsModuleSettings, type NewsPreviewResult, type NewsSource, type NewsWeight, type SpeakMode
} from './types'

const SPEAK_OPTIONS: { value: SpeakMode; label: string; hint: string }[] = [
  { value: 'off', label: '不抓新聞', hint: '按「說點什麼」只會閒聊' },
  { value: 'sometimes', label: '偶爾（推薦）', hint: '有時閒聊、有時帶一則新聞' },
  { value: 'always', label: '每次', hint: '每次都會挑一則新聞來聊' }
]

const LANG_OPTIONS: { value: LangMode; label: string; hint: string }[] = [
  { value: 'translate', label: '外語也收，請角色翻成繁中講（推薦）', hint: '日文／簡中新聞由角色用繁體中文轉述' },
  { value: 'zh-only', label: '只要繁體中文', hint: '非繁中的新聞直接略過' },
  { value: 'raw', label: '原文照收', hint: '不處理語言' }
]

function weightChipClass(weight: NewsWeight): string {
  switch (weight) {
    case 'often': return 'bg-teal text-primary'
    case 'rarely': return 'bg-surface text-secondary border border-border'
    default: return 'bg-mint text-primary'
  }
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

  const keywordSources = settings.sources.filter(s => s.type === 'keyword' && s.origin !== 'location')
  const feedSources = settings.sources.filter(s => s.type === 'rss' || s.type === 'json')

  function addInterest(raw: string) {
    const labels = raw.split(/[,，\n]/).map(s => s.trim()).filter(Boolean)
    if (labels.length === 0) return
    update(prev => {
      const existing = new Set(prev.sources.filter(s => s.type === 'keyword').map(s => s.label))
      const additions: NewsSource[] = labels
        .filter(l => !existing.has(l))
        .map(label => ({
          id: crypto.randomUUID(),
          type: 'keyword' as const,
          label,
          weight: 'normal' as const,
          enabled: true,
          origin: 'user' as const
        }))
      return { ...prev, sources: [...prev.sources, ...additions] }
    })
    setInterestInput('')
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

  return (
    <div className="space-y-5">
      {/* 興趣標籤 */}
      <section className="space-y-2">
        <p className="text-sm font-semibold text-primary">🗞️ 想聊哪方面的消息？</p>
        <p className="text-xs text-secondary">打字後按 Enter 或逗號變成一顆標籤。點標籤可切換「常聊／普通／偶爾」。</p>
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
          </div>
        )}
      </section>
    </div>
  )
}
