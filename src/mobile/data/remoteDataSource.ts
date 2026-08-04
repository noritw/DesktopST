import { DataError } from '@core/data'
import type {
  AppStateSnapshot,
  Capabilities,
  CharacterListItem,
  CharactersApi,
  ConversationListItem,
  ConversationsApi,
  DataSource,
  MessagesApi,
  PresetListItem,
  PresetsApi,
  SendMessageInput,
  SettingsApi
} from '@core/data'
import type { Character, PersonaPreset, ScenePreset, WorldPreset } from '@core/types'
import { HttpClient } from './httpClient'
import type { HttpClientOptions } from './httpClient'

/**
 * 遙控模式的資料來源：打電腦上 `mobileServer` 的 `/api/*`。
 *
 * 方法對映逐條沿用 `assets/mobile.html` 的既有呼叫，只是換成介面的形狀。
 *
 * ## ⚠️ 尚未有對應端點的方法
 *
 * `mobileServer` 現有 29 個端點**全是讀取與「套用」，沒有任何寫入端點**
 * （角色卡、預設組、設定都不能改）。編輯類方法因此暫時擲出 `not-supported`，
 * 端點會在 B3 階段 3（角色）／階段 5（預設組）補上。
 *
 * **不用「假裝成功」或悄悄退化成唯讀** —— 那會讓使用者以為存檔了。
 * 擲錯誤，UI 顯示「這台電腦的版本還不支援」，是誠實且可行動的。
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
      maxImages: number
    }>('/api/state')

    return {
      // 電腦端叫「桌面角色」，手機 UI 叫「在場角色」（決議①）。
      // 名稱轉換就在這一行，UI 之後只認識 present。
      presentCharacters: d.desktopCharacters ?? [],
      conversation: d.conversation ?? null,
      colorTheme: d.colorTheme,
      randomToolsEnabled: d.randomToolsEnabled,
      maxImagesPerMessage: d.maxImages
    }
  }

  async sendMessage(input: SendMessageInput): Promise<void> {
    await this.http.post('/api/send', {
      content: input.content,
      images: input.images,
      randomResults: input.randomResults,
      skipLlm: input.skipLlm
    })
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
    resend: async (id) => { await this.http.post('/api/messages/resend', { id }) }
  }

  readonly characters: CharactersApi = {
    list: async () => {
      const d = await this.http.get<{ characters: { id: string; name: string; onDesktop: boolean }[] }>('/api/characters/library')
      return d.characters.map((c): CharacterListItem => ({ id: c.id, name: c.name, present: c.onDesktop }))
    },
    get: async (): Promise<Character> => { throw notYet('characters.get', 3) },
    save: async (): Promise<void> => { throw notYet('characters.save', 3) },
    remove: async (): Promise<void> => { throw notYet('characters.remove', 3) },

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

    getPersona: async (): Promise<PersonaPreset> => { throw notYet('presets.getPersona', 5) },
    getWorld: async (): Promise<WorldPreset> => { throw notYet('presets.getWorld', 5) },
    getScene: async (): Promise<ScenePreset> => { throw notYet('presets.getScene', 5) },

    activePersonaId: async () => (await this.fetchPresets()).activePersonaId,
    activeWorldId: async () => (await this.fetchPresets()).activeWorldId,

    activatePersona: async (id) => { await this.http.post('/api/presets/activate-persona', { id }) },
    activateWorld: async (id) => { await this.http.post('/api/presets/activate-world', { id }) },
    applyScene: async (id) => { await this.http.post('/api/scenes/apply', { id }) },

    savePersona: async (): Promise<void> => { throw notYet('presets.savePersona', 5) },
    saveWorld: async (): Promise<void> => { throw notYet('presets.saveWorld', 5) },
    saveScene: async (): Promise<void> => { throw notYet('presets.saveScene', 5) },
    removePersona: async (): Promise<void> => { throw notYet('presets.removePersona', 5) },
    removeWorld: async (): Promise<void> => { throw notYet('presets.removeWorld', 5) },
    removeScene: async (): Promise<void> => { throw notYet('presets.removeScene', 5) }
  }

  readonly settings: SettingsApi = {
    setColorTheme: async (theme) => { await this.http.post('/api/settings/color-theme', { theme }) }
  }

  private fetchPresets(): Promise<{
    personas: PresetListItem[]
    worlds: PresetListItem[]
    activePersonaId: string
    activeWorldId: string
  }> {
    // `/api/presets` 一次回四樣，四個方法共用同一支端點。
    // 刻意不快取：呼叫端是 UI 開啟選單時才問，量很小，快取反而要處理失效。
    return this.http.get('/api/presets')
  }
}

/** 電腦端還沒有對應端點。標明會在哪個階段補上，免得日後只看到一句 not-supported。 */
function notYet(method: string, stage: number): DataError {
  return new DataError('not-supported', `${method}: mobileServer 尚無對應端點（B3 階段 ${stage} 補上）`)
}
