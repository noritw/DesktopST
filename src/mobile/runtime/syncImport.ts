import type { AppSettings, Conversation, PersonaPreset, ScenePreset, WorldPreset } from '@core/types'
import type { NewsModuleSettings } from '@core/news/types'
import { saveNewsModuleSettings } from '@core/news/settings'
import type { StandaloneSession } from './session'
import { importCharactersFromDstPack } from './seedDefaults'
import { newId } from './id'
import { SyncError, getBinary, getJson, type FetchImpl, type SyncSource } from './syncTransport'

export { SyncError, type SyncSource }

/**
 * S1 初始化匯入：從使用者自己的電腦**單向**拉一份設定與角色（roadmap §4.7）。
 *
 * ## 這支不做什麼
 *
 * - **不是雙向同步**。不會把手機的東西送回電腦，也不比對 mtime——那是 S2。
 * - **不刪手機上的任何東西**。角色一律以新 id 加入，同名時由呼叫端決定略過或覆蓋；
 *   對話、手機自建的預設組完全不動（owner 2026-08-08 決定）。
 * - **不自己判斷金鑰能不能傳**。電腦端看 `req.socket.remoteAddress` 決定要不要附
 *   `apiKeys`，這裡只照收。欄位不存在＝這條連線不給金鑰，不是「金鑰是空的」。
 */

export interface SyncInitBundle {
  lanDirect: boolean
  /** 非直連時電腦附上的區網位址，手機用它把連線升級（見 `upgradeToLan`）。 */
  lanUrl?: string
  colorTheme?: string
  showLlmBadge?: boolean
  randomToolsEnabled?: boolean
  llm?: Partial<AppSettings['llm']> & { apiKeys?: Record<string, string> }
  memory?: Partial<AppSettings['memory']>
  /**
   * 天氣設定裡**與地點無關**的那幾項。
   *
   * 地點刻意不帶（owner 2026-08-08 決定）：手機會移動、而且有 GPS，
   * 同步電腦的座標只會讓你出門在外看到家裡的天氣。
   *
   * `cwaApiKey` 與 LLM 金鑰同規矩 —— 只有區網直連才會出現這個欄位。
   */
  weather?: {
    polish?: boolean
    realtimeQuery?: { enabled: boolean; forecastCounty: string; cwaApiKey?: string }
  }
  /**
   * 新聞模組設定（關鍵字／來源／分組／黑名單／版面配額⋯）。
   *
   * 電腦端刻意不帶 `enabled`（走下面的 `modules`）、`seenIds`、`feedback`、
   * `reminder`——理由見 `ipcHandlers.getNewsSyncSettingsDirect`。
   */
  news?: Partial<NewsModuleSettings>
  modules?: { id: string; label: string; enabled: boolean }[]
  personas?: PersonaPreset[]
  worlds?: WorldPreset[]
  scenes?: ScenePreset[]
  activePersonaId?: string
  activeWorldId?: string
  characters?: { id: string; name: string }[]
}

/** 同名衝突怎麼辦。與 `.dstpack` 匯入同一套語彙。 */
export type SyncConflictPolicy = 'skip' | 'overwrite'

export interface SyncPreview {
  bundle: SyncInitBundle
  /** 實際要用的來源。可能已被 `upgradeToLan` 換成區網位址。 */
  src: SyncSource
  /** 是否從 relay 自動改走了區網直連（UI 拿去說明金鑰為什麼突然可以帶了）。 */
  upgradedToLan: boolean
  /** 手機上已存在同名角色的名字，UI 拿去問使用者 */
  conflictNames: string[]
  /** 電腦上有幾隻角色 */
  characterCount: number
  /** 這條連線會不會帶金鑰過來 */
  apiKeysIncluded: boolean
}

export interface SyncResult {
  charactersImported: number
  charactersSkipped: number
  /** 個別下載／解包失敗的隻數。不中斷整批，最後一起回報。 */
  charactersFailed: number
  presetsImported: number
  apiKeysImported: number
  settingsApplied: boolean
  conversationsImported: number
  /** 個別下載失敗的則數。同樣不中斷整批。 */
  conversationsFailed: number
  /** 隨角色卡與世界觀一起帶下來的用語解說本數（缺口 #2，用同 id 落地，見 `importLorebooksFromPack`） */
  lorebooksImported: number
}

