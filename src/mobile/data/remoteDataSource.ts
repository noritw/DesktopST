import { DataError } from '@core/data'
import type {
  AppStateSnapshot,
  Capabilities,
  CardFile,
  CharacterListItem,
  CharactersApi,
  LlmSettingsSnapshot,
  LorebooksApi,
  LoreGenerateResult,
  MemorySettingsSnapshot,
  MessageDebug,
  ModuleToggle,
  WeatherNowSnapshot,
  WeatherSettingsSnapshot,
  ConversationListItem,
  ConversationsApi,
  DataSource,
  MessagesApi,
  NewsApi,
  NewsEditableSettings,
  NewsFetchResult,
  NewsReaderSnapshot,
  NewsScheduleSnapshot,
  PresetListItem,
  PresetsApi,
  RemindersApi,
  RemoteActionResult,
  RemoteControlApi,
  RemoteControlState,
  RemoteDisplay,
  RemoteProgram,
  RemoteScreenBounds,
  RemoteScreenshot,
  RemoteWindow,
  SendMessageInput,
  SettingsApi
} from '@core/data'
import type { Character, PersonaPreset, Reminder, ScenePreset, WorldPreset } from '@core/types'
import type { NewsSource } from '@core/news/types'
import type { Lorebook } from '@core/lore'
import { base64ToBytes, bytesToBase64 } from '@core/util/base64'
import { HttpClient } from './httpClient'
import type { HttpClientOptions } from './httpClient'

/**
 * 遙控模式的資料來源：打電腦上 `mobileServer` 的 `/api/*`。
 *
 * 方法對映逐條沿用 `assets/mobile.html` 的既有呼叫，只是換成介面的形狀。
 *
 * ## ⚠️ 尚未有對應端點的方法
 *
 * 階段 3 已補上角色卡的寫入端點（建立／存檔／刪除／主圖／匯入匯出）。
 * 預設組讀寫也走同一組 DataSource 方法；手機 UI 不知道資料是在電腦還是本機。
 */

export interface RemoteDataSourceOptions extends HttpClientOptions {
  /**
   * 是否為區網直連。**由電腦端判定後回報，不可由手機自稱**（roadmap §4.7）。
   * 目前 `mobileServer` 還沒有這個判定（階段 4 才做），故預設 false ——
   * 保守方向：不確定就不給 API Key 存取。
   */
  lanDirect?: boolean
}

export class RemoteDataSource implements DataSource {
  private http: HttpClient
  readonly capabilities: Capabilities

  constructor(opts: RemoteDataSourceOptions) {
    this.http = new HttpClient(opts)
    this.capabilities = {
      apiKeyAccess: opts.lanDirect ?? false,
      remoteControl: true,
      screenshot: true
    }
  }

  async getState(): Promise<AppStateSnapshot> {
    const d = await this.http.get<{
      desktopCharacters: { id: string; name: string; muted: boolean }[]
      conversation: AppStateSnapshot['conversation']
      colorTheme: AppStateSnapshot['colorTheme']
      randomToolsEnabled: boolean
      showLlmBadge?: boolean
      showPersonaName?: boolean
      maxImages: number
      activeSceneId?: string
      activePersonaId?: string
      activeWorldId?: string
      activeSceneDirty?: boolean
    }>('/api/state')

    return {
      // 電腦端叫「桌面角色」，手機 UI 叫「在場角色」（決議①）。
      // 名稱轉換就在這一行，UI 之後只認識 present。
      presentCharacters: d.desktopCharacters ?? [],
      conversation: d.conversation ?? null,
      colorTheme: d.colorTheme,
      randomToolsEnabled: d.randomToolsEnabled,
      // 舊版電腦端沒這個欄位；缺就當開啟（與 settings 的 `!== false` 同義）
      showLlmBadge: d.showLlmBadge !== false,
      showPersonaName: d.showPersonaName !== false,
      maxImagesPerMessage: d.maxImages,
      activeSceneId: d.activeSceneId,
      activePersonaId: d.activePersonaId,
      activeWorldId: d.activeWorldId,
      activeSceneDirty: d.activeSceneDirty === true
    }
  }

  async sendMessage(input: SendMessageInput): Promise<void> {
    await this.http.post('/api/send', {
      content: input.content,
      images: input.images,
      randomResults: input.randomResults,
      skipLlm: input.skipLlm,
      newsLink: input.newsLink ?? undefined
    })
  }

