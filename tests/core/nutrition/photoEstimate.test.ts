import { describe, expect, it } from 'vitest'
import {
  applyEstimateToEntries,
  buildPhotoEstimatePrompt,
  canAddAnotherFoodSlot,
  checkRequestCompatibility,
  estimateRequestCost,
  findDuplicateLog,
  formatServings,
  hashPhoto,
  matchFoodItem,
  normalizeLabel,
  nutritionFromGrams,
  parseEstimateResult,
  parsePastedNutrition,
  resolveEatenAt,
  resolveMaxFoodSlots,
  stepServings,
  UNKNOWN_MODEL_MAX_IMAGES_PER_REQUEST,
  type ModelCapabilities,
  type PhotoEstimateResult
} from '@core/nutrition'
import { foodItem, mealLog } from './fixtures'

describe('matchFoodItem', () => {
  it('回傳 0/1/N 候選', () => {
    const library = [
      foodItem({ id: 'a', name: '燻雞三明治', brand: '7-11' }),
      foodItem({ id: 'b', name: '燻雞三明治', brand: '全家' }),
      foodItem({ id: 'c', name: '滷雞腿便當' })
    ]
    expect(matchFoodItem('不存在', undefined, library)).toEqual([])
    expect(matchFoodItem('滷雞腿便當', undefined, library).map((f) => f.id)).toEqual(['c'])
    expect(matchFoodItem('燻雞三明治', undefined, library).map((f) => f.id)).toEqual(['a', 'b'])
    expect(matchFoodItem('燻雞三明治', '7-11', library).map((f) => f.id)).toEqual(['a'])
  })

  it('比對 aliases 且忽略大小寫與前後空白', () => {
    const library = [foodItem({ id: 'a', name: 'Sandwich', aliases: ['雞肉堡'] })]
    expect(matchFoodItem(' 雞肉堡 ', undefined, library).map((f) => f.id)).toEqual(['a'])
    expect(matchFoodItem('SANDWICH', undefined, library).map((f) => f.id)).toEqual(['a'])
  })
})

describe('buildPhotoEstimatePrompt', () => {
  it('不含個資，且帶入最近食物名稱', () => {
    const prompt = buildPhotoEstimatePrompt(['燻雞三明治', '滷雞腿便當'])
    expect(prompt).toContain('燻雞三明治、滷雞腿便當')
    expect(prompt).not.toMatch(/kcal.*:\s*\d/i)
  })

  it('沒有最近名稱時仍能組出 prompt', () => {
    expect(buildPhotoEstimatePrompt([])).toContain('JSON')
  })
})

describe('parseEstimateResult', () => {
  it('解析陣列並補上 slot', () => {
    const raw = [
      { name: '燻雞三明治', perServing: { kcal: 320, proteinG: 18 }, confidence: 'high' },
      { slot: 5, name: '滷雞腿便當' }
    ]
    const results = parseEstimateResult(raw)
    expect(results).toHaveLength(2)
    expect(results[0].slot).toBe(1)
    expect(results[0].perServing).toEqual({ kcal: 320, proteinG: 18 })
    expect(results[1].slot).toBe(5)
    expect(results[1].perServing).toBeNull()
  })

  it('接受單一物件（非陣列）', () => {
    const results = parseEstimateResult({ name: '滷雞腿便當' })
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('滷雞腿便當')
  })

  it('缺欄位不丟錯，回傳最小可用形狀', () => {
    const results = parseEstimateResult([{}])
    expect(results[0]).toMatchObject({ name: null, perServing: null, confidence: 'low', nutritionSource: 'estimate' })
  })

  it('非物件／非陣列回空陣列', () => {
    expect(parseEstimateResult(null)).toEqual([])
    expect(parseEstimateResult('garbage')).toEqual([])
  })
})

describe('applyEstimateToEntries', () => {
  const baseResult: PhotoEstimateResult = {
    slot: 1,
    name: '燻雞三明治',
    brand: '7-11',
    flavor: null,
    servings: 1,
    perServing: { kcal: 320, proteinG: 18 },
    nutritionSource: 'estimate',
    label: null,
    confidence: 'high',
    appliedNote: false,
    noteConflict: null,
    note: '三明治'
  }

  it('未命中既有食物 → 新建 FoodItem 並寫入 MealLog', () => {
    const { foodItem: created, mealLog: log } = applyEstimateToEntries(baseResult, {
      matchedFoodItem: null,
      newFoodItemId: 'food-new',
      newMealLogId: 'meal-new',
      now: 1000,
      eatenAt: 900,
      eatenAtSource: 'exif',
      servings: 1,
      photoKeys: ['food-photos/food-new/0.webp']
    })
    expect(created).not.toBeNull()
    expect(created?.id).toBe('food-new')
    expect(created?.source).toBe('llm-photo')
    expect(created?.perServing).toEqual({ kcal: 320, proteinG: 18 })
    expect(log.foodItemId).toBe('food-new')
    expect(log.eatenAtSource).toBe('exif')
  })

  it('命中既有食物 → 不新建 FoodItem，MealLog 沿用食物 id', () => {
    const matched = foodItem({ id: 'food-existing' })
    const { foodItem: created, mealLog: log } = applyEstimateToEntries(baseResult, {
      matchedFoodItem: matched,
      newFoodItemId: 'food-unused',
      newMealLogId: 'meal-new',
      now: 1000,
      eatenAt: 1000,
      eatenAtSource: 'now',
      servings: 2
    })
    expect(created).toBeNull()
    expect(log.foodItemId).toBe('food-existing')
    expect(log.servings).toBe(2)
  })

  it('label 來源的新食物 source 標記為 label', () => {
    const labelResult: PhotoEstimateResult = { ...baseResult, nutritionSource: 'label' }
    const { foodItem: created } = applyEstimateToEntries(labelResult, {
      matchedFoodItem: null,
      newFoodItemId: 'food-new',
      newMealLogId: 'meal-new',
      now: 1000,
      eatenAt: 1000,
      eatenAtSource: 'now',
      servings: 1
    })
    expect(created?.source).toBe('label')
  })
})

