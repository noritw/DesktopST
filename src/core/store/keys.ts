/**
 * 儲存位置的單一真相（B2.7）。
 *
 * 這裡定義的是 `StorageAdapter` 用的**平台無關相對 key**
 * （以 `/` 分隔、不以 `/` 開頭、不含 `..`；見 `core/adapters/storage.ts`）。
 * 桌面解析到資料夾、手機解析到 app 沙箱，但**檔案佈局兩邊必須一致**——
 * 否則同一份資料在兩個平台叫不同名字，同步與搬家包都會對不起來。
 *
 * core 不認識絕對路徑，這裡也不得出現 `%APPDATA%` 或任何路徑分隔符判斷。
 */

export const SETTINGS_KEY = 'settings.json'
export const PINNED_NOTES_KEY = 'pinned-notes.json'
export const REMINDERS_KEY = 'reminders.json'
/** 提醒觸發的歷史紀錄（見 `core/reminder/history.ts`）。 */
export const REMINDER_HISTORY_KEY = 'reminder-history.json'
/**
 * 每則提醒「最近一次生成的台詞」快取。
 *
 * 只在現場生成失敗（離線／API 掛掉／逾時）時當 fallback 用，
 * 見 `docs/mobile-standalone-reminder-plan.md` §2.1。
 * 這是**衍生資料**，刪掉不影響任何設定，因此不進同步也不進搬家包。
 */
export const REMINDER_CACHE_KEY = 'reminder-cache.json'
/**
 * 手機記住的「同步主機」（roadmap §4.7 星狀拓樸：只綁定一台）。
 *
 * 不放進 `settings.json` 是因為它**不該跟著設定被同步或匯出**——
 * 那是「這台裝置跟誰配對」，換一台手機就該重配，不是使用者偏好。
 */
export const SYNC_HOST_KEY = 'sync-host.json'
/**
 * 手機記住「上次用哪個模式」（S2 M1，`docs/mobile-mode-switch-sync.md` §4）。
 *
 * 只有原生殼會寫入／讀取這個 key——網頁版永遠是遙控模式（拓樸限制），
 * 這份偏好對它沒有意義。同樣不放進 `settings.json`：換一台手機不該帶著走。
 */
export const MODE_PREF_KEY = 'mode-pref.json'
/**
 * S2 M2 差異預覽的同步基準（`docs/mobile-mode-switch-sync.md` §5）。
 *
 * 只在手機上存在——電腦端不記任何同步狀態（星狀拓樸下手機只綁一台
 * 同步主機，見 §5.1）。這一版（M2）**只讀不寫**：基準要等資料真的搬過去
 * 才會更新（§7.2），M2 還沒有搬資料的功能。不放進 `settings.json`：
 * 這是同步游標，不是使用者資料，換一台手機不該帶著走。
 */
export const SYNC_BASELINE_KEY = 'sync-baseline.json'
/**
 * 框選的臉部顯示範圍（`docs/mobile-character-expression-plan.md` §3.1），
 * key 是 characterId。
 *
 * ⚠️ **2026-08-25 起雙端都有一份、且走 S2 `characterDisplay` 種類同步**
 * （`core/sync/pair.ts` 的 `KINDS`）——這推翻了本檔案原本「mobile-only 裝置
 * 偏好」的舊決策：桌面角色庫縮圖現在也套用這份框選。手機端仍然只讀寫自己
 * 這一份本地檔案（見 `mobile/runtime/faceCropConfig.ts` 檔頭），桌面端另有
 * 自己的一份（`main/ipcHandlers.ts` 的 `getCharacterDisplayConfigDirect`/
 * `setCharacterDisplayConfigDirect`）——**兩邊各自存本地檔案，靠同步引擎
 * 對齊內容，不是共用同一個實體檔案**，跟 `CHARACTERS_DIR` 那種本來就同步的
 * 資料是同一種模式，只是這份設定當初沒被算進「一般角色卡內容」。
 */
