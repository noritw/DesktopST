/**
 * Android 桌面小工具的資料形狀與純邏輯（`docs/mobile-android-widget-plan.md` §2／§4）。
 *
 * 平台無關：不 import electron／fs／path／Capacitor。
 *
 * ⚠️ **小工具不綁角色，跟著「目前這個對話」走**（owner 2026-08-23 實機回報後
 * 改的，見計畫書 §11.3）。原設計要使用者放置小工具時先選一個角色，owner 的
 * 預期是「沒釘選任何東西時就直接顯示當前對話最新的一兩則」——所以資料模型
 * 從「每個角色一份快照」改成「全域一份快照」，釘選也是全域最多兩則，
 * 不再以 characterId 分群。
 */

/** 小工具最多顯示幾則對白（3x2／4x2 兩則；3x1／4x1 只畫第一則）。 */
export const WIDGET_LINE_LIMIT = 2

/** 使用者釘選到小工具的一句話。釘選當下就把文字存下來，之後不必回頭查訊息。 */
export interface PinnedWidgetMessage {
  messageId: string
  /** 這則訊息屬於哪個對話——點對白要跳回去（§6），而釘選的訊息可能不在目前對話裡。 */
  conversationId: string
  text: string
  /** 誰說的：小工具的名字與頭像跟著第一則走。 */
  characterId?: string
  /**
   * 發話當下的角色名字快照。釘選的訊息可能來自**別的對話**，那個角色不一定
   * 還在目前對話的 `presentCharacters` 裡，查不到時就靠這個顯示。
   */
  characterName?: string
  /** 釘選當下的 `emotionOverride ?? emotion`，決定頭像用哪張表情圖。 */
  emotion?: string
  pinnedAt: number
}

/** `widget-config.json` 的內容（裝置本地偏好，不進同步／搬家包）。 */
export interface WidgetConfig {
  /** 最多 {@link WIDGET_LINE_LIMIT} 則，陣列順序＝顯示順序。空陣列＝全部顯示最新對話。 */
  pinnedMessages: PinnedWidgetMessage[]
  /** 小工具要不要顯示角色頭像（關掉只剩名字＋對白，省空間）。 */
  showAvatar: boolean
  /**
   * 配色與底色透明度（§14.2）。
   *
   * ⚠️ 型別刻意寫成結構而不是 `import type { WidgetAppearance }`：
   * **core 不可以往上依賴 `shared/`**（那是呈現層）。解析與色值換算在
   * `shared/widgetAppearance.ts`，這裡只是把它存下來的欄位。
   */
  appearance: { theme: string | null; bgOpacity: number }
}

export const DEFAULT_WIDGET_CONFIG: WidgetConfig = {
  pinnedMessages: [],
  showAvatar: true,
  appearance: { theme: null, bgOpacity: 100 }
}

/**
 * 把讀進來的檔案正規化成 {@link WidgetConfig}。
 *
 * 檔案可能不存在、可能是壞的、也可能是**改版前那個以 characterId 為 key 的舊格式**
 * （2026-08-23 之前寫進裝置的）——舊格式頂層沒有 `pinnedMessages`，
 * 會自然落到預設值，等於安靜地丟掉舊釘選，這是刻意的：舊格式的釘選綁在角色上，
 * 新模型沒有對應概念，硬轉過來只會得到使用者沒設定過的奇怪狀態。
 */
export function normalizeWidgetConfig(raw: unknown): WidgetConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_WIDGET_CONFIG }
  const obj = raw as Partial<WidgetConfig>
  const pins = Array.isArray(obj.pinnedMessages) ? obj.pinnedMessages : []
  const rawAppearance = (obj.appearance ?? {}) as Partial<WidgetConfig['appearance']>
  const opacity = typeof rawAppearance.bgOpacity === 'number' && Number.isFinite(rawAppearance.bgOpacity)
    ? Math.min(100, Math.max(0, Math.round(rawAppearance.bgOpacity)))
    : 100
  return {
    pinnedMessages: pins
      .filter((p): p is PinnedWidgetMessage => !!p && typeof p.messageId === 'string' && typeof p.text === 'string')
      .slice(0, WIDGET_LINE_LIMIT),
    showAvatar: obj.showAvatar !== false,
    // 主題 id 的合法性由 `shared/widgetAppearance.ts` 的 `normalizeWidgetAppearance`
    // 把關（那裡才有色表）；這裡只確保型別對、數值在範圍內。
    appearance: { theme: typeof rawAppearance.theme === 'string' ? rawAppearance.theme : null, bgOpacity: opacity }
  }
}

