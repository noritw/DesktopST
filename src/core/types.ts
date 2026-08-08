export interface Character {
  id: string
  name: string
  nicknames?: string[]
  avatar: string
  description: string
  personality: string
  firstMessage: string
  exampleDialogue: string
  emotions: Record<string, string>
  spriteIds?: Record<string, string>
  scenario?: string
  systemPromptOverride?: string
  creatorNotes?: string
  /** 角色自帶新聞興趣關鍵字（疊加在當前興趣池上，普通權重）。純字串、不帶權重。 */
  newsKeywords?: string[]
  lorebook?: null
  /** 角色卡掛的用語解說 id（疊加，注入時排在世界觀之前）。見 docs/future-lorebook.md §4.2 */
  lorebookIds?: string[]
  lastDesktopSize?: number
  lastDesktopFlipped?: boolean
  lastDesktopPosition?: { x: number; y: number }
  createdAt: number
  updatedAt: number
}

/** 新聞陪聊 debug 資訊（保留最近一則，供 Log 視窗「新聞」分頁顯示）。 */
export interface NewsDebugInfo {
  /** 當前情境綁定的關鍵字組名稱（未綁則為「預設組」）。 */
  groupName: string
  /** 當前發話角色的 newsKeywords（疊加來源）。 */
  characterKeywords: string[]
  /** collectInterestTerms 解析出的有效興趣詞池（組 + 角色合並、去重）。 */
  interestTerms: string[]
  /** 本次選中的新聞；未選到 / 主題模式時為 null。 */
  item: {
    title: string; source: string; keyword?: string; url: string; summary?: string
    /**
     * 標題主觀／情緒程度評分（0~5，由輔助模型輕量分類；僅供觀察記錄，不參與篩選）。
     * 分類失敗或未啟用時為 undefined。
     */
    subjectivityScore?: number
    /** 評分理由（繁中、簡短）。 */
    subjectivityReason?: string
  } | null
  fromTopic: boolean
  /** news=純新聞 / topic=釘住話題 / survey=新聞+便利貼讓角色選 / notes=只有便利貼 / none=沒有候選素材 */
  mode: 'news' | 'topic' | 'survey' | 'notes' | 'none'
}

/** 新聞發話的原文連結中繼資料（保留最近數則，供事後從對話記錄重開泡泡時還原連結卡與互動按鈕）。 */
export interface NewsLinkInfo {
  id: string
  sourceId: string
  title: string
  url: string
  summary: string
  source: string
  keyword?: string
  /**
   * 實際進 Prompt 的上下文（全文節錄／輔助模型大意／使用者改過的版本）。
   * UI 聊天泡泡只顯示 title；點標題可開面板編輯此欄。
   */
  promptContext?: string
}

export interface Message {
  id: string
  role: 'user' | 'character' | 'system'
  characterId?: string
  /**
   * 這則使用者訊息是用哪個「使用者身分」發的（發話當下的顯示名，快照式保存）。
   *
   * 存名字而不是 id：身分可以被改名或刪除，但當時的對話記錄應該保持原樣 ——
   * 玩角色扮演切了好幾個身分之後，回頭看要知道「這句是誰說的」。
   * 舊訊息沒有這個欄位，UI 就不顯示（不要拿目前使用中的身分去補，那會是錯的）。
   */
  personaName?: string
  content: string
  llmProvider?: 'openai' | 'claude' | 'gemini' | 'grok'
  llmModel?: string
  debugPrompt?: string
  emotion?: string
  images?: string[]
  randomResult?: RandomResult
  randomResults?: RandomResult[]
  timestamp: number
  inputTokens?: number
  outputTokens?: number
  utilityInputTokens?: number
  utilityOutputTokens?: number
  utilityDebugPrompt?: string
  /** 對話新聞搜尋：意圖萃取 LLM call 的完整 prompt。 */
  convSearchDebugPrompt?: string
  convSearchInputTokens?: number
  convSearchOutputTokens?: number
  /** 輕量旗標：此訊息是否保有完整 debug prompt（廣播時不剝除，供 renderer 決定是否顯示「查看完整 Prompt」）。 */
  hasDebugPrompt?: boolean
  /** 新聞陪聊 debug（保留最近一則）。 */
  newsDebug?: NewsDebugInfo
  /** 輕量旗標：此訊息是否保有 newsDebug。 */
  hasNewsDebug?: boolean
  /** 新聞發話的原文連結資料（保留最近數則，供對話記錄重開泡泡時還原連結卡與互動按鈕）。 */
  newsLink?: NewsLinkInfo
  /** 使用者對這則角色訊息按的 emoji reaction（單選，限 MESSAGE_REACTION_EMOJIS）。 */
  reaction?: string
  /** 排除於記憶外：不進 prompt 上下文（不佔 keepRecentN 名額）、也不被記憶摘要收錄 */
  excludeFromContext?: boolean
}