describe('resolveEatenAt', () => {
  it('優先序 exif → mtime → now(manual)', () => {
    expect(resolveEatenAt(100, 200, 300)).toEqual({ eatenAt: 100, eatenAtSource: 'exif' })
    expect(resolveEatenAt(null, 200, 300)).toEqual({ eatenAt: 200, eatenAtSource: 'mtime' })
    expect(resolveEatenAt(null, null, 300)).toEqual({ eatenAt: 300, eatenAtSource: 'manual' })
    expect(resolveEatenAt(undefined, undefined, 300)).toEqual({ eatenAt: 300, eatenAtSource: 'manual' })
  })
})

describe('hashPhoto / findDuplicateLog', () => {
  it('相同內容產生相同 hash', () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    expect(hashPhoto(bytes)).toBe(hashPhoto(new Uint8Array([1, 2, 3, 4])))
    expect(hashPhoto(bytes)).not.toBe(hashPhoto(new Uint8Array([1, 2, 3, 5])))
  })

  it('命中 photoHash 或 photoHashes 陣列', () => {
    const logs = [mealLog({ id: 'm1', photoHash: 'abc' }), mealLog({ id: 'm2', photoHashes: ['xyz', 'def'] })]
    expect(findDuplicateLog('abc', logs)?.id).toBe('m1')
    expect(findDuplicateLog('def', logs)?.id).toBe('m2')
    expect(findDuplicateLog('nope', logs)).toBeNull()
  })
})

describe('resolveMaxFoodSlots / canAddAnotherFoodSlot', () => {
  const caps: ModelCapabilities = { id: 'gpt-4o-mini', vision: true, maxImagesPerRequest: 10 }

  it('依模型能力算最壞情況上限', () => {
    expect(resolveMaxFoodSlots(caps)).toBe(3)
    expect(resolveMaxFoodSlots({ ...caps, maxImagesPerRequest: 30 })).toBe(8) // 硬上限
  })

  it('未知模型保守值為 3', () => {
    expect(UNKNOWN_MODEL_MAX_IMAGES_PER_REQUEST).toBe(3)
  })

  it('依實際已放張數動態判斷還能不能加', () => {
    expect(canAddAnotherFoodSlot(caps, 9)).toBe(true)
    expect(canAddAnotherFoodSlot(caps, 10)).toBe(false)
  })
})

describe('estimateRequestCost', () => {
  const caps: ModelCapabilities = {
    id: 'gpt-4o-mini',
    vision: true,
    maxImagesPerRequest: 10,
    pricing: { currency: 'USD', inputPerMTok: 0.15, outputPerMTok: 0.6, imageTokensFormula: 'fixed' }
  }

  it('算出正幣別金額', () => {
    const cost = estimateRequestCost(caps, 2, 500)
    expect(cost).not.toBeNull()
    expect(cost?.currency).toBe('USD')
    expect(cost?.amount).toBeGreaterThan(0)
  })

  it('缺價格表／幣別/formula 回 null', () => {
    expect(estimateRequestCost({ ...caps, pricing: null }, 1, 10)).toBeNull()
    expect(estimateRequestCost({ ...caps, pricing: { currency: 'USD', imageTokensFormula: 'fixed' } }, 1, 10)).toBeNull()
    expect(
      estimateRequestCost({ ...caps, pricing: { ...caps.pricing!, imageTokensFormula: 'unknown' } }, 1, 10)
    ).toBeNull()
  })
})

