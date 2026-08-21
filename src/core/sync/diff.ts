import type {
  CollectionDiff,
  EntityBaseline,
  Manifest,
  ManifestConversation,
  ManifestEntity,
  SyncBaseline,
  SyncDiff
} from './types'

const EMPTY_COLLECTION_DIFF: CollectionDiff = Object.freeze({
  localNew: [],
  localModified: [],
  localDeleted: [],
  remoteNew: [],
  remoteModified: [],
  remoteDeleted: [],
  conflicts: []
})

/**
 * 比對單一 collection（例如全部角色）在本地／遠端相對於基準的變動。
 *
 * 規則見 `docs/mobile-mode-switch-sync.md` §5.3／§5.4：
 * - 先查基準的 id 對應表；查不到才用名字配對（視為已經對應過，這一版
 *   不逐欄比對，只是避免同一筆被誤判成「兩邊都新增」）。
 * - 兩邊都改了同一筆基準對應的實體 → 移出 modified，改記進 conflicts（§7.3）。
 */
function diffCollection<L extends { id: string; updatedAt: number }>(
  baseline: Record<string, EntityBaseline> | undefined,
  local: L[],
  remote: L[],
  nameOf: (x: L) => string
): CollectionDiff {
  const base = baseline ?? {}
  const localById = new Map(local.map((x) => [x.id, x]))
  const remoteById = new Map(remote.map((x) => [x.id, x]))

  const baselineLocalIds = new Set(Object.keys(base))
  const baselineRemoteIds = new Set(Object.values(base).map((eb) => eb.remoteId))

  const localNew: string[] = []
  const localModified: string[] = []
  const localDeleted: string[] = []
  const remoteNew: string[] = []
  const remoteModified: string[] = []
  const remoteDeleted: string[] = []
  const conflicts: string[] = []

  const localModifiedSet = new Set<string>()
  const remoteModifiedSet = new Set<string>()

  for (const [localId, eb] of Object.entries(base)) {
    const l = localById.get(localId)
    const r = remoteById.get(eb.remoteId)
    if (l) {
      if (l.updatedAt > eb.localUpdatedAt) {
        localModified.push(localId)
        localModifiedSet.add(localId)
      }
    } else {
      localDeleted.push(localId)
    }
    if (r) {
      if (r.updatedAt > eb.remoteUpdatedAt) {
        remoteModified.push(eb.remoteId)
        remoteModifiedSet.add(eb.remoteId)
      }
    } else {
      remoteDeleted.push(eb.remoteId)
    }
  }

  // 名字後備配對：只在雙方都還沒有基準紀錄的那些實體之間找相同名字，
  // 視為已經對應過（不算新增，也不因為沒有基準時間點而算修改）。
  const unmappedRemoteByName = new Map<string, L>()
  for (const r of remote) {
    if (!baselineRemoteIds.has(r.id)) unmappedRemoteByName.set(nameOf(r), r)
  }
  const matchedByName = new Set<string>()
  for (const l of local) {
    if (baselineLocalIds.has(l.id)) continue
    const match = unmappedRemoteByName.get(nameOf(l))
    if (match) {
      matchedByName.add(l.id)
      matchedByName.add(match.id)
      unmappedRemoteByName.delete(nameOf(l))
    }
  }

  for (const l of local) {
    if (baselineLocalIds.has(l.id) || matchedByName.has(l.id)) continue
    localNew.push(l.id)
  }
  for (const r of remote) {
    if (baselineRemoteIds.has(r.id) || matchedByName.has(r.id)) continue
    remoteNew.push(r.id)
  }

  for (const [localId, eb] of Object.entries(base)) {
    if (localModifiedSet.has(localId) && remoteModifiedSet.has(eb.remoteId)) {
      conflicts.push(localId)
    }
  }
  const conflictLocalIds = new Set(conflicts)
  const conflictRemoteIds = new Set(conflicts.map((localId) => base[localId].remoteId))

  return {
    localNew,
    localModified: localModified.filter((id) => !conflictLocalIds.has(id)),
    localDeleted,
    remoteNew,
    remoteModified: remoteModified.filter((id) => !conflictRemoteIds.has(id)),
    remoteDeleted,
    conflicts
  }
}

/**
 * 比對雙邊的輕量清單，算出「有什麼不一樣」。**只讀，不寫任何東西**——
 * 呼叫端（手機）決定要不要把結果拿去顯示，基準本身要等真的搬過資料
 * 才會更新（§7.2）。
 *
 * `baseline === null`（手機上還沒有任何基準，例如第一次切換）時，
 * 直接回傳 `hasBaseline: false` 加上全空的差異——不要把「本地目前有的
 * 資料」逐筆判成「新增」，那只是在重述使用者有資料，不是有意義的差異。
 */
export function computeDiff(baseline: SyncBaseline | null, local: Manifest, remote: Manifest): SyncDiff {
  if (!baseline) {
    return {
      hasBaseline: false,
      characters: EMPTY_COLLECTION_DIFF,
      personas: EMPTY_COLLECTION_DIFF,
      worlds: EMPTY_COLLECTION_DIFF,
      scenes: EMPTY_COLLECTION_DIFF,
      lorebooks: EMPTY_COLLECTION_DIFF,
      conversations: EMPTY_COLLECTION_DIFF,
      settingsChanged: false
    }
  }

  const entityName = (x: ManifestEntity): string => x.name
  const conversationName = (x: ManifestConversation): string => x.title

  return {
    hasBaseline: true,
    characters: diffCollection(baseline.characters, local.characters, remote.characters, entityName),
    personas: diffCollection(baseline.personas, local.personas, remote.personas, entityName),
    worlds: diffCollection(baseline.worlds, local.worlds, remote.worlds, entityName),
    scenes: diffCollection(baseline.scenes, local.scenes, remote.scenes, entityName),
    lorebooks: diffCollection(baseline.lorebooks, local.lorebooks, remote.lorebooks, entityName),
    conversations: diffCollection(baseline.conversations, local.conversations, remote.conversations, conversationName),
    settingsChanged: local.settingsHash !== baseline.settingsHash || remote.settingsHash !== baseline.settingsHash
  }
}

/** 給 UI 判斷「完全沒有差異，不彈窗」用（§7.1）。 */
export function isDiffEmpty(diff: SyncDiff): boolean {
  if (diff.settingsChanged) return false
  const collections = [diff.characters, diff.personas, diff.worlds, diff.scenes, diff.lorebooks, diff.conversations]
  return collections.every(
    (c) =>
      c.localNew.length === 0 &&
      c.localModified.length === 0 &&
      c.localDeleted.length === 0 &&
      c.remoteNew.length === 0 &&
      c.remoteModified.length === 0 &&
      c.remoteDeleted.length === 0 &&
      c.conflicts.length === 0
  )
}