/** 電腦上一則對話的後設資料（勾選畫面用，不含訊息內容）。 */
export interface SyncConversationItem {
  id: string
  title: string
  updatedAt: number
  messageCount: number
  characterNames: string[]
  /** 這台手機已經匯入過（比對 `Conversation.importedFrom.sourceId`）。已匯入的不給重選。 */
  alreadyImported: boolean
}

/**
 * 先取設定包，讓 UI 能在動手前顯示「會拉幾隻角色、哪些同名、金鑰會不會過來」。
 * **預覽階段不寫入任何東西。**
 */
export async function fetchSyncPreview(
  src: SyncSource,
  session: StandaloneSession,
  fetchImpl: FetchImpl = globalThis.fetch
): Promise<SyncPreview> {
  const first = await getJson<SyncInitBundle>(src, '/api/sync-init', fetchImpl)
  const upgraded = await upgradeToLan(src, first, fetchImpl)
  const bundle = upgraded?.bundle ?? first

  const existing = new Set(session.characters.map((c) => c.name))
  const incoming = bundle.characters ?? []
  return {
    bundle,
    src: upgraded?.src ?? src,
    upgradedToLan: !!upgraded,
    conflictNames: incoming.filter((c) => existing.has(c.name)).map((c) => c.name),
    characterCount: incoming.length,
    apiKeysIncluded: !!bundle.llm?.apiKeys && Object.keys(bundle.llm.apiKeys).length > 0
  }
}