  async stopGenerating() {
    const r = await this.http.post<{
      ok: boolean
      stopped?: boolean
      content?: string
      images?: string[]
    }>('/api/stop', {})
    if (!r.stopped) return null
    return { content: r.content ?? '', images: r.images }
  }

  async getMessageImageUrl(messageId: string, index: number): Promise<string | null> {
    // 圖片按需取用（base64 不隨快照走）。`<img>` 沒法加 header，所以走 query token。
    return this.http.url(`/api/message-image/${encodeURIComponent(messageId)}/${index}`)
  }

  readonly conversations: ConversationsApi = {
    list: async () => (await this.http.get<{ conversations: ConversationListItem[] }>('/api/conversations')).conversations,
    load: async (id) => { await this.http.post('/api/conversations/load', { id }) },
    create: async (title) => (await this.http.post<{ conversation: ConversationListItem }>('/api/conversations/new', { title })).conversation,
    rename: async (id, title) => (await this.http.post<{ conversation: ConversationListItem }>('/api/conversations/rename', { id, title })).conversation,
    remove: async (id) => this.http.post<{ activeConversationId: string }>('/api/conversations/delete', { id })
  }

  readonly messages: MessagesApi = {
    // ⚠️ 欄位名是 `id` 不是 `messageId` —— 三支端點讀的都是 `payload.id`
    // （`mobileServer.ts` 688–730）。階段 0-③ 寫成 `messageId`，
    // 會被端點當成缺參數擋下並回 400，而 UI 只會看到「操作失敗」。
    remove: async (id) => { await this.http.post('/api/messages/delete', { id }) },
    edit: async (id, content) => { await this.http.post('/api/messages/edit', { id, content }) },
    resend: async (id) => { await this.http.post('/api/messages/resend', { id }) },
    // 舊版電腦端沒這支端點：當成「這則沒留 prompt」處理（回 null）而不是報錯，
    // UI 顯示「找不到」總比丟一個看不懂的連線錯誤好。
    getDebug: async (id) => {
      try {
        const d = await this.http.post<{ debug: MessageDebug | null }>('/api/messages/debug', { id })
        return d.debug ?? null
      } catch (e) {
        if (e instanceof DataError && (e.code === 'not-found' || e.code === 'not-supported')) return null
        throw e
      }
    }
  }

  readonly characters: CharactersApi = {
    list: async () => {
      const d = await this.http.get<{ characters: { id: string; name: string; onDesktop: boolean }[] }>('/api/characters/library')
      return d.characters.map((c): CharacterListItem => ({ id: c.id, name: c.name, present: c.onDesktop }))
    },
    get: async (id) =>
      (await this.http.get<{ character: Character }>(`/api/characters/card/${encodeURIComponent(id)}`)).character,
    save: async (character) => { await this.http.post('/api/characters/save', { character }) },
    remove: async (id) => { await this.http.post('/api/characters/delete', { id }) },
    create: async (name) =>
      (await this.http.post<{ character: Character }>('/api/characters/create', { name })).character,

    saveAvatar: async (id, image) =>
      (await this.http.post<{ avatar: string }>('/api/characters/avatar', {
        id,
        data: bytesToBase64(image.bytes),
        ext: image.ext
      })).avatar,

    // 二進位一律 base64 過 JSON：`HttpClient` 只講 JSON，為了匯入匯出另開一條
    // 二進位通道會讓認證與錯誤翻譯多一份實作（正是 httpClient 檔頭要避免的）。
    importCard: async (file) =>
      (await this.http.post<{ character: Character }>('/api/characters/import-card', {
        kind: file.kind,
        data: bytesToBase64(file.bytes)
      })).character,
    exportCard: async (id, kind) => toCardFile(
      await this.http.post<{ data: string; filename: string }>('/api/characters/export-card', { id, kind })
    ),

    importPack: async (bytes, opts) =>
      this.http.post<{ imported: number; skipped: number }>('/api/characters/import-pack', {
        data: bytesToBase64(bytes),
        onConflict: opts.onConflict,
        applyGlobalSettings: opts.applyGlobalSettings
      }),
    exportPack: async (ids, opts) => toCardFile(
      await this.http.post<{ data: string; filename: string }>('/api/characters/export-pack', { ids, ...opts })
    ),

    setPresent: async (id, present) => {
      const r = await this.http.post<{ ok: boolean }>(
        present ? '/api/characters/desktop/add' : '/api/characters/desktop/remove',
        { characterId: id }
      )
      // ⚠️ **端點用 HTTP 200 + `ok: false` 表示拒絕**，不是錯誤狀態碼。
      // 最常見的原因是「至少要留一個角色」（清單 D5）。
      // 不檢查的話 UI 會顯示成功、清單卻沒變 —— 使用者只會覺得按鈕壞了。
      if (!r.ok) throw new DataError('conflict', 'setPresent rejected')
    },
    toggleMute: async (id) => (await this.http.post<{ muted: boolean }>('/api/characters/toggle-mute', { characterId: id })).muted,
    speak: async (id) => { await this.http.post('/api/characters/speak', { characterId: id }) },
    avatarUrl: async (id) => this.http.url(`/api/avatar/${encodeURIComponent(id)}`)
  }

