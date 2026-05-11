import { useEffect, useState } from 'react'
import {
  OPENAI_DATA_SHARING_INCENTIVE_10M_GROUP,
  OPENAI_DATA_SHARING_INCENTIVE_1M_GROUP
} from '../constants/openaiDataSharingIncentiveModels'
import { useAppStore } from '../stores/useAppStore'
import type { AppSettings } from '../types'
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

const LEFT_TABS = ['LLM 設定', '記憶', '資料'] as const
const RIGHT_TABS = ['世界觀', '使用者', '介面'] as const
const TABS = [...LEFT_TABS, ...RIGHT_TABS] as const
type Tab = typeof TABS[number]
const SETTINGS_LAST_TAB_KEY = 'desktopst.settings.lastTab'

function readLastSettingsTab(): Tab | null {
  try {
    const raw = localStorage.getItem(SETTINGS_LAST_TAB_KEY)
    if (!raw) return null
    return (TABS as readonly string[]).includes(raw) ? (raw as Tab) : null
  } catch {
    return null
  }
}

function persistLastSettingsTab(tab: Tab): void {
  try {
    localStorage.setItem(SETTINGS_LAST_TAB_KEY, tab)
  } catch {
    // Ignore persistence errors (private mode / storage disabled).
  }
}

const TAB_PARAM_ALIASES: Record<string, Tab> = {
  llm: 'LLM 設定',
  world: '世界觀',
  user: '使用者',
  persona: '使用者',
  memory: '記憶',
  ui: '介面',
  data: '資料',
  'LLM 設定': 'LLM 設定',
  世界觀: '世界觀',
  使用者: '使用者',
  記憶: '記憶',
  介面: '介面',
  資料: '資料'
}

function tabFromLocation(): Tab {
  const raw = new URLSearchParams(window.location.search).get('tab')
  if (!raw) return readLastSettingsTab() ?? 'LLM 設定'
  const decoded = decodeURIComponent(raw.trim())
  if (TAB_PARAM_ALIASES[decoded]) return TAB_PARAM_ALIASES[decoded]
  if (TAB_PARAM_ALIASES[raw]) return TAB_PARAM_ALIASES[raw]
  if ((TABS as readonly string[]).includes(decoded)) return decoded as Tab
  return readLastSettingsTab() ?? 'LLM 設定'
}