/** 訊息 reaction 的固定 emoji 集（泡泡 / Log 視窗共用；😒 對新聞訊息兼作「主題沒興趣」回饋）。 */
export const MESSAGE_REACTION_EMOJIS = ['❤️', '👍', '😂', '🥺', '😮', '😒'] as const

export interface Conversation {
  id: string
  title: string
  participantIds: string[]
  messages: Message[]
  /** 記憶摘要：超出 keepRecentN 的舊訊息濃縮結果（自動或手動產生，使用者可直接編輯） */
  summary: string
  /** 摘要已涵蓋到哪個時間點（最後一則被濃縮訊息的 timestamp）；訊息被刪除也不受影響 */
  summaryCoversTs?: number
  /**
   * 這則對話是 S1 從電腦匯入來的（roadmap §4.7）。
   *
   * 存來源 id 而不是沿用它當本地 id：手機上可能已經有同 id 的對話，
   * 而且同一則從兩台電腦匯入時要分得開。S2 雙向同步靠這個找到對應的那一則；
   * 匯入畫面也用它標出「已經帶過來了」，避免重複拉一份。
   */
  importedFrom?: ConversationImportSource
  createdAt: number
  updatedAt: number
}

export interface ConversationImportSource {
  /** 電腦端的 conversation id */
  sourceId: string
  /**
   * 匯入當下**電腦那份**的 `updatedAt`。
   * S2 判斷「電腦端有沒有變動過」要比對這個，不是本地的 `updatedAt`
   * —— 本地那個一被使用者接著聊天就會往前跑。
   */
  sourceUpdatedAt: number
  importedAt: number
}

export interface DesktopCharacterState {
  characterId: string
  position: { x: number; y: number }
  size: number
  flipped: boolean
  muted: boolean
  zIndex: number
}

export interface WindowBoundsState {
  x: number
  y: number
  width: number
  height: number
}

export interface PinnedNote {
  id: string
  characterId: string
  title: string
  content: string
  color: string           // 便利貼背景色，e.g. '#FFE8AA'
  visible: boolean        // true=貼在桌面；false=收回管理介面
  position: { x: number; y: number }
  size?: { width: number; height: number }
  fontSize?: number       // 便利貼內文字級（px），未設定時 fallback 到全域字級
  updatedAt: number
}

export interface PersonaPreset {
  id: string
  name: string
  displayName: string
  nickname: string
  nicknames?: string[]
  description: string
  builtIn?: boolean
  createdAt: number
  updatedAt: number
}

export interface WorldPreset {
  id: string
  name: string
  worldSetting: string
  interactionExample: string
  /** 世界觀掛的用語解說 id（疊加）。見 docs/future-lorebook.md §4.2 */
  lorebookIds?: string[]
  builtIn?: boolean
  createdAt: number
  updatedAt: number
}

export type ColorTheme =
  | 'mint' | 'butter' | 'peach' | 'aqua' | 'sky' | 'blush' | 'lavender' | 'forest' | 'white'
  | 'dark' | 'sepia' | 'cyber'