/** 私有位址才准跟去（RFC1918 ＋ loopback）。 */
function isPrivateHost(host: string): boolean {
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(host)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

/**
 * 掃 QR 拿到的多半是 relay 網址 —— 那條路徑拿不到 API Key。
 * 電腦若附了 `lanUrl`，就用**同一個權杖**改連區網再問一次；
 * 通了而且電腦說這次是直連，才採用。
 *
 * 為什麼安全：
 * - 位址由「我們已經帶著權杖認證過的那台電腦」提供，沒有新增信任對象
 * - 仍只接受私有位址，公網位址一律不跟（避免被導去別的地方）
 * - **金鑰給不給仍由電腦端依 `remoteAddress` 判定**，這裡只是換一條路去問
 *
 * 連不上就當沒這回事（在外面用行動網路時必然如此），回 `null` 沿用原本那條。
 */
async function upgradeToLan(
  src: SyncSource,
  bundle: SyncInitBundle,
  fetchImpl: FetchImpl
): Promise<{ src: SyncSource; bundle: SyncInitBundle } | null> {
  if (bundle.lanDirect) return null
  const lanUrl = bundle.lanUrl?.trim()
  if (!lanUrl) return null

  let host: string
  try {
    host = new URL(lanUrl).hostname
  } catch {
    return null
  }
  if (!isPrivateHost(host)) return null

  const lanSrc: SyncSource = { baseUrl: lanUrl.replace(/\/$/, ''), token: src.token }
  try {
    const next = await getJson<SyncInitBundle>(lanSrc, '/api/sync-init', fetchImpl)
    if (!next.lanDirect) return null
    return { src: lanSrc, bundle: next }
  } catch {
    return null
  }
}

/**
 * 電腦上有哪些對話可以帶過來。**這一步只拿後設資料**，內容等勾選完才逐則抓。
 *
 * 已經匯入過的照樣列出來但標記 `alreadyImported` —— 直接濾掉的話，使用者會以為
 * 那幾則消失了；標出來才知道「已經在手機上了」。
 */
export async function fetchSyncConversations(
  src: SyncSource,
  session: StandaloneSession,
  fetchImpl: FetchImpl = globalThis.fetch
): Promise<SyncConversationItem[]> {
  const res = await getJson<{ conversations?: Omit<SyncConversationItem, 'alreadyImported'>[] }>(
    src,
    '/api/sync-conversations',
    fetchImpl
  )
  const seen = session.importedConversationSourceIds()
  return (res.conversations ?? []).map((c) => ({ ...c, alreadyImported: seen.has(c.id) }))
}

/**
 * 實際匯入。順序刻意是「設定 → 預設組 → 角色 → 對話」：
 * 角色最慢（要下載 pack、寫圖檔），前面兩步先落地，中途失敗至少設定已經好了。
 * 對話排最後，因為它要靠角色先進來才對得上是誰在說話。
 */
export async function runSyncImport(
  src: SyncSource,
  session: StandaloneSession,
  opts: {
    onConflict: SyncConflictPolicy
    bundle?: SyncInitBundle
    /** 要帶過來的對話（電腦端 id）。空陣列＝不帶對話，這是預設。 */
    conversationIds?: string[]
    /** 角色與對話都是一個一個抓，這裡回報進度給 UI。 */
    onProgress?: (done: number, total: number) => void
  },
  fetchImpl: FetchImpl = globalThis.fetch
): Promise<SyncResult> {
  const bundle = opts.bundle ?? (await getJson<SyncInitBundle>(src, '/api/sync-init', fetchImpl))

  const apiKeysImported = applySettings(session, bundle)
  await applyNewsSettings(session, bundle)
  const presetsImported = await applyPresets(session, bundle)
  await session.saveSettings()
  await session.rememberSyncHost(src)

  /*
   * 情境綁定的對話一定要帶過來，否則套用情境時換不了對話
   * （owner 2026-08-09：「切情境都沒有切到和電腦一樣的角色和對話」）。
   * 使用者勾選的那幾則再併進去；已匯入的會被 importConversations 略過。
   */
  const wantedConvs = uniqueIds([
    ...(opts.conversationIds ?? []),
    ...sceneBoundConversationIds(bundle)
  ])
  const charTotal = (bundle.characters ?? []).length
  const grandTotal = charTotal + wantedConvs.length

  const { imported, skipped, failed, lorebooksImported } = await importCharacters(
    src,
    session,
    bundle,
    opts.onConflict,
    fetchImpl,
    // 進度條算的是「角色 ＋ 對話」的總數，所以角色階段的分母要換成總數
    opts.onProgress && ((done) => opts.onProgress!(done, grandTotal))
  )

  await session.reloadCharacters()
  await session.reloadPresets()

  const conv = await importConversations(
    src,
    session,
    bundle,
    wantedConvs,
    fetchImpl,
    opts.onProgress && ((done) => opts.onProgress!(charTotal + done, grandTotal))
  )

  /*
   * 一定要等角色與對話都落地才能對 id。
   * 同名情境現在會用電腦內容覆寫綁定欄位（見 applyPresets），再整批 remap。
   */
  await remapSceneReferences(session, bundle)
  await session.reloadPresets()

  session.events.push({ kind: 'state-invalidated', reason: 'desktop' })

  return {
    charactersImported: imported,
    charactersSkipped: skipped,
    charactersFailed: failed,
    presetsImported,
    apiKeysImported,
    settingsApplied: true,
    conversationsImported: conv.imported,
    conversationsFailed: conv.failed,
    lorebooksImported
  }
}

/**
 * 只把**設定**從電腦拉一次，可以重複執行（owner 2026-08-08）。
 *
 * S1 是一次性的初始化，解決不了「電腦改了設定、手機又要再設一次」——
 * 那本來是 S2 的守備範圍，但 S2 貴在雙向合併與差異預覽。這支把方向
 * 固定成「電腦 → 手機」，就退化成單純的覆蓋，不需要任何衝突處理。
 *
 * ## 刻意不碰的東西
 *
 * | 不動 | 為什麼 |
 * |---|---|
 * | 角色 | 每次都會多一份（匯入一律發新 id），重複按就會爆量 |
 * | 預設組 | 同上 |
 * | 對話 | 那是要勾選的，不該被「更新設定」順手帶走 |
 * | 天氣**地點** | 手機自己定位，見 `applyWeatherSettings` |
 *
 * 手機這邊改過的設定會被覆蓋掉 —— 所以 UI 上的按鈕要寫明是「以電腦的設定覆蓋」，
 * 不能只寫「同步」。
 */
export async function pullSettingsFromDesktop(
  src: SyncSource,
  session: StandaloneSession,
  fetchImpl: FetchImpl = globalThis.fetch
): Promise<{ apiKeysImported: number; lanDirect: boolean }> {
  const first = await getJson<SyncInitBundle>(src, '/api/sync-init', fetchImpl)
  // 走 relay 的話金鑰會被剝掉；能升級成區網直連就順手升，理由同 `fetchSyncPreview`
  const upgraded = await upgradeToLan(src, first, fetchImpl)
  const bundle = upgraded?.bundle ?? first
  const usedSrc = upgraded?.src ?? src

  const apiKeysImported = applySettings(session, bundle)
  await applyNewsSettings(session, bundle)
  /*
   * 設定覆蓋也要把情境的「在場角色／綁定對話」從電腦抄過來。
   * 這裡**只動情境**，不新增 persona／世界觀／角色（那是完整 S1 的事）。
   * 情境綁定的對話一併拉下來，否則套用時還是換不了對話。
   */
  await session.reloadPresets()
  await syncScenesFromBundle(session, bundle)
  await session.reloadPresets()
  await importConversations(usedSrc, session, bundle, sceneBoundConversationIds(bundle), fetchImpl)
  await remapSceneReferences(session, bundle)
  await session.reloadPresets()
  await session.saveSettings()
  await session.rememberSyncHost(usedSrc)
  session.events.push({ kind: 'state-invalidated', reason: 'desktop' })

  return { apiKeysImported, lanDirect: !!bundle.lanDirect }
}

/**
 * 對話一則一則抓（理由同角色：訊息帶著圖片的 data URI，整批會太大）。
 *
 * 一律以**新 id** 落地並記下 `importedFrom`，不覆蓋手機上任何既有對話。
 * 已經匯入過的直接略過 —— UI 那邊本來就不給勾，這裡是第二道保險
 * （清單抓完到按下匯入之間，使用者可能在另一個分頁匯過了）。
 */
async function importConversations(
  src: SyncSource,
  session: StandaloneSession,
  bundle: SyncInitBundle,
  ids: string[],
  fetchImpl: FetchImpl,
  onProgress?: (done: number) => void
): Promise<{ imported: number; failed: number }> {
  if (ids.length === 0) return { imported: 0, failed: 0 }

  const remap = characterIdRemap(session, bundle)
  const already = session.importedConversationSourceIds()
  let imported = 0
  let failed = 0

  for (let i = 0; i < ids.length; i++) {
    const sourceId = ids[i]!
    onProgress?.(i)
    if (already.has(sourceId)) continue

    try {
      const res = await getJson<{ conversation?: Conversation }>(
        src,
        `/api/sync-conversation?id=${encodeURIComponent(sourceId)}`,
        fetchImpl
      )
      const incoming = res.conversation
      if (!incoming) {
        failed++
        continue
      }
      const now = Date.now()
      await session.addImportedConversation({
        ...incoming,
        id: newId(),
        participantIds: (incoming.participantIds ?? []).map((cid) => remap(cid)),
        messages: (incoming.messages ?? []).map((m) =>
          m.characterId ? { ...m, characterId: remap(m.characterId) } : m
        ),
        importedFrom: {
          sourceId,
          sourceUpdatedAt: incoming.updatedAt,
          importedAt: now
        }
      })
      already.add(sourceId)
      imported++
    } catch {
      // 抓到第七則斷線時，前六則不該一起沒有（同角色那邊的處置）
      failed++
    }
  }

  onProgress?.(ids.length)
  return { imported, failed }
}

/**
 * 電腦端的角色 id → 這台手機的角色 id。
 *
 * **靠名字對**：`.dstpack` 解包時一律發新 id（`extractOneCharacter`），
 * 電腦那邊的 id 在手機上根本不存在。名字也正是 S1 判斷「同名衝突」的依據，
 * 兩處用同一把尺才不會出現「匯入時算同一隻、對話卻對不上」。
 *
 * 對不上的（角色沒一起帶過來、或事後改了名）原樣保留：訊息內容照樣看得到，
 * 只是少了名字與頭像。硬塞給別隻角色比這糟糕得多。
 */
function characterIdRemap(
  session: StandaloneSession,
  bundle: SyncInitBundle
): (sourceId: string) => string {
  const nameBySourceId = new Map((bundle.characters ?? []).map((c) => [c.id, c.name]))
  const localIdByName = new Map(session.characters.map((c) => [c.name, c.id]))
  return (sourceId) => {
    const name = nameBySourceId.get(sourceId)
    return (name && localIdByName.get(name)) || sourceId
  }
}

/** 回傳帶進來的金鑰數量。 */
function applySettings(session: StandaloneSession, bundle: SyncInitBundle): number {
  const s = session.settings

  if (bundle.colorTheme) s.ui.colorTheme = bundle.colorTheme as AppSettings['ui']['colorTheme']
  if (typeof bundle.showLlmBadge === 'boolean') s.ui.showLlmBadge = bundle.showLlmBadge
  if (typeof bundle.randomToolsEnabled === 'boolean') s.ui.randomToolsEnabled = bundle.randomToolsEnabled

  if (bundle.memory) s.memory = { ...s.memory, ...bundle.memory }

  let apiKeysImported = 0
  const llm = bundle.llm
  if (llm) {
    const { apiKeys, models, endpoints, utilityModels, ...rest } = llm
    s.llm = { ...s.llm, ...rest }
    /*
     * `models`／`endpoints`／`utilityModels` 是「每家供應商各自」的表，
     * 逐 key 合併、不要整包覆蓋——跟下面 `apiKeys` 同一套理由：整包蓋掉的話，
     * 電腦沒設定過的那幾家會被手機自己填過的值一起清掉。這正是「本地模型的
     * 端點／模型清單同步過來反而消失」的成因（owner 2026-08-24 實機回報），
     * `resolveEndpoint()` 只信 `endpoints[provider]`，表非空但缺這一家時
     * **不會**退回舊的攤平欄位。
     */
    if (models) s.llm.models = mergeNonEmpty(s.llm.models, models)
    if (endpoints) s.llm.endpoints = mergeNonEmpty(s.llm.endpoints, endpoints)
    if (utilityModels) s.llm.utilityModels = mergeNonEmpty(s.llm.utilityModels, utilityModels)
    if (apiKeys) {
      // 只覆蓋電腦上真的有值的那幾家，手機自己填過的其他家不要被清掉
      for (const [provider, key] of Object.entries(apiKeys)) {
        if (!key?.trim()) continue
        s.llm.apiKeys = { ...s.llm.apiKeys, [provider]: key }
        apiKeysImported++
      }
    }
  }

  apiKeysImported += applyWeatherSettings(s, bundle)

  // 模組開關：手機沒有的模組略過（例如桌面限定的那些）
  // 新聞不在這裡——它的開關住在模組自己的設定檔，見 `applyNewsSettings`
  for (const m of bundle.modules ?? []) {
    if (m.id === 'desktopst.weather' && s.weather) s.weather.enabled = m.enabled
    if (m.id === 'desktopst.spotify' && s.spotify) s.spotify.enabled = m.enabled
    if (m.id === 'desktopst.calendar' && s.calendar) s.calendar.enabled = m.enabled
  }

  return apiKeysImported
}

/**
 * 新聞：關鍵字／來源／分組／黑名單等設定，外加模組開關。
 *
 * 與其他模組分開處理是因為**新聞的設定不在 `settings.json`**，
 * 而在 `modules/desktopst.news/settings.json`（`core/store/moduleSettings.ts`
 * 的 key 佈局，兩個平台一致），寫入是非同步的。
 *
 * 兩個來源合成一次寫入：設定本體來自 `bundle.news`，`enabled` 來自
 * `bundle.modules`——分兩次寫會讓「設定覆蓋」與「開關覆蓋」各觸發一次
 * 讀改寫，中間那次的結果是半套的。
 */
async function applyNewsSettings(session: StandaloneSession, bundle: SyncInitBundle): Promise<void> {
  const patch: Partial<NewsModuleSettings> = { ...(bundle.news ?? {}) }

  const toggle = (bundle.modules ?? []).find((m) => m.id === 'desktopst.news')
  if (toggle) patch.enabled = toggle.enabled

  if (Object.keys(patch).length === 0) return
  await saveNewsModuleSettings(session.adapters.storage, patch)
}

/**
 * 天氣：帶潤飾開關與 CWA 設定，**不動地點**。
 *
 * 回傳帶進來的金鑰數（CWA 金鑰算一把，計入畫面上的「已帶入 N 把金鑰」）。
 */
function applyWeatherSettings(s: AppSettings, bundle: SyncInitBundle): number {
  const from = bundle.weather
  if (!from) return 0

  // 手機可能還沒碰過天氣，先給一份空的再往上蓋
  s.weather ??= {
    enabled: false,
    polish: false,
    locationName: '',
    latitude: 0,
    longitude: 0,
    locationSource: ''
  }

  if (typeof from.polish === 'boolean') s.weather.polish = from.polish

  const rq = from.realtimeQuery
  if (!rq) return 0

  const existingKey = s.weather.realtimeQuery?.cwaApiKey ?? ''
  /*
   * 沒附金鑰欄位＝這條連線不給金鑰（不是「電腦上是空的」），
   * 這時要留住手機自己填過的那把。判斷規則與 LLM 金鑰一致。
   */
  const key = rq.cwaApiKey?.trim() ? rq.cwaApiKey : existingKey
  s.weather.realtimeQuery = {
    enabled: rq.enabled,
    forecastCounty: rq.forecastCounty,
    cwaApiKey: key
  }
  return rq.cwaApiKey?.trim() ? 1 : 0
}

/**
 * 預設組落地規則：
 * - Persona／World：同名略過（避免蓋掉手機上改過的文案）
 * - Scene：**同名則覆寫綁定欄位**（在場角色、對話、身分、世界觀、配色……）
 *
 * 情境同名略過是 2026-08-09 才發現的坑：第一次匯入若帶著電腦端 id、或手機上
 * 先有一個空的同名情境，之後再拉一次永遠拿不到電腦那份角色／對話綁定，
 * 套用看起來「沒反應」。身分／世界觀的內文仍以同名略過為準；情境要的是
 * 「桌面狀態快照」，內容本來就該跟電腦對齊。
 *
 * ⚠️ 寫進去的引用這時還是電腦端 id，由後續的 `remapSceneReferences` 收尾。
 */
async function applyPresets(session: StandaloneSession, bundle: SyncInitBundle): Promise<number> {
  const keys = await import('@core/store/keys')
  let count = 0
  const now = Date.now()

  const existingPersona = new Set(session.personas.map((p) => p.name))
  for (const p of bundle.personas ?? []) {
    if (existingPersona.has(p.name)) continue
    const next: PersonaPreset = { ...p, id: newId(), createdAt: p.createdAt || now, updatedAt: now }
    await session.adapters.storage.writeJson(keys.personaKey(next.id), next)
    if (bundle.activePersonaId === p.id) session.settings.activePersonaId = next.id
    count++
  }

  const existingWorld = new Set(session.worlds.map((w) => w.name))
  for (const w of bundle.worlds ?? []) {
    if (existingWorld.has(w.name)) continue
    const next: WorldPreset = { ...w, id: newId(), createdAt: w.createdAt || now, updatedAt: now }
    await session.adapters.storage.writeJson(keys.worldKey(next.id), next)
    if (bundle.activeWorldId === w.id) session.settings.activeWorldId = next.id
    count++
  }

  count += await syncScenesFromBundle(session, bundle)
  return count
}

/**
 * 把電腦的情境綁定寫進手機（同名覆寫、沒有就新建）。
 * S1 完整匯入與「重新拉設定」共用。
 */
async function syncScenesFromBundle(session: StandaloneSession, bundle: SyncInitBundle): Promise<number> {
  const keys = await import('@core/store/keys')
  const now = Date.now()
  let count = 0
  const localByName = new Map(session.scenes.map((s) => [s.name, s]))

  for (const sc of bundle.scenes ?? []) {
    const existing = localByName.get(sc.name)
    if (existing) {
      existing.activePersonaId = sc.activePersonaId
      existing.activeWorldId = sc.activeWorldId
      existing.desktopCharacters = (sc.desktopCharacters ?? []).map((d) => ({ ...d }))
      existing.lastActiveConversationId = sc.lastActiveConversationId
      existing.colorTheme = sc.colorTheme
      existing.lorebookIds = sc.lorebookIds
      existing.moduleOverrides = sc.moduleOverrides
      existing.newsKeywordGroupId = sc.newsKeywordGroupId
      existing.updatedAt = now
      await session.adapters.storage.writeJson(keys.sceneKey(existing.id), existing)
    } else {
      const next: ScenePreset = { ...sc, id: newId(), createdAt: sc.createdAt || now, updatedAt: now }
      await session.adapters.storage.writeJson(keys.sceneKey(next.id), next)
      localByName.set(next.name, next)
    }
    count++
  }
  return count
}

/** 電腦端情境記著的對話 id（套用情境時要切過去的那則）。 */
function sceneBoundConversationIds(bundle: SyncInitBundle): string[] {
  return uniqueIds(
    (bundle.scenes ?? [])
      .map((s) => s.lastActiveConversationId)
      .filter((id): id is string => !!id?.trim())
  )
}

/**
 * 逐 key 合併「每家供應商各自」的表（`llm.models`／`llm.endpoints`／
 * `llm.utilityModels`）。電腦沒填值的 key 不覆蓋，手機自己填過的原樣留著。
 */
function mergeNonEmpty(
  local: Record<string, string> | undefined,
  incoming: Record<string, string>
): Record<string, string> {
  const next: Record<string, string> = { ...local }
  for (const [key, value] of Object.entries(incoming)) {
    if (value?.trim()) next[key] = value
  }
  return next
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)]
}

