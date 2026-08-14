import type { SyncBaseline, SyncDiff } from '@core/sync/types'
import type { StandaloneSession } from './session'
import { readBaseline, writeBaseline } from './syncBaseline'
import { fetchRemoteManifest } from './syncManifest'
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

/** 電腦上已有同名角色、而且沒有同步記錄可以確認是不是同一隻。 */
export interface NameConflict {
  /** 手機端的角色 id */
  id: string
  name: string
}

/** 使用者在同名清單上按了取消 → 整趟推送不做。 */
export class PushCancelled extends Error {
  constructor() {
    super('使用者取消了推送')
    this.name = 'PushCancelled'
  }
}

/** 名字比對用：去頭尾空白、統一大小寫，與電腦端 `importDstPackDirect` 的判定一致。 */
function normalizeName(name: string): string {
  return name.trim().toLowerCase()
}

/** 這隻角色有沒有被 diff 標記成要推（第一次同步時 diff 刻意全空，一律放行）。 */
function passesCharacterDiff(diff: SyncDiff, id: string): boolean {
  if (!diff.hasBaseline) return true
  return diff.characters.localNew.includes(id) || diff.characters.localModified.includes(id)
}

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
  /**
   * 遇到同名衝突時問使用者要覆蓋哪幾隻。
   *
   * 回傳要覆蓋的手機端角色 id 集合；回 `null` ＝ 取消整趟推送（丟 `PushCancelled`）。
   * **不提供這個回調時一律不推**衝突的那幾隻——預設值不能是「默默建立重複角色」。
   */
  onNameConflicts?: (conflicts: NameConflict[]) => Promise<Set<string> | null>
}

/**
 * 推送結果摘要——每個 collection 實際推了哪些名字（不是 id，UI 直接顯示用）。
 * 推送失敗時 `pushSync` 會拋錯，不會回傳這個；只有整趟成功才有意義。
 */