  readonly presets: PresetsApi = {
    listPersonas: async () => (await this.fetchPresets()).personas,
    listWorlds: async () => (await this.fetchPresets()).worlds,
    listScenes: async () => (await this.http.get<{ scenes: PresetListItem[] }>('/api/scenes')).scenes,

    getPersona: async (id): Promise<PersonaPreset> => (await this.http.get<{ preset: PersonaPreset }>(`/api/presets/persona/${encodeURIComponent(id)}`)).preset,
    getWorld: async (id): Promise<WorldPreset> => (await this.http.get<{ preset: WorldPreset }>(`/api/presets/world/${encodeURIComponent(id)}`)).preset,
    getScene: async (id): Promise<ScenePreset> => (await this.http.get<{ preset: ScenePreset }>(`/api/presets/scene/${encodeURIComponent(id)}`)).preset,

    activePersonaId: async () => (await this.fetchPresets()).activePersonaId,
    activeWorldId: async () => (await this.fetchPresets()).activeWorldId,
    activeSceneId: async () => (await this.fetchPresets()).activeSceneId,

    activatePersona: async (id) => { await this.http.post('/api/presets/activate-persona', { id }) },
    activateWorld: async (id) => { await this.http.post('/api/presets/activate-world', { id }) },
    applyScene: async (id) => { await this.http.post('/api/scenes/apply', { id }) },
    captureScene: async (id) => { await this.http.post('/api/scenes/capture', { id }) },

    savePersona: async (preset): Promise<void> => { await this.http.post('/api/presets/persona/save', { preset }) },
    saveWorld: async (preset): Promise<void> => { await this.http.post('/api/presets/world/save', { preset }) },
    saveScene: async (preset): Promise<void> => { await this.http.post('/api/presets/scene/save', { preset }) },
    removePersona: async (id): Promise<void> => { await this.http.post('/api/presets/persona/delete', { id }) },
    removeWorld: async (id): Promise<void> => { await this.http.post('/api/presets/world/delete', { id }) },
    removeScene: async (id): Promise<void> => { await this.http.post('/api/presets/scene/delete', { id }) }
  }

  readonly settings: SettingsApi = {
    setColorTheme: async (theme) => { await this.http.post('/api/settings/color-theme', { theme }) },
    setShowLlmBadge: async (show) => { await this.http.post('/api/settings/show-llm-badge', { show }) },
    setShowPersonaName: async (show) => { await this.http.post('/api/settings/show-persona-name', { show }) },

    getLlm: async () => (await this.http.get<{ llm: LlmSettingsSnapshot }>('/api/settings/llm')).llm,
    setLlmProvider: async (provider) => { await this.http.post('/api/settings/llm-provider', { provider }) },
    setLlmModel: async (provider, model) => { await this.http.post('/api/settings/llm-model', { provider, model }) },
    setLlmEndpoint: async (endpoint) => { await this.http.post('/api/settings/llm-endpoint', { endpoint }) },
    setLlmApiKey: async (provider, apiKey) => { await this.http.post('/api/settings/llm-apikey', { provider, apiKey }) },
    setLlmChatLimits: async (limits) => { await this.http.post('/api/settings/llm-chat-limits', limits) },

    getMemory: async () => (await this.http.get<{ memory: MemorySettingsSnapshot }>('/api/settings/memory')).memory,
    setMemory: async (m) => { await this.http.post('/api/settings/memory', m) },

    listModules: async () => (await this.http.get<{ modules: ModuleToggle[] }>('/api/settings/modules')).modules,
    setModuleEnabled: async (id, enabled) => { await this.http.post('/api/settings/modules/toggle', { id, enabled }) },

    getWeather: async () => (await this.http.get<{ weather: WeatherSettingsSnapshot }>('/api/settings/weather')).weather,
    setWeather: async (patch) => (await this.http.post<{ weather: WeatherSettingsSnapshot }>('/api/settings/weather', patch)).weather,
    detectWeatherLocation: async () => (await this.http.post<{ weather: WeatherSettingsSnapshot }>('/api/settings/weather/detect-ip', {})).weather,
    geocodeWeatherLocation: async (name) => (await this.http.post<{ weather: WeatherSettingsSnapshot }>('/api/settings/weather/geocode', { name })).weather,
    fetchWeatherNow: async () => {
      const r = await this.http.post<WeatherNowSnapshot & { ok?: true }>('/api/settings/weather/fetch-now', {})
      return { description: r.description, temperatureC: r.temperatureC, humidity: r.humidity, windSpeed: r.windSpeed }
    }
  }

