import type { AppSettings, PersonaPreset, ScenePreset, WorldPreset } from '@core/types'
import type { StandaloneSession } from './session'
import { importCharactersFromDstPack } from './seedDefaults'
import { newId } from './id'

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
  colorTheme?: string
  showLlmBadge?: boolean
  randomToolsEnabled?: boolean
  llm?: Partial<AppSettings['llm']> & { apiKeys?: Record<string, string> }
  memory?: Partial<AppSettings['memory']>
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

export interface SyncSource {
  /** 不含結尾斜線，例如 `http://192.168.1.20:3721` */
  baseUrl: string
  token: string
}

export interface SyncPreview {
  bundle: SyncInitBundle
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
  presetsImported: number
  apiKeysImported: number
  settingsApplied: boolean
}

export class SyncError extends Error {
  constructor(
    readonly code: 'unreachable' | 'unauthorized' | 'server-error' | 'bad-response' | 'empty',
    message: string
  ) {
    super(message)
    this.name = 'SyncError'
  }
}

type FetchImpl = typeof globalThis.fetch

function authHeaders(src: SyncSource): Record<string, string> {
  return { 'X-DesktopST-Token': src.token }
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
  const bundle = await getJson<SyncInitBundle>(src, '/api/sync-init', fetchImpl)
  const existing = new Set(session.characters.map((c) => c.name))
  const incoming = bundle.characters ?? []
  return {
    bundle,
    conflictNames: incoming.filter((c) => existing.has(c.name)).map((c) => c.name),
    characterCount: incoming.length,
    apiKeysIncluded: !!bundle.llm?.apiKeys && Object.keys(bundle.llm.apiKeys).length > 0
  }
}

/**
 * 實際匯入。順序刻意是「設定 → 預設組 → 角色」：
 * 角色最慢（要下載 pack、寫圖檔），前面兩步先落地，中途失敗至少設定已經好了。
 */
export async function runSyncImport(
  src: SyncSource,
  session: StandaloneSession,
  opts: { onConflict: SyncConflictPolicy; bundle?: SyncInitBundle },
  fetchImpl: FetchImpl = globalThis.fetch
): Promise<SyncResult> {
  const bundle = opts.bundle ?? (await getJson<SyncInitBundle>(src, '/api/sync-init', fetchImpl))

  const apiKeysImported = applySettings(session, bundle)
  const presetsImported = await applyPresets(session, bundle)
  await session.saveSettings()

  const { imported, skipped } = await importCharacters(src, session, opts.onConflict, fetchImpl)

  await session.reloadCharacters()
  await session.reloadPresets()
  session.events.push({ kind: 'state-invalidated', reason: 'desktop' })

  return {
    charactersImported: imported,
    charactersSkipped: skipped,
    presetsImported,
    apiKeysImported,
    settingsApplied: true
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
    const { apiKeys, ...rest } = llm
    s.llm = { ...s.llm, ...rest }
    if (apiKeys) {
      // 只覆蓋電腦上真的有值的那幾家，手機自己填過的其他家不要被清掉
      for (const [provider, key] of Object.entries(apiKeys)) {
        if (!key?.trim()) continue
        s.llm.apiKeys = { ...s.llm.apiKeys, [provider]: key }
        apiKeysImported++
      }
    }
  }

  // 模組開關：手機沒有的模組略過（例如桌面限定的那些）
  for (const m of bundle.modules ?? []) {
    if (m.id === 'desktopst.weather' && s.weather) s.weather.enabled = m.enabled
    if (m.id === 'desktopst.spotify' && s.spotify) s.spotify.enabled = m.enabled
    if (m.id === 'desktopst.calendar' && s.calendar) s.calendar.enabled = m.enabled
  }

  return apiKeysImported
}

/**
 * 預設組一律以**新 id** 落地，並保留電腦端的名字。
 * 用新 id 是因為手機上可能已經有同 id 的內建預設組（種子產生的 id 與電腦無關），
 * 直接沿用會蓋掉使用者自己改過的那份。
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

  const existingScene = new Set(session.scenes.map((s) => s.name))
  for (const sc of bundle.scenes ?? []) {
    if (existingScene.has(sc.name)) continue
    const next: ScenePreset = { ...sc, id: newId(), createdAt: sc.createdAt || now, updatedAt: now }
    await session.adapters.storage.writeJson(keys.sceneKey(next.id), next)
    count++
  }

  return count
}

async function importCharacters(
  src: SyncSource,
  session: StandaloneSession,
  onConflict: SyncConflictPolicy,
  fetchImpl: FetchImpl
): Promise<{ imported: number; skipped: number }> {
  const bytes = await getBinary(src, '/api/sync-pack', fetchImpl)
  if (!bytes || bytes.byteLength === 0) return { imported: 0, skipped: 0 }

  const keys = await import('@core/store/keys')
  const beforeIds = new Set(session.characters.map((c) => c.id))
  const { chars } = await importCharactersFromDstPack(session.adapters.storage, bytes)

  let imported = 0
  let skipped = 0
  for (const incoming of chars) {
    const clash = session.characters.find((c) => beforeIds.has(c.id) && c.name === incoming.name)
    if (clash && onConflict === 'skip') {
      // 已經解壓到磁碟了，略過就要把剛落地的那份清掉
      await session.adapters.storage.remove(keys.characterDirKey(incoming.id))
      skipped++
      continue
    }
    if (clash && onConflict === 'overwrite') {
      await session.adapters.storage.remove(keys.characterDirKey(clash.id))
      session.characters = session.characters.filter((c) => c.id !== clash.id)
      session.settings.ui.desktopCharacters = session.settings.ui.desktopCharacters.map((d) =>
        d.characterId === clash.id ? { ...d, characterId: incoming.id } : d
      )
    }
    imported++
  }
  return { imported, skipped }
}

async function getJson<T>(src: SyncSource, path: string, fetchImpl: FetchImpl): Promise<T> {
  const res = await request(src, path, fetchImpl)
  try {
    return (await res.json()) as T
  } catch {
    throw new SyncError('bad-response', `${path} 回應不是 JSON`)
  }
}

async function getBinary(src: SyncSource, path: string, fetchImpl: FetchImpl): Promise<Uint8Array> {
  const res = await request(src, path, fetchImpl)
  return new Uint8Array(await res.arrayBuffer())
}

async function request(src: SyncSource, path: string, fetchImpl: FetchImpl): Promise<Response> {
  let res: Response
  try {
    res = await fetchImpl(`${src.baseUrl.replace(/\/$/, '')}${path}`, { headers: authHeaders(src) })
  } catch (e) {
    throw new SyncError('unreachable', e instanceof Error ? e.message : String(e))
  }
  if (res.status === 401 || res.status === 403) {
    throw new SyncError('unauthorized', `${path} 回 ${res.status}`)
  }
  if (res.status === 404) throw new SyncError('empty', `${path} 回 404`)
  if (!res.ok) throw new SyncError('server-error', `${path} 回 ${res.status}`)
  return res
}
