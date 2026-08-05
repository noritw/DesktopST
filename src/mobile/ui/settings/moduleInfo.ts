/**
 * 模組開關的說明文案（owner 2026-08-06：「至少要解說每個模組是幹嘛的」）。
 *
 * 伺服器端（`listMobileModuleTogglesDirect`）只回 `id` 與短標籤，
 * 沒有說明——短標籤如「Spotify 音樂偵測」對沒用過的人等於沒講。
 * 說明是 UI 文案，依 roadmap §3.3 留在這一層，不進 core。
 *
 * ⚠️ **文案不寫「去電腦上設定」**（見既有慣例：手機版要能獨立運作，
 * 不可預設使用者背後有一台電腦）。天氣／Spotify／日曆確實需要先完成
 * 各自的基本設定才會生效，但文案只講「需要先完成設定」，不指定在哪台裝置。
 */

export const MODULE_DESCRIPTIONS: Record<string, string> = {
  'desktopst.weather': '角色會知道現在的天氣與氣溫，聊天時可能主動提起。需要先設定所在地點才會生效。',
  'desktopst.spotify': '角色會知道你正在聽什麼歌，可以跟你聊音樂。需要先完成 Spotify 連結才會生效。',
  'desktopst.calendar': '角色會知道你今天的行程（唯讀，不會幫你改），可以提醒你等一下有什麼事。需要先完成日曆授權才會生效。',
  'desktopst.news': '角色會知道最近的新聞，可以跟你聊時事。可在個人新聞報裡設定想追蹤的關鍵字。'
}

/** 查不到說明就回 `null`，UI 只顯示標籤不留空行。 */
export function moduleDescription(id: string): string | null {
  return MODULE_DESCRIPTIONS[id] ?? null
}
