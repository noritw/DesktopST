/**
 * 模組開關的說明文案（owner 2026-08-06：「至少要解說每個模組是幹嘛的」）。
 *
 * 伺服器端（`listMobileModuleTogglesDirect`）只回 `id` 與短標籤，
 * 沒有說明——短標籤如「Spotify 音樂偵測」對沒用過的人等於沒講。
 *
 * Spotify／日曆的 OAuth 仍只在桌面完成（手機這版只給開關）。
 * 天氣位置與新聞陪聊頻率則可在手機設定（見 SettingsView／NewsSettingsView）。
 */
const DESCRIPTIONS: Record<string, string> = {
  'desktopst.weather': '角色會知道現在的天氣與氣溫，聊天時可能主動提起。地點可在上方「天氣」區塊設定。',
  'desktopst.news': '角色會知道最近的新聞，可以跟你聊時事。陪聊頻率與排程在「個人新聞報 → 新聞設定」。',
  'desktopst.spotify': '角色會知道你正在聽什麼歌。帳號連結請在電腦版「設定 → 擴充」完成，手機只負責開關。',
  'desktopst.calendar': '角色會知道你今天的行程（唯讀）。授權請在電腦版完成，手機只負責開關。'
}

export function moduleDescription(id: string): string | null {
  return DESCRIPTIONS[id] ?? null
}
