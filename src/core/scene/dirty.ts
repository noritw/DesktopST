import type { ColorTheme, DesktopCharacterState, ScenePreset } from '../types'

/**
 * 套用情境後、與目前執行中狀態比對用的 runtime 摘要。
 *
 * 刻意不含角色座標／視窗大小：拖寵物與調視窗是常態操作，
 * 若一併算 dirty，星號會幾乎永遠亮著，反而失去「記得存檔」的提示意義。
 * 「覆寫為目前狀態」仍會把座標一併寫回。
 */
export interface SceneRuntimeSnapshot {
  activePersonaId: string
  activeWorldId: string
  colorTheme?: ColorTheme
  lastActiveConversationId?: string
  desktopCharacterIds: string[]
}

type SceneDirtyFields = Pick<
  ScenePreset,
  'activePersonaId' | 'activeWorldId' | 'colorTheme' | 'lastActiveConversationId' | 'desktopCharacters'
>

function sameIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  for (const id of b) {
    if (!set.has(id)) return false
  }
  return true
}

function characterIds(chars: DesktopCharacterState[]): string[] {
  return chars.map((d) => d.characterId)
}

/**
 * 使用中的情境是否與目前桌面／設定狀態不一致。
 *
 * 無使用中情境時回 `false`。呼叫端應先確認 `activeSceneId` 對應到這份 `scene`。
 */
export function isActiveSceneDirty(scene: SceneDirtyFields, current: SceneRuntimeSnapshot): boolean {
  if (scene.activePersonaId !== current.activePersonaId) return true
  if (scene.activeWorldId !== current.activeWorldId) return true
  if ((scene.colorTheme ?? 'mint') !== (current.colorTheme ?? 'mint')) return true
  if ((scene.lastActiveConversationId ?? '') !== (current.lastActiveConversationId ?? '')) return true
  return !sameIdSet(characterIds(scene.desktopCharacters), current.desktopCharacterIds)
}