export interface PushSummary {
  characters: string[]
  personas: string[]
  worlds: string[]
  scenes: string[]
  lorebooks: string[]
  /** 因為同名、使用者沒勾覆蓋而略過的角色名字（UI 要說出來，不能默默不推）。 */
  skippedByName: string[]
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
): Promise<PushSummary> {
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
  const summary: PushSummary = { characters: [], personas: [], worlds: [], scenes: [], lorebooks: [], skippedByName: [] }

  /**
   * 基準記錄「這隻角色先前推送成功過」不代表電腦上現在還真的有那個 id——
   * 使用者可能事後在電腦上把它刪了、或那份基準本來就是舊資料換過主機
   * 殘留下來的。血淋淋的教訓（2026-08-13 owner 實機檢查發現）：手機端
   * 12 隻角色裡有 10 隻的基準 remoteId 電腦上早就不存在了，但電腦上剛好
   * 都有一隻「同名、不同 id」的角色（多半是電腦原生就有、從未被手機碰過
   * 的角色）。如果只看基準歷史就決定 `overwrite`，電腦端 id 對不上時會
   * 退回用名字比對，會直接蓋掉那隻同名但完全無關的原生角色——真的會弄丟
   * 使用者資料。所以 `overwrite` 只能在「基準記的 remoteId 現在真的還在
   * 電腦上」這個前提下才能用；查不到（或整個 fetch 失敗，保守起見一律
   * 當查不到）就退回 `new`，讓電腦端照原本「同名不覆蓋、發新 id」的
   * 既有規則處理，不要冒著蓋掉不相關角色的風險去猜。
   */
  const remoteManifest = await fetchRemoteManifest(src, fetchImpl).catch(() => null)
  const remoteCharacterIds = new Set((remoteManifest?.characters ?? []).map((c) => c.id))
  /** 電腦上現有的角色名字（正規化後）→ 用來偵測同名衝突。 */
  const remoteCharacterNames = new Set(
    (remoteManifest?.characters ?? []).map((c) => normalizeName(c.name))
  )

  /**
   * 同名衝突：手機要推的角色，電腦上已經有一隻同名、但**沒有同步記錄**的。
   *
   * 這是 2026-08-13 那場事故的正源頭。當時的處理是「一律當新角色送過去」，
   * 於是電腦上每推一次就多一隻同名角色；owner 清理重複時留下的是手機推過去
   * 的新複本，而所有舊對話指向的是原本那隻的 id —— 五月到八月的角色名字
   * 一次全部消失。
   *
   * owner 2026-08-13 拍板：**列出同名清單讓使用者逐一勾選**（預設全選）。
   * 打勾＝覆蓋電腦上那隻（電腦端會沿用它原本的 id，所以舊對話的連結不會斷）；
   * 沒打勾＝這次不推這隻。**刻意不提供「另外建一隻新的」**——那正是出事的
   * 那條路，真的想要第二隻同名角色，在手機上改個名字再推即可。
   */
  const conflicts: NameConflict[] = []
  for (const id of opts.selectedIds.characters ?? new Set<string>()) {
    if (!passesCharacterDiff(diff, id)) continue
    const char = session.characters.find((c) => c.id === id)
    if (!char) continue
    // 基準記的 remoteId 還在電腦上 → 已知是同一隻，不必問
    const recordedRemoteId = baseline.characters[id]?.remoteId
    if (recordedRemoteId && remoteCharacterIds.has(recordedRemoteId)) continue
    if (remoteCharacterNames.has(normalizeName(char.name))) conflicts.push({ id, name: char.name })
  }

  /**
   * 沒有提供 `onNameConflicts` 時一律**不覆蓋也不推**（保守）。
   * 舊行為是默默送出去變成重複角色，那個預設值已經害過一次，不留回頭路。
   */
  let approvedOverwrite = new Set<string>()
  if (conflicts.length > 0) {
    const answer = opts.onNameConflicts ? await opts.onNameConflicts(conflicts) : new Set<string>()
    if (answer === null) throw new PushCancelled()
    approvedOverwrite = answer
  }

  /**
   * 每推成功一筆就立刻寫回基準——**不要等整趟迴圈跑完才寫一次**。
   *
   * 血淋淋的教訓（2026-08-13）：原本的寫法是全部收集在記憶體裡的 `updates`，
   * 等五個 collection 都跑完、完全沒出錯才在最後寫一次。這代表「角色都推
   * 成功了，但後面人設／情境隨便哪一步出錯」時，基準完全不會更新——已經
   * 真的送到電腦、電腦也真的建好的角色，手機這邊卻不知道自己推過。
   * 使用者下次重試「帶過去」，`computeDiff` 還是把這些角色當成沒推過，
   * `buildPushSelection` 又把它們全部選進去——電腦的 `onConflict: 'new'`
   * 策略是每次匯入都建新角色、不判重複，於是每重試一次就多一批重複角色。
   * 改成每推成功一筆就寫一次，中途失敗時已經成功的那幾筆不會再被重推。
   */
  const persist = async (): Promise<void> => {
    updates.hostBaseUrl = src.baseUrl
    updates.syncedAt = Date.now()
    // settingsHash 不動：這一版設定推送還沒接進主迴圈（§5 步驟④待做），
    // 亂改會讓 computeDiff 誤判成「設定已經同步過」。
    await writeBaseline(session.adapters.storage, updates)
  }

  try {
    // ── 角色推送 ──
    const charIds = opts.selectedIds.characters ?? new Set()
    const conflictIds = new Set(conflicts.map((c) => c.id))
    for (const id of charIds) {
      // 第一次同步（!diff.hasBaseline）時 diff 刻意全空，信任 selectedIds（見 buildPushSelection）
      if (!passesCharacterDiff(diff, id)) continue
      const char = session.characters.find((c) => c.id === id)
      const charName = char?.name || id

      // 同名衝突而使用者沒勾 → 這次不推這隻（見上面 conflicts 的說明）
      if (conflictIds.has(id) && !approvedOverwrite.has(id)) {
        summary.skippedByName.push(charName)
        continue
      }

      opts.onProgress?.(`推送角色 ${charName}...`)
      /*
       * `overwrite` 的兩種來源：
       * 1. 基準記過、而且那個 remoteId 現在真的還在電腦上 → 已知是同一隻角色被改過重推
       * 2. 同名衝突且使用者勾了要覆蓋 → 電腦端會用名字對到那隻並**沿用它的 id**
       *    （`importDstPackDirect` 的 nameHit 分支），所以舊對話的連結不會斷
       * 兩者皆非 → `new`（電腦上沒有同名的，本來就是新角色）
       */
      const recordedRemoteId = baseline.characters[id]?.remoteId
      const onConflict =
        (recordedRemoteId && remoteCharacterIds.has(recordedRemoteId)) || approvedOverwrite.has(id)
          ? 'overwrite'
          : 'new'
      await pushCharacter(src, session, id, onConflict, fetchImpl)
      summary.characters.push(charName)
      if (char) {
        if (!updates.characters[id]) {
          updates.characters[id] = { remoteId: id, localUpdatedAt: char.updatedAt, remoteUpdatedAt: Date.now() }
        } else {
          updates.characters[id]!.localUpdatedAt = char.updatedAt
          updates.characters[id]!.remoteUpdatedAt = Date.now()
        }
        await persist()
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
      summary.personas.push(persona.name || id)
      if (!updates.personas[id]) {
        updates.personas[id] = { remoteId: id, localUpdatedAt: persona.updatedAt, remoteUpdatedAt: Date.now() }
      } else {
        updates.personas[id]!.localUpdatedAt = persona.updatedAt
        updates.personas[id]!.remoteUpdatedAt = Date.now()
      }
      await persist()
    }

    // ── 世界觀推送 ──
    const worldIds = opts.selectedIds.worlds ?? new Set()
    for (const id of worldIds) {
      if (diff.hasBaseline && !diff.worlds.localNew.includes(id) && !diff.worlds.localModified.includes(id)) continue
      const world = session.worlds.find((w) => w.id === id)
      if (!world) continue
      opts.onProgress?.(`推送世界觀 ${world.name || id}...`)
      await pushWorld(src, world, fetchImpl)
      summary.worlds.push(world.name || id)
      if (!updates.worlds[id]) {
        updates.worlds[id] = { remoteId: id, localUpdatedAt: world.updatedAt, remoteUpdatedAt: Date.now() }
      } else {
        updates.worlds[id]!.localUpdatedAt = world.updatedAt
        updates.worlds[id]!.remoteUpdatedAt = Date.now()
      }
      await persist()
    }

    // ── 用語解說推送 ──
    const lorebookIds = opts.selectedIds.lorebooks ?? new Set()
    for (const id of lorebookIds) {
      if (diff.hasBaseline && !diff.lorebooks.localNew.includes(id) && !diff.lorebooks.localModified.includes(id)) continue
      const lore = await session.getLorebook(id)
      opts.onProgress?.(`推送用語解說 ${lore?.name || id}...`)
      await pushLorebook(src, session, id, fetchImpl)
      summary.lorebooks.push(lore?.name || id)
      if (lore) {
        if (!updates.lorebooks[id]) {
          updates.lorebooks[id] = { remoteId: id, localUpdatedAt: lore.updatedAt, remoteUpdatedAt: Date.now() }
        } else {
          updates.lorebooks[id]!.localUpdatedAt = lore.updatedAt
          updates.lorebooks[id]!.remoteUpdatedAt = Date.now()
        }
        await persist()
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
      summary.scenes.push(scene.name || id)
      if (!updates.scenes[id]) {
        updates.scenes[id] = { remoteId: id, localUpdatedAt: scene.updatedAt, remoteUpdatedAt: Date.now() }
      } else {
        updates.scenes[id]!.localUpdatedAt = scene.updatedAt
        updates.scenes[id]!.remoteUpdatedAt = Date.now()
      }
      await persist()
    }

    return summary
  } catch (err) {
    // 使用者主動取消不是失敗，原樣往上丟，呼叫端才能安靜收工不跳錯誤。
    if (err instanceof PushCancelled) throw err
    // 中途失敗：已經成功推的那幾筆基準在上面 persist() 時已經寫回去了，
    // 不會因為後面這步失敗而消失——不需要在這裡再寫一次，也不能整份倒退。
    throw new Error(`推送失敗：${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * 推送單一角色到電腦（§5 步驟②）。
 *
 * 手機端用 `exportPack` 把角色序列化成 `.dstpack`，再 POST 到電腦的
 * `/api/characters/import-pack`。電腦那邊用同一套 S1 的解包邏輯接收。
 *
 * `onConflict` 由呼叫端（`pushSync` 的角色迴圈）依基準有沒有這筆記錄決定：
 * - `'new'`：第一次推這隻角色，電腦上還沒有。
 * - `'overwrite'`：基準已經記過，這次是同一隻角色被改過重推——蓋掉電腦
 *   上那份，不要每次修改重推都生一隻新角色（`mobileServer.ts` 的
 *   `/api/characters/import-pack` 端點註解有完整說明這條的來龍去脈）。
 */
async function pushCharacter(
  src: SyncSource,
  session: StandaloneSession,
  id: string,
  onConflict: 'new' | 'overwrite',
  fetchImpl: FetchImpl
): Promise<void> {
  const char = session.characters.find((c) => c.id === id)
  if (!char) throw new Error(`Character ${id} not found`)

  const { bytes } = await session.exportPack([id], { includeGlobalSettings: false, includeLorebooks: false })
  await pushBinary(src, `/api/characters/import-pack?onConflict=${onConflict}`, bytes, fetchImpl)
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

  // LLM endpoint（可選）：逐 provider 各推一次，不能只推目前這家——
  // 本機端點多半設在非當前 provider 上（主＝雲端／輔助＝本機）
  for (const [p, ep] of Object.entries(llm.endpoints ?? {})) {
    if (ep) await pushJson(src, '/api/settings/llm-endpoint', { provider: p, endpoint: ep }, fetchImpl)
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
 *
 * ⚠️ **手機端不能用 `Buffer`**：那是 Node.js 專屬全域物件，WebView／瀏覽器
 * 執行環境沒有這東西（症狀：`Buffer is not defined`）。
 *
 * ⚠️ **也不能直接送 `Uint8Array` 或 `Blob`**：CapacitorHttp 的 Android
 * 原生橋接（`native-bridge.js` 的 `convertBody()`）對這兩種 body 都會先
 * `new TextDecoder().decode()` 轉成字串，原生層再 `getBytes(UTF_8)`
 * 轉回位元組——任意二進位資料經過這個 UTF-8 往返幾乎必壞（`.dstpack`
 * 是 JSZip 產出的 ZIP，內容不是合法 UTF-8）。橋接只有 `File` 這個 body
 * 型別會走 base64 編碼上橋、原生端用 `Base64.decode` 直接寫回輸出串流，
 * 是唯一位元組正確的路徑（`CapacitorHttpUrlConnection.java` 的
 * `bodyType.equals("file")` 分支）——所以就算不是要上傳「檔案」，
 * 這裡也要包成 `File` 才會送到位元組正確的資料。
 */
async function pushBinary(src: SyncSource, path: string, data: Uint8Array, fetchImpl: FetchImpl): Promise<void> {
  const token = `Bearer ${src.token}`
  const url = `${src.baseUrl}${path}`
  // 複製一份再包：data 底下的 ArrayBuffer 型別上可能是 SharedArrayBuffer，
  // File／Blob 只吃一般的 ArrayBuffer（比照 fileTransfer.ts 的 downloadBytes）。
  const body = new File([new Uint8Array(data).slice().buffer as ArrayBuffer], 'push.bin', {
    type: 'application/octet-stream'
  })
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
