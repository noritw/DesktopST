// ⚠️ 這個檔案會被 Electron 主行程 import（`main/mobileServer.ts` 的
// `/api/sync-manifest`），而 main 的建置沒有 `@core` alias（見
// `electron.vite.config.ts`——只有 renderer 有）。core/ 裡凡是主行程也會用到的
// 模組一律走相對路徑，不要用 `@core/…`，否則桌面端建置會直接解析失敗。
import { sha1Hex } from '../util/sha1'
import { stableStringify } from '../util/stableJson'
import type { Character, PersonaPreset, ScenePreset, WorldPreset } from '../types'
import type { Lorebook } from '../lore/types'

/**
 * S2 M4：跨裝置的「內容是不是同一份」雜湊。
 *
 * ## 為什麼不能直接比 `updatedAt`
 *
 * 兩台機器的時鐘不同步，而且推送本身就會把接收端的 `updatedAt` 設成
 * `Date.now()`——推完之後電腦那份**永遠比手機新**，拿時間當「誰比較新」
 * 會每次都得出「用電腦的」，同步變成單向覆蓋。所以「內容一不一樣」必須
 * 看內容本身，時間只拿來顯示給使用者參考。
 *
 * ## 為什麼不能整份物件下去雜湊
 *
 * 三類欄位**跨裝置必然不同**，一律排除，否則每一列都會被判成「不一樣」：
 *
 * 1. **id 與時間**：`id`／`createdAt`／`updatedAt`／`builtIn`。
 * 2. **檔案路徑**：`avatar`／`emotions`／`spriteIds` 存的是各自裝置上的路徑，
 *    同一張圖在兩台的字串完全不同。
 * 3. **桌面專屬配置**：情境的 `desktopCharacters` 座標／大小／翻面、視窗位置、
 *    `colorTheme`——手機根本沒有這些概念，而且 `syncPush.ts` 推送時本來就
 *    刻意過濾掉不推（§3.2：不要洗掉電腦的桌寵配置）。既然不推，就不該
 *    因為它不同而把整列標成「有差異」。
 *
 * ## 交叉參照要換成名稱
 *
 * 情境的 `activePersonaId`、世界觀的 `lorebookIds` 這些**存的是對方裝置上
 * 不存在的 id**（電腦端 `savePersonaPresetDirect` 會重新發 id）。直接雜湊
 * 等於保證不同。所以一律先透過呼叫端給的 resolver 換成名稱再雜湊——
 * 名稱正好就是 `pair.ts` 判定身分的依據，兩邊一致。
 *
 * ⚠️ **改這個檔案時，桌面端（`main/mobileServer.ts` 的 `/api/sync-manifest`）
 * 與手機端（`mobile/runtime/syncManifest.ts` 的 `buildLocalManifest`）必須同時
 * 改。** 兩邊算法只要漂移一個欄位，所有列都會變成「內容不同」，使用者會看到
 * 一整頁假衝突——而且不會有任何錯誤訊息。這也是為什麼算法只有這一份、
 * 放在 `core/`，兩端都 import 它，不各自抄一份。
 */

/** 把 id 換成名稱；查不到的用原 id（至少穩定，不會憑空消失）。 */
export type NameResolver = (id: string) => string | undefined

const resolveNames = (ids: string[] | undefined, resolve: NameResolver): string[] =>
  (ids ?? []).map((id) => resolve(id) ?? id).sort()

const hash = (subset: unknown): string => sha1Hex(stableStringify(subset))

export function characterContentHash(c: Character, lorebookName: NameResolver): string {
  return hash({
    name: c.name,
    nicknames: c.nicknames ?? [],
    description: c.description,
    personality: c.personality,
    firstMessage: c.firstMessage,
    exampleDialogue: c.exampleDialogue,
    scenario: c.scenario ?? '',
    systemPromptOverride: c.systemPromptOverride ?? '',
    creatorNotes: c.creatorNotes ?? '',
    newsKeywords: [...(c.newsKeywords ?? [])].sort(),
    lorebooks: resolveNames(c.lorebookIds, lorebookName)
  })
}

export function personaContentHash(p: PersonaPreset): string {
  return hash({
    name: p.name,
    displayName: p.displayName,
    nickname: p.nickname,
    nicknames: p.nicknames ?? [],
    description: p.description
  })
}

export function worldContentHash(w: WorldPreset, lorebookName: NameResolver): string {
  return hash({
    name: w.name,
    worldSetting: w.worldSetting,
    interactionExample: w.interactionExample,
    lorebooks: resolveNames(w.lorebookIds, lorebookName)
  })
}

/** 情境要換掉三種 id：使用者設定、世界觀、桌面角色。 */
export interface SceneResolvers {
  personaName: NameResolver
  worldName: NameResolver
  characterName: NameResolver
  lorebookName: NameResolver
}

export function sceneContentHash(s: ScenePreset, r: SceneResolvers): string {
  return hash({
    name: s.name,
    persona: s.activePersonaId ? (r.personaName(s.activePersonaId) ?? s.activePersonaId) : '',
    world: s.activeWorldId ? (r.worldName(s.activeWorldId) ?? s.activeWorldId) : '',
    // 只取角色名稱與靜音狀態——座標／大小／翻面是桌面專屬，推送時本來就不帶
    characters: (s.desktopCharacters ?? [])
      .map((dc) => ({ name: r.characterName(dc.characterId) ?? dc.characterId, muted: !!dc.muted }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    newsKeywordGroupId: s.newsKeywordGroupId ?? '',
    // undefined（跟隨疊加）與 []（一本都不用）語意不同，要分得出來
    lorebooks: s.lorebookIds === undefined ? null : resolveNames(s.lorebookIds, r.lorebookName),
    moduleOverrides: s.moduleOverrides ?? {}
  })
}

export function lorebookContentHash(b: Lorebook): string {
  return hash({
    name: b.name,
    scan_depth: b.scan_depth,
    token_budget: b.token_budget,
    entries: [...b.entries]
      .sort((a, b2) => a.insertion_order - b2.insertion_order || a.content.localeCompare(b2.content))
      .map((e) => ({
        keys: [...e.keys].sort(),
        content: e.content,
        enabled: e.enabled,
        constant: e.constant,
        case_sensitive: !!e.case_sensitive,
        insertion_order: e.insertion_order,
        priority: e.priority ?? null,
        secondary_keys: [...(e.secondary_keys ?? [])].sort(),
        selective: !!e.selective,
        comment: e.comment ?? ''
      }))
  })
}