export interface ScenePreset {
  id: string
  name: string
  activePersonaId: string
  activeWorldId: string
  desktopCharacters: DesktopCharacterState[]
  lastActiveConversationId?: string
  colorTheme?: ColorTheme
  inputWindowBounds?: WindowBoundsState
  logWindowBounds?: WindowBoundsState
  /** 綁定的新聞關鍵字組 id；未綁（undefined）= 用預設組（取代式切換興趣池） */
  newsKeywordGroupId?: string
  /**
   * 綁定的用語解說；未綁（undefined）＝用角色卡＋世界觀的疊加結果，
   * 有值＝**取代式**切換（空陣列＝這個情境一本都不用）。見 docs/future-lorebook.md §6.4
   */
  lorebookIds?: string[]
  /** 各模組在此情境的開關覆蓋：'on' 強制開、'off' 強制關、無 key＝跟隨全域設定 */
  moduleOverrides?: Record<string, 'on' | 'off'>
  createdAt: number
  updatedAt: number
}

/**
 * 天氣地點是怎麼來的。
 *
 * `gps` **只有手機會出現** —— 桌面沒有定位硬體，只能靠對外 IP 猜。
 * 兩者精度差很多（IP 常落在電信商的機房而不是你家），所以要分得開，
 * 使用者才知道畫面上那個地名可不可信。
 */
export type WeatherLocationSource = 'ip' | 'gps' | 'manual' | ''

export interface WeatherSettings {
  enabled: boolean
  polish: boolean
  locationName: string
  latitude: number
  longitude: number
  locationSource: WeatherLocationSource
  realtimeQuery?: {
    enabled: boolean
    cwaApiKey: string
    forecastCounty: string
  }
}

export interface SpotifySettings {
  enabled: boolean
  clientId: string
  displayName?: string
}

export interface CalendarSettings {
  enabled: boolean
  /** 使用者自備的 Google OAuth Client ID（程式碼中不內建任何 ID） */
  clientId: string
  /** Google 桌面應用程式 client 一併發放的密鑰；以 safeStorage 加密存放 */
  clientSecret?: string
  /** 已連結的帳號（Google 為 email） */
  displayName?: string
  /** 往後看幾小時的行程 */
  lookaheadHours: number
  maxEvents: number
  /** 沒有行程時也告訴角色（預設關，省 token） */
  mentionWhenEmpty: boolean
}

export interface MobileSettings {
  enabled: boolean
  port: number
  useTunnel: boolean
  relay?: {
    deviceId?: string
    relayUrl: string
  }
}

export interface RegisteredProgram {
  id: string
  name: string              // 顯示名稱
  path: string              // 可執行檔絕對路徑
  args?: string             // 啟動參數
  iconDataUrl?: string      // 32x32 圖示,從 exe 抽取
  createdAt: number
}

export type RemoteCapability =
  | 'remote.viewScreen'
  | 'remote.captureWindow'
  | 'remote.pointer.click'
  | 'remote.pointer.scroll'
  | 'remote.keyboard.type'
  | 'remote.keyboard.hotkey'
  | 'remote.program.launch'
  | 'remote.program.close'
  | 'remote.monitor.power'
  | 'remote.system.shutdown'
  | 'remote.system.restart'

export interface RegisteredRemoteDevice {
  id: string
  nickname: string
  label?: string
  createdAt: number
  lastSeenAt?: number
}

export interface RemoteControlSettings {
  enabled: boolean
  allowedCapabilities: RemoteCapability[]
  requireConfirmation: RemoteCapability[]
  allowedDevices: RegisteredRemoteDevice[]
  restrictToAllowedDevices: boolean
  logRetention: {
    maxEntries: number
    keepDays?: number
  }
  /** 允許手機端遙控鍵鼠（點擊 / 輸入文字 / 快捷鍵）*/
  enableInputControl: boolean
  /** 允許手機端執行系統動作（關機 / 重開機） */
  enableSystemActions: boolean
  /** 白名單登錄程式 */
  registeredPrograms: RegisteredProgram[]
}

export type OmikujiTier = '大吉' | '中吉' | '小吉' | '吉' | '末吉' | '凶' | '大凶'

export type RandomResult =
  | { tool: 'omikuji'; result: OmikujiTier }
  | { tool: 'jiao'; result: '聖筊' | '笑筊' | '陰筊' }
  | { tool: 'coin'; result: '正面' | '反面' }
  | { tool: 'dice'; faces: number; count: number; rolls: number[]; kept: number[]; keepHighest?: number; keepLowest?: number; modifier: number; total: number }

