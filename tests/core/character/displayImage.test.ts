import { describe, expect, it } from 'vitest'
import { resolveDisplayImagePath } from '../../../src/core/character/displayImage'

describe('resolveDisplayImagePath', () => {
  const base = { avatar: 'characters/abc/avatar.png', emotions: { joy: 'characters/abc/emotions/joy.png' } }

  it('回主圖：emotion 是 undefined', () => {
    expect(resolveDisplayImagePath(base, undefined)).toEqual({ path: base.avatar, matchedEmotion: false })
  })

  it('對得到圖：emotions 裡有這個 key', () => {
    expect(resolveDisplayImagePath(base, 'joy')).toEqual({ path: base.emotions.joy, matchedEmotion: true })
  })

  it('對不到圖就退回主圖', () => {
    expect(resolveDisplayImagePath(base, 'anger')).toEqual({ path: base.avatar, matchedEmotion: false })
  })

  it('emotions 缺席時（角色卡沒設定任何表情）也能安全退回主圖', () => {
    expect(resolveDisplayImagePath({ avatar: base.avatar, emotions: {} }, 'joy')).toEqual({
      path: base.avatar,
      matchedEmotion: false
    })
  })

  it('spriteIds 只在對應的圖片真的被 emotions 指派時才生效（不是獨立命名空間）', () => {
    // spriteIds 有一筆自訂 id，但那張圖沒有出現在 emotions 裡——不該對到任何東西。
    const withSpriteIds = {
      avatar: base.avatar,
      emotions: {},
      spriteIds: { 'characters/abc/emotions/custom.png': 'custom' }
    }
    expect(resolveDisplayImagePath(withSpriteIds, 'custom')).toEqual({ path: base.avatar, matchedEmotion: false })
  })

  it('LLM 合約用的自訂 id 要能反查回圖片路徑（buildEmotionContract 的對稱邏輯）', () => {
    // 這是 2026-08-23 實機回報的成因：buildEmotionContract() 送給模型的合約
    // 不是 canonical 的 28 個情緒 key，而是 spriteIds[imagePath]（自訂 id），
    // 模型回傳這個自訂 id 時，這裡也要能反查回同一張圖，不能只查 canonical key。
    const withCustomId = {
      avatar: base.avatar,
      emotions: { joy: 'characters/abc/emotions/joy.png' },
      spriteIds: { 'characters/abc/emotions/joy.png': 'happy_face' }
    }
    expect(resolveDisplayImagePath(withCustomId, 'happy_face')).toEqual({
      path: 'characters/abc/emotions/joy.png',
      matchedEmotion: true
    })
  })

  it('沒有自訂 id 時，退回檔名主幹也要能對得到圖', () => {
    // 手機上傳表情圖沒有另外設定 spriteIds 時，buildEmotionContract() 會用
    // 檔名主幹（去掉副檔名）當 id——舊資料（上這次修正之前存的表情圖）要
    // 繼續讀得到，不能因為沒有 spriteIds 就對不到圖。
    const withoutCustomId = {
      avatar: base.avatar,
      emotions: { joy: 'characters/abc/emotions/joy-1755900000000.png' }
    }
    expect(resolveDisplayImagePath(withoutCustomId, 'joy-1755900000000')).toEqual({
      path: 'characters/abc/emotions/joy-1755900000000.png',
      matchedEmotion: true
    })
  })
})
