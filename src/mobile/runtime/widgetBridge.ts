import type { StorageAdapter } from '@core/adapters'
import type { AppStateSnapshot } from '@core/data'
import { base64ToBytes } from '@core/util/base64'
import { buildWidgetLines, hasDistinctSpeakers, type WidgetConfig, type WidgetLine } from '@core/character/widgetSnapshot'
import { normalizeWidgetAppearance, resolveWidgetColors, type WidgetColors } from '@shared/widgetAppearance'
import { resolveCharacterName } from '@core/chat/characterName'
import { getData, isAttached } from '../ui/stores/appStore'
import { capacitorAdapters } from '../adapters'
import { readWidgetConfig } from './widgetPins'

/**
 * Android 桌面小工具的 Bridge（`docs/mobile-android-widget-plan.md` §4）。
 *
 * 「不論哪個模式，JS 端只要拿到現在該顯示什麼，就把它落地成原生層看得懂的檔案」
 * ——見計畫書 §2.1。原生層永遠只讀 `widget-cache/state.json`＋`image.png`
 * 兩個固定路徑，完全不需要知道資料實際存在手機還是電腦上。
 *
 * ⚠️ **小工具是全域一份、跟著目前這個對話走**（不綁角色，owner 2026-08-23
 * 回報後改的，見 `core/character/widgetSnapshot.ts` 檔頭與計畫書 §11.3）。
 *
 * 兩個入口：
 *   - {@link refreshWidgetCache}　前景 UI 呼叫，走 `getData()`（`DataSource`），
 *     兩種模式都能用。
 *   - {@link refreshWidgetCacheWith}　`session.ts` 直接呼叫的版本，不經過
 *     `getData()`/appStore——`runReminderHeadless()` 可能在 App 完全被劃掉、
 *     原生層叫起 headless WebView 時執行，那時 appStore 從未 `attach()` 過。
 *   兩支共用同一段「決定顯示什麼、寫檔、觸發原生」邏輯，差別只在資料怎麼來。
 */

const WIDGET_STATE_KEY = 'widget-cache/state.json'
/** 兩則對白是不同角色時各自一張頭像（§13）；同一個角色時只用得到第一張。 */
const WIDGET_IMAGE_KEYS = ['widget-cache/image1.png', 'widget-cache/image2.png'] as const
/** 改成 image1／image2 之前用的檔名。留著只會在 `adb shell ls` 時讓人困惑，寫入時順手清掉。 */
const LEGACY_WIDGET_IMAGE_KEY = 'widget-cache/image.png'

/** 寫進 `state.json` 的一則對白。 */
interface WidgetStateLine {
  text: string
  /** 這一則的說話者名字（已經解析過現存角色／名字快照）。 */
  name: string
  conversationId?: string
  messageId?: string
  pinned: boolean
  /** 用 `imageN.png` 的哪一張當頭像；`-1` ＝ 沒有頭像可用。 */
  avatarIndex: number
}

/** 寫進 `state.json` 的形狀。**改這裡一定要同步改 `DeSTWidgetProvider.kt` 的解析**。 */
interface WidgetStateFile {
  showAvatar: boolean
  /**
   * 兩則對白是不同角色說的——原生層要改用「每則各自頭像＋名字」的版面（§13）。
   * **判斷在 JS 這邊做完**，原生層只讀檔案不做決策（比照計畫書 §2.1 的精神）。
   */
  perLineSpeaker: boolean
  /** 配色與底色透明度，已經換算成 `#AARRGGBB`（§14.2）。 */
  colors: WidgetColors
  /** 兩則版（3x2／4x2）由上到下要顯示的內容。 */
  lines: WidgetStateLine[]
  /**
   * 一則版（3x1／4x1）要顯示的那一則。
   *
   * ⚠️ **不能拿 `lines[0]` 代替**：自動補的那幾則是「舊的在上、新的在下」
   * （§14.1），所以兩則版的第 0 則是**比較舊**的那則，而一則版該顯示的是
   * 最新的。這是用 `buildWidgetLines(..., 1)` 另外算的一份，見那支的檔頭警告。
   */
  singleLine: WidgetStateLine | null
}

/** `refreshWidgetCacheWith` 需要的最小資料介面，`DataSource` 與 `StandaloneSession` 都符合。 */
export interface WidgetDataProvider {
  getState(): Promise<AppStateSnapshot> | AppStateSnapshot
  characterDisplayImageUrl(characterId: string, emotion: string | undefined): Promise<string | null>
}

/**
 * `characterDisplayImageUrl()` 回傳的可能是 `data:`（獨立模式一律如此；遙控模式
 * 套用 faceCrop 之後也是）也可能是 `blob:`（遙控模式沒有 faceCrop 時，見
 * `remoteDataSource.ts`）——兩種都要能轉成位元組。
 */
async function imageUrlToBytes(url: string): Promise<Uint8Array | null> {
  try {
    if (url.startsWith('data:')) {
      const comma = url.indexOf(',')
      if (comma < 0) return null
      return base64ToBytes(url.slice(comma + 1))
    }
    const buf = await (await fetch(url)).arrayBuffer()
    return new Uint8Array(buf)
  } catch {
    return null
  }
}

/**
 * 觸發原生層 `DeSTWidgetProvider.updateAll()`（§7）。JS 沒辦法直接發 Android
 * broadcast，這支薄外掛照抄飲食小工具 `NutritionWidgetBridgePlugin` 的做法。
 * headless WebView 裡 plugin 不一定註冊得到，失敗就算了——檔案已經寫進磁碟，
 * 下次前景觸發或系統排程更新會自動補上。
 */
