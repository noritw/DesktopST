import { useEffect, useState, useRef } from 'react'
import { staticFileUrl } from '../utils/resourcePath'
import { v4 as uuidv4 } from 'uuid'
import {
  OPENAI_DATA_SHARING_INCENTIVE_10M_GROUP,
  OPENAI_DATA_SHARING_INCENTIVE_1M_GROUP
} from '../constants/openaiDataSharingIncentiveModels'
import { useAppStore } from '../stores/useAppStore'
import type { AppSettings, PersonaPreset, ScenePreset, WorldPreset } from '../types'
import MonoIcon from '../components/MonoIcon'

const OPENAI_MODEL_LIST_HELP =
  'https://help.openai.com/en/articles/10306912-sharing-feedback-evaluation-and-fine-tuning-data-and-api-inputs-and-outputs-with-openai'

/** 完整授權條款（網頁，與程式附帶之 docs/license.html 內容對齊維護） */
const DESKTOPST_LICENSE_URL = 'https://nori.tw/DeST/license.html'

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
const SCENE_TABS = ['情境'] as const
const RIGHT_TABS = ['世界觀', '使用者', '介面', '關於'] as const
const TABS = [...LEFT_TABS, ...SCENE_TABS, ...RIGHT_TABS] as const
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
  about: '關於',
  scene: '情境',
  'LLM 設定': 'LLM 設定',
  世界觀: '世界觀',
  使用者: '使用者',
  記憶: '記憶',
  介面: '介面',
  資料: '資料',
  關於: '關於',
  情境: '情境'
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
  const scenePresets = useAppStore(s => s.scenePresets)
  const savePersonaPreset = useAppStore(s => s.savePersonaPreset)
  const deletePersonaPreset = useAppStore(s => s.deletePersonaPreset)
  const saveWorldPreset = useAppStore(s => s.saveWorldPreset)
  const deleteWorldPreset = useAppStore(s => s.deleteWorldPreset)
  const captureScene = useAppStore(s => s.captureScene)
  const deleteScene = useAppStore(s => s.deleteScene)
  const loadScene = useAppStore(s => s.loadScene)
  const renameScene = useAppStore(s => s.renameScene)

  const [tab, setTab] = useState<Tab>(() => tabFromLocation())
  const [draft, setDraft] = useState<AppSettings | null>(null)
  const [dirty, setDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [openaiModelListMode, setOpenaiModelListMode] = useState<OpenaiModelListMode>('catalog')
  const [utilityOpenaiModelListMode, setUtilityOpenaiModelListMode] = useState<OpenaiModelListMode>('catalog')
  const [worldDraft, setWorldDraft] = useState<WorldPreset | null>(null)
  const [personaDraft, setPersonaDraft] = useState<PersonaPreset | null>(null)
  const [personaNickDraft, setPersonaNickDraft] = useState('')
  const [renaming, setRenaming] = useState<'world' | 'persona' | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [sceneRenamingId, setSceneRenamingId] = useState<string | null>(null)
  const [sceneRenameValue, setSceneRenameValue] = useState('')
  const [sceneCaptureName, setSceneCaptureName] = useState('')
  const [sceneLoading, setSceneLoading] = useState<string | null>(null)
  const [convTitles, setConvTitles] = useState<Record<string, string>>({})

  const changeTab = (nextTab: Tab) => {
    setTab(nextTab)
    persistLastSettingsTab(nextTab)
  }

  // API test state
  const [connTesting, setConnTesting] = useState(false)
  const [connResult, setConnResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [msgTesting, setMsgTesting] = useState(false)
  const [msgResult, setMsgResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [utilityConnTesting, setUtilityConnTesting] = useState(false)
  const [utilityConnResult, setUtilityConnResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [dataDir, setDataDir] = useState('')
  const [changingDataDir, setChangingDataDir] = useState(false)
  const [appVersion, setAppVersion] = useState('')
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [windowsStartupSupported, setWindowsStartupSupported] = useState(false)
  const [windowsStartupExists, setWindowsStartupExists] = useState(false)
  const [windowsStartupNeedsUpdate, setWindowsStartupNeedsUpdate] = useState(false)
  const [addingWindowsStartup, setAddingWindowsStartup] = useState(false)
  const [removingWindowsStartup, setRemovingWindowsStartup] = useState(false)
  const [openingWindowsStartupFolder, setOpeningWindowsStartupFolder] = useState(false)
  const [devToolsAvailable, setDevToolsAvailable] = useState(false)
  const [devToolsReveal, setDevToolsReveal] = useState(false)
  const devToolsClickRef = useRef(0)
  const devToolsClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previewAudioRef = useRef<HTMLAudioElement | null>(null)
  const [weatherDetecting, setWeatherDetecting] = useState(false)
  const [weatherGeocoding, setWeatherGeocoding] = useState(false)
  const [weatherCityInput, setWeatherCityInput] = useState('')
  const [weatherMsg, setWeatherMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [weatherFetching, setWeatherFetching] = useState(false)
  const messagePreviewAudioRef = useRef<HTMLAudioElement | null>(null)
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const messagePreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draftRef = useRef<AppSettings | null>(null)
  const dirtyRef = useRef(false)

  // 提醒音效路徑改變時重新建立 Audio 實例（只載入一次）
  const customSoundPath = draft?.ui.reminderNotificationSound?.customSoundPath
  useEffect(() => {
    const audioPath = customSoundPath
      ? `file://${customSoundPath.replace(/\\/g, '/')}`
      : staticFileUrl('notification-sound.wav')
    previewAudioRef.current = new Audio(audioPath)
  }, [customSoundPath])

  // 訊息音效路徑改變時重新建立 Audio 實例（只載入一次）
  const messageCustomSoundPath = draft?.ui.messageNotificationSound?.customSoundPath
  useEffect(() => {
    const audioPath = messageCustomSoundPath
      ? `file://${messageCustomSoundPath.replace(/\\/g, '/')}`
      : staticFileUrl('message-notification-sound.wav')
    messagePreviewAudioRef.current = new Audio(audioPath)
  }, [messageCustomSoundPath])

  useEffect(() => {
    void window.api.invoke('devtools:is-available').then(v => setDevToolsAvailable(v === true))
  }, [])

  // debounce：停止拖動 400ms 後才播放，避免連續觸發
  const playPreviewSound = (volume: number) => {
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current)
    previewTimerRef.current = setTimeout(() => {
      const audio = previewAudioRef.current
      if (!audio) return
      audio.volume = Math.max(0, Math.min(1, volume))
      audio.currentTime = 0
      audio.play().catch((e: unknown) => console.error('[Audio Preview] Play failed:', e))
    }, 400)
  }

  // 訊息音效預覽播放
  const playMessagePreviewSound = (volume: number) => {
    if (messagePreviewTimerRef.current) clearTimeout(messagePreviewTimerRef.current)
    messagePreviewTimerRef.current = setTimeout(() => {
      const audio = messagePreviewAudioRef.current
      if (!audio) return
      audio.volume = Math.max(0, Math.min(1, volume))
      audio.currentTime = 0
      audio.play().catch((e: unknown) => console.error('[Audio Preview] Message sound failed:', e))
    }, 400)
  }

  useEffect(() => {
    persistLastSettingsTab(tab)
  }, [tab])

  useEffect(() => {
    if (tab !== '情境') return
    void (async () => {
      const list = await window.api.invoke('conversation:list') as Array<{ id: string; title: string }>
      setConvTitles(Object.fromEntries(list.map(c => [c.id, c.title])))
    })()
  }, [tab, scenePresets])

  useEffect(() => {
    const unsub = window.api.on('settings:navigate-tab', (t: unknown) => {
      const nextTab = tabFromExternalParam(t)
      setTab(nextTab)
      persistLastSettingsTab(nextTab)
    })
    return unsub
  }, [])

  useEffect(() => {
    void (async () => {
      const result = await window.api.invoke('data:get-dir') as { dataDir?: string }
      setDataDir(typeof result?.dataDir === 'string' ? result.dataDir : '')
    })()
  }, [])

  useEffect(() => {
    void window.api.invoke('app:get-version').then((v: unknown) => {
      if (typeof v === 'string') setAppVersion(v)
    })
  }, [])

  const refreshWindowsStartupStatus = async () => {
    const status = await window.api.invoke('shell:windows-startup-shortcut-status') as {
      supported?: boolean
      exists?: boolean
      needsUpdate?: boolean
    }
    setWindowsStartupSupported(!!status?.supported)
    setWindowsStartupExists(!!status?.exists)
    setWindowsStartupNeedsUpdate(!!status?.needsUpdate)
  }

  useEffect(() => {
    void refreshWindowsStartupStatus()
  }, [])

  const addWindowsStartupShortcut = async () => {
    if (windowsStartupExists && !windowsStartupNeedsUpdate) return
    const wasUpdating = windowsStartupExists && windowsStartupNeedsUpdate
    setAddingWindowsStartup(true)
    try {
      const result = await window.api.invoke('shell:add-windows-startup-shortcut') as {
        ok?: boolean
        error?: string
        path?: string
        updated?: boolean
      }
      if (result?.ok) {
        await refreshWindowsStartupStatus()
        window.alert(wasUpdating
          ? '已更新 Windows 啟動程式中的 DesktopST 捷徑。'
          : '已將 DesktopST 捷徑加入 Windows 啟動程式。下次開機會自動啟動。')
      } else {
        window.alert(result?.error || '加入啟動程式失敗。')
      }
    } finally {
      setAddingWindowsStartup(false)
    }
  }

  const removeWindowsStartupShortcut = async () => {
    if (!windowsStartupExists) return
    setRemovingWindowsStartup(true)
    try {
      const result = await window.api.invoke('shell:remove-windows-startup-shortcut') as {
        ok?: boolean
        error?: string
      }
      if (result?.ok) {
        await refreshWindowsStartupStatus()
      } else {
        window.alert(result?.error || '從啟動程式移除失敗。')
      }
    } finally {
      setRemovingWindowsStartup(false)
    }
  }

  const openWindowsStartupFolder = async () => {
    setOpeningWindowsStartupFolder(true)
    try {
      const result = await window.api.invoke('shell:open-windows-startup-folder') as {
        ok?: boolean
        error?: string
      }
      if (!result?.ok) {
        window.alert(result?.error || '開啟啟動程式資料夾失敗。')
      }
    } finally {
      setOpeningWindowsStartupFolder(false)
    }
  }

  useEffect(() => {
    if (!settings) return
    if (dirty) return  // 用戶正在編輯，不用外部事件覆蓋未儲存的修改
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
  }, [settings, dirty])

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

  // 保持 ref 與最新 state 同步，供 unmount cleanup 使用
  useEffect(() => { draftRef.current = draft }, [draft])
  useEffect(() => { dirtyRef.current = dirty }, [dirty])

  // 視窗關閉前若有未儲存修改，立即觸發儲存（fire-and-forget）
  useEffect(() => {
    return () => {
      if (!dirtyRef.current || !draftRef.current) return
      const data = draftRef.current
      const settingsToSave = JSON.parse(JSON.stringify(data)) as AppSettings
      settingsToSave.llm.model = settingsToSave.llm.models?.[settingsToSave.llm.provider] ?? settingsToSave.llm.model
      window.api.invoke('settings:save', settingsToSave).catch(() => {})
    }
  }, [])

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
      dirtyRef.current = false
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
    setDirty(true)
    const next = JSON.parse(JSON.stringify(draft)) as AppSettings
    if (!next.llm.models) next.llm.models = {}
    next.llm.models[next.llm.provider] = m
    next.llm.model = m
    setDraft(next)
  }

  // Helper: get/set utility model for the currently-selected utility provider
  const getUtilityModel = (): string => {
    const p = draft?.llm.utilityProvider ?? draft?.llm.provider ?? 'openai'
    return draft?.llm.utilityModels?.[p] ?? ''
  }
  const setUtilityModel = (m: string) => {
    if (!draft) return
    setDirty(true)
    const next = JSON.parse(JSON.stringify(draft)) as AppSettings
    const p = next.llm.utilityProvider ?? next.llm.provider
    if (!next.llm.utilityModels) next.llm.utilityModels = {}
    next.llm.utilityModels[p] = m
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
    if (!worldDraft) return
    if (worldPresets.length <= 1) {
      window.alert('至少需要保留一組世界觀。')
      return
    }
    const label = `${worldDraft.name}${worldDraft.builtIn ? '（內建）' : ''}`
    if (!window.confirm(`確定要刪除「${label}」？\n\n此操作無法復原。`)) return
    const deletedId = worldDraft.id
    await deleteWorldPreset(deletedId)
    const remaining = useAppStore.getState().worldPresets.filter(w => w.id !== deletedId)
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
    if (!personaDraft) return
    if (personaPresets.length <= 1) {
      window.alert('至少需要保留一組使用者預設。')
      return
    }
    const label = `${personaDraft.name}${personaDraft.builtIn ? '（內建）' : ''}`
    if (!window.confirm(`確定要刪除「${label}」？\n\n此操作無法復原。`)) return
    const deletedId = personaDraft.id
    await deletePersonaPreset(deletedId)
    const remaining = useAppStore.getState().personaPresets.filter(p => p.id !== deletedId)
    set('activePersonaId', remaining[0]?.id ?? '')
  }

  // ── Scene handlers ──────────────────────────────────────
  const handleCaptureScene = async () => {
    const name = sceneCaptureName.trim() || `情境 ${scenePresets.length + 1}`
    await captureScene(null, name)
    setSceneCaptureName('')
  }

  const handleLoadScene = async (id: string) => {
    setSceneLoading(id)
    try {
      const result = await loadScene(id)
      if ('error' in result) window.alert(result.error)
    } finally {
      setSceneLoading(null)
    }
  }

  const handleDeleteScene = async (scene: ScenePreset) => {
    if (!window.confirm(`確定要刪除情境「${scene.name}」？\n\n此操作無法復原。`)) return
    await deleteScene(scene.id)
  }

  const startSceneRename = (scene: ScenePreset) => {
    setSceneRenamingId(scene.id)
    setSceneRenameValue(scene.name)
  }

  const commitSceneRename = async () => {
    if (sceneRenamingId && sceneRenameValue.trim()) {
      await renameScene(sceneRenamingId, sceneRenameValue.trim())
    }
    setSceneRenamingId(null)
  }

  const handleUpdateScene = async (scene: ScenePreset) => {
    await captureScene(scene.id, scene.name)
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

  const changeDataDir = async () => {
    const summary = await window.api.invoke('data:get-relocate-summary') as {
      dataDir?: string
      estimatedSizeBytes?: number
      characters?: number
      conversations?: number
      personas?: number
      worlds?: number
      pinnedNotes?: number
    }
    const sizeMb = ((summary?.estimatedSizeBytes ?? 0) / (1024 * 1024)).toFixed(2)
    const confirmed = window.confirm(
      [
        '即將搬移以下資料到新位置：',
        `- 目前路徑：${summary?.dataDir ?? (dataDir || '未知')}`,
        `- 角色：${summary?.characters ?? 0} 位`,
        `- 對話：${summary?.conversations ?? 0} 份`,
        `- 使用者預設：${summary?.personas ?? 0} 組`,
        `- 世界觀預設：${summary?.worlds ?? 0} 組`,
        `- 便利貼：${summary?.pinnedNotes ?? 0} 張`,
        `- 預估資料量：約 ${sizeMb} MB`,
        '',
        '是否繼續選擇新的資料夾位置？'
      ].join('\n')
    )
    if (!confirmed) return

    setChangingDataDir(true)
    try {
      const result = await window.api.invoke('data:change-dir') as {
        ok?: boolean
        canceled?: boolean
        error?: string
        dataDir?: string
      }
      if (typeof result?.dataDir === 'string') setDataDir(result.dataDir)
      if (result?.ok) {
        window.alert('資料已搬移到新路徑。')
        return
      }
      if (!result?.canceled) {
        window.alert(result?.error || '修改資料夾位置失敗。')
      }
    } finally {
      setChangingDataDir(false)
    }
  }

  return (
    <div className="w-full h-full flex flex-col bg-bg">
      {/* Title bar */}
      <div className="drag-region flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="font-semibold text-primary no-drag"> 設定</span>
        <div className="flex items-center gap-1 no-drag">
          <button
            type="button"
            className="btn-round w-7 h-7 text-sm no-drag font-bold"
            title="開啟新手教學"
            aria-label="開啟新手教學"
            onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              void window.api.invoke('app:open-getting-started')
            }}
          >
            <span aria-hidden="true">?</span>
          </button>
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
        <div className="flex gap-1 flex-wrap">
          {SCENE_TABS.map(t => (
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
        <div className="px-4 py-3 border-b border-border bg-mint-20 no-drag space-y-3 shrink-0">
          <button
            type="button"
            onClick={() => void window.api.invoke('app:open-getting-started')}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-teal hover:bg-mint font-bold text-primary text-base shadow-sm transition-all cursor-pointer"
          >
            <span aria-hidden="true" className="text-xl">📖</span>
            <span>第一次使用?點我看新手教學</span>
          </button>
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
                  setDirty(true)
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
              <p className="text-[11px] text-secondary mt-1 leading-relaxed">
                金鑰以系統加密儲存於本機。換電腦或重灌系統後無法自動還原，需重新輸入；對話記錄與角色資料不受影響。
              </p>
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
            <Field label="輔助模型">
              <label className="flex items-center gap-2 text-sm text-primary cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={!(draft.llm.utilityEnabled ?? false)}
                  onChange={e => set('llm.utilityEnabled', !e.target.checked)}
                  className="accent-teal"
                />
                情緒分類與提醒沿用扮演模型
              </label>
              <p className="text-[11px] text-secondary leading-snug mt-1">
                群組對話中每位角色的回應一律使用上方扮演主模型。取消勾選後，僅<strong className="text-primary font-medium">定時提醒發話</strong>與<strong className="text-primary font-medium">情緒分類</strong>改由下方輔助模型處理，以節省主模型用量。
              </p>
              {draft.llm.utilityEnabled && (
                <div className="mt-3 space-y-2 pl-2 border-l-2 border-border">
                  <Field label="輔助服務商">
                    <select
                      className="input-field"
                      value={draft.llm.utilityProvider ?? draft.llm.provider}
                      onChange={e => {
                        const p = e.target.value as AppSettings['llm']['provider']
                        setDirty(true)
                        setDraft(prev => {
                          if (!prev) return prev
                          const next = JSON.parse(JSON.stringify(prev)) as AppSettings
                          next.llm.utilityProvider = p
                          if (!next.llm.utilityModels) next.llm.utilityModels = {}
                          if (!next.llm.utilityModels[p]) next.llm.utilityModels[p] = PROVIDER_DEFAULT_MODEL[p] ?? ''
                          return next
                        })
                        // Reset utility OpenAI model list mode when switching provider
                        setUtilityOpenaiModelListMode('catalog')
                      }}
                    >
                      {Object.entries(PROVIDER_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label={`輔助 API Key（${PROVIDER_LABELS[draft.llm.utilityProvider ?? draft.llm.provider]}）`}>
                    <input
                      type="password"
                      className="input-field"
                      value={draft.llm.apiKeys?.[draft.llm.utilityProvider ?? draft.llm.provider] ?? ''}
                      onChange={e => set(`llm.apiKeys.${draft.llm.utilityProvider ?? draft.llm.provider}`, e.target.value)}
                      placeholder={PROVIDER_KEY_PLACEHOLDER[draft.llm.utilityProvider ?? draft.llm.provider] ?? 'API Key'}
                    />
                    <div className="flex gap-2 mt-2 items-center flex-wrap">
                      <button
                        type="button"
                        disabled={utilityConnTesting || !(draft.llm.apiKeys?.[draft.llm.utilityProvider ?? draft.llm.provider] ?? '').trim()}
                        className="text-xs px-3 py-1.5 rounded-full bg-mint font-semibold text-primary disabled:opacity-40 disabled:cursor-not-allowed hover:bg-teal transition-all"
                        onClick={async () => {
                          setUtilityConnTesting(true)
                          setUtilityConnResult(null)
                          try {
                            const r = await window.api.invoke('llm:test-connection', {
                              provider: draft.llm.utilityProvider ?? draft.llm.provider,
                              apiKeys: draft.llm.apiKeys,
                              endpoint: draft.llm.endpoint
                            }) as { ok: boolean; error?: string; models?: string[] }
                            setUtilityConnResult(r.ok
                              ? { ok: true, msg: '已驗證' }
                              : { ok: false, msg: r.error || '連線失敗' })
                          } catch (e: any) {
                            setUtilityConnResult({ ok: false, msg: e?.message || '未知錯誤' })
                          } finally {
                            setUtilityConnTesting(false)
                          }
                        }}
                      >
                        {utilityConnTesting ? '驗證中...' : '連線'}
                      </button>
                      {utilityConnResult && (
                        <span className={`text-xs ${utilityConnResult.ok ? 'text-[#4CAF50]' : 'text-[#E85D3F]'}`}>
                          {utilityConnResult.ok ? '●' : '●'} {utilityConnResult.msg}
                        </span>
                      )}
                    </div>
                  </Field>
                  {(draft.llm.utilityProvider ?? draft.llm.provider) === 'openai' && (
                    <Field label="模型建議清單">
                      <select
                        className="input-field"
                        value={utilityOpenaiModelListMode}
                        onChange={e => setUtilityOpenaiModelListMode(e.target.value as OpenaiModelListMode)}
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
                  <Field label="輔助模型（可手動輸入自訂 ID）">
                    <input
                      type="text"
                      className="input-field"
                      list="utility-model-list"
                      value={getUtilityModel()}
                      onChange={e => setUtilityModel(e.target.value)}
                      placeholder="輸入或選擇輔助模型 ID"
                    />
                    <div className="mt-2">
                      <select
                        className="input-field"
                        value=""
                        onChange={e => {
                          const v = e.target.value
                          if (v) setUtilityModel(v)
                          e.currentTarget.value = ''
                        }}
                      >
                        <option value="">快速挑選</option>
                        {((draft.llm.utilityProvider ?? draft.llm.provider) === 'openai'
                          ? openaiModelOptionsFor(utilityOpenaiModelListMode)
                          : PROVIDER_MODELS[draft.llm.utilityProvider ?? draft.llm.provider] ?? MODELS
                        ).map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>
                    <datalist id="utility-model-list">
                      {((draft.llm.utilityProvider ?? draft.llm.provider) === 'openai'
                        ? openaiModelOptionsFor(utilityOpenaiModelListMode)
                        : PROVIDER_MODELS[draft.llm.utilityProvider ?? draft.llm.provider] ?? MODELS
                      ).map(m => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                  </Field>
                </div>
              )}
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
              <p className="text-[11px] text-secondary leading-snug mt-1.5">
                控制每次送出訊息後，群組模式最多幾位角色會回應（含第一位）；數值越大，對話越熱鬧但 token 消耗也越高。
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

        {tab === '情境' && (() => {
          // Color theme display map
          const THEME_META: Record<string, { label: string; color: string; dark?: boolean }> = {
            mint:     { label: '薄荷',   color: '#CBFBC4' },
            butter:   { label: '奶油黃', color: '#FFE8AA' },
            peach:    { label: '粉橘',   color: '#FFD6B8' },
            aqua:     { label: '粉藍綠', color: '#B8F4EA' },
            sky:      { label: '天藍',   color: '#AAEEFF' },
            blush:    { label: '粉紅',   color: '#FFBBBB' },
            lavender: { label: '薰衣草', color: '#F0BBFF' },
            white:    { label: '純白',   color: '#E8E8E8' },
            dark:     { label: '黑底白字', color: '#252525', dark: true },
          }
          return (
            <>
              {/* Capture new scene */}
              <div className="border border-border rounded-2xl p-3 space-y-2 bg-mint-20">
                <p className="text-xs font-semibold text-primary">儲存目前狀態為新情境</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="input-field flex-1 text-xs"
                    placeholder={`情境 ${scenePresets.length + 1}`}
                    value={sceneCaptureName}
                    onChange={e => setSceneCaptureName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') void handleCaptureScene() }}
                  />
                  <button
                    type="button"
                    className="text-xs px-3 py-1.5 rounded-full bg-teal font-semibold text-primary hover:bg-mint transition-all shrink-0"
                    onClick={() => void handleCaptureScene()}
                  >
                    儲存情境
                  </button>
                </div>
                <p className="text-[11px] text-secondary leading-snug">
                  會記錄：目前世界觀、使用者設定、桌面角色位置與大小、對話記錄、介面色彩、視窗位置。
                </p>
              </div>

              {/* Scene list */}
              {scenePresets.length === 0 ? (
                <p className="text-sm text-secondary text-center py-6">尚無情境。點上方「儲存情境」建立第一個。</p>
              ) : (
                <div className="space-y-2">
                  {scenePresets.slice().sort((a, b) => b.updatedAt - a.updatedAt).map(scene => {
                    const isActive = draft.activeSceneId === scene.id
                    const isLoading = sceneLoading === scene.id
                    const isRenaming = sceneRenamingId === scene.id
                    const themeMeta = THEME_META[scene.colorTheme ?? 'mint'] ?? THEME_META.mint
                    const worldName = worldPresets.find(w => w.id === scene.activeWorldId)?.name
                    const personaName = personaPresets.find(p => p.id === scene.activePersonaId)?.displayName
                    const convTitle = scene.lastActiveConversationId
                      ? (convTitles[scene.lastActiveConversationId] ?? null)
                      : null
                    const charNames = scene.desktopCharacters
                      .map(d => characters.find(c => c.id === d.characterId)?.name)
                      .filter(Boolean) as string[]
                    return (
                      <div
                        key={scene.id}
                        className={`rounded-2xl overflow-hidden transition-all ${isActive ? 'ring-2 ring-teal' : 'border border-border'}`}
                      >
                        {/* Color accent bar */}
                        <div
                          className="h-1.5 w-full"
                          style={{ backgroundColor: themeMeta.color }}
                        />
                        <div className="p-3 space-y-2">
                          {/* Name row */}
                          <div className="flex items-center gap-2 min-w-0">
                            {isActive && (
                              <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal text-primary">使用中</span>
                            )}
                            {isRenaming ? (
                              <input
                                type="text"
                                className="input-field text-xs flex-1 min-w-0"
                                value={sceneRenameValue}
                                onChange={e => setSceneRenameValue(e.target.value)}
                                onBlur={() => void commitSceneRename()}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') void commitSceneRename()
                                  if (e.key === 'Escape') setSceneRenamingId(null)
                                }}
                                autoFocus
                              />
                            ) : (
                              <span className="text-sm font-semibold text-primary flex-1 min-w-0 truncate">{scene.name}</span>
                            )}
                          </div>

                          {/* Meta info */}
                          <div className="text-[11px] text-secondary space-y-0.5 leading-snug">
                            {worldName && <div><span className="text-primary/60">世界觀：</span>{worldName}</div>}
                            {personaName && <div><span className="text-primary/60">使用者：</span>{personaName}</div>}
                            {convTitle && <div className="truncate"><span className="text-primary/60">對話：</span>{convTitle}</div>}
                            {charNames.length > 0 && (
                              <div className="truncate"><span className="text-primary/60">角色：</span>{charNames.join('、')}</div>
                            )}
                            <div className="flex items-center gap-1.5 pt-0.5">
                              <span
                                className="inline-block w-2.5 h-2.5 rounded-full border border-black/10 shrink-0"
                                style={{ backgroundColor: themeMeta.color }}
                              />
                              <span>{new Date(scene.updatedAt).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                          </div>

                          {/* Action buttons */}
                          <div className="flex gap-1.5 flex-wrap">
                            {!isActive && (
                              <button
                                type="button"
                                disabled={isLoading}
                                className="text-xs px-2.5 py-1 rounded-full bg-teal font-semibold text-primary hover:bg-mint transition-all disabled:opacity-50"
                                onClick={() => void handleLoadScene(scene.id)}
                              >
                                {isLoading ? '切換中…' : '切換'}
                              </button>
                            )}
                            <button
                              type="button"
                              title="把目前桌面的角色位置、世界觀、對話等狀態覆寫進這個情境"
                              className="text-xs px-2.5 py-1 rounded-full border border-border text-primary hover:bg-mint-40 transition-all"
                              onClick={() => void handleUpdateScene(scene)}
                            >
                              覆寫為目前狀態
                            </button>
                            {!isRenaming && (
                              <button
                                type="button"
                                className="text-xs px-2.5 py-1 rounded-full border border-border text-primary hover:bg-mint-40 transition-all"
                                onClick={() => startSceneRename(scene)}
                              >
                                重新命名
                              </button>
                            )}
                            <button
                              type="button"
                              className="text-xs px-2.5 py-1 rounded-full border border-[#FFBBBB] text-[#E85D3F] hover:bg-[#FFBBBB]/30 transition-all"
                              onClick={() => void handleDeleteScene(scene)}
                            >
                              刪除
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )
        })()}

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
                  {worldPresets.length > 1 && (
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

            {/* 天氣設定 */}
            <div className="border-t border-border pt-3 space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.weather?.enabled ?? false}
                  onChange={e => set('weather.enabled', e.target.checked)}
                  disabled={!(draft.weather?.locationName)}
                  className="accent-teal w-4 h-4 disabled:opacity-40"
                />
                <span className={`text-sm ${draft.weather?.locationName ? 'text-primary' : 'text-secondary'}`}>
                  對話中自動帶入天氣資訊
                </span>
                {!draft.weather?.locationName && (
                  <span className="text-[11px] text-secondary">（請先設定位置）</span>
                )}
              </label>

              <div className="space-y-2">
                <p className="text-xs font-semibold text-primary">位置設定</p>
                <div className="flex gap-2 flex-wrap">
                  <button
                    type="button"
                    disabled={weatherDetecting}
                    className="text-xs px-3 py-1.5 rounded-full bg-mint font-semibold text-primary hover:bg-teal transition-all disabled:opacity-50"
                    onClick={async () => {
                      setWeatherDetecting(true)
                      setWeatherMsg(null)
                      try {
                        const result = await window.api.invoke('weather:detect-ip') as { city: string; lat: number; lon: number } | null
                        if (!result) { setWeatherMsg({ type: 'err', text: '偵測失敗，請手動輸入城市名稱' }); return }
                        set('weather.locationName', result.city)
                        set('weather.latitude', result.lat)
                        set('weather.longitude', result.lon)
                        set('weather.locationSource', 'ip')
                        setWeatherMsg({ type: 'ok', text: `已偵測到：${result.city}` })
                      } finally {
                        setWeatherDetecting(false)
                      }
                    }}
                  >
                    {weatherDetecting ? '偵測中…' : '自動偵測位置（IP）'}
                  </button>
                </div>

                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    placeholder="手動輸入城市名稱，例：Tokyo"
                    className="input-field flex-1 text-sm"
                    value={weatherCityInput}
                    onChange={e => setWeatherCityInput(e.target.value)}
                    onKeyDown={async e => {
                      if (e.key !== 'Enter' || !weatherCityInput.trim() || weatherGeocoding) return
                      setWeatherGeocoding(true)
                      setWeatherMsg(null)
                      try {
                        const result = await window.api.invoke('weather:geocode', weatherCityInput.trim()) as { name: string; lat: number; lon: number } | null
                        if (!result) { setWeatherMsg({ type: 'err', text: '找不到該城市，請換個名稱試試' }); return }
                        set('weather.locationName', result.name)
                        set('weather.latitude', result.lat)
                        set('weather.longitude', result.lon)
                        set('weather.locationSource', 'manual')
                        setWeatherMsg({ type: 'ok', text: `已設定：${result.name}` })
                        setWeatherCityInput('')
                      } finally {
                        setWeatherGeocoding(false)
                      }
                    }}
                  />
                  <button
                    type="button"
                    disabled={weatherGeocoding || !weatherCityInput.trim()}
                    className="text-xs px-3 py-1.5 rounded-full bg-mint font-semibold text-primary hover:bg-teal transition-all disabled:opacity-50 shrink-0"
                    onClick={async () => {
                      if (!weatherCityInput.trim() || weatherGeocoding) return
                      setWeatherGeocoding(true)
                      setWeatherMsg(null)
                      try {
                        const result = await window.api.invoke('weather:geocode', weatherCityInput.trim()) as { name: string; lat: number; lon: number } | null
                        if (!result) { setWeatherMsg({ type: 'err', text: '找不到該城市，請換個名稱試試' }); return }
                        set('weather.locationName', result.name)
                        set('weather.latitude', result.lat)
                        set('weather.longitude', result.lon)
                        set('weather.locationSource', 'manual')
                        setWeatherMsg({ type: 'ok', text: `已設定：${result.name}` })
                        setWeatherCityInput('')
                      } finally {
                        setWeatherGeocoding(false)
                      }
                    }}
                  >
                    {weatherGeocoding ? '查詢中…' : '查詢'}
                  </button>
                </div>

                {draft.weather?.locationName && (
                  <p className="text-xs text-secondary">
                    目前位置：<span className="text-primary font-medium">{draft.weather.locationName}</span>
                    {draft.weather.locationSource === 'ip' ? '（自動偵測）' : draft.weather.locationSource === 'manual' ? '（手動設定）' : ''}
                    {' '}
                    <button
                      type="button"
                      className="text-xs text-teal underline ml-1"
                      disabled={weatherFetching}
                      onClick={async () => {
                        setWeatherFetching(true)
                        setWeatherMsg(null)
                        try {
                          const data = await window.api.invoke('weather:fetch-now') as { description: string; temperatureC: number; humidity: number; windSpeed: number } | null
                          if (!data) { setWeatherMsg({ type: 'err', text: '天氣抓取失敗' }); return }
                          setWeatherMsg({ type: 'ok', text: `${data.description} ${data.temperatureC}°C 濕度 ${data.humidity}%` })
                        } finally {
                          setWeatherFetching(false)
                        }
                      }}
                    >
                      {weatherFetching ? '更新中…' : '立即更新天氣'}
                    </button>
                  </p>
                )}

                {weatherMsg && (
                  <p className={`text-xs ${weatherMsg.type === 'ok' ? 'text-teal' : 'text-[#E85D3F]'}`}>
                    {weatherMsg.text}
                  </p>
                )}
              </div>

              <label className={`flex items-center gap-2 cursor-pointer ${!draft.llm.utilityEnabled ? 'opacity-40' : ''}`}>
                <input
                  type="checkbox"
                  checked={draft.weather?.polish ?? false}
                  onChange={e => set('weather.polish', e.target.checked)}
                  disabled={!draft.llm.utilityEnabled}
                  className="accent-teal w-4 h-4"
                />
                <span className="text-sm text-primary">用輔助模型潤飾天氣描述</span>
                {!draft.llm.utilityEnabled && (
                  <span className="text-[11px] text-secondary">（需先啟用輔助模型）</span>
                )}
              </label>
            </div>
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
                  {personaPresets.length > 1 && (
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
                <div className="space-y-1">
                  <label className="text-xs font-medium text-secondary">其他稱呼（選填）</label>
                  <p className="text-[11px] text-secondary">角色可能用的其他方式稱呼你，例如綽號、全名等。按 Enter 新增。</p>
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {(personaDraft.nicknames ?? []).map((n, idx) => (
                      <span key={`${n}-${idx}`} className="inline-flex items-center gap-1 rounded-full bg-mint-30 border border-border px-2.5 py-0.5 text-xs text-primary">
                        {n}
                        <button
                          type="button"
                          onClick={() => setPersonaDraft(prev => prev ? { ...prev, nicknames: (prev.nicknames ?? []).filter((_, i) => i !== idx) } : prev)}
                          className="text-secondary hover:text-primary leading-none"
                          title="移除"
                        >×</button>
                      </span>
                    ))}
                  </div>
                  <input
                    type="text"
                    maxLength={40}
                    className="input-field"
                    placeholder="輸入後按 Enter"
                    value={personaNickDraft}
                    onChange={e => setPersonaNickDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        const v = personaNickDraft.trim()
                        if (!v) return
                        setPersonaDraft(prev => {
                          if (!prev) return prev
                          if ((prev.nicknames ?? []).includes(v)) return prev
                          return { ...prev, nicknames: [...(prev.nicknames ?? []), v] }
                        })
                        setPersonaNickDraft('')
                      }
                    }}
                    onBlur={() => {
                      const v = personaNickDraft.trim()
                      if (!v) return
                      setPersonaDraft(prev => {
                        if (!prev) return prev
                        if ((prev.nicknames ?? []).includes(v)) return prev
                        return { ...prev, nicknames: [...(prev.nicknames ?? []), v] }
                      })
                      setPersonaNickDraft('')
                    }}
                  />
                </div>
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
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.ui.alwaysOnTop ?? true}
                onChange={e => set('ui.alwaysOnTop', e.target.checked)}
                className="accent-teal w-4 h-4"
              />
              <span className="text-sm text-primary">角色視窗永遠顯示在最上層</span>
            </label>
            {!(draft.ui.alwaysOnTop ?? true) && (
              <p className="text-xs text-secondary ml-6">關閉後角色會被全螢幕視窗或其他應用程式蓋住；也可從 Tray 圖示快速切換。</p>
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

            <div className="border-t border-border pt-3" />
            <p className="text-xs font-medium text-secondary">對話泡泡</p>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.ui.chatBubbleAutoClose?.enabled ?? false}
                onChange={e => {
                  if (e.target.checked) {
                    set('ui.chatBubbleAutoClose', { enabled: true, seconds: draft.ui.chatBubbleAutoClose?.seconds ?? 8 })
                  } else {
                    set('ui.chatBubbleAutoClose', { enabled: false, seconds: draft.ui.chatBubbleAutoClose?.seconds ?? 8 })
                  }
                }}
                className="accent-teal w-4 h-4"
              />
              <span className="text-sm text-primary">顯示</span>
              <input
                type="number"
                min={1}
                max={120}
                value={draft.ui.chatBubbleAutoClose?.seconds ?? 8}
                onChange={e => {
                  const seconds = Math.max(1, Math.min(120, Number(e.target.value)))
                  set('ui.chatBubbleAutoClose', { enabled: draft.ui.chatBubbleAutoClose?.enabled ?? false, seconds })
                }}
                className="input-field w-16 text-center text-sm px-2 py-1"
              />
              <span className="text-sm text-primary">秒後自動消失</span>
            </label>
            <p className="text-xs text-secondary ml-6">不勾選的話，對話泡泡會一直留在畫面上，直到手動關閉或下一句對話出現。</p>

            <div className="border-t border-border pt-3" />
            <p className="text-xs font-medium text-secondary">截圖</p>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.ui.screenshotIncludeInputWindow ?? false}
                onChange={e => set('ui.screenshotIncludeInputWindow', e.target.checked)}
                className="accent-teal w-4 h-4"
              />
              <span className="text-sm text-primary">保留DesktopST截圖時連對話框一起截進去</span>
            </label>
            <p className="text-xs text-secondary ml-6">勾選後，使用「保留DesktopST角色」截圖模式時會連同輸入框顯示；不勾選則只截圖角色。</p>

            <div className="border-t border-border pt-3" />
            <p className="text-xs font-medium text-secondary">提醒通知</p>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.ui.reminderNotificationSound?.enabled ?? true}
                onChange={e => {
                  set('ui.reminderNotificationSound', {
                    enabled: e.target.checked,
                    volume: draft.ui.reminderNotificationSound?.volume ?? 0.7
                  })
                }}
                className="accent-teal w-4 h-4"
              />
              <span className="text-sm text-primary">觸發提醒時播放通知音</span>
            </label>
            {draft.ui.reminderNotificationSound?.enabled !== false && (
              <div className="ml-6 space-y-2">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-secondary">音量：</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round((draft.ui.reminderNotificationSound?.volume ?? 0.7) * 100)}
                    onChange={e => {
                      const volume = Number(e.target.value) / 100
                      set('ui.reminderNotificationSound', {
                        enabled: draft.ui.reminderNotificationSound?.enabled ?? true,
                        volume
                      })
                      // 播放試聽音效
                      playPreviewSound(volume)
                    }}
                    className="flex-1 accent-teal"
                  />
                  <span className="text-xs text-secondary w-8 text-right">{Math.round((draft.ui.reminderNotificationSound?.volume ?? 0.7) * 100)}%</span>
                </div>
                <button
                  type="button"
                  className="text-xs px-3 py-1.5 rounded-full border border-border text-primary hover:bg-mint-40 transition-all"
                  onClick={() => window.api.invoke('audio:select-notification-sound')}
                >
                  選擇自訂音效
                </button>
                {draft.ui.reminderNotificationSound?.customSoundPath && (
                  <p className="text-xs text-secondary break-all">
                    目前：{draft.ui.reminderNotificationSound.customSoundPath.split(/[/\\]/).pop()}
                  </p>
                )}
              </div>
            )}

            <div className="border-t border-border pt-3 mt-1" />
            <p className="text-xs font-medium text-secondary">閒置偵測</p>
            <label className="flex items-center gap-2">
              <span className="text-sm text-primary">電腦閒置超過</span>
              <input
                type="number"
                min={0}
                max={480}
                step={5}
                value={draft.ui.reminderIdleSkipMinutes ?? 0}
                onChange={e => set('ui.reminderIdleSkipMinutes', Math.max(0, Number(e.target.value)))}
                className="input-field w-16 text-center text-sm px-2 py-1"
              />
              <span className="text-sm text-primary">分鐘時，略過提醒</span>
            </label>
            <p className="text-xs text-secondary">設為 0 表示不偵測，提醒一律觸發。</p>

            <div className="border-t border-border pt-3 mt-3" />
            <p className="text-xs font-medium text-secondary">訊息通知</p>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.ui.messageNotificationSound?.enabled ?? true}
                onChange={e => {
                  set('ui.messageNotificationSound', {
                    enabled: e.target.checked,
                    volume: draft.ui.messageNotificationSound?.volume ?? 0.7
                  })
                }}
                className="accent-teal w-4 h-4"
              />
              <span className="text-sm text-primary">收到訊息時播放通知音</span>
            </label>
            {draft.ui.messageNotificationSound?.enabled !== false && (
              <div className="ml-6 space-y-2">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-secondary">音量：</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round((draft.ui.messageNotificationSound?.volume ?? 0.7) * 100)}
                    onChange={e => {
                      const volume = Number(e.target.value) / 100
                      set('ui.messageNotificationSound', {
                        enabled: draft.ui.messageNotificationSound?.enabled ?? true,
                        volume
                      })
                      // 播放試聽音效
                      playMessagePreviewSound(volume)
                    }}
                    className="flex-1 accent-teal"
                  />
                  <span className="text-xs text-secondary w-8 text-right">{Math.round((draft.ui.messageNotificationSound?.volume ?? 0.7) * 100)}%</span>
                </div>
                <button
                  type="button"
                  className="text-xs px-3 py-1.5 rounded-full border border-border text-primary hover:bg-mint-40 transition-all"
                  onClick={() => window.api.invoke('audio:select-message-notification-sound')}
                >
                  選擇自訂音效
                </button>
                {draft.ui.messageNotificationSound?.customSoundPath && (
                  <p className="text-xs text-secondary break-all">
                    目前：{draft.ui.messageNotificationSound.customSoundPath.split(/[/\\]/).pop()}
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {tab === '資料' && (
          <div className="space-y-3">
            <p className="text-sm text-secondary">所有資料存放於：</p>
            <p className="text-xs font-mono bg-surface border border-border rounded-lg px-3 py-2 text-primary break-all">
              {dataDir || '讀取中...'}
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                className="btn-round w-auto px-4 rounded-full h-auto py-2 text-sm"
                onClick={() => window.api.invoke('window:open-data-folder')}
                disabled={changingDataDir}
              >
                開啟資料夾
              </button>
              <button
                type="button"
                className="btn-round w-auto px-4 rounded-full h-auto py-2 text-sm"
                onClick={() => void changeDataDir()}
                disabled={changingDataDir}
              >
                {changingDataDir ? '搬移中...' : '修改資料夾位置'}
              </button>
            </div>
          </div>
        )}

        {tab === '關於' && (
          <div className="space-y-4">
            <div className="rounded-xl bg-surface border border-border px-4 py-3 space-y-0.5">
              <p className="text-xs text-secondary">目前版本</p>
              <p
                className="text-base font-semibold text-primary select-none"
                role={devToolsAvailable ? 'button' : undefined}
                tabIndex={devToolsAvailable ? 0 : undefined}
                onClick={() => {
                  if (!devToolsAvailable) return
                  if (devToolsClickTimerRef.current) clearTimeout(devToolsClickTimerRef.current)
                  devToolsClickRef.current += 1
                  if (devToolsClickRef.current >= 5) {
                    devToolsClickRef.current = 0
                    setDevToolsReveal(true)
                    return
                  }
                  devToolsClickTimerRef.current = setTimeout(() => {
                    devToolsClickRef.current = 0
                  }, 2000)
                }}
                onKeyDown={e => {
                  if (!devToolsAvailable || e.key !== 'Enter') return
                  e.currentTarget.click()
                }}
              >
                DesktopST{appVersion ? ` v${appVersion}` : ''}
              </p>
              {devToolsAvailable && devToolsReveal && (
                <button
                  type="button"
                  className="mt-2 text-xs text-secondary hover:text-primary underline"
                  onClick={() => void window.api.invoke('devtools:toggle')}
                >
                  切換此視窗開發者工具
                </button>
              )}
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-primary">
              <input
                type="checkbox"
                checked={draft?.updates?.checkOnStartup !== false}
                onChange={e => setDraft(prev => prev ? {
                  ...prev,
                  updates: { ...prev.updates, checkOnStartup: e.target.checked }
                } : prev)}
              />
              啟動時自動檢查更新
            </label>
            {windowsStartupSupported && (
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="btn-round w-auto px-4 rounded-full h-auto py-2 text-sm"
                    disabled={addingWindowsStartup || removingWindowsStartup}
                    onClick={() => {
                      if (windowsStartupExists && !windowsStartupNeedsUpdate) {
                        void removeWindowsStartupShortcut()
                      } else {
                        void addWindowsStartupShortcut()
                      }
                    }}
                  >
                    {addingWindowsStartup || removingWindowsStartup
                      ? '處理中...'
                      : windowsStartupExists && windowsStartupNeedsUpdate
                        ? '更新 Windows 啟動捷徑'
                        : windowsStartupExists
                          ? '從 Windows 啟動程式移除'
                          : '加到 Windows 啟動程式'}
                  </button>
                  <button
                    type="button"
                    className="btn-round w-auto px-4 rounded-full h-auto py-2 text-sm"
                    disabled={openingWindowsStartupFolder}
                    onClick={() => void openWindowsStartupFolder()}
                  >
                    {openingWindowsStartupFolder ? '開啟中...' : '開啟啟動程式資料夾'}
                  </button>
                </div>
                <p className="text-[11px] text-secondary leading-snug">
                  {windowsStartupNeedsUpdate
                    ? '目前的啟動捷徑是舊格式；更新後會修正目標、工作目錄與圖示。'
                    : '在啟動資料夾建立 DesktopST 捷徑（等同 Win+R → shell:startup 後手動放入）。不會自動啟用，需你按此按鈕一次。'}
                </p>
              </div>
            )}
            <button
              className="btn-round w-auto px-4 rounded-full h-auto py-2 text-sm"
              disabled={checkingUpdate}
              onClick={async () => {
                setCheckingUpdate(true)
                await window.api.invoke('updates:check-now')
                setCheckingUpdate(false)
              }}
            >
              {checkingUpdate ? '檢查中...' : '立即檢查更新'}
            </button>
            <div className="text-xs text-secondary space-y-2 mt-6 pt-6 border-t border-border">
              <p>
                本程式採作者<strong className="text-primary font-medium">自訂授權條款</strong>
                （非標準 MIT／CC）。
              </p>
              <button
                type="button"
                className="btn-round w-auto px-4 rounded-full h-auto py-2 text-sm"
                onClick={() => void window.api.invoke('shell:open-external', DESKTOPST_LICENSE_URL)}
              >
                查看完整授權條款
              </button>
              <div className="space-y-0.5 pt-0.5">
                <p>作者：Nori</p>
                <p>
                  網站：
                  <a
                    className="ml-1 underline hover:no-underline text-primary"
                    href="https://nori.tw"
                    target="_blank"
                    rel="noreferrer"
                  >
                    https://nori.tw
                  </a>
                </p>
                <p className="break-all">
                  授權全文：
                  <a
                    className="ml-1 underline hover:no-underline text-primary"
                    href={DESKTOPST_LICENSE_URL}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {DESKTOPST_LICENSE_URL}
                  </a>
                </p>
              </div>
            </div>
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
