import type { ColorTheme, ScenePreset } from '../types'

/**
 * 套用情境時，設定層要跟著換掉的那幾個欄位。
 *
 * 桌面另外還要開關角色視窗、搬視窗座標，那些是平台專屬、留在 `main/`；
 * 這裡只放**兩邊一模一樣**的那一段。抄成兩份的話，日後情境多一個欄位
 * （例如綁定用語解說）就會只有一邊記得跟上。
 */
export interface SceneApplyTarget {
  activePersonaId: string
  activeWorldId: string
  activeSceneId?: string
  colorTheme?: ColorTheme
  lastActiveConversationId?: string
}

/**
 * 把情境的設定欄位寫進 `target`（就地修改）。
 *
 * `colorTheme` 與 `lastActiveConversationId` **只有情境真的有存才覆蓋** ——
 * 舊情境檔沒有這兩個欄位，用 `undefined` 蓋下去會把使用者目前的配色洗成預設值。
 */
export function applySceneSettings(scene: ScenePreset, target: SceneApplyTarget): void {
  target.activePersonaId = scene.activePersonaId
  target.activeWorldId = scene.activeWorldId
  target.activeSceneId = scene.id
  if (scene.colorTheme !== undefined) target.colorTheme = scene.colorTheme
  if (scene.lastActiveConversationId !== undefined) {
    target.lastActiveConversationId = scene.lastActiveConversationId
  }
}