export interface PendingRandomTool {
  tool: 'omikuji' | 'jiao' | 'coin' | 'dice'
  faces?: number
  count?: number
  modifier?: number
  keepHighest?: number
  keepLowest?: number
}

export interface AppSettings {
  activePersonaId: string
  activeWorldId: string
  activeSceneId?: string
  injectSystemTime: boolean
  weather?: WeatherSettings
  spotify?: SpotifySettings
  calendar?: CalendarSettings
  mobile?: MobileSettings
  remoteControl?: RemoteControlSettings
  llm: {
    provider: 'openai' | 'claude' | 'gemini' | 'grok'
    /** @deprecated use apiKeys[provider] instead; kept for migration */
    apiKey: string
    apiKeys: Record<string, string>
    model: string
    /** Per-provider model selection; takes precedence over single `model` field */
    models?: Record<string, string>
    endpoint?: string
    maxResponseTokens: number
    maxGroupRounds: number
    maxImagesPerMessage: number
    temperature: number
    /** 提醒發話、情緒分類是否使用獨立輔助模型（群組對話一律用扮演主模型） */
    utilityEnabled?: boolean
    /** 輔助模型的供應商（未設定時跟隨 provider） */
    utilityProvider?: 'openai' | 'claude' | 'gemini' | 'grok'
    /** 各供應商的輔助模型名稱 */
    utilityModels?: Record<string, string>
  }
  memory: {
    keepRecentN: number
    /** 未被摘要涵蓋的訊息累積達此數量時自動觸發摘要（需 autoSummarizeEnabled） */
    autoSummarizeAfter: number
    /** 是否自動摘要（關閉時仍可在 Log 視窗手動摘要） */
    autoSummarizeEnabled: boolean
    /** 只有最近 N 則訊息保留完整 debug prompt（供 Log「查看完整 Prompt」）；超過的剪掉以減輕載入。 */
    keepDebugPromptN: number
  }
  updates?: {
    checkOnStartup?: boolean
    dismissedVersion?: string
    versionPublishedAt?: string
  }
  ui: {
    desktopCharacters: DesktopCharacterState[]
    inputWindowPosition: { x: number; y: number }
    inputWindowBounds?: WindowBoundsState
    logWindowBounds?: WindowBoundsState
    emojiPickerOffset?: { x: number; y: number }
    unfocusedBubbleOpacity: number
    theme: 'light' | 'dark' | 'auto'
    hoverMenuOnHover: boolean
    /** 全域字級：xs=12 / sm=13 / md=14（預設）/ lg=16 / xl=18 px */
    chatFontSize?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
    /** 上次在記錄／輸入端使用的作用中對話；重開程式時還原 */
    lastActiveConversationId?: string
    /** 首次啟動引導完成後為 true，避免重複打擾 */
    onboardingCompleted?: boolean
    /** 便利貼資料 */
    pinnedNotes?: PinnedNote[]
    /** 角色視窗保持在最上層（預設 true）*/
    alwaysOnTop?: boolean
    /** 對話泡泡自動消失設定 */
    chatBubbleAutoClose?: {
      enabled: boolean
      seconds: number
    }
    /** 提醒通知音效設定 */
    reminderNotificationSound?: {
      enabled: boolean
      volume: number
      customSoundPath?: string
    }
    /** 訊息通知音效設定 */
    messageNotificationSound?: {
      enabled: boolean
      volume: number
      customSoundPath?: string
    }
    /** 介面配色主題 */
    colorTheme?: ColorTheme
    /** 閒置超過幾分鐘時略過提醒（0 = 不略過）*/
    reminderIdleSkipMinutes?: number
    /** 按「說點什麼」時是否把桌面可見便利貼當作可聊的話題素材 */
    speakUsePinnedNotes?: boolean
    /** 一般回話時是否把桌面可見便利貼附入 system context */
    chatUsePinnedNotes?: boolean
    /** 截圖時是否保留對話輸入框 */
    screenshotIncludeInputWindow?: boolean
    randomToolsEnabled?: boolean
    /** 每則角色回覆旁顯示生成它的模型小圖示（點一下看型號）。未設定＝開啟 */
    showLlmBadge?: boolean
    /** 使用者訊息旁顯示發話身分的名字（切換身分玩角色扮演時才分得出誰是誰）。未設定＝開啟 */
    showPersonaName?: boolean
    /** 低效能模式：保留角色透明，簡化對話泡泡並限制泡泡視窗數量 */
    lowPerformanceMode?: boolean
    /** 低效能模式下 Log 視窗初始顯示最近幾則訊息 */
    lowPerformanceLogMessageLimit?: number
    /** 事件驅動命中測試：停用主程序游標輪詢，改由 renderer 事件即時驅動點擊穿透（省 CPU，首次點擊可能需先移動游標） */
    eventDrivenHitTest?: boolean
  }
}

