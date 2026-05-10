import { useEffect, useState } from 'react'
import {
  OPENAI_DATA_SHARING_INCENTIVE_10M_GROUP,
  OPENAI_DATA_SHARING_INCENTIVE_1M_GROUP
} from '../constants/openaiDataSharingIncentiveModels'
import { useAppStore } from '../stores/useAppStore'
import type { AppSettings, Character } from '../types'
import MonoIcon from '../components/MonoIcon'

const OPENAI_MODEL_LIST_HELP =
  'https://help.openai.com/en/articles/10306912-sharing-feedback-evaluation-and-fine-tuning-data-and-api-inputs-and-outputs-with-openai'

type OpenaiModelListMode = 'catalog' | 'incentive-1m' | 'incentive-10m' | 'incentive-all'

function openaiDatalistOptions(mode: OpenaiModelListMode): string[] {
  switch (mode) {
    case 'incentive-1m':
      return [...OPENAI_DATA_SHARING_INCENTIVE_1M_GROUP]
    case 'incentive-10m':
      return [...OPENAI_DATA_SHARING_INCENTIVE_10M_GROUP]
    case 'incentive-all':
      return [
        ...OPENAI_DATA_SHARING_INCENTIVE_1M_GROUP,
        ...OPENAI_DATA_SHARING_INCENTIVE_10M_GROUP
      ]
    default:
      return []
  }
}

function openaiModelOptionsFor(mode: OpenaiModelListMode): string[] {
  return mode === 'catalog' ? MODELS : openaiDatalistOptions(mode)
}

/** 建議值：與官方目錄同步手動維護，或以帳戶可用的 `GET https://api.openai.com/v1/models` 為準 */
const MODELS = [
  'gpt-5.5', 'gpt-5.5-pro',
  'gpt-5.4', 'gpt-5.4-pro', 'gpt-5.4-mini', 'gpt-5.4-nano',
  'gpt-5.2', 'gpt-5.2-pro', 'gpt-5.1',
  'gpt-5', 'gpt-5-pro', 'gpt-5-mini', 'gpt-5-nano',
  'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano',
  'gpt-4o', 'gpt-4o-mini',
  'o3', 'o3-pro', 'o4-mini', 'o1', 'o1-mini'
]

const TABS = ['LLM 設定', '世界觀', '使用者', '記憶', '介面', '角色', '資料'] as const
type Tab = typeof TABS[number]

