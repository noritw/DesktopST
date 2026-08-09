import JSZip from 'jszip'
import type { StorageAdapter } from '@core/adapters'
import * as keys from '@core/store/keys'
import type { Character, DesktopCharacterState, PersonaPreset, WorldPreset } from '@core/types'
import { normalizeLorebook, type Lorebook } from '@core/lore'
import { newId } from './id'

import defaultPersonaJson from '../../../assets/default-persona.json'
import defaultWorldJson from '../../../assets/default-world.json'
import type { ScenePreset } from '@core/types'

/** 建置時抄到 `out/mobile/`；APK 可 fetch。網頁遙控不會跑這條。 */
export const DEFAULT_CHARA_PACK_URL = './DesktopST_DefaultChara.dstpack'

export async function seedDefaultPresetsIfEmpty(storage: StorageAdapter): Promise<{
  personas: PersonaPreset[]
  worlds: WorldPreset[]
  scenes: ScenePreset[]
}> {
  const personaNames = await storage.list(keys.PERSONAS_DIR)
  const worldNames = await storage.list(keys.WORLDS_DIR)
  const sceneNames = await storage.list(keys.SCENES_DIR)
  const personas: PersonaPreset[] = []
  const worlds: WorldPreset[] = []
  const scenes: ScenePreset[] = []

  if (personaNames.length === 0) {
    const now = Date.now()
    const preset: PersonaPreset = {
      id: newId(),
      name: defaultPersonaJson.name ?? '預設使用者',
      displayName: defaultPersonaJson.displayName ?? '使用者',
      nickname: defaultPersonaJson.nickname ?? '主人',
      description: defaultPersonaJson.description ?? '',
      builtIn: true,
      createdAt: now,
      updatedAt: now
    }
    await storage.writeJson(keys.personaKey(preset.id), preset)
    personas.push(preset)
  }

  if (worldNames.length === 0) {
    const now = Date.now()
    const preset: WorldPreset = {
      id: newId(),
      name: defaultWorldJson.name ?? '預設世界觀',
      worldSetting: defaultWorldJson.worldSetting ?? '',
      interactionExample: defaultWorldJson.interactionExample ?? '',
      builtIn: true,
      createdAt: now,
      updatedAt: now
    }
    await storage.writeJson(keys.worldKey(preset.id), preset)
    worlds.push(preset)
  }

  if (sceneNames.length === 0) {
    const now = Date.now()
    const defaultPersonaId = personas[0]?.id ?? (await firstIdInDir(storage, personaNames))
    const defaultWorldId = worlds[0]?.id ?? (await firstIdInDir(storage, worldNames))
    if (defaultPersonaId && defaultWorldId) {
      const preset: ScenePreset = {
        id: newId(),
        name: '預設情境',
        activePersonaId: defaultPersonaId,
        activeWorldId: defaultWorldId,
        desktopCharacters: [],
        createdAt: now,
        updatedAt: now
      }
      await storage.writeJson(keys.sceneKey(preset.id), preset)
      scenes.push(preset)
    }
  }

  return { personas, worlds, scenes }
}

/** 舊資料（personas/worlds 早就存在，本次沒新建）時，從既有檔名清單取第一筆的 id。 */
async function firstIdInDir(storage: StorageAdapter, listed: string[]): Promise<string | null> {
  const name = listed[0]?.split('/').pop() ?? ''
  return keys.idFromJsonName(name)
}

/**
 * 空角色庫時嘗試解預設 dstpack；失敗則建一張空白卡，保證獨立模式有人可聊。
 */
export async function seedDefaultCharactersIfEmpty(
  storage: StorageAdapter,
  opts?: { packUrl?: string; packBytes?: Uint8Array | null; skipFetch?: boolean }
): Promise<{ chars: Character[]; desktopState: DesktopCharacterState[] }> {
  const existingKeys = await storage.list(keys.CHARACTERS_DIR)
  if (existingKeys.length > 0) {
    return { chars: [], desktopState: [] }
  }

  const bytes =
    opts?.packBytes !== undefined
      ? opts.packBytes
      : opts?.skipFetch
        ? null
        : await tryFetchPack(opts?.packUrl ?? DEFAULT_CHARA_PACK_URL)
  if (bytes && bytes.byteLength > 0) {
    try {
      return await importCharactersFromDstPack(storage, bytes)
    } catch (e) {
      console.warn('[standalone] default dstpack import failed; falling back to blank character', e)
    }
  } else if (!opts?.skipFetch) {
    console.warn('[standalone] default character pack not found; creating blank character')
  }

  const char = blankCharacter('新角色')
  await storage.writeJson(keys.characterCardKey(char.id), char)
  const desktopState: DesktopCharacterState[] = [
    {
      characterId: char.id,
      position: { x: 80, y: 400 },
      size: 1,
      flipped: false,
      muted: false,
      zIndex: 1
    }
  ]
  return { chars: [char], desktopState }
}

function blankCharacter(name: string): Character {
  const now = Date.now()
  return {
    id: newId(),
    name,
    nicknames: [],
    avatar: '',
    description: '',
    personality: '',
    firstMessage: '',
    exampleDialogue: '',
    emotions: {},
    scenario: '',
    systemPromptOverride: '',
    creatorNotes: '',
    createdAt: now,
    updatedAt: now
  }
}

async function tryFetchPack(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return new Uint8Array(await res.arrayBuffer())
  } catch {
    return null
  }
}

