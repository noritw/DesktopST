import type { SyncBaseline, SyncDiff } from '@core/sync/types'
import type { StandaloneSession } from './session'
import { readBaseline, writeBaseline } from './syncBaseline'
import type { FetchImpl, SyncSource } from './syncTransport'
import { request } from './syncTransport'

/**
 * S2 M3 推送邏輯（`docs/mobile-sync-m3-kickoff.md`）。
 *
 * 根據 diff 算出的變動，把使用者勾選要帶的資料推送到電腦。
 * 成功推送後更新本地基準，失敗時保持基準不變。
 *
 * **這一版只推**（§5 步驟②）：
 * - 角色／人設／世界觀／用語解說的新增＋修改（不含刪除）
 *
 * **暫不推**（見 §5 步驟③④）：
 * - 情境（需欄位過濾，§3.2）
 * - 設定（需拆成多支呼叫，§3.3）
 */

export interface PushOptions {
  /** 使用者要帶過去的 id（characters, personas, worlds, scenes, lorebooks）。未勾的就不推。 */
  selectedIds: {
    characters?: Set<string>
    personas?: Set<string>
    worlds?: Set<string>
    scenes?: Set<string>
    lorebooks?: Set<string>
  }
  /** 推送進度回調。 */
  onProgress?: (message: string) => void
}

/**
 * 算出「帶過去並切換」預設要選的 id（M3 UI 用，`ModeSwitcher.tsx` 呼叫）。
 *
 * **第一次同步（`diff.hasBaseline === false`）要特別處理**：`computeDiff()`
 * 對第一次同步刻意讓每個 collection 全空（`core/sync/diff.ts` 的註解——
 * 不要把「本地目前有的資料」逐筆判成新增，那只是在重述使用者有資料）。
 * 但這代表如果直接拿 `diff.characters.localNew` 建選取清單，第一次同步時
 * 會全部是空集合、使用者選了「帶過去」卻什麼都沒推。第一次同步要推的
 * 是「本地目前全部的資料」，不是 diff 裡（刻意留空）的新增清單。
 */
export async function buildPushSelection(diff: SyncDiff, session: StandaloneSession): Promise<PushOptions['selectedIds']> {
  if (!diff.hasBaseline) {
    const lorebooks = await session.listLorebooksManifest()
    return {
      characters: new Set(session.characters.map((c) => c.id)),
      personas: new Set(session.personas.map((p) => p.id)),
      worlds: new Set(session.worlds.map((w) => w.id)),
      scenes: new Set(session.scenes.map((s) => s.id)),
      lorebooks: new Set(lorebooks.map((l) => l.id))
    }
  }
  return {
    characters: new Set([...diff.characters.localNew, ...diff.characters.localModified]),
    personas: new Set([...diff.personas.localNew, ...diff.personas.localModified]),
    worlds: new Set([...diff.worlds.localNew, ...diff.worlds.localModified]),
    scenes: new Set([...diff.scenes.localNew, ...diff.scenes.localModified]),
    lorebooks: new Set([...diff.lorebooks.localNew, ...diff.lorebooks.localModified])
  }
}

/**
 * 推送選中的資料到電腦，並更新本地基準（§5 步驟②）。
 *
 * 呼叫端（`ModeSwitcher.tsx`）負責：
 * - 決定使用者是「帶過去並切換」還是「直接切、不帶」
 * - 只有「帶過去」時才呼叫這支，並在返回後才更新連線模式
 *
 * 推送失敗不中斷，但也不部份更新基準。整趟失敗就整份基準保持不動（§3.1）。
 */