describe('checkRequestCompatibility', () => {
  const caps: ModelCapabilities = { id: 'm', vision: true, maxImagesPerRequest: 5 }

  it('列出所有相容性問題', () => {
    expect(checkRequestCompatibility(caps, { photoCount: 3, hasApiKey: true, isLocalModel: false })).toEqual([])
    expect(checkRequestCompatibility({ ...caps, vision: false }, { photoCount: 1, hasApiKey: true, isLocalModel: false })).toEqual([
      { kind: 'no-vision' }
    ])
    expect(checkRequestCompatibility(caps, { photoCount: 8, hasApiKey: true, isLocalModel: false })).toEqual([
      { kind: 'too-many-images', max: 5, excess: 3 }
    ])
    expect(checkRequestCompatibility(caps, { photoCount: 1, hasApiKey: false, isLocalModel: false })).toEqual([
      { kind: 'missing-api-key' }
    ])
    expect(checkRequestCompatibility(caps, { photoCount: 1, hasApiKey: false, isLocalModel: true })).toEqual([])
  })
})

describe('parsePastedNutrition', () => {
  it('抓出各種寫法', () => {
    expect(parsePastedNutrition('熱量 320 大卡，蛋白質 18 克')).toEqual({ kcal: 320, proteinG: 18 })
    expect(parsePastedNutrition('320 kcal 蛋白 18g 碳水 34g 脂肪 12 公克 糖 5g 鈉 610mg')).toEqual({
      kcal: 320,
      proteinG: 18,
      carbsG: 34,
      fatG: 12,
      sugarG: 5,
      sodiumMg: 610
    })
  })

  it('抓不到就當沒事，不丟錯', () => {
    expect(parsePastedNutrition('今天天氣真好')).toEqual({})
  })
})

describe('normalizeLabel', () => {
  it('perServing 基準：eatenPortion 為吃了幾份', () => {
    const label = { basis: 'perServing' as const, servingSizeG: 60, kcal: 150, proteinG: 5, sodiumMg: 260 }
    expect(normalizeLabel(label, 2)).toEqual({ kcal: 300, proteinG: 10, carbsG: null, fatG: null, sugarG: null, sodiumMg: 520 })
  })

  it('per100g 基準：用 servingSizeG × servingsPerPackage × eatenPortion 算出總克數', () => {
    const label = {
      basis: 'per100g' as const,
      servingSizeG: 60,
      servingsPerPackage: 2,
      kcal: 250,
      proteinG: 9,
      carbsG: 27,
      fatG: 9
    }
    const result = normalizeLabel(label, 1)
    expect(result.kcal).toBe(300) // 120g / 100 * 250
    expect(result.proteinG).toBeCloseTo(10.8)
    expect(result.sugarG).toBeNull()
  })

  it('perPackage 基準：eatenPortion 為吃了幾包', () => {
    const label = { basis: 'perPackage' as const, kcal: 500, proteinG: 20 }
    expect(normalizeLabel(label, 0.5)).toMatchObject({ kcal: 250, proteinG: 10 })
  })
})

describe('nutritionFromGrams', () => {
  it('per100g 基準直接換算', () => {
    const label = { basis: 'per100g' as const, kcal: 500, proteinG: 20, sodiumMg: 800 }
    const result = nutritionFromGrams(label, 12)
    expect(result?.kcal).toBeCloseTo(60)
    expect(result?.proteinG).toBeCloseTo(2.4)
    expect(result?.sodiumMg).toBeCloseTo(96)
  })

  it('perServing 基準先推回每100公克再換算', () => {
    const label = { basis: 'perServing' as const, servingSizeG: 25, kcal: 125, proteinG: 5 }
    // 每100g = 500 kcal / 20 proteinG
    const result = nutritionFromGrams(label, 12)
    expect(result?.kcal).toBeCloseTo(60)
    expect(result?.proteinG).toBeCloseTo(2.4)
  })

  it('perPackage 基準或缺 servingSizeG 時回 null', () => {
    expect(nutritionFromGrams({ basis: 'perPackage', kcal: 500, proteinG: 20 }, 12)).toBeNull()
    expect(nutritionFromGrams({ basis: 'perServing', kcal: 125, proteinG: 5 }, 12)).toBeNull()
  })
})

describe('stepServings / formatServings', () => {
  it('走 1/3→1/2→1→2→…→10 且到底不溢出', () => {
    expect(stepServings(1 / 3, 'down')).toBeCloseTo(1 / 3)
    expect(stepServings(1 / 3, 'up')).toBeCloseTo(1 / 2)
    expect(stepServings(1, 'up')).toBe(2)
    expect(stepServings(10, 'up')).toBe(10)
    expect(stepServings(1, 'down')).toBeCloseTo(1 / 2)
  })

  it('手打的非級距值會先找相鄰級距再走一步', () => {
    expect(stepServings(0.75, 'up')).toBe(1)
    expect(stepServings(0.75, 'down')).toBeCloseTo(1 / 2)
  })

  it('formatServings 顯示分數，其餘顯示數字', () => {
    expect(formatServings(1 / 3)).toBe('1/3')
    expect(formatServings(1 / 2)).toBe('1/2')
    expect(formatServings(1)).toBe('1')
    expect(formatServings(0.75)).toBe('0.75')
  })
})
