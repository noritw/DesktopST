import { useEffect, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import {
  OPENAI_DATA_SHARING_INCENTIVE_10M_GROUP,
  OPENAI_DATA_SHARING_INCENTIVE_1M_GROUP
} from '../constants/openaiDataSharingIncentiveModels'
import { useAppStore } from '../stores/useAppStore'
import type { AppSettings, PersonaPreset, WorldPreset } from '../types'
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

const CLAUDE_MODELS = [
  'claude-sonnet-4-6',
  'claude-opus-4-7',
  'claude-haiku-4-5-20251001',
  'claude-3-7-sonnet-20250219',
  'claude-3-5-sonnet-20241022',
  'claude-3-5-haiku-20241022',
  'claude-3-opus-20240229'
]

const GEMINI_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-3.1-flash',
  'gemini-3.1-pro-preview',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-pro'
]

const GROK_MODELS = [
  'grok-4-1-fast-reasoning',
  'grok-4-1-fast-non-reasoning',
  'grok-4.3',
  'grok-4.20-reasoning',
  'grok-4.20-non-reasoning'
]

const PROVIDER_MODELS: Record<string, string[]> = {
  openai: MODELS,
  claude: CLAUDE_MODELS,
  gemini: GEMINI_MODELS,
  grok: GROK_MODELS
}

const PROVIDER_DEFAULT_MODEL: Record<string, string> = {
  openai: 'gpt-4o',
  claude: 'claude-sonnet-4-6',
  gemini: 'gemini-3.1-flash-lite',
  grok: 'grok-4-1-fast-reasoning'
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  claude: 'Anthropic Claude',
  gemini: 'Google Gemini',
  grok: 'xAI Grok'
}