export async function pushSync(
  src: SyncSource,
  session: StandaloneSession,
  diff: SyncDiff,
  opts: PushOptions,
  fetchImpl: FetchImpl = globalThis.fetch
): Promise<void> {
  // 第一次同步（從未寫過基準）時 readBaseline() 回傳 null——這不是錯誤，
  // 是正常狀況：建一份空的基準骨架，讓推送迴圈往裡面填。
  const existing = await readBaseline(session.adapters.storage)
  const baseline: SyncBaseline =
    existing ?? {
      hostBaseUrl: src.baseUrl,
      syncedAt: 0,
      settingsHash: '',
      characters: {},
      personas: {},
      worlds: {},
      scenes: {},
      lorebooks: {},
      conversations: {}
    }

  const updates = { ...baseline }
  let anyPushed = false

  try {
    // ── 角色推送 ──
    const charIds = opts.selectedIds.characters ?? new Set()
    for (const id of charIds) {
      // 第一次同步（!diff.hasBaseline）時 diff 刻意全空，信任 selectedIds（見 buildPushSelection）
      if (diff.hasBaseline && !diff.characters.localNew.includes(id) && !diff.characters.localModified.includes(id)) continue
      opts.onProgress?.(`推送角色 ${session.characters.find((c) => c.id === id)?.name || id}...`)
      await pushCharacter(src, session, id, fetchImpl)
      anyPushed = true
      const char = session.characters.find((c) => c.id === id)
      if (char) {
        if (!updates.characters[id]) {
          updates.characters[id] = { remoteId: id, localUpdatedAt: char.updatedAt, remoteUpdatedAt: Date.now() }
        } else {
          updates.characters[id]!.localUpdatedAt = char.updatedAt
          updates.characters[id]!.remoteUpdatedAt = Date.now()
        }
      }
    }

    // ── 人設推送 ──
    const personaIds = opts.selectedIds.personas ?? new Set()
    for (const id of personaIds) {
      if (diff.hasBaseline && !diff.personas.localNew.includes(id) && !diff.personas.localModified.includes(id)) continue
      const persona = session.personas.find((p) => p.id === id)
      if (!persona) continue
      opts.onProgress?.(`推送人設 ${persona.name || id}...`)
      await pushPersona(src, persona, fetchImpl)
      anyPushed = true
      if (!updates.personas[id]) {
        updates.personas[id] = { remoteId: id, localUpdatedAt: persona.updatedAt, remoteUpdatedAt: Date.now() }
      } else {
        updates.personas[id]!.localUpdatedAt = persona.updatedAt
        updates.personas[id]!.remoteUpdatedAt = Date.now()
      }
    }

    // ── 世界觀推送 ──
    const worldIds = opts.selectedIds.worlds ?? new Set()
    for (const id of worldIds) {
      if (diff.hasBaseline && !diff.worlds.localNew.includes(id) && !diff.worlds.localModified.includes(id)) continue
      const world = session.worlds.find((w) => w.id === id)
      if (!world) continue
      opts.onProgress?.(`推送世界觀 ${world.name || id}...`)
      await pushWorld(src, world, fetchImpl)
      anyPushed = true
      if (!updates.worlds[id]) {
        updates.worlds[id] = { remoteId: id, localUpdatedAt: world.updatedAt, remoteUpdatedAt: Date.now() }
      } else {
        updates.worlds[id]!.localUpdatedAt = world.updatedAt
        updates.worlds[id]!.remoteUpdatedAt = Date.now()
      }
    }

    // ── 用語解說推送 ──
    const lorebookIds = opts.selectedIds.lorebooks ?? new Set()
    for (const id of lorebookIds) {
      if (diff.hasBaseline && !diff.lorebooks.localNew.includes(id) && !diff.lorebooks.localModified.includes(id)) continue
      opts.onProgress?.(`推送用語解說 ${id}...`)
      await pushLorebook(src, session, id, fetchImpl)
      anyPushed = true
      const lore = await session.getLorebook(id)
      if (lore) {
        if (!updates.lorebooks[id]) {
          updates.lorebooks[id] = { remoteId: id, localUpdatedAt: lore.updatedAt, remoteUpdatedAt: Date.now() }
        } else {
          updates.lorebooks[id]!.localUpdatedAt = lore.updatedAt
          updates.lorebooks[id]!.remoteUpdatedAt = Date.now()
        }
      }
    }

    // ── 情境推送（§5 步驟③）──
    const sceneIds = opts.selectedIds.scenes ?? new Set()
    for (const id of sceneIds) {
      if (diff.hasBaseline && !diff.scenes.localNew.includes(id) && !diff.scenes.localModified.includes(id)) continue
      const scene = session.scenes.find((s) => s.id === id)
      if (!scene) continue
      opts.onProgress?.(`推送情境 ${scene.name || id}...`)
      await pushScene(src, scene, fetchImpl)
      anyPushed = true
      if (!updates.scenes[id]) {
        updates.scenes[id] = { remoteId: id, localUpdatedAt: scene.updatedAt, remoteUpdatedAt: Date.now() }
      } else {
        updates.scenes[id]!.localUpdatedAt = scene.updatedAt
        updates.scenes[id]!.remoteUpdatedAt = Date.now()
      }
    }

    // 只有真的推過東西才寫基準（§3.1）
    if (anyPushed) {
      opts.onProgress?.('更新同步基準...')
      // 換主機時基準作廢（§7.6）
      updates.hostBaseUrl = src.baseUrl
      updates.syncedAt = Date.now()
      // settingsHash 不動：這一版設定推送還沒接進主迴圈（§5 步驟④待做），
      // 亂改會讓 computeDiff 誤判成「設定已經同步過」。
      await writeBaseline(session.adapters.storage, updates)
    }
  } catch (err) {
    // 推送失敗時基準保持不變（CLAUDE.md §5 的坑）
    throw new Error(`推送失敗：${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * 推送單一角色到電腦（§5 步驟②）。
 *
 * 手機端用 `exportPack` 把角色序列化成 `.dstpack`，再 POST 到電腦的
 * `/api/characters/import-pack`。電腦那邊用同一套 S1 的解包邏輯接收。
 */
async function pushCharacter(
  src: SyncSource,
  session: StandaloneSession,
  id: string,
  fetchImpl: FetchImpl
): Promise<void> {
  const char = session.characters.find((c) => c.id === id)
  if (!char) throw new Error(`Character ${id} not found`)

  const { bytes } = await session.exportPack([id], { includeGlobalSettings: false, includeLorebooks: false })
  await pushBinary(src, '/api/characters/import-pack', bytes, fetchImpl)
}

/**
 * 推送人設到電腦（§5 步驟②）。
 */
async function pushPersona(src: SyncSource, persona: any, fetchImpl: FetchImpl): Promise<void> {
  await pushJson(src, '/api/presets/persona/save', { preset: persona }, fetchImpl)
}

/**
 * 推送世界觀到電腦（§5 步驟②）。
 */
async function pushWorld(src: SyncSource, world: any, fetchImpl: FetchImpl): Promise<void> {
  await pushJson(src, '/api/presets/world/save', { preset: world }, fetchImpl)
}

/**
 * 推送情境到電腦（§5 步驟③）。
 *
 * **重要**（§3.2）：只推 characterId／muted，座標／大小／翻面一律沿用電腦上
 * 原本那份，避免洗掉電腦的桌寵配置。
 */
async function pushScene(src: SyncSource, scene: any, fetchImpl: FetchImpl): Promise<void> {
  const filtered = {
    ...scene,
    desktopCharacters: (scene.desktopCharacters ?? []).map((dc: any) => ({ characterId: dc.characterId, muted: dc.muted }))
  }
  await pushJson(src, '/api/presets/scene/save', { preset: filtered }, fetchImpl)
}

/**
 * 推送用語解說到電腦（§5 步驟②）。
 */
async function pushLorebook(src: SyncSource, session: StandaloneSession, id: string, fetchImpl: FetchImpl): Promise<void> {
  const lore = await session.getLorebook(id)
  if (!lore) throw new Error(`Lorebook ${id} not found`)
  await pushJson(src, '/api/lorebooks/save', { book: lore }, fetchImpl)
}

/**
 * 推送設定到電腦（§5 步驟④）。
 *
 * **重要**（§3.3）：設定沒有整包端點，要拆成好幾支呼叫。
 * `buildLocalManifest()` 算 `settingsHash` 用的子集是：
 * { llm: { provider, model, models, endpoint, maxResponseTokens, maxGroupRounds, maxImagesPerMessage },
 *   memory, colorTheme, modules }
 */
async function pushSettings(src: SyncSource, session: StandaloneSession, fetchImpl: FetchImpl): Promise<void> {
  const s = session.settings
  const llm = s.llm

  // LLM 設定：拆成多個端點
  await pushJson(src, '/api/settings/llm-provider', { provider: llm.provider }, fetchImpl)
  await pushJson(src, '/api/settings/llm-model', { provider: llm.provider, model: llm.model }, fetchImpl)

  // LLM endpoint（可選）
  if (llm.endpoint) {
    await pushJson(src, '/api/settings/llm-endpoint', { endpoint: llm.endpoint }, fetchImpl)
  }

  // LLM chat limits（一次送所有值）
  await pushJson(src, '/api/settings/llm-chat-limits', {
    maxResponseTokens: llm.maxResponseTokens,
    maxGroupRounds: llm.maxGroupRounds,
    maxImagesPerMessage: llm.maxImagesPerMessage
  }, fetchImpl)

  // 記憶設定
  if (s.memory) {
    await pushJson(src, '/api/settings/memory', {
      keepRecentN: s.memory.keepRecentN,
      autoSummarizeAfter: s.memory.autoSummarizeAfter,
      autoSummarizeEnabled: s.memory.autoSummarizeEnabled
    }, fetchImpl)
  }

  // 配色主題
  if (s.ui?.colorTheme) {
    await pushJson(src, '/api/settings/color-theme', { theme: s.ui.colorTheme }, fetchImpl)
  }

  // 模組開關（逐個推送）
  const modules = await session.listModules()
  for (const m of modules) {
    await pushJson(src, '/api/settings/modules/toggle', { id: m.id, enabled: m.enabled }, fetchImpl)
  }
}

/**
 * 推送 JSON 到電腦。
 */
async function pushJson(src: SyncSource, path: string, payload: unknown, fetchImpl: FetchImpl): Promise<void> {
  const token = `Bearer ${src.token}`
  const url = `${src.baseUrl}${path}`
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`HTTP ${res.status}: ${text}`)
  }
}

/**
 * 推送二進位資料到電腦。
 */
async function pushBinary(src: SyncSource, path: string, data: Uint8Array, fetchImpl: FetchImpl): Promise<void> {
  const token = `Bearer ${src.token}`
  const url = `${src.baseUrl}${path}`
  // Uint8Array 需轉為 Buffer 或 ArrayBuffer 才能作為 fetch body
  const body = data instanceof Buffer ? data : Buffer.from(data)
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: token,
      'Content-Type': 'application/octet-stream'
    },
    body
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`HTTP ${res.status}: ${text}`)
  }
}