  readonly lorebooks: LorebooksApi = {
    list: async () => (await this.http.get<{ lorebooks: PresetListItem[] }>('/api/lorebooks')).lorebooks,
    get: async (id) => (await this.http.get<{ book: Lorebook }>(`/api/lorebooks/${encodeURIComponent(id)}`)).book,
    save: async (book) => (await this.http.post<{ book: Lorebook }>('/api/lorebooks/save', { book })).book,
    remove: async (id) => { await this.http.post('/api/lorebooks/delete', { id }) },
    create: async (name) => (await this.http.post<{ book: Lorebook }>('/api/lorebooks/create', { name })).book,
    generateEntry: (characterId, lorebookId) =>
      this.http.post<LoreGenerateResult>('/api/lorebooks/generate-entry', { characterId, lorebookId })
  }

  /**
   * 個人新聞報（清單 F1–F13）。端點在 `src/main/modules/news/mobileRoutes.ts`，
   * 抓取邏輯與桌面共用 `readerFetch.ts` —— **手機端一行抓取邏輯都沒有**。
   */
  readonly news: NewsApi = {
    getReaderState: async () => this.http.get<NewsReaderSnapshot>('/api/news/reader/state'),

    fetchBatch: async (req) => this.http.post<NewsFetchResult>('/api/news/reader/batch', {
      excludeIds: req?.excludeIds ?? [],
      strictExclude: req?.strictExclude === true
    }),
    fetchSection: async (req) => this.http.post<NewsFetchResult>('/api/news/reader/section', {
      sectionGroupId: req.sectionGroupId,
      excludeIds: req.excludeIds ?? [],
      strictExclude: req.strictExclude !== false
    }),

    setPinned: async (items) => { await this.http.post('/api/news/reader/pinned', { items }) },
    setDismissed: async (ids) => { await this.http.post('/api/news/reader/dismissed', { ids }) },

    setQuota: async (sectionGroupId, quota) =>
      this.http.post<NewsFetchResult>('/api/news/reader/quota', { sectionGroupId, quota }),
    setKeywordGroups: async (ids) => { await this.http.post('/api/news/reader/groups', { ids }) },
    setSourceOrder: async (orderedSourceIds) =>
      (await this.http.post<{ sources: NewsSource[] }>('/api/news/reader/order', { orderedSourceIds })).sources,

    markOpened: async (sourceId) => { await this.http.post('/api/news/mark-opened', { sourceId }) },

    enrichForChat: async (item, forceRefresh) =>
      this.http.post('/api/news/enrich', { item, forceRefresh: !!forceRefresh }),

    updatePromptContext: async (messageId, promptContext) =>
      this.http.post('/api/news/update-prompt-context', { messageId, promptContext }),

    getSettings: async () => this.http.get<NewsEditableSettings>('/api/news/settings'),
    saveSettings: async (patch) => this.http.post<NewsEditableSettings>('/api/news/settings', patch),

    getSchedule: async () => this.http.get<NewsScheduleSnapshot>('/api/news/scheduler'),
    setSchedule: async (next) => { await this.http.post('/api/news/scheduler', next) }
  }

  readonly reminders: RemindersApi = {
    list: async () => (await this.http.get<{ reminders: Reminder[] }>('/api/reminders')).reminders,
    create: async () => (await this.http.post<{ reminder: Reminder }>('/api/reminders/create')).reminder,
    save: async (reminder) => (await this.http.post<{ reminder: Reminder }>('/api/reminders/save', { reminder })).reminder,
    remove: async (id) => { await this.http.post('/api/reminders/delete', { id }) },
    toggle: async (id, enabled) => { await this.http.post('/api/reminders/toggle', { id, enabled }) }
  }