async function triggerNativeWidgetRefresh(): Promise<void> {
  const core = await import('@capacitor/core').catch(() => null)
  if (!core || !core.Capacitor.isNativePlatform()) return
  const bridge = core.registerPlugin<{ refresh(): Promise<void> }>('DeSTWidgetBridge')
  await bridge.refresh().catch(() => {})
}

/** 主畫面上目前放了幾個小工具實例（小工具設定頁用來說明「現在有沒有在用」）。 */
export async function countPlacedWidgets(): Promise<number | null> {
  const core = await import('@capacitor/core').catch(() => null)
  if (!core || !core.Capacitor.isNativePlatform()) return null
  const bridge = core.registerPlugin<{ count(): Promise<{ count: number }> }>('DeSTWidgetBridge')
  const r = await bridge.count().catch(() => null)
  return r?.count ?? null
}

/** {@link computeWidgetLines} 的結果：對白＋已經解析好的說話者名字。 */
export type ResolvedWidgetLine = WidgetLine & { name: string }

/**
 * 算出小工具現在該顯示什麼。**小工具設定頁的預覽也用這一支**，
 * 所以預覽跟實際顯示保證一致（owner 要求「可預覽小工具會顯示的對話」）。
 */
export async function computeWidgetLines(
  provider: WidgetDataProvider,
  config: WidgetConfig
): Promise<{
  /** 兩則版（3x2／4x2）由上到下的內容。 */
  lines: ResolvedWidgetLine[]
  /** 一則版（3x1／4x1）要顯示的那一則——**不是** `lines[0]`，見 {@link WidgetStateFile.singleLine}。 */
  single: ResolvedWidgetLine | null
  perLineSpeaker: boolean
  snapshot: AppStateSnapshot
}> {
  const snapshot = await provider.getState()
  const conv = snapshot.conversation
  const messages = conv?.messages ?? []
  const convId = conv?.id ?? null
  // 釘選的訊息可能來自別的對話，那個角色不一定還在 `presentCharacters` 裡——
  // `resolveCharacterName` 查不到時會退回訊息自己帶的名字快照。
  const resolve = (line: WidgetLine): ResolvedWidgetLine => ({
    ...line,
    name: resolveCharacterName(line.characterId, snapshot.presentCharacters, line.characterName)
  })
  const lines = buildWidgetLines(messages, convId, config.pinnedMessages).map(resolve)
  const single = buildWidgetLines(messages, convId, config.pinnedMessages, 1).map(resolve)[0] ?? null
  return { lines, single, perLineSpeaker: hasDistinctSpeakers(lines), snapshot }
}

/** §4.2 的核心流程，平台無關（只碰 {@link WidgetDataProvider} 與 `StorageAdapter`）。 */
export async function refreshWidgetCacheWith(
  provider: WidgetDataProvider,
  storage: StorageAdapter,
  config: WidgetConfig
): Promise<void> {
  const { lines, single, perLineSpeaker, snapshot } = await computeWidgetLines(provider, config)

  /*
   * 每一則顯示出來的對白都準備一張自己的頭像（最多兩張）。
   *
   * ⚠️ **不要「只有 perLineSpeaker 時才產第二張」**：一則版顯示的是
   * `singleLine`，而它可能是 `lines[1]`（自動補的情況下最新那則在下面，
   * 見 §14.1）——只產第一張的話，一則版會配到另一則的臉，群組聊天時
   * 直接張冠李戴。多產一張很便宜，判斷少一個分支反而更安全。
   */
  const avatarIndexOf = (line: ResolvedWidgetLine | undefined): number => {
    if (!line || !config.showAvatar) return -1
    const i = lines.findIndex((l) => l.messageId === line.messageId)
    return i >= 0 && i < WIDGET_IMAGE_KEYS.length ? i : -1
  }
  const toStateLine = (line: ResolvedWidgetLine): WidgetStateLine => ({
    text: line.text,
    name: line.name,
    conversationId: line.conversationId,
    messageId: line.messageId,
    pinned: line.pinned,
    avatarIndex: avatarIndexOf(line)
  })

  const file: WidgetStateFile = {
    showAvatar: config.showAvatar,
    perLineSpeaker,
    colors: resolveWidgetColors(normalizeWidgetAppearance(config.appearance), snapshot.colorTheme),
    lines: lines.map(toStateLine),
    singleLine: single ? toStateLine(single) : null
  }
  await storage.writeJson(WIDGET_STATE_KEY, file)

  for (let i = 0; i < WIDGET_IMAGE_KEYS.length; i++) {
    const line = config.showAvatar ? lines[i] : undefined
    const imageUrl = line?.characterId
      ? await provider.characterDisplayImageUrl(line.characterId, line.emotion).catch(() => null)
      : null
    const bytes = imageUrl ? await imageUrlToBytes(imageUrl) : null
    // 抓不到圖時**一定要把舊檔刪掉**，否則角色換了、頭像卻停在上一位的臉。
    if (bytes) await storage.writeBinary(WIDGET_IMAGE_KEYS[i], bytes)
    else await storage.remove(WIDGET_IMAGE_KEYS[i]).catch(() => {})
  }
  await storage.remove(LEGACY_WIDGET_IMAGE_KEY).catch(() => {})

  await triggerNativeWidgetRefresh()
}

/** 前景 UI 呼叫的版本：透過 `getData()`，兩種模式都能用。失敗安靜放棄，小工具是輔助功能。 */
export async function refreshWidgetCache(config?: WidgetConfig): Promise<void> {
  if (!isAttached()) return
  try {
    const resolved = config ?? (await readWidgetConfig())
    await refreshWidgetCacheWith(getData(), capacitorAdapters.storage, resolved)
  } catch {
    // 小工具是輔助功能，失敗不影響聊天本身
  }
}
