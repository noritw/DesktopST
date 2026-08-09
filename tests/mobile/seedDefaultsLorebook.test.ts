import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { createMemoryStorage } from '../../src/mobile/adapters/memoryStorage'
import { importCharactersFromDstPack } from '../../src/mobile/runtime/seedDefaults'
import * as keys from '../../src/core/store/keys'

/**
 * `.dstpack` 裡帶的用語解說要能落地（缺口 #2 的另一半：S1 同步／手動匯入設定包
 * 都要能把電腦上掛的書一起帶過來，不然角色的 `lorebookIds` 是一堆查無此書的空 id）。
 *
 * 桌面 `buildDstPackDirect` 早就會把角色與世界觀綁的書塞進 `lorebooks/*.json`
 * （`includeLorebooks: true`），這裡直接手搭一個最小 zip 驗手機端真的有讀。
 */
function buildPackZip(opts: {
  characterId: string
  characterName: string
  lorebook?: { id: string; name: string }
}): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file(
    'manifest.json',
    JSON.stringify({ format: 'desktopst-pack', version: 1, characterIds: [opts.characterId] })
  )
  zip.file(
    `characters/${opts.characterId}/card.json`,
    JSON.stringify({ id: opts.characterId, name: opts.characterName, description: '', personality: '' })
  )
  if (opts.lorebook) {
    zip.file(
      `lorebooks/${opts.lorebook.id}.json`,
      JSON.stringify({
        id: opts.lorebook.id,
        name: opts.lorebook.name,
        entries: [],
        scan_depth: 0,
        token_budget: 2000,
        createdAt: 0,
        updatedAt: 0
      })
    )
  }
  return zip.generateAsync({ type: 'uint8array' })
}

describe('importCharactersFromDstPack：用語解說隨包落地', () => {
  it('包裡有 lorebooks/*.json 時，用原本的 id 存到本機並回報 id', async () => {
    const storage = createMemoryStorage()
    const bytes = await buildPackZip({
      characterId: 'c1',
      characterName: '小綠',
      lorebook: { id: 'lb-from-desktop', name: '專案用語' }
    })

    const result = await importCharactersFromDstPack(storage, bytes)

    expect(result.lorebookIds.size).toBe(1)
    expect(result.lorebookIds.has('lb-from-desktop')).toBe(true)
    const saved = await storage.readJson(keys.lorebookKey('lb-from-desktop'))
    expect(saved).toMatchObject({ id: 'lb-from-desktop', name: '專案用語' })
  })

  it('沒帶任何書時 lorebookIds 是空，角色照樣匯入成功', async () => {
    const storage = createMemoryStorage()
    const bytes = await buildPackZip({ characterId: 'c1', characterName: '小綠' })

    const result = await importCharactersFromDstPack(storage, bytes)

    expect(result.chars).toHaveLength(1)
    expect(result.lorebookIds.size).toBe(0)
  })

  it('壞掉的那本靜默略過，不擋角色匯入（規格 §6.6 同一原則）', async () => {
    const storage = createMemoryStorage()
    const zip = new JSZip()
    zip.file('manifest.json', JSON.stringify({ format: 'desktopst-pack', version: 1, characterIds: ['c1'] }))
    zip.file('characters/c1/card.json', JSON.stringify({ id: 'c1', name: '小綠' }))
    zip.file('lorebooks/broken.json', '{ not valid json')
    const bytes = await zip.generateAsync({ type: 'uint8array' })

    const result = await importCharactersFromDstPack(storage, bytes)

    expect(result.chars).toHaveLength(1)
    expect(result.lorebookIds.size).toBe(0)
  })
})