/** 原生層讀的一句對白。`pinned` 讓小工具畫一個圖釘，使用者才知道這則為什麼固定在那裡。 */
export interface WidgetLine {
  text: string
  conversationId?: string
  messageId?: string
  characterId?: string
  /** 名字快照，查不到現存角色時的後備（見 {@link PinnedWidgetMessage.characterName}）。 */
  characterName?: string
  /** 頭像用哪張表情圖（只有第 0 則會被採用，見計畫書 §5.2）。 */
  emotion?: string
  pinned: boolean
}

/** `buildWidgetLines` 只需要訊息的這幾個欄位；`MessageSnapshot` 與 `Message` 都符合。 */
export interface WidgetScanMessage {
  id: string
  role: string
  characterId?: string
  characterName?: string
  content: string
  emotion?: string
  emotionOverride?: string
  timestamp: number
}

/**
 * 決定小工具現在該顯示哪一、兩則對白（計畫書 §4.2 的核心演算法）。
 * 回傳的是**由上往下的顯示順序**。
 *
 * 1. 已釘選的排在前面（依使用者指定的順序，最多 {@link WIDGET_LINE_LIMIT} 則）。
 * 2. 不夠就用**目前這個對話**的角色訊息補滿，**跳過已經被釘選的那幾則**
 *    ——不然釘選的剛好是最新一則時，第二格會重複顯示同一句。
 * 3. 完全沒有東西可顯示（沒釘選、對話也沒有任何角色發言）→ 回空陣列，
 *    原生層顯示「還沒有對話」的預設文字。
 *
 * ⚠️ **自動補的那幾則是「舊的在上、新的在下」**（owner 2026-08-23 要求，
 * 見計畫書 §14.1）：跟聊天記錄的閱讀方向一致，不然同一批訊息在小工具上
 * 是倒的、在 App 裡是正的，切過去會愣一下。所以挑的時候取「最新的 N 則」
 * （由新到舊排序後截斷），**放進陣列前要再反轉成時間由舊到新**。
 * 釘選的不受影響——那是使用者自己指定的順序，不是時間序。
 *
 * ⚠️ `limit` 不同時結果**不是**單純的截斷關係：`limit=1` 拿到的是「最新那則」，
 * 而 `limit=2` 的第 0 則是**比較舊**的那則。所以矮版小工具（3x1／4x1）不能拿
 * `limit=2` 的結果取第一個來用，要另外用 `limit=1` 算一次——這正是
 * `widgetBridge.ts` 會把 `singleLine` 分開寫進 `state.json` 的原因。
 */
export function buildWidgetLines(
  messages: readonly WidgetScanMessage[],
  conversationId: string | null,
  pins: readonly PinnedWidgetMessage[],
  limit: number = WIDGET_LINE_LIMIT
): WidgetLine[] {
  if (limit <= 0) return []

  const lines: WidgetLine[] = pins.slice(0, limit).map((p) => ({
    text: p.text,
    conversationId: p.conversationId,
    messageId: p.messageId,
    characterId: p.characterId,
    characterName: p.characterName,
    emotion: p.emotion,
    pinned: true
  }))
  if (lines.length >= limit) return lines

  const pinnedIds = new Set(pins.map((p) => p.messageId))
  const candidates = messages
    .filter((m) => m.role === 'character' && !!m.content?.trim() && !pinnedIds.has(m.id))
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit - lines.length)
    // 取到的是「最新的 N 則」，反轉成舊 → 新才是要顯示的順序（見上面的說明）
    .reverse()

  for (const m of candidates) {
    lines.push({
      text: m.content,
      conversationId: conversationId ?? undefined,
      messageId: m.id,
      characterId: m.characterId,
      characterName: m.characterName,
      emotion: m.emotionOverride ?? m.emotion,
      pinned: false
    })
  }
  return lines
}

/** 這則訊息有沒有被釘選（聊天畫面畫圖釘、訊息選單決定要顯示「釘選」還是「取消釘選」）。 */
export function isPinnedMessage(pins: readonly PinnedWidgetMessage[], messageId: string): boolean {
  return pins.some((p) => p.messageId === messageId)
}

/**
 * 兩則對白是不是**不同角色說的**（owner 2026-08-23 追加，見計畫書 §13）。
 *
 * 是的話小工具改用「每則各自一張頭像＋各自的名字」的版面——群組聊天時
 * 只掛一張臉會讓人分不出哪句是誰說的。同一個角色連續講兩句則維持共用一張臉，
 * 同一張臉在同一個小工具上出現兩次看起來比較像故障（原 §5.2 的理由仍然成立，
 * 只是那條規則現在只適用於「同一個角色」的情況）。
 *
 * 任何一則沒有 `characterId`（例如系統訊息或壞資料）就當成不需要分開顯示——
 * 沒有身分可以標示的話，分兩欄只會多一塊空白。
 */
export function hasDistinctSpeakers(lines: readonly WidgetLine[]): boolean {
  if (lines.length < 2) return false
  const [a, b] = lines
  return !!a.characterId && !!b.characterId && a.characterId !== b.characterId
}