export async function importCharactersFromDstPack(
  storage: StorageAdapter,
  bytes: Uint8Array
): Promise<{ chars: Character[]; desktopState: DesktopCharacterState[]; lorebookIds: Set<string> }> {
  const zip = await JSZip.loadAsync(bytes)
  const mf = zip.file('manifest.json')
  if (!mf) throw new Error('missing manifest.json')
  const manifest = JSON.parse(await mf.async('string')) as {
    format?: string
    characterIds?: string[]
  }
  if (manifest.format !== 'desktopst-pack') throw new Error('bad pack format')

  const prefixes = new Set<string>()
  const wanted = new Set((manifest.characterIds ?? []).map(String))
  for (const p of Object.keys(zip.files)) {
    const norm = p.replace(/\\/g, '/')
    const m = /^characters\/([^/]+)\//.exec(norm)
    if (!m) continue
    if (wanted.size === 0 || wanted.has(m[1])) prefixes.add(`characters/${m[1]}`)
  }
  if (prefixes.size === 0) throw new Error('pack has no characters')

  const created: Character[] = []
  for (const prefix of [...prefixes].sort()) {
    const char = await extractOneCharacter(storage, zip, prefix)
    if (char) created.push(char)
  }
  if (created.length === 0) throw new Error('no characters extracted')

  const lorebookIds = await importLorebooksFromPack(storage, zip)

  const desktopState: DesktopCharacterState[] = created.map((c, i) => ({
    characterId: c.id,
    position: { x: 80 + i * 220, y: 400 },
    size: 1,
    flipped: false,
    muted: false,
    zIndex: i + 1
  }))
  return { chars: created, desktopState, lorebookIds }
}

/**
 * 落地 `.dstpack` 裡帶的用語解說（規格 §7.3／§4.2）。
 *
 * **用原本的 id 存**，不像角色那樣重發新 id——角色卡的 `lorebookIds` 與世界觀的
 * `lorebookIds`（隨 `/api/sync-init` 一起帶來的 `WorldPreset`）都還是電腦端原本
 * 那個 id，只要本機用同一個 id 落地，兩邊立刻對得上，不必再補一道 remap。
 * 同 id 已存在就覆蓋——重新同步時內容要能跟著電腦更新。
 *
 * 單本壞掉（JSON 解析失敗）靜默略過，不擋角色匯入（規格 §6.6 同一原則）。
 * 回傳已落地的 id 集合（不是計數）—— 多隻角色都掛同一本書時，外面要去重。
 */
async function importLorebooksFromPack(storage: StorageAdapter, zip: JSZip): Promise<Set<string>> {
  const ids = new Set<string>()
  for (const p of Object.keys(zip.files)) {
    const norm = p.replace(/\\/g, '/')
    if (!/^lorebooks\/[^/]+\.json$/.test(norm)) continue
    const zf = zip.files[p]
    if (!zf || zf.dir) continue
    try {
      const raw = JSON.parse(await zf.async('string')) as Lorebook
      if (!raw?.id) continue
      const book = normalizeLorebook(raw)
      await storage.writeJson(keys.lorebookKey(book.id), book)
      ids.add(book.id)
    } catch {
      continue
    }
  }
  return ids
}

async function extractOneCharacter(
  storage: StorageAdapter,
  zip: JSZip,
  prefix: string
): Promise<Character | null> {
  const cardFile = zip.file(`${prefix}/card.json`)
  if (!cardFile) return null
  let diskCard: Character
  try {
    diskCard = JSON.parse(await cardFile.async('string')) as Character
  } catch {
    return null
  }
  if (!diskCard?.name) return null

  const newIdVal = newId()
  const dirKey = keys.characterDirKey(newIdVal)
  const pref = prefix.replace(/\\/g, '/')

  for (const relPath of Object.keys(zip.files)) {
    const zf = zip.files[relPath]
    if (!zf || zf.dir) continue
    const norm = relPath.replace(/\\/g, '/')
    if (!norm.startsWith(`${pref}/`)) continue
    const tail = norm.slice(pref.length + 1)
    if (!tail || tail === 'card.json') continue
    const data = new Uint8Array(await zf.async('uint8array'))
    await storage.writeBinary(`${dirKey}/${tail}`, data)
  }

  diskCard.id = newIdVal
  diskCard.createdAt = diskCard.createdAt || Date.now()
  diskCard.updatedAt = Date.now()

  // 路徑改成沙箱相對 key（相對於角色資料夾）
  const avatarRaw = (diskCard.avatar || '').trim().replace(/\\/g, '/')
  let avatarKey = ''
  if (avatarRaw && !avatarRaw.includes('..')) {
    const candidate = `${dirKey}/${avatarRaw.split('/').pop()}`
    if (await storage.exists(candidate)) avatarKey = candidate
    else if (await storage.exists(`${dirKey}/${avatarRaw}`)) avatarKey = `${dirKey}/${avatarRaw}`
  }
  if (!avatarKey) {
    const listed = await storage.list(dirKey)
    const hit = listed.find((k) => /\/avatar[^/]*\.(png|jpe?g|webp)$/i.test(k))
    if (hit) avatarKey = hit
  }
  diskCard.avatar = avatarKey

  const emotions: Record<string, string> = {}
  for (const [ek, ev] of Object.entries(diskCard.emotions ?? {})) {
    if (typeof ev !== 'string' || !ev.trim()) continue
    const rel = ev.replace(/\\/g, '/')
    const candidates = [`${dirKey}/${rel}`, `${dirKey}/emotions/${rel.split('/').pop()}`]
    let found = ''
    for (const c of candidates) {
      if (await storage.exists(c)) {
        found = c
        break
      }
    }
    emotions[ek] = found || ''
  }
  diskCard.emotions = emotions

  await storage.writeJson(keys.characterCardKey(newIdVal), diskCard)
  return diskCard
}

export { blankCharacter }