  /**
   * 遙控面板（清單 H1–H11，B6）。逐條沿用 `assets/mobile.html` 既有的
   * `/api/remote/*`、`/api/screenshot/*`、`/api/displays`、`/api/windows`、
   * `/api/capture-window`、`/api/system/lock-status` 呼叫，只是換成介面形狀。
   */
  readonly remoteControl: RemoteControlApi = {
    getState: async () =>
      (await this.http.get<{ remoteControl: RemoteControlState }>('/api/state')).remoteControl,

    listDisplays: async () => this.http.get<RemoteDisplay[]>('/api/displays'),
    listWindows: async () => this.http.get<RemoteWindow[]>('/api/windows'),

    captureDisplay: async (displayIndex, withCharacters) => {
      const path = `${withCharacters ? '/api/screenshot/with-chars' : '/api/screenshot/clean'}?displayIndex=${displayIndex}`
      const { blob, headers } = await this.http.getBinary(path)
      return toScreenshot(blob, headers, 'X-Display-Bounds')
    },
    captureWindow: async (win) => {
      const { blob, headers } = await this.http.postBinary('/api/capture-window', win)
      return toScreenshot(blob, headers, 'X-Window-Bounds')
    },
    isLocked: async () => (await this.http.get<{ locked: boolean }>('/api/system/lock-status')).locked,

    click: async (x, y, opts) =>
      this.http.post<RemoteActionResult>(
        '/api/remote/click',
        { x, y, button: opts.button, double: opts.double },
        confirmedHeader(opts.confirmed)
      ),
    scroll: async (x, y, deltaX, deltaY) =>
      this.http.post<RemoteActionResult>('/api/remote/scroll', { x, y, deltaX, deltaY }),
    typeText: async (text, opts) =>
      this.http.post<RemoteActionResult>(
        '/api/remote/type',
        { text, pressEnter: opts.pressEnter },
        confirmedHeader(opts.confirmed)
      ),
    sendKey: async (keys, confirmed) =>
      this.http.post<RemoteActionResult>('/api/remote/key', { keys }, confirmedHeader(confirmed)),

    listPrograms: async () => this.http.get<RemoteProgram[]>('/api/remote/programs'),
    launchProgram: async (id, confirmed) =>
      this.http.post<RemoteActionResult>('/api/remote/programs/launch', { id }, confirmedHeader(confirmed)),
    closeProgram: async (id, confirmed) =>
      this.http.post<RemoteActionResult>('/api/remote/programs/close', { id }, confirmedHeader(confirmed)),

    systemAction: async (action, confirmed) => {
      if (action === 'monitor-off') return this.http.post<RemoteActionResult>('/api/remote/monitor-off', undefined, confirmedHeader(confirmed))
      if (action === 'wake') return this.http.post<RemoteActionResult>('/api/remote/wake', undefined, confirmedHeader(confirmed))
      return this.http.post<RemoteActionResult>('/api/remote/system', { action }, confirmedHeader(confirmed))
    },

    hideWindows: async () => { await this.http.post('/api/remote/hide-windows') },
    restoreWindows: async () => { await this.http.post('/api/remote/restore-windows') }
  }

  private fetchPresets(): Promise<{
    personas: PresetListItem[]
    worlds: PresetListItem[]
    activePersonaId: string
    activeWorldId: string
    activeSceneId?: string
  }> {
    // `/api/presets` 一次回四樣，四個方法共用同一支端點。
    // 刻意不快取：呼叫端是 UI 開啟選單時才問，量很小，快取反而要處理失效。
    return this.http.get('/api/presets')
  }
}

function toCardFile(r: { data: string; filename: string }): CardFile {
  return { bytes: base64ToBytes(r.data), filename: r.filename }
}

/** `confirmed` → `X-Remote-Confirmed` header；見 `routes.ts` 的 `hasRemoteConfirmation()`。 */
function confirmedHeader(confirmed?: boolean): { headers?: Record<string, string> } | undefined {
  return confirmed ? { headers: { 'X-Remote-Confirmed': '1' } } : undefined
}

function toScreenshot(blob: Blob, headers: Headers, boundsHeaderName: 'X-Display-Bounds' | 'X-Window-Bounds'): RemoteScreenshot {
  const raw = headers.get(boundsHeaderName)
  let bounds: RemoteScreenBounds | null = null
  if (raw) {
    try { bounds = JSON.parse(raw) } catch { bounds = null }
  }
  return { url: URL.createObjectURL(blob), bounds }
}
