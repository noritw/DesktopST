// 相對路徑的理由同 `contentHash.ts` 檔頭：主行程建置沒有 `@core` alias。
import type { Character, PersonaPreset, ScenePreset, WorldPreset } from '../types'
import type { Lorebook } from '../lore/types'
import {
  characterContentHash,
  lorebookContentHash,
  personaContentHash,
  sceneContentHash,
  worldContentHash
} from './contentHash'
import type { Manifest, ManifestConversation } from './types'

/**
 * 從完整資料組出 `/api/sync-manifest` 形狀的輕量清單（S2 M4）。
 *
 * **桌面與手機共用這一支**，這樣 `contentHash` 的算法不可能漂移——
 * 兩邊各自維護一份雜湊是 M4 最容易出的錯，錯了會讓每一列都變成假衝突
 * 而且完全沒有錯誤訊息（`contentHash.ts` 開頭有完整說明）。
 */
export interface ManifestInput {
  characters: Character[]
  personas: PersonaPreset[]
  worlds: WorldPreset[]
  scenes: ScenePreset[]
  lorebooks: Lorebook[]
  conversations: ManifestConversation[]
  settingsHash: string
}

export function buildManifest(input: ManifestInput): Manifest {
  const nameOf = <T extends { id: string; name: string }>(list: T[]) => {
    const m = new Map(list.map((x) => [x.id, x.name]))
    return (id: string): string | undefined => m.get(id)
  }
  const lorebookName = nameOf(input.lorebooks)
  const personaName = nameOf(input.personas)
  const worldName = nameOf(input.worlds)
  const characterName = nameOf(input.characters)
  const sceneResolvers = { personaName, worldName, characterName, lorebookName }

  return {
    characters: input.characters.map((c) => ({
      id: c.id,
      name: c.name,
      updatedAt: c.updatedAt,
      contentHash: characterContentHash(c, lorebookName)
    })),
    personas: input.personas.map((p) => ({
      id: p.id,
      name: p.name,
      updatedAt: p.updatedAt,
      contentHash: personaContentHash(p)
    })),
    worlds: input.worlds.map((w) => ({
      id: w.id,
      name: w.name,
      updatedAt: w.updatedAt,
      contentHash: worldContentHash(w, lorebookName)
    })),
    scenes: input.scenes.map((s) => ({
      id: s.id,
      name: s.name,
      updatedAt: s.updatedAt,
      contentHash: sceneContentHash(s, sceneResolvers)
    })),
    lorebooks: input.lorebooks.map((b) => ({
      id: b.id,
      name: b.name,
      updatedAt: b.updatedAt,
      contentHash: lorebookContentHash(b)
    })),
    conversations: input.conversations,
    settingsHash: input.settingsHash
  }
}