const PROVIDER_KEY_PLACEHOLDER: Record<string, string> = {
  openai: 'sk-...',
  claude: 'sk-ant-...',
  gemini: 'AIza...',
  grok: 'xai-...'
}

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
  const personaPresets = useAppStore(s => s.personaPresets)
  const worldPresets = useAppStore(s => s.worldPresets)
  const savePersonaPreset = useAppStore(s => s.savePersonaPreset)
  const deletePersonaPreset = useAppStore(s => s.deletePersonaPreset)
  const saveWorldPreset = useAppStore(s => s.saveWorldPreset)
  const deleteWorldPreset = useAppStore(s => s.deleteWorldPreset)

  const [tab, setTab] = useState<Tab>(() => tabFromLocation())
  const [draft, setDraft] = useState<AppSettings | null>(null)
  const [dirty, setDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [openaiModelListMode, setOpenaiModelListMode] = useState<OpenaiModelListMode>('catalog')
  const [worldDraft, setWorldDraft] = useState<WorldPreset | null>(null)
  const [personaDraft, setPersonaDraft] = useState<PersonaPreset | null>(null)
  const [renaming, setRenaming] = useState<'world' | 'persona' | null>(null)
  const [renameValue, setRenameValue] = useState('')

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
    // Ensure apiKeys exists (fallback for old settings)
    if (!nextDraft.llm.apiKeys) {
      nextDraft.llm.apiKeys = {
        openai: nextDraft.llm.apiKey ?? '',
        claude: '',
        gemini: '',
        grok: ''
      }
    }
    setDraft(nextDraft)
  }, [settings])

  useEffect(() => {
    if (!draft) return
    const w = worldPresets.find(p => p.id === draft.activeWorldId)
    setWorldDraft(w ? { ...w } : null)
  }, [draft?.activeWorldId, worldPresets])

  useEffect(() => {
    if (!draft) return
    const p = personaPresets.find(p => p.id === draft.activePersonaId)
    setPersonaDraft(p ? { ...p } : null)
  }, [draft?.activePersonaId, personaPresets])

  // 自動儲存防抖（600ms）
  useEffect(() => {
    if (!dirty || !draft) return
    const timer = window.setTimeout(() => {
      void doAutoSave(draft)
    }, 600)
    return () => window.clearTimeout(timer)
  }, [draft, dirty])

  if (!draft) return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)', gap: 12 }}>
      <span style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>載入設定中...</span>
      <button style={{ padding: '6px 16px', borderRadius: 20, border: '1px solid var(--color-teal)', background: 'var(--color-mint)', color: 'var(--color-text-primary)', cursor: 'pointer', fontSize: 13 }}
        onClick={() => window.api.invoke('window:close-self')}>關閉</button>
    </div>
  )

  const set = (path: string, value: unknown) => {
    setDirty(true)
    setDraft(prev => {
      if (!prev) return prev
      const next = JSON.parse(JSON.stringify(prev)) as AppSettings
      const keys = path.split('.')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let obj: any = next
      for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i]
        if (obj[key] === undefined || obj[key] === null) {
          obj[key] = {} // Initialize to empty object if undefined
        }
        obj = obj[key]
      }
      obj[keys[keys.length - 1]] = value
      return next
    })
  }

  const doAutoSave = async (data: AppSettings) => {
    setIsSaving(true)
    try {
      const settingsToSave = JSON.parse(JSON.stringify(data)) as AppSettings
      settingsToSave.llm.model = settingsToSave.llm.models?.[settingsToSave.llm.provider] ?? settingsToSave.llm.model
      if (worldDraft) {
        worldDraft.updatedAt = Date.now()
        await saveWorldPreset(worldDraft)
      }
      if (personaDraft) {
        personaDraft.updatedAt = Date.now()
        await savePersonaPreset(personaDraft)
      }
      await saveSettings(settingsToSave)
      setDraft(settingsToSave)
      setDirty(false)
    } finally {
      setIsSaving(false)
    }
  }

  // Helper: get current provider's model (from per-provider storage or fallback to global)
  const getCurrentModel = (): string => {
    return draft?.llm.models?.[draft.llm.provider] ?? draft?.llm.model ?? ''
  }

  // Helper: set current provider's model to per-provider storage
  const setCurrentModel = (m: string) => {
    if (!draft) return
    const next = JSON.parse(JSON.stringify(draft)) as AppSettings
    if (!next.llm.models) next.llm.models = {}
    next.llm.models[next.llm.provider] = m
    next.llm.model = m
    setDraft(next)
  }


  const onboardingIncomplete = !!draft && draft.ui.onboardingCompleted === false
  const canFinishOnboarding =
    !!draft &&
    (draft.llm.apiKeys?.[draft.llm.provider] ?? draft.llm.apiKey ?? '').trim().length > 0 &&
    getCurrentModel().trim().length > 0 &&
    !!(worldDraft?.worldSetting?.trim()) &&
    !!(personaDraft?.description?.trim()) &&
    characters.length >= 1

  const switchWorld = async (id: string) => {
    if (worldDraft) {
      worldDraft.updatedAt = Date.now()
      await saveWorldPreset(worldDraft)
    }
    set('activeWorldId', id)
  }

  const addWorld = async () => {
    const now = Date.now()
    const preset: WorldPreset = {
      id: uuidv4(),
      name: `世界觀 ${worldPresets.length + 1}`,
      worldSetting: '',
      interactionExample: '',
      builtIn: false,
      createdAt: now,
      updatedAt: now
    }
    await saveWorldPreset(preset)
    set('activeWorldId', preset.id)
  }

  const deleteCurrentWorld = async () => {
    if (!worldDraft || worldDraft.builtIn) return
    await deleteWorldPreset(worldDraft.id)
    const remaining = worldPresets.filter(w => w.id !== worldDraft.id)
    set('activeWorldId', remaining[0]?.id ?? '')
  }

  const switchPersona = async (id: string) => {
    if (personaDraft) {
      personaDraft.updatedAt = Date.now()
      await savePersonaPreset(personaDraft)
    }
    set('activePersonaId', id)
  }

  const addPersona = async () => {
    const now = Date.now()
    const preset: PersonaPreset = {
      id: uuidv4(),
      name: `使用者 ${personaPresets.length + 1}`,
      displayName: '',
      nickname: '',
      description: '',
      builtIn: false,
      createdAt: now,
      updatedAt: now
    }
    await savePersonaPreset(preset)
    set('activePersonaId', preset.id)
  }

  const deleteCurrentPersona = async () => {
    if (!personaDraft || personaDraft.builtIn) return
    await deletePersonaPreset(personaDraft.id)
    const remaining = personaPresets.filter(p => p.id !== personaDraft.id)
    set('activePersonaId', remaining[0]?.id ?? '')
  }

  const startRename = (kind: 'world' | 'persona') => {
    const current = kind === 'world' ? worldDraft?.name : personaDraft?.name
    setRenaming(kind)
    setRenameValue(current ?? '')
  }

  const commitRename = async () => {
    const trimmed = renameValue.trim()
    if (!trimmed || !renaming) {
      setRenaming(null)
      return
    }
    if (renaming === 'world' && worldDraft) {
      const updated = { ...worldDraft, name: trimmed, updatedAt: Date.now() }
      await saveWorldPreset(updated)
      setWorldDraft(updated)
    } else if (renaming === 'persona' && personaDraft) {
      const updated = { ...personaDraft, name: trimmed, updatedAt: Date.now() }
      await savePersonaPreset(updated)
      setPersonaDraft(updated)
    }
    setRenaming(null)
  }

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
        <div className="px-4 py-3 border-b border-border bg-mint-20 no-drag space-y-2 shrink-0">
          <p className="text-sm font-semibold text-primary">歡迎使用 DesktopST · 首次設定</p>
          <ol className="text-xs text-secondary list-decimal pl-4 space-y-1 leading-relaxed">
            <li>在「LLM 設定」選擇服務商並填寫對應的 API Key。</li>
            <li>在「世界觀」「使用者」填寫敘事與你的角色設定（至少各有一段內容）。</li>
            <li>到「角色庫」匯入既有角色卡（JSON／PNG）或新增角色；跨電腦搬家請用「匯出 DesktopST 搬家包」。</li>
          </ol>
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" className="text-xs px-3 py-1.5 rounded-full bg-mint font-semibold text-primary" onClick={() => changeTab('LLM 設定')}>
              前往 API Key
            </button>
            <button type="button" className="text-xs px-3 py-1.5 rounded-full border border-border text-primary hover:bg-mint-40" onClick={() => changeTab('世界觀')}>
              世界觀
            </button>
            <button type="button" className="text-xs px-3 py-1.5 rounded-full border border-border text-primary hover:bg-mint-40" onClick={() => changeTab('使用者')}>
              使用者
            </button>
            <button
              type="button"
              className="text-xs px-3 py-1.5 rounded-full border border-border text-primary hover:bg-mint-40"
              onClick={() => void window.api.invoke('character-library:open')}
            >
              開啟角色庫
            </button>
            <button
              type="button"
              disabled={!canFinishOnboarding}
              className="text-xs px-3 py-1.5 rounded-full bg-teal font-semibold text-primary disabled:opacity-40 disabled:cursor-not-allowed"
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
            <div className="px-3 py-3 border border-border rounded-2xl bg-mint-20 space-y-2">
              <p className="text-sm font-semibold text-primary">🔑 API Key 入門指南</p>
              <p className="text-xs text-secondary leading-relaxed">
                使用 AI 聊天需要費用。你聊越多，花越多錢。大多數 LLM 服務商都提供免費試用額度，但額度和方案不同，建議查看各家說明。
              </p>
              <button
                onClick={() => window.api.invoke('app:open-api-guide')}
                className="text-xs inline-block px-3 py-1.5 rounded-full bg-mint font-semibold text-primary hover:bg-teal transition-all cursor-pointer"
              >
                👉 查看 API Key 申請指南
              </button>
            </div>
            <Field label="服務商">
              <select
                className="input-field"
                value={draft.llm.provider}
                onChange={e => {
                  const p = e.target.value as AppSettings['llm']['provider']
                  setDraft(prev => {
                    if (!prev) return prev
                    const next = JSON.parse(JSON.stringify(prev)) as AppSettings
                    next.llm.provider = p
                    if (!next.llm.models) next.llm.models = {}
                    const savedModel = next.llm.models[p]
                    const fallbackModel = PROVIDER_MODELS[p]?.includes(next.llm.model ?? '')
                      ? next.llm.model
                      : (PROVIDER_DEFAULT_MODEL[p] ?? '')
                    const nextModel = savedModel || fallbackModel
                    next.llm.models[p] = nextModel
                    next.llm.model = nextModel
                    if (p === 'grok' && !next.llm.endpoint?.trim()) {
                      next.llm.endpoint = 'https://api.x.ai/v1'
                    } else if (p === 'openai' && next.llm.endpoint?.includes('api.x.ai')) {
                      next.llm.endpoint = ''
                    }
                    return next
                  })
                  // Clear test results when switching provider
                  setConnResult(null)
                  setMsgResult(null)
                }}
              >
                {Object.entries(PROVIDER_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              {draft.llm.provider === 'gemini' && (
                <p className="text-[11px] text-secondary leading-snug mt-1.5">
                  Gemini 2.0 Flash 每日免費 1500 次請求，不需綁定信用卡。
                </p>
              )}
            </Field>
            {draft.llm.provider === 'openai' && (
              <Field label="模型建議清單">
                <select
                  className="input-field"
                  value={openaiModelListMode}
                  onChange={e => {
                    setOpenaiModelListMode(e.target.value as OpenaiModelListMode)
                    setConnResult(null)
                    setMsgResult(null)
                  }}
                >
                  <option value="catalog">一般（最新常用 ID 捷徑）</option>
                  <option value="incentive-1m">資料分享贈送額度 · 每日 1M 組（官方快照 ID）</option>
                  <option value="incentive-10m">資料分享贈送額度 · 每日 10M 組（官方快照 ID）</option>
                  <option value="incentive-all">資料分享贈送額度 · 兩組合併</option>
                </select>
                <p className="text-[11px] text-secondary leading-snug mt-1.5">
                  贈送額度僅在已於 Platform 開啟「分享輸入／輸出」且帳戶顯示符合資格時適用；兩組額度分開計（tier 1–2 為 250K / 2.5M）。
                  詳見{' '}
                  <a className="underline text-primary" href={OPENAI_MODEL_LIST_HELP} target="_blank" rel="noreferrer">
                    OpenAI 說明
                  </a>
                  。微調、eval、工具呼叫不在贈送範圍。
                </p>
              </Field>
            )}
            <Field label="模型（可手動輸入自訂 ID）">
              <input
                type="text"
                className="input-field"
                list="model-list"
                value={getCurrentModel()}
                onChange={e => setCurrentModel(e.target.value)}
                placeholder="輸入或選擇模型 ID"
              />
              <div className="mt-2 flex gap-2 items-center">
                <select
                  className="input-field"
                  value=""
                  onChange={e => {
                    const v = e.target.value
                    if (v) {
                      setCurrentModel(v)
                      // Clear test results when switching model
                      setConnResult(null)
                      setMsgResult(null)
                    }
                    e.currentTarget.value = ''
                  }}
                >
                  <option value="">快速挑選（顯示完整清單）</option>
                  {(draft?.llm.provider === 'openai'
                    ? openaiModelOptionsFor(openaiModelListMode)
                    : PROVIDER_MODELS[draft?.llm.provider ?? 'openai'] ?? MODELS
                  ).map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <datalist id="model-list">
                {(draft?.llm.provider === 'openai'
                  ? openaiModelOptionsFor(openaiModelListMode)
                  : PROVIDER_MODELS[draft?.llm.provider ?? 'openai'] ?? MODELS
                ).map(m => <option key={m} value={m} />)}
              </datalist>
            </Field>
            <Field label={`API Key（${PROVIDER_LABELS[draft.llm.provider]}）`}>
              <input
                type="password"
                className="input-field"
                value={draft.llm.apiKeys?.[draft.llm.provider] ?? ''}
                onChange={e => set(`llm.apiKeys.${draft.llm.provider}`, e.target.value)}
                placeholder={PROVIDER_KEY_PLACEHOLDER[draft.llm.provider] ?? 'API Key'}
              />
              <div className="flex gap-2 mt-2 items-center flex-wrap">
                <button
                  type="button"
                  disabled={connTesting || !(draft.llm.apiKeys?.[draft.llm.provider] ?? '').trim()}
                  className="text-xs px-3 py-1.5 rounded-full bg-mint font-semibold text-primary disabled:opacity-40 disabled:cursor-not-allowed hover:bg-teal transition-all"
                  onClick={async () => {
                    setConnTesting(true)
                    setConnResult(null)
                    try {
                      const r = await window.api.invoke('llm:test-connection', {
                        provider: draft.llm.provider,
                        apiKeys: draft.llm.apiKeys,
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
                  disabled={msgTesting || !(draft?.llm.apiKeys?.[draft?.llm.provider ?? 'openai'] ?? '').trim() || !getCurrentModel().trim()}
                  className="text-xs px-3 py-1.5 rounded-full border border-border text-primary disabled:opacity-40 disabled:cursor-not-allowed hover:bg-mint-40 transition-all"
                  onClick={async () => {
                    setMsgTesting(true)
                    setMsgResult(null)
                    try {
                      const r = await window.api.invoke('llm:test-message', {
                        provider: draft?.llm.provider,
                        apiKeys: draft?.llm.apiKeys,
                        endpoint: draft?.llm.endpoint,
                        model: getCurrentModel()
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
            {(draft.llm.provider === 'openai' || draft.llm.provider === 'grok') && (
              <Field label={draft.llm.provider === 'grok' ? 'Grok API 端點' : '自訂端點（選填）'}>
                <input
                  type="text"
                  className="input-field"
                  value={draft.llm.endpoint ?? ''}
                  onChange={e => set('llm.endpoint', e.target.value)}
                  placeholder={draft.llm.provider === 'grok' ? 'https://api.x.ai/v1' : 'https://api.example.com/v1'}
                />
                {draft.llm.provider === 'grok' && (
                  <p className="text-[11px] text-secondary leading-snug mt-1.5">
                    Grok 使用 OpenAI 相容 API，預設端點為 https://api.x.ai/v1。
                  </p>
                )}
              </Field>
            )}
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
              <p className="text-[11px] text-secondary leading-snug mt-1.5">
                控制每次送出訊息後，群組模式最多追加幾位角色的後續回應；數值越大，對話越熱鬧但 token 消耗也越高。
              </p>
            </Field>
            <Field label={`單則訊息圖片上限（${draft.llm.maxImagesPerMessage} 張）`}>
              <input type="range" min={1} max={10} step={1}
                value={draft.llm.maxImagesPerMessage}
                onChange={e => set('llm.maxImagesPerMessage', Number(e.target.value))}
                className="w-full accent-teal"
              />
              <p className="text-[11px] text-secondary leading-snug mt-1.5">
                每張圖片都會增加 token 消耗（以 gpt-4o 為例，1024×1024 約 765 tokens / 張）。
              </p>
            </Field>
          </>
        )}

        {tab === '世界觀' && (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                className="input-field flex-1 min-w-[120px]"
                value={draft.activeWorldId}
                onChange={e => switchWorld(e.target.value)}
              >
                {worldPresets.map(w => (
                  <option key={w.id} value={w.id}>{w.name}{w.builtIn ? '（內建）' : ''}</option>
                ))}
                {worldPresets.length === 0 && <option value="">（無預設組）</option>}
              </select>
              <button type="button" className="text-xs px-2.5 py-1.5 rounded-full bg-mint font-semibold text-primary hover:bg-teal transition-all" onClick={addWorld}>新增</button>
              {worldDraft && (
                <>
                  {renaming === 'world' ? (
                    <input
                      type="text"
                      className="input-field text-xs w-32"
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(null) }}
                      autoFocus
                    />
                  ) : (
                    <button type="button" className="text-xs px-2.5 py-1.5 rounded-full border border-border text-primary hover:bg-mint-40 transition-all" onClick={() => startRename('world')}>重新命名</button>
                  )}
                  {!worldDraft.builtIn && (
                    <button type="button" className="text-xs px-2.5 py-1.5 rounded-full border border-[#FFBBBB] text-[#E85D3F] hover:bg-[#FFBBBB]/30 transition-all" onClick={deleteCurrentWorld}>刪除</button>
                  )}
                </>
              )}
            </div>
            {worldDraft ? (
              <>
                <Field label="世界觀設定">
                  <textarea
                    className="input-field min-h-[120px] resize-none"
                    value={worldDraft.worldSetting}
                    onChange={e => setWorldDraft(prev => prev ? { ...prev, worldSetting: e.target.value } : prev)}
                    placeholder="描述這個世界的背景設定..."
                  />
                  <p className="text-[11px] text-secondary leading-snug mt-1.5">
                    可用標籤：<code>{'{{user}}'}</code>、<code>{'{{char}}'}</code>
                  </p>
                </Field>
                <Field label="角色互動範例">
                  <textarea
                    className="input-field min-h-[80px] resize-none"
                    value={worldDraft.interactionExample}
                    onChange={e => setWorldDraft(prev => prev ? { ...prev, interactionExample: e.target.value } : prev)}
                    placeholder="角色之間如何互動的範例..."
                  />
                  <p className="text-[11px] text-secondary leading-snug mt-1.5">
                    可用標籤：<code>{'{{user}}'}</code>、<code>{'{{char}}'}</code>
                  </p>
                </Field>
              </>
            ) : (
              <p className="text-sm text-secondary">尚未選擇世界觀預設組，請點「新增」建立。</p>
            )}
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
            <div className="flex items-center gap-2 flex-wrap">
              <select
                className="input-field flex-1 min-w-[120px]"
                value={draft.activePersonaId}
                onChange={e => switchPersona(e.target.value)}
              >
                {personaPresets.map(p => (
                  <option key={p.id} value={p.id}>{p.name}{p.builtIn ? '（內建）' : ''}</option>
                ))}
                {personaPresets.length === 0 && <option value="">（無預設組）</option>}
              </select>
              <button type="button" className="text-xs px-2.5 py-1.5 rounded-full bg-mint font-semibold text-primary hover:bg-teal transition-all" onClick={addPersona}>新增</button>
              {personaDraft && (
                <>
                  {renaming === 'persona' ? (
                    <input
                      type="text"
                      className="input-field text-xs w-32"
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(null) }}
                      autoFocus
                    />
                  ) : (
                    <button type="button" className="text-xs px-2.5 py-1.5 rounded-full border border-border text-primary hover:bg-mint-40 transition-all" onClick={() => startRename('persona')}>重新命名</button>
                  )}
                  {!personaDraft.builtIn && (
                    <button type="button" className="text-xs px-2.5 py-1.5 rounded-full border border-[#FFBBBB] text-[#E85D3F] hover:bg-[#FFBBBB]/30 transition-all" onClick={deleteCurrentPersona}>刪除</button>
                  )}
                </>
              )}
            </div>
            {personaDraft ? (
              <>
                <Field label="顯示名稱">
                  <input type="text" className="input-field"
                    value={personaDraft.displayName}
                    onChange={e => setPersonaDraft(prev => prev ? { ...prev, displayName: e.target.value } : prev)}
                    placeholder="你的名字"
                  />
                </Field>
                <Field label="角色如何稱呼你">
                  <input type="text" className="input-field"
                    value={personaDraft.nickname}
                    onChange={e => setPersonaDraft(prev => prev ? { ...prev, nickname: e.target.value } : prev)}
                    placeholder="主人、大人、小名..."
                  />
                </Field>
                <Field label="自我介紹（選填）">
                  <textarea className="input-field min-h-[80px] resize-none"
                    value={personaDraft.description}
                    onChange={e => setPersonaDraft(prev => prev ? { ...prev, description: e.target.value } : prev)}
                    placeholder="讓角色更了解你..."
                  />
                </Field>
              </>
            ) : (
              <p className="text-sm text-secondary">尚未選擇使用者預設組，請點「新增」建立。</p>
            )}
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
            <p className="text-xs font-medium text-secondary">介面配色</p>
            <div className="grid grid-cols-3 gap-2">
              {([
                { key: 'mint',     label: '薄荷綠', bg: '#CBFBC4', border: '#A9DED2', text: '#3D5A52' },
                { key: 'butter',   label: '奶油黃', bg: '#FFE8AA', border: '#E8CC88', text: '#5A4A2A' },
                { key: 'peach',    label: '粉橘',   bg: '#FFD6B8', border: '#E8B898', text: '#5A3A2A' },
                { key: 'aqua',     label: '粉藍綠', bg: '#B8F4EA', border: '#88D8CC', text: '#2A5050' },
                { key: 'sky',      label: '天藍',   bg: '#AAEEFF', border: '#88CCEE', text: '#2A4A6A' },
                { key: 'blush',    label: '粉紅',   bg: '#FFBBBB', border: '#E898A8', text: '#5A2A3A' },
                { key: 'lavender', label: '薰衣草', bg: '#F0BBFF', border: '#D088E8', text: '#4A2A5A' },
                { key: 'white',    label: '純白',   bg: '#FFFFFF', border: '#CCCCCC', text: '#3D5A52' },
                { key: 'dark',     label: '黑底白字', bg: '#1F2423', border: '#445A52', text: '#F7FFFC' },
              ] as const).map(opt => {
                const active = (draft.ui.colorTheme ?? 'mint') === opt.key
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => {
                      set('ui.colorTheme', opt.key)
                      if (opt.key === 'mint') {
                        document.documentElement.removeAttribute('data-color-theme')
                      } else {
                        document.documentElement.setAttribute('data-color-theme', opt.key)
                      }
                    }}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs font-medium border transition-all"
                    style={{
                      background: active ? opt.bg : 'transparent',
                      borderColor: active ? opt.border : 'var(--color-border)',
                      color: active ? opt.text : 'var(--color-text-secondary)',
                      outline: active ? `2px solid ${opt.border}` : 'none',
                      outlineOffset: '1px',
                    }}
                  >
                    <span
                      className="w-4 h-4 rounded-full shrink-0 border"
                      style={{ background: opt.bg, borderColor: opt.border }}
                    />
                    {opt.label}
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-secondary">選擇後立即套用。</p>

            <div className="border-t border-border pt-3" />
            <p className="text-xs font-medium text-secondary">文字大小</p>
            <div className="flex gap-2">
              {([
                { key: 'xs', label: '極小', px: '12' },
                { key: 'sm', label: '小', px: '13' },
                { key: 'md', label: '中', px: '14' },
                { key: 'lg', label: '大', px: '16' },
                { key: 'xl', label: '極大', px: '18' },
              ] as const).map(opt => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => set('ui.chatFontSize', opt.key)}
                  className={`flex-1 py-1.5 rounded-full text-xs font-medium border transition-all ${
                    (draft.ui.chatFontSize ?? 'md') === opt.key
                      ? 'bg-mint text-primary border-teal font-semibold'
                      : 'bg-surface text-secondary border-border hover:border-teal hover:text-primary'
                  }`}
                >
                  <span style={{ fontSize: `${opt.px}px` }}>{opt.label}</span>
                  <span className="block text-[10px] opacity-60">{opt.px}px</span>
                </button>
              ))}
            </div>
            <p className="text-xs text-secondary">套用至全 App 文字，儲存後立即生效。</p>

            <div className="border-t border-border pt-3" />
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

      <div className="px-4 py-3 border-t border-border no-drag flex items-center justify-between">
        <span className="text-sm text-secondary">
          {isSaving ? '儲存中…' : dirty ? '有未儲存的變更' : '已儲存'}
        </span>
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
