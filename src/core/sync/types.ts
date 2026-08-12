/**
 * S2 M2 差異預覽的型別（`docs/mobile-mode-switch-sync.md` §5.2／§6.2）。
 *
 * 基準只存在手機上（§5.1），這裡定義的型別跨平台共用：桌面端用來組
 * `/api/sync-manifest` 的回應，手機端用來讀基準、比對差異。
 */

/** 上次同步完成當下，單一實體兩邊的狀態。這張表就是 id 對應表（§5.3）。 */
export interface EntityBaseline {
  /** 電腦端的 id。 */
  remoteId: string
  /** 同步完成當下，手機那份的 updatedAt。 */
  localUpdatedAt: number
  /** 同步完成當下，電腦那份的 updatedAt。 */
  remoteUpdatedAt: number
}

/** 對話是 append-only，則數是最便宜的變動訊號，額外記錄。 */
export interface ConversationBaseline extends EntityBaseline {
  localMessageCount: number
  remoteMessageCount: number
}

/** 上次同步完成當下的兩邊狀態。用來算「之後誰改了什麼」（§5.2）。 */
export interface SyncBaseline {
  /** 綁定的同步主機。換主機時整份基準作廢（§7.6）。 */
  hostBaseUrl: string
  syncedAt: number

  characters: Record<string, EntityBaseline>
  personas: Record<string, EntityBaseline>
  worlds: Record<string, EntityBaseline>
  scenes: Record<string, EntityBaseline>
  lorebooks: Record<string, EntityBaseline>
  conversations: Record<string, ConversationBaseline>

  /** 設定沒有 updatedAt，用同步當下的內容雜湊代替。 */
  settingsHash: string
}

/** `/api/sync-manifest` 裡一般實體的輕量描述——不含任何內容。 */
export interface ManifestEntity {
  id: string
  name: string
  updatedAt: number
}

/** 對話的輕量描述，多帶則數。 */
export interface ManifestConversation {
  id: string
  title: string
  updatedAt: number
  messageCount: number
}

/** 雙邊都用這個形狀描述自己的資料量，供 `computeDiff` 比對。 */
export interface Manifest {
  characters: ManifestEntity[]
  personas: ManifestEntity[]
  worlds: ManifestEntity[]
  scenes: ManifestEntity[]
  lorebooks: ManifestEntity[]
  conversations: ManifestConversation[]
  settingsHash: string
}

/** 單一 collection（例如角色）的差異結果，id 列表。 */
export interface CollectionDiff {
  localNew: string[]
  localModified: string[]
  localDeleted: string[]
  remoteNew: string[]
  remoteModified: string[]
  remoteDeleted: string[]
  /** 同一筆兩邊都改了（§7.3）——不自動覆蓋，只標籤。 */
  conflicts: string[]
}

/** `computeDiff` 的完整結果。 */
export interface SyncDiff {
  /**
   * 手機上還沒有任何基準（第一次切換）。這種情況下每個 collection
   * 都是空陣列——不要把「本地全部都是新增」當成有意義的差異顯示，
   * 見 `docs/mobile-mode-switch-sync.md` 之外、本次規劃另行決議的
   * 「首次執行」處理：UI 層應改顯示雙邊筆數統計，不逐筆貼標籤。
   */
  hasBaseline: boolean
  characters: CollectionDiff
  personas: CollectionDiff
  worlds: CollectionDiff
  scenes: CollectionDiff
  lorebooks: CollectionDiff
  conversations: CollectionDiff
  settingsChanged: boolean
}