export const CHARACTER_DISPLAY_CONFIG_KEY = 'character-display-config.json'
/**
 * Android 桌面小工具的設定（釘選的對白＋要不要顯示頭像，
 * `docs/mobile-android-widget-plan.md` §2.2 A 層）。**全域一份，不以角色分群**
 * ——小工具跟著「目前這個對話」走，見 `core/character/widgetSnapshot.ts` 檔頭。
 * 同樣是 mobile-only 裝置偏好，理由與 `MODE_PREF_KEY` 一致：
 * 不進同步／搬家包，桌面版沒有這個小工具（跟 `CHARACTER_DISPLAY_CONFIG_KEY`
 * 不同——那個 2026-08-25 起已改成雙端同步，這個沒有）。
 *
 * ⚠️ 原生層（`DeSTWidgetProvider.kt`）**不讀這一份**，只讀 Bridge 產出的
 * `widget-cache/state.json`——檔名改動時要順手確認那邊。
 */
export const WIDGET_CONFIG_KEY = 'widget-config.json'
/**
 * 「本機日曆衍生提醒有變動，但還沒推送到手機」旗標（桌面限定，
 * `docs/calendar-driven-reminders-kickoff.md` §6）。純粹是裝置本地狀態，
 * 不進 S2 同步、不進搬家包——換一台電腦不該帶著走，而且手機端完全用不到它。
 */
export const CALENDAR_SYNC_FLAG_KEY = 'calendar-sync-flag.json'

/**
 * 天氣主動發話：上次觀測到的世界狀態快照（`core/weather/proactive.ts` 的
 * `WeatherWatchSnapshot`）。桌面限定裝置本地狀態，不進 S2 同步——
 * 「已經講過哪些事件」換一台電腦沒有意義，帶著走反而會讓新裝置錯過該講的事件。
 */
export const WEATHER_WATCH_SNAPSHOT_KEY = 'weather-watch-snapshot.json'

/**
 * 早安簡報：上次講過早安的日期快照（`core/greeting/morningBriefing.ts` 的
 * `MorningBriefingSnapshot`）。裝置本地狀態，不進 S2 同步——「今天講過了嗎」
 * 換一台裝置沒有意義，帶著走反而會讓新裝置漏講。
 */
export const MORNING_BRIEFING_KEY = 'morning-briefing.json'

/**
 * 天氣主動發話的手機影子模式 log（`docs/weather-proactive-mobile-kickoff.md` §9.3）。
 * 桌面版寫的是純文字檔（`main/weatherWatcher.ts` 直接 `fs.appendFileSync`），
 * 手機沒有等價的原生檔案寫入管道，改存 JSON 陣列、只留最近 N 筆。
 * 純衍生資料，不進同步、不進搬家包。
 */
export const WEATHER_PROACTIVE_SHADOW_LOG_KEY = 'weather-proactive-shadow-log.json'

export const MODULES_DIR = 'modules'
export const CHARACTERS_DIR = 'characters'
export const CONVERSATIONS_DIR = 'conversations'
export const PERSONAS_DIR = 'personas'
export const WORLDS_DIR = 'worlds'
export const SCENES_DIR = 'scenes'
export const LOREBOOKS_DIR = 'lorebooks'

/** 啟動時需要先確保存在的目錄（相對 key，不含資料根目錄本身）。 */
export const DATA_SUBDIRS = [
  MODULES_DIR,
  CHARACTERS_DIR,
  CONVERSATIONS_DIR,
  PERSONAS_DIR,
  WORLDS_DIR,
  SCENES_DIR,
  LOREBOOKS_DIR
] as const

export const personaKey = (id: string): string => `${PERSONAS_DIR}/${id}.json`
export const worldKey = (id: string): string => `${WORLDS_DIR}/${id}.json`
export const sceneKey = (id: string): string => `${SCENES_DIR}/${id}.json`
export const conversationKey = (id: string): string => `${CONVERSATIONS_DIR}/${id}.json`
export const lorebookKey = (id: string): string => `${LOREBOOKS_DIR}/${id}.json`

/** 角色是一個資料夾（卡片 ＋ 圖片），卡片本體固定叫 card.json。 */
export const characterDirKey = (id: string): string => `${CHARACTERS_DIR}/${id}`
export const characterCardKey = (id: string): string => `${CHARACTERS_DIR}/${id}/card.json`

/** 從 `xxx.json` 檔名取出 id；非 .json 回傳 null。 */
export function idFromJsonName(name: string): string | null {
  return name.endsWith('.json') ? name.slice(0, -'.json'.length) : null
}
