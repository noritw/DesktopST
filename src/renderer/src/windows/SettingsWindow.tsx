import { useEffect, useState } from 'react'
import { useAppStore } from '../stores/useAppStore'
import type { AppSettings, Character } from '../types'

const PROVIDERS = ['openai', 'claude', 'gemini', 'grok'] as const
const MODELS: Record<string, string[]> = {
  openai: [
    'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano',
    'gpt-4o', 'gpt-4o-mini',
    'o4-mini', 'o3', 'o1', 'o1-mini'
  ],
  claude: [
    'claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001',
    'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'
  ],
  gemini: [
    'gemini-2.5-pro', 'gemini-2.5-flash',
    'gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'
  ],
  grok: ['grok-3', 'grok-3-mini', 'grok-2']
}

const TABS = ['LLM 設定', '世界觀', '使用者', '記憶', '角色', '資料'] as const
type Tab = typeof TABS[number]

export default function SettingsWindow() {
  const settings = useAppStore(s => s.settings)
  const saveSettings = useAppStore(s => s.saveSettings)
  const characters = useAppStore(s => s.characters)
  const desktopCharacters = useAppStore(s => s.desktopCharacters)
  const saveCharacter = useAppStore(s => s.saveCharacter)
  const addToDesktop = useAppStore(s => s.addToDesktop)
  const removeFromDesktop = useAppStore(s => s.removeFromDesktop)
  const importCharacterJson = useAppStore(s => s.importCharacterJson)

  const [tab, setTab] = useState<Tab>('LLM 設定')
  const [draft, setDraft] = useState<AppSettings | null>(null)
  const [saved, setSaved] = useState(false)

  // Character tab state
  const [selectedCharId, setSelectedCharId] = useState<string | null>(null)
  const [charDraft, setCharDraft] = useState<Character | null>(null)
  const [charSaved, setCharSaved] = useState(false)

  useEffect(() => {
    if (settings) setDraft(JSON.parse(JSON.stringify(settings)))
  }, [settings])

  useEffect(() => {
    if (selectedCharId) {
      const char = characters.find(c => c.id === selectedCharId)
      if (char) setCharDraft(JSON.parse(JSON.stringify(char)))
      else { setSelectedCharId(null); setCharDraft(null) }
    }
  }, [selectedCharId, characters])

  if (!draft) return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#F7FFFC', gap: 12 }}>
      <span style={{ color: '#7BA898', fontSize: 14 }}>載入設定中...</span>
      <button style={{ padding: '6px 16px', borderRadius: 20, border: '1px solid #D8F5EC', background: '#CBFBC4', color: '#3D5A52', cursor: 'pointer', fontSize: 13 }}
        onClick={() => window.api.invoke('window:close-self')}>關閉</button>
    </div>
  )

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

  const handleSaveChar = async () => {
    if (!charDraft) return
    await saveCharacter(charDraft)
    setCharSaved(true)
    setTimeout(() => setCharSaved(false), 2000)
  }

  const handleImportJson = async () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      const text = await file.text()
      const char = await importCharacterJson(text)
      if (char) setSelectedCharId(char.id)
    }
    input.click()
  }

  const setCharField = (key: keyof Character, value: string) => {
    setCharDraft(prev => prev ? { ...prev, [key]: value } : prev)
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
                onChange={e => { set('llm.provider', e.target.value); set('llm.model', MODELS[e.target.value]?.[0] ?? '') }}
              >
                {PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="模型（可手動輸入自訂 ID）">
              <input
                type="text"
                className="input-field"
                list="model-list"
                value={draft.llm.model}
                onChange={e => set('llm.model', e.target.value)}
                placeholder="輸入或選擇模型 ID"
              />
              <datalist id="model-list">
                {(MODELS[draft.llm.provider] ?? []).map(m => <option key={m} value={m} />)}
              </datalist>
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

        {tab === '角色' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-secondary">角色列表</span>
              <button className="tab-btn text-xs" onClick={handleImportJson}>
                📥 匯入 JSON
              </button>
            </div>

            {/* Character list */}
            <div className="space-y-2">
              {characters.map(char => {
                const onDesktop = desktopCharacters.some(d => d.characterId === char.id)
                const isSelected = selectedCharId === char.id
                return (
                  <div key={char.id} className="border border-border rounded-xl overflow-hidden">
                    <div
                      className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors ${isSelected ? 'bg-mint/40' : 'bg-surface hover:bg-teal/10'}`}
                      onClick={() => setSelectedCharId(isSelected ? null : char.id)}
                    >
                      <div className="w-8 h-8 rounded-full bg-mint flex items-center justify-center text-sm shrink-0 overflow-hidden">
                        {char.avatar
                          ? <img src={`local://${encodeURIComponent(char.avatar)}`} className="w-full h-full object-cover" alt="" />
                          : '👤'}
                      </div>
                      <span className="flex-1 text-sm font-medium text-primary">{char.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${onDesktop ? 'bg-teal/30 text-primary' : 'bg-surface text-secondary border border-border'}`}>
                        {onDesktop ? '桌面中' : '未上桌'}
                      </span>
                      <button
                        className="text-xs tab-btn py-1 px-2"
                        onClick={e => { e.stopPropagation(); onDesktop ? removeFromDesktop(char.id) : addToDesktop(char.id) }}
                      >
                        {onDesktop ? '移出' : '上桌'}
                      </button>
                    </div>

                    {/* Inline edit form */}
                    {isSelected && charDraft && (
                      <div className="px-3 pb-3 pt-1 border-t border-border bg-bg space-y-3">
                        <Field label="名稱">
                          <input type="text" className="input-field"
                            value={charDraft.name}
                            onChange={e => setCharField('name', e.target.value)} />
                        </Field>
                        <Field label="人格設定">
                          <textarea className="input-field min-h-[80px] resize-none"
                            value={charDraft.personality}
                            onChange={e => setCharField('personality', e.target.value)}
                            placeholder="角色的個性、說話方式..." />
                        </Field>
                        <Field label="角色描述">
                          <textarea className="input-field min-h-[60px] resize-none"
                            value={charDraft.description}
                            onChange={e => setCharField('description', e.target.value)}
                            placeholder="角色的外貌、背景..." />
                        </Field>
                        <Field label="開場白">
                          <textarea className="input-field min-h-[60px] resize-none"
                            value={charDraft.firstMessage}
                            onChange={e => setCharField('firstMessage', e.target.value)}
                            placeholder="首次見面說的話..." />
                        </Field>
                        <div className="flex justify-end">
                          <button
                            onClick={handleSaveChar}
                            className="px-4 py-1.5 rounded-full text-sm font-semibold bg-mint text-primary shadow-soft hover:bg-teal transition-all"
                          >
                            {charSaved ? '✓ 已儲存' : '儲存角色'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
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

      {/* Save button — hide on character tab (has its own save) */}
      {tab !== '角色' && (
        <div className="px-4 py-3 border-t border-border no-drag flex justify-end">
          <button
            onClick={handleSave}
            className="px-6 py-2 rounded-full text-sm font-semibold bg-mint text-primary
                       shadow-soft hover:bg-teal transition-all hover:scale-105 active:scale-95"
          >
            {saved ? '✓ 已儲存' : '儲存'}
          </button>
        </div>
      )}
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