/**
 * 把情境裡的**電腦端 id** 換成這台手機的 id。
 *
 * 不做這件事的話，情境等於指向一堆不存在的東西，症狀有兩個而且都很難聯想到匯入
 * （owner 2026-08-08 回報）：
 *
 * 1. **星號一直亮**：dirty 拿情境記的在場角色與目前的比，一邊是電腦 id、
 *    一邊是手機 id，永遠不相等。
 * 2. **套用沒反應**：`applyScene` 只留「這台手機真的有的角色」，全部對不到就
 *    整組跳過；對話同理，`conversationIndex` 查不到就不切換。
 *
 * 一律**靠名字**對應（與對話匯入的 `characterIdRemap` 同一套作法）。
 *
 * 已是手機 id 的欄位（不在電腦端清單裡）**原樣留下**，否則會把使用者本機自建的
 * 情境一起洗壞。電腦端 id 對不到本地名字的角色／對話則刪掉 —— 留著只會讓星號永遠亮。
 *
 * 可重複執行：S1 初次匯入、以及「從電腦重新拉設定」都會跑，用來修舊資料。
 */
async function remapSceneReferences(session: StandaloneSession, bundle: SyncInitBundle): Promise<void> {
  if (session.scenes.length === 0) return
  const keys = await import('@core/store/keys')

  const nameBySourceId = <T extends { id: string; name: string }>(
    source: readonly T[] | undefined
  ): Map<string, string> => new Map((source ?? []).map((x) => [x.id, x.name]))

  const personaName = nameBySourceId(bundle.personas)
  const worldName = nameBySourceId(bundle.worlds)
  const characterName = nameBySourceId(bundle.characters)
  const localPersona = new Map(session.personas.map((p) => [p.name, p.id]))
  const localWorld = new Map(session.worlds.map((w) => [w.name, w.id]))
  const localCharacter = new Map(session.characters.map((c) => [c.name, c.id]))
  const ownedChars = new Set(session.characters.map((c) => c.id))
  const convIdBySourceId = session.importedConversationIds()
  const localConvIds = new Set(session.listConversations().map((c) => c.id))

  /** 在電腦清單裡 → 換成同名本地 id；不在清單裡 → 視為已是本地 id，不動。 */
  const remapNamed = (
    sourceId: string,
    names: Map<string, string>,
    localByName: Map<string, string>,
    fallback: string
  ): string => {
    const name = names.get(sourceId)
    if (!name) return sourceId
    return localByName.get(name) ?? fallback
  }

  for (const scene of session.scenes) {
    scene.activePersonaId = remapNamed(
      scene.activePersonaId,
      personaName,
      localPersona,
      session.settings.activePersonaId
    )
    scene.activeWorldId = remapNamed(
      scene.activeWorldId,
      worldName,
      localWorld,
      session.settings.activeWorldId
    )

    scene.desktopCharacters = scene.desktopCharacters.flatMap((d) => {
      const name = characterName.get(d.characterId)
      if (name) {
        const local = localCharacter.get(name)
        return local ? [{ ...d, characterId: local }] : []
      }
      // 不在電腦清單：保留本地已有的，丟掉幽靈 id
      return ownedChars.has(d.characterId) ? [d] : []
    })

    const want = scene.lastActiveConversationId
    if (want) {
      const mapped = convIdBySourceId.get(want)
      if (mapped) scene.lastActiveConversationId = mapped
      else if (!localConvIds.has(want)) scene.lastActiveConversationId = undefined
    }

    await session.adapters.storage.writeJson(keys.sceneKey(scene.id), scene)
  }
}

