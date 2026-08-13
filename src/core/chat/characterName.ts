import type { Conversation, Message } from '../types'

/**
 * 訊息上的角色名字快照（`Message.characterName`）。
 *
 * 兩個平台共用同一份邏輯：桌面在 `fileStore.saveConversation` 補寫，
 * 手機在 `session.saveConversation` 補寫，顯示端則共用 `resolveCharacterName`。
 * 放在 `core/` 是因為這裡完全不碰平台 —— 也才能被 `npm test` 直接測到。
 *
 * ## 這是備援，不是顯示來源
 *
 * `characterId` 查得到角色時**一律以角色現在的名字為準**：改名之後舊對話
 * 也應該跟著顯示新名字，那是同一隻角色。只有 id 查不到人（角色被刪、
 * 或同步把 id 換掉了）才退回這個快照。詳細理由見 `types.ts` 的欄位註解。
 */

/** 查名字只需要這兩個欄位，`Character` 與 `PresentCharacter` 都吃得下。 */
export interface NamedCharacter {
  id: string
  name: string
}

/**
 * 決定一則訊息要顯示的角色名字。
 *
 * 優先序：現存角色的名字 → 訊息裡的名字快照 → `fallback`。
 * `fallback` 由呼叫端決定（桌面用「角色」、手機用空字串），因為兩邊
 * 對「不知道是誰」的呈現方式本來就不同。
 */
export function resolveCharacterName(
  characterId: string | undefined,
  characters: readonly NamedCharacter[],
  snapshotName?: string,
  fallback = ''
): string {
  if (!characterId) return fallback
  const live = characters.find((c) => c.id === characterId)
  if (live?.name) return live.name
  const snap = snapshotName?.trim()
  return snap || fallback
}

/**
 * 把目前的角色名字補寫進對話裡還沒有快照的角色訊息。
 *
 * 回傳「有沒有動到東西」，讓呼叫端可以在沒變動時跳過寫檔。
 *
 * 規則刻意保守：
 * - **只補、不覆蓋**。已經有快照的不動 —— 那是當時存下來的，比現在的猜測可信
 *   （角色可能早就被刪掉了，這時現在的名單反而查不到人）。
 * - **查不到角色就不寫**。寫不出正確答案時留空，讓 UI 顯示「不知道是誰」，
 *   總比塞一個猜的名字進使用者的存檔好。
 */
export function stampCharacterNames(conv: Conversation, characters: readonly NamedCharacter[]): boolean {
  let changed = false
  for (const msg of conv.messages) {
    if (!needsStamp(msg)) continue
    const name = characters.find((c) => c.id === msg.characterId)?.name
    if (!name) continue
    msg.characterName = name
    changed = true
  }
  return changed
}

function needsStamp(msg: Message): boolean {
  return msg.role === 'character' && !!msg.characterId && !msg.characterName?.trim()
}