function tabFromExternalParam(raw: unknown): Tab {
  if (typeof raw !== 'string' || !raw.trim()) return readLastSettingsTab() ?? 'LLM 設定'
  const decoded = decodeURIComponent(raw.trim())
  if (TAB_PARAM_ALIASES[decoded]) return TAB_PARAM_ALIASES[decoded]
  if (TAB_PARAM_ALIASES[raw.trim()]) return TAB_PARAM_ALIASES[raw.trim()]
  if ((TABS as readonly string[]).includes(decoded)) return decoded as Tab
  return readLastSettingsTab() ?? 'LLM 設定'
}

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

  const [tab, setTab] = useState<Tab>(() => tabFromLocation())
  const [draft, setDraft] = useState<AppSettings | null>(null)
  const [saved, setSaved] = useState(false)
  const [openaiModelListMode, setOpenaiModelListMode] = useState<OpenaiModelListMode>('catalog')

  const changeTab = (nextTab: Tab) => {
    setTab(nextTab)
    persistLastSettingsTab(nextTab)
  }

  // API test state
  const [connTesting, setConnTesting] = useState(false)
  const [connResult, setConnResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [msgTesting, setMsgTesting] = useState(false)
  const [msgResult, setMsgResult] = useState<{ ok: boolean; msg: string } | null>(null)

  useEffect(() => {
    persistLastSettingsTab(tab)
  }, [tab])

  useEffect(() => {
    const unsub = window.api.on('settings:navigate-tab', (t: unknown) => {
      const nextTab = tabFromExternalParam(t)
      setTab(nextTab)
      persistLastSettingsTab(nextTab)
    })
    return unsub
  }, [])

  useEffect(() => {
    if (!settings) return
    const nextDraft = JSON.parse(JSON.stringify(settings)) as AppSettings
    // 目前只支援 OpenAI，避免舊設定殘留其他 provider 造成 UI/行為不一致。
    if (nextDraft.llm.provider !== 'openai') {
      nextDraft.llm.provider = 'openai'
    }
    setDraft(nextDraft)
  }, [settings])

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

  const onboardingIncomplete = !!draft && draft.ui.onboardingCompleted === false
  const canFinishOnboarding =
    !!draft &&
    draft.llm.apiKey.trim().length > 0 &&
    draft.worldSetting.trim().length > 0 &&
    draft.persona.description.trim().length > 0 &&
    characters.length >= 1

  const finishOnboarding = async () => {
    if (!draft || !canFinishOnboarding) return
    const next: AppSettings = {
      ...draft,
      ui: { ...draft.ui, onboardingCompleted: true }
    }
    await saveSettings(next)
    setDraft(JSON.parse(JSON.stringify(next)) as AppSettings)
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
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border no-drag">
        <div className="flex gap-1 flex-wrap">
          {LEFT_TABS.map(t => (
            <button
              key={t}
              onClick={() => changeTab(t)}
              className={`tab-btn text-xs ${tab === t ? 'active' : ''}`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="h-6 w-px bg-border shrink-0" aria-hidden="true" />
        <div className="flex gap-1 flex-wrap ml-auto justify-end">
          {RIGHT_TABS.map(t => (
            <button
              key={t}
              onClick={() => changeTab(t)}
              className={`tab-btn text-xs ${tab === t ? 'active' : ''}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {onboardingIncomplete && (
        <div className="px-4 py-3 border-b border-border bg-[#E8FBF4] no-drag space-y-2 shrink-0">
          <p className="text-sm font-semibold text-primary">歡迎使用 DesktopST · 首次設定</p>
          <ol className="text-xs text-secondary list-decimal pl-4 space-y-1 leading-relaxed">
            <li>在「LLM 設定」填寫 OpenAI API Key。</li>
            <li>在「世界觀」「使用者」填寫敘事與你的角色設定（至少各有一段內容）。</li>
            <li>到「角色庫」匯入既有角色卡（JSON／PNG）或新增角色；跨電腦搬家請用「匯出 DesktopST 搬家包」。</li>
          </ol>
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" className="text-xs px-3 py-1.5 rounded-full bg-mint font-semibold text-primary" onClick={() => changeTab('LLM 設定')}>
              前往 API Key
            </button>
            <button type="button" className="text-xs px-3 py-1.5 rounded-full border border-border text-primary hover:bg-mint/40" onClick={() => changeTab('世界觀')}>
              世界觀
            </button>
            <button type="button" className="text-xs px-3 py-1.5 rounded-full border border-border text-primary hover:bg-mint/40" onClick={() => changeTab('使用者')}>
              使用者
            </button>
            <button
              type="button"
              className="text-xs px-3 py-1.5 rounded-full border border-border text-primary hover:bg-mint/40"
              onClick={() => void window.api.invoke('character-library:open')}
            >
              開啟角色庫
            </button>
            <button
              type="button"
              disabled={!canFinishOnboarding}
              className="text-xs px-3 py-1.5 rounded-full bg-[#AAEEDD] font-semibold text-primary disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => void finishOnboarding()}
            >
              完成引導
            </button>
          </div>
        </div>
      )}

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
              <div className="flex gap-2 mt-2 items-center flex-wrap">
                <button
                  type="button"
                  disabled={connTesting || !draft.llm.apiKey.trim()}
                  className="text-xs px-3 py-1.5 rounded-full bg-mint font-semibold text-primary disabled:opacity-40 disabled:cursor-not-allowed hover:bg-teal transition-all"
                  onClick={async () => {
                    setConnTesting(true)
                    setConnResult(null)
                    try {
                      const r = await window.api.invoke('llm:test-connection', {
                        apiKey: draft.llm.apiKey,
                        endpoint: draft.llm.endpoint
                      }) as { ok: boolean; error?: string; models?: string[] }
                      setConnResult(r.ok
                        ? { ok: true, msg: '已驗證' }
                        : { ok: false, msg: r.error || '連線失敗' })
                    } catch (e: any) {
                      setConnResult({ ok: false, msg: e?.message || '未知錯誤' })
                    } finally {
                      setConnTesting(false)
                    }
                  }}
                >
                  {connTesting ? '驗證中...' : '連線'}
                </button>
                <button
                  type="button"
                  disabled={msgTesting || !draft.llm.apiKey.trim() || !draft.llm.model.trim()}
                  className="text-xs px-3 py-1.5 rounded-full border border-border text-primary disabled:opacity-40 disabled:cursor-not-allowed hover:bg-mint/40 transition-all"
                  onClick={async () => {
                    setMsgTesting(true)
                    setMsgResult(null)
                    try {
                      const r = await window.api.invoke('llm:test-message', {
                        apiKey: draft.llm.apiKey,
                        endpoint: draft.llm.endpoint,
                        model: draft.llm.model
                      }) as { ok: boolean; error?: string; reply?: string }
                      setMsgResult(r.ok
                        ? { ok: true, msg: r.reply || '成功' }
                        : { ok: false, msg: r.error || '測試失敗' })
                    } catch (e: any) {
                      setMsgResult({ ok: false, msg: e?.message || '未知錯誤' })
                    } finally {
                      setMsgTesting(false)
                    }
                  }}
                >
                  {msgTesting ? '測試中...' : '測試訊息'}
                </button>
                {connResult && (
                  <span className={`text-xs ${connResult.ok ? 'text-[#4CAF50]' : 'text-[#E85D3F]'}`}>
                    {connResult.ok ? '\u25CF' : '\u25CF'} {connResult.msg}
                  </span>
                )}
                {msgResult && (
                  <span className={`text-xs ${msgResult.ok ? 'text-[#4CAF50]' : 'text-[#E85D3F]'}`}>
                    {msgResult.ok ? '\u25CF' : '\u25CF'} {msgResult.msg}
                  </span>
                )}
              </div>
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

      <div className="px-4 py-3 border-t border-border no-drag flex justify-end">
        <button
          onClick={handleSave}
          className="px-6 py-2 rounded-full text-sm font-semibold bg-mint text-primary
                     shadow-soft hover:bg-teal transition-all"
        >
          {saved ? ' 已儲存' : '儲存'}
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
