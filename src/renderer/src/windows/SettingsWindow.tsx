import { useEffect, useState } from 'react'
import { useAppStore } from '../stores/useAppStore'
import type { AppSettings } from '../types'

const PROVIDERS = ['openai', 'claude', 'gemini', 'grok'] as const
const MODELS: Record<string, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  claude: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  gemini: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
  grok: ['grok-3', 'grok-3-mini']
}

const TABS = ['LLM 設定', '世界觀', '使用者', '記憶', '資料'] as const
type Tab = typeof TABS[number]

export default function SettingsWindow() {
  const { settings, saveSettings } = useAppStore(s => ({
    settings: s.settings,
    saveSettings: s.saveSettings
  }))

  const [tab, setTab] = useState<Tab>('LLM 設定')
  const [draft, setDraft] = useState<AppSettings | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (settings) setDraft(JSON.parse(JSON.stringify(settings)))
  }, [settings])

  if (!draft) return null

  const set = (path: string, value: unknown) => {
    setDraft(prev => {
      if (!prev) return prev
      const next = JSON.parse(JSON.stringify(prev)) as AppSettings
      const keys = path.split('.')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let obj: any = next
      for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]]
      obj[keys[keys.length - 1]] = value
      return next
    })
  }

  const handleSave = async () => {
    if (!draft) return
    await saveSettings(draft)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="w-full h-full flex flex-col bg-bg">
      {/* Title bar */}
      <div className="drag-region flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="font-semibold text-primary no-drag">⚙️ 設定</span>
        <button
          className="btn-round w-7 h-7 text-sm no-drag"
          onClick={() => window.api.invoke('window:close-self')}
        >✕</button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-4 py-2 border-b border-border no-drag">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`tab-btn text-xs ${tab === t ? 'active' : ''}`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 no-drag space-y-4">

        {tab === 'LLM 設定' && (
          <>
            <Field label="服務商">
              <select
                className="input-field"
                value={draft.llm.provider}
                onChange={e => { set('llm.provider', e.target.value); set('llm.model', MODELS[e.target.value][0]) }}
              >
                {PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="模型">
              <select
                className="input-field"
                value={draft.llm.model}
                onChange={e => set('llm.model', e.target.value)}
              >
                {(MODELS[draft.llm.provider] ?? []).map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
            <Field label="API Key">
              <input
                type="password"
                className="input-field"
                value={draft.llm.apiKey}
                onChange={e => set('llm.apiKey', e.target.value)}
                placeholder="sk-..."
              />
            </Field>
            <Field label="自訂端點（選填）">
              <input
                type="text"
                className="input-field"
                value={draft.llm.endpoint ?? ''}
                onChange={e => set('llm.endpoint', e.target.value)}
                placeholder="https://api.example.com/v1"
              />
            </Field>
            <Field label={`最大回應字數（${draft.llm.maxResponseTokens}）`}>
              <input type="range" min={100} max={1000} step={10}
                value={draft.llm.maxResponseTokens}
                onChange={e => set('llm.maxResponseTokens', Number(e.target.value))}
                className="w-full accent-teal"
              />
            </Field>
            <Field label={`Temperature（${draft.llm.temperature}）`}>
              <input type="range" min={0} max={2} step={0.05}
                value={draft.llm.temperature}
                onChange={e => set('llm.temperature', Number(e.target.value))}
                className="w-full accent-teal"
              />
            </Field>
          </>
        )}

        {tab === '世界觀' && (
          <>
            <Field label="世界觀設定">
              <textarea
                className="input-field min-h-[120px] resize-none"
                value={draft.worldSetting}
                onChange={e => set('worldSetting', e.target.value)}
                placeholder="描述這個世界的背景設定..."
              />
            </Field>
            <Field label="角色互動範例">
              <textarea
                className="input-field min-h-[80px] resize-none"
                value={draft.interactionExample}
                onChange={e => set('interactionExample', e.target.value)}
                placeholder="角色之間如何互動的範例..."
              />
            </Field>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.injectSystemTime}
                onChange={e => set('injectSystemTime', e.target.checked)}
                className="accent-teal w-4 h-4"
              />
              <span className="text-sm text-primary">對話中自動帶入當下系統時間</span>
            </label>
          </>
        )}

        {tab === '使用者' && (
          <>
            <Field label="顯示名稱">
              <input type="text" className="input-field"
                value={draft.persona.displayName}
                onChange={e => set('persona.displayName', e.target.value)}
                placeholder="你的名字"
              />
            </Field>
            <Field label="角色如何稱呼你">
              <input type="text" className="input-field"
                value={draft.persona.nickname}
                onChange={e => set('persona.nickname', e.target.value)}
                placeholder="主人、大人、小名..."
              />
            </Field>
            <Field label="自我介紹（選填）">
              <textarea className="input-field min-h-[80px] resize-none"
                value={draft.persona.description}
                onChange={e => set('persona.description', e.target.value)}
                placeholder="讓角色更了解你..."
              />
            </Field>
          </>
        )}

        {tab === '記憶' && (
          <>
            <Field label={`保留最近對話數（${draft.memory.keepRecentN} 則）`}>
              <input type="range" min={5} max={100} step={5}
                value={draft.memory.keepRecentN}
                onChange={e => set('memory.keepRecentN', Number(e.target.value))}
                className="w-full accent-teal"
              />
            </Field>
            <Field label={`自動摘要閾值（${draft.memory.autoSummarizeAfter} 則）`}>
              <input type="range" min={20} max={200} step={10}
                value={draft.memory.autoSummarizeAfter}
                onChange={e => set('memory.autoSummarizeAfter', Number(e.target.value))}
                className="w-full accent-teal"
              />
            </Field>
          </>
        )}

        {tab === '資料' && (
          <div className="space-y-3">
            <p className="text-sm text-secondary">所有資料存放於：</p>
            <p className="text-xs font-mono bg-surface border border-border rounded-lg px-3 py-2 text-primary break-all">
              %APPDATA%\DesktopFamiliar\
            </p>
            <button
              className="btn-round w-auto px-4 rounded-full h-auto py-2 text-sm"
              onClick={() => window.api.invoke('window:open-data-folder')}
            >
              📂 開啟資料夾
            </button>
          </div>
        )}
      </div>

      {/* Save button */}
      <div className="px-4 py-3 border-t border-border no-drag flex justify-end">
        <button
          onClick={handleSave}
          className="px-6 py-2 rounded-full text-sm font-semibold bg-mint text-primary
                     shadow-soft hover:bg-teal transition-all hover:scale-105 active:scale-95"
        >
          {saved ? '✓ 已儲存' : '儲存'}
        </button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-secondary">{label}</label>
      {children}
    </div>
  )
}