export type ReminderSchedule =
  | { type: 'startup' }
  | { type: 'once'; at: number }
  | { type: 'daily'; hour: number; minute: number }
  /** days: 0=週日 … 6=週六（與 JS Date.getDay() 一致），可複選 */
  | { type: 'weekly'; days: number[]; hour: number; minute: number }
  | { type: 'interval'; intervalMs: number }

export interface Reminder {
  id: string
  /** 未設定時觸發時隨機選桌面上的未靜音角色 */
  characterId?: string
  label: string
  prompt: string
  schedule: ReminderSchedule
  enabled: boolean
  /** 觸發時將桌面可見便利貼內容附入 prompt */
  injectPinnedNotes?: boolean
  /** 觸發時附入目前對話的近期紀錄（筆數同「記憶」設定） */
  injectConversationContext?: boolean
  /** 觸發時附入天氣資訊（需先在設定設定地點） */
  injectWeather?: boolean
  /** 觸發時抓一則新聞當話題素材（需先啟用新聞模組） */
  injectNews?: boolean
  /** 觸發時附入接下來的行程（需先連結 Google 日曆） */
  injectCalendar?: boolean
  lastTriggeredAt?: number
  createdAt: number
}

/** Legacy shape — used only for migration detection */
export interface LegacyAppSettings extends Omit<AppSettings, 'activePersonaId' | 'activeWorldId'> {
  worldSetting?: string
  interactionExample?: string
  persona?: {
    displayName: string
    nickname: string
    description: string
  }
  activePersonaId?: string
  activeWorldId?: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  activePersonaId: '',
  activeWorldId: '',
  injectSystemTime: true,
  llm: {
    provider: 'openai',
    apiKey: '',
    apiKeys: { openai: '', claude: '', gemini: '', grok: '' },
    model: 'gpt-5.4-nano-2026-03-17',
    maxResponseTokens: 360,
    maxGroupRounds: 3,
    maxImagesPerMessage: 5,
    temperature: 0.8
  },
  memory: {
    keepRecentN: 20,
    autoSummarizeAfter: 50,
    autoSummarizeEnabled: true,
    keepDebugPromptN: 5
  },
  remoteControl: {
    enabled: false,
    allowedCapabilities: [],
    requireConfirmation: [],
    allowedDevices: [],
    restrictToAllowedDevices: false,
    logRetention: {
      maxEntries: 500
    },
    enableInputControl: false,
    enableSystemActions: false,
    registeredPrograms: []
  },
  mobile: {
    enabled: false,
    port: 3721,
    useTunnel: true
  },
  ui: {
    desktopCharacters: [],
    inputWindowPosition: { x: 100, y: 100 },
    unfocusedBubbleOpacity: 0.1,
    theme: 'light',
    hoverMenuOnHover: true,
    onboardingCompleted: false,
    alwaysOnTop: true,
    chatBubbleAutoClose: {
      enabled: false,
      seconds: 8
    },
    reminderNotificationSound: {
      enabled: true,
      volume: 0.7
    },
    messageNotificationSound: {
      enabled: true,
      volume: 0.7
    },
    screenshotIncludeInputWindow: false,
    randomToolsEnabled: true,
    showLlmBadge: true,
    showPersonaName: true,
    lowPerformanceMode: false,
    lowPerformanceLogMessageLimit: 50,
    eventDrivenHitTest: false
  }
}