export default function SettingsWindow() {
  useEffect(() => {
    const onDown = () => window.api.invoke('ui:aux-activated')
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('focus', onDown, true)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('focus', onDown, true)
    }
  }, [])

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
  const [openaiModelListMode, setOpenaiModelListMode] = useState<OpenaiModelListMode>('catalog')

  // Character tab state
  const [selectedCharId, setSelectedCharId] = useState<string | null>(null)
  const [charDraft, setCharDraft] = useState<Character | null>(null)
  const [charSaved, setCharSaved] = useState(false)
  const [nicknamesText, setNicknamesText] = useState('')

  useEffect(() => {
    if (!settings) return
    const nextDraft = JSON.parse(JSON.stringify(settings)) as AppSettings
    // 目前只支援 OpenAI，避免舊設定殘留其他 provider 造成 UI/行為不一致。
    if (nextDraft.llm.provider !== 'openai') {
      nextDraft.llm.provider = 'openai'
    }
    setDraft(nextDraft)
  }, [settings])

  useEffect(() => {
    if (selectedCharId) {
      const char = characters.find(c => c.id === selectedCharId)
      if (char) setCharDraft(JSON.parse(JSON.stringify(char)))
      else { setSelectedCharId(null); setCharDraft(null) }
    }
  }, [selectedCharId, characters])

  useEffect(() => {
    if (!charDraft) { setNicknamesText(''); return }
    setNicknamesText((charDraft.nicknames ?? []).join(', '))
  }, [charDraft?.id])

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
    // Commit nickname text → array right before saving
    const parts = nicknamesText
      .split(/[,\uFF0C、]/g)
      .map(s => s.trim())
      .filter(Boolean)
    await saveCharacter({ ...charDraft, nicknames: parts })
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
        <span className="font-semibold text-primary no-drag"> 設定</span>
        <button
          type="button"
          className="btn-round w-7 h-7 text-sm no-drag"
          title="Close settings"
          aria-label="Close settings"
          onMouseDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            window.api.invoke('window:close-self')
          }}
        >
          <MonoIcon name="close" className="w-3.5 h-3.5" />
        </button>
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
              <input className="input-field" value="openai" disabled />
            </Field>
            <Field label="模型建議清單">
              <select
                className="input-field"
                value={openaiModelListMode}
                onChange={e => setOpenaiModelListMode(e.target.value as OpenaiModelListMode)}
              >
                <option value="catalog">一般（最新常用 ID 捷徑）</option>
                <option value="incentive-1m">資料分享贈送額度 · 每日 1M 組（官方快照 ID）</option>
                <option value="incentive-10m">資料分享贈送額度 · 每日 10M 組（官方快照 ID）</option>
                <option value="incentive-all">資料分享贈送額度 · 兩組合併</option>
              </select>
              <p className="text-[11px] text-[#7BA898] leading-snug mt-1.5">
                贈送額度僅在已於 Platform 開啟「分享輸入／輸出」且帳戶顯示符合資格時適用；兩組額度分開計（tier 1–2 為 250K / 2.5M）。
                詳見{' '}
                <a className="underline text-[#3D5A52]" href={OPENAI_MODEL_LIST_HELP} target="_blank" rel="noreferrer">
                  OpenAI 說明
                </a>
                。微調、eval、工具呼叫不在贈送範圍。
              </p>
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
              <div className="mt-2 flex gap-2 items-center">
                <select
                  className="input-field"
                  value=""
                  onChange={e => {
                    const v = e.target.value
                    if (v) set('llm.model', v)
                    e.currentTarget.value = ''
                  }}
                >
                  <option value="">快速挑選（顯示完整清單）</option>
                  {openaiModelOptionsFor(openaiModelListMode).map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <datalist id="model-list">
                {(openaiModelListMode === 'catalog'
                  ? MODELS
                  : openaiDatalistOptions(openaiModelListMode)
                ).map(m => <option key={m} value={m} />)}
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
            <Field label={`群組對話最多角色回應數（${draft.llm.maxGroupRounds} 則）`}>
              <input type="range" min={1} max={10} step={1}
                value={draft.llm.maxGroupRounds}
                onChange={e => set('llm.maxGroupRounds', Number(e.target.value))}
                className="w-full accent-teal"
              />
              <p className="text-[11px] text-[#7BA898] leading-snug mt-1.5">
                控制每次送出訊息後，群組模式最多追加幾位角色的後續回應；數值越大，對話越熱鬧但 token 消耗也越高。
              </p>
            </Field>
            <Field label={`單則訊息圖片上限（${draft.llm.maxImagesPerMessage} 張）`}>
              <input type="range" min={1} max={10} step={1}
                value={draft.llm.maxImagesPerMessage}
                onChange={e => set('llm.maxImagesPerMessage', Number(e.target.value))}
                className="w-full accent-teal"
              />
              <p className="text-[11px] text-[#7BA898] leading-snug mt-1.5">
                每張圖片都會增加 token 消耗（以 gpt-4o 為例，1024×1024 約 765 tokens / 張）。
              </p>
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
              <p className="text-[11px] text-[#7BA898] leading-snug mt-1.5">
                可用標籤：<code>{'{{user}}'}</code>、<code>{'{{char}}'}</code>
              </p>
            </Field>
            <Field label="角色互動範例">
              <textarea
                className="input-field min-h-[80px] resize-none"
                value={draft.interactionExample}
                onChange={e => set('interactionExample', e.target.value)}
                placeholder="角色之間如何互動的範例..."
              />
              <p className="text-[11px] text-[#7BA898] leading-snug mt-1.5">
                可用標籤：<code>{'{{user}}'}</code>、<code>{'{{char}}'}</code>
              </p>
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
              <div className="flex gap-2">
                <button className="tab-btn text-xs" type="button" onClick={() => window.api.invoke('character-library:open')}>
                  角色庫
                </button>
                <button className="tab-btn text-xs" type="button" onClick={handleImportJson}>
                  匯入 JSON
                </button>
              </div>
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
                          : ''}
                      </div>
                      <span className="flex-1 text-sm font-medium text-primary">{char.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${onDesktop ? 'bg-teal/30 text-primary' : 'bg-surface text-secondary border border-border'}`}>
                        {onDesktop ? '桌面中' : '未上桌'}
                      </span>
                      <button
                        className={`text-xs tab-btn py-1 px-2 ${onDesktop ? 'text-[#E85D3F] hover:text-[#E85D3F] hover:bg-[#FFE2D8]' : ''}`}
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
                        <Field label="暱稱（可多個，用逗號分隔；支援 , / ， / 、）">
                          <input
                            type="text"
                            className="input-field"
                            value={nicknamesText}
                            onChange={e => setNicknamesText(e.target.value)}
                            onBlur={() => {
                              const parts = nicknamesText
                                .split(/[,\uFF0C、]/g)
                                .map(s => s.trim())
                                .filter(Boolean)
                              setCharDraft(prev => prev ? { ...prev, nicknames: parts } : prev)
                            }}
                            placeholder="例如：天行, 阿行, 老紀"
                          />
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
                            {charSaved ? ' 已儲存' : '儲存角色'}
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

        {tab === '介面' && (
          <>
            <p className="text-xs font-medium text-secondary">互動方式</p>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.ui.hoverMenuOnHover}
                onChange={e => set('ui.hoverMenuOnHover', e.target.checked)}
                className="accent-teal w-4 h-4"
              />
              <span className="text-sm text-primary">滑鼠移入角色身上時開啟功能選單</span>
            </label>
            {!draft.ui.hoverMenuOnHover && (
              <p className="text-xs text-secondary ml-6">關閉後改用右鍵開關功能選單</p>
            )}
            <div className="pt-2 space-y-1">
              <Field label={`App 失焦時角色對白透明度（${Math.round((draft.ui.unfocusedBubbleOpacity ?? 0.1) * 100)}%）`}>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round((draft.ui.unfocusedBubbleOpacity ?? 0.1) * 100)}
                  onChange={e => set('ui.unfocusedBubbleOpacity', Number(e.target.value) / 100)}
                  className="w-full accent-teal"
                />
              </Field>
              <p className="text-xs text-secondary">僅在對白框可見時套用；0% 為完全透明，100% 為不透明。</p>
            </div>
          </>
        )}

        {tab === '資料' && (
          <div className="space-y-3">
            <p className="text-sm text-secondary">所有資料存放於：</p>
            <p className="text-xs font-mono bg-surface border border-border rounded-lg px-3 py-2 text-primary break-all">
              %APPDATA%\DesktopST\
            </p>
            <button
              className="btn-round w-auto px-4 rounded-full h-auto py-2 text-sm"
              onClick={() => window.api.invoke('window:open-data-folder')}
            >
               開啟資料夾
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
                       shadow-soft hover:bg-teal transition-all"
          >
            {saved ? ' 已儲存' : '儲存'}
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