/**
 * 角色**一隻一隻**抓。
 *
 * 不要整庫一包：owner 的資料庫（10 隻、含表情圖）整包 54 MB，而手機端是
 * `arrayBuffer()` 一次吃下、CapacitorHttp 又會把二進位 base64 過 JS bridge，
 * 實測會失敗。分開拿還有兩個好處：UI 有進度、單隻壞掉不會整批白做。
 */
async function importCharacters(
  src: SyncSource,
  session: StandaloneSession,
  bundle: SyncInitBundle,
  onConflict: SyncConflictPolicy,
  fetchImpl: FetchImpl,
  onProgress?: (done: number, total: number) => void
): Promise<{ imported: number; skipped: number; failed: number; lorebooksImported: number }> {
  const keys = await import('@core/store/keys')
  const wanted = bundle.characters ?? []
  const total = wanted.length

  let imported = 0
  let skipped = 0
  let failed = 0
  const lorebookIds = new Set<string>()  // 去重用 Set，最後轉回 .size

  for (let i = 0; i < total; i++) {
    const entry = wanted[i]!
    onProgress?.(i, total)

    // 同名的先問過再下載，省掉整包流量
    const beforeIds = new Set(session.characters.map((c) => c.id))
    const clash = session.characters.find((c) => c.name === entry.name)
    if (clash && onConflict === 'skip') {
      skipped++
      continue
    }

    let chars: Awaited<ReturnType<typeof importCharactersFromDstPack>>['chars']
    try {
      const bytes = await getBinary(src, `/api/sync-pack?id=${encodeURIComponent(entry.id)}`, fetchImpl)
      if (!bytes || bytes.byteLength === 0) {
        failed++
        continue
      }
      const result = await importCharactersFromDstPack(session.adapters.storage, bytes)
      chars = result.chars
      // 多隻角色都掛同一本書時，Set 會自動去重（同 id 只加一次）
      for (const id of result.lorebookIds) {
        lorebookIds.add(id)
      }
    } catch {
      // 單隻失敗不中斷整批 —— 十隻抓到第七隻斷線時，前六隻不該一起沒有
      failed++
      continue
    }

    for (const incoming of chars) {
      if (clash && onConflict === 'overwrite') {
        await session.adapters.storage.remove(keys.characterDirKey(clash.id))
        session.characters = session.characters.filter((c) => c.id !== clash.id)
        session.settings.ui.desktopCharacters = session.settings.ui.desktopCharacters.map((d) =>
          d.characterId === clash.id ? { ...d, characterId: incoming.id } : d
        )
      }
      // 剛解壓的那份要進記憶體清單，下一輪的同名比對才看得到它
      if (!beforeIds.has(incoming.id)) session.characters.push(incoming)
      imported++
    }
  }

  onProgress?.(total, total)
  return { imported, skipped, failed, lorebooksImported: lorebookIds.size }
}
