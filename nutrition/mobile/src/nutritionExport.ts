/**
 * CSV / JSON 匯出與匯入工具。
 * 用途：讓使用者可以把飲食紀錄匯出給各家 AI（OpenAI、Gemini、Claude、Grok）分析。
 */

import type { FoodItem, MealLog, BodyProfile, NutritionSnapshot } from '@core/nutrition'
import { toIsoDateString } from '@core/nutrition'

/**
 * 將飲食紀錄匯出成 CSV 格式。
 * 格式：日期,時間,食物名稱,份量,熱量,蛋白質,碳水,脂肪,纖維,標籤,備註
 */
export function buildNutritionCsv(snapshot: NutritionSnapshot, dateStart?: string, dateEnd?: string): string {
  const { mealLogs, foodItems, bodyProfile } = snapshot

  // 建立食物快取對照表
  const foodById = new Map(foodItems.map(f => [f.id, f]))

  // 篩選日期範圍
  const filtered = mealLogs.filter(log => {
    const isoDate = toIsoDateString(log.eatenAt)
    if (dateStart && isoDate < dateStart) return false
    if (dateEnd && isoDate > dateEnd) return false
    return true
  })

  // 排序按時間
  filtered.sort((a, b) => a.eatenAt - b.eatenAt)

  // Header 備註行：個人檔案資訊
  const profileLines: string[] = []
  if (bodyProfile) {
    profileLines.push(`# 個人檔案`)
    profileLines.push(`# 身高: ${bodyProfile.heightCm} cm`)
    profileLines.push(`# 體重: ${bodyProfile.weightKg} kg`)
    profileLines.push(`# 日熱量目標: ${bodyProfile.dailyKcalLimit} kcal`)
    profileLines.push(`# 目標: ${bodyProfile.goal}`)
    profileLines.push(`# 活動等級: ${bodyProfile.activityLevel}`)
    profileLines.push(``)
  }

  // CSV 表頭
  const headers = ['日期', '時間', '食物名稱', '份量', '熱量(kcal)', '蛋白質(g)', '碳水(g)', '脂肪(g)', '纖維(g)', '標籤', '備註']

  // CSV 列內容
  const rows = filtered.map(log => {
    const food = foodById.get(log.foodItemId)
    if (!food) return null

    const date = toIsoDateString(log.eatenAt)
    const eatenAtDate = new Date(log.eatenAt)
    const time = `${String(eatenAtDate.getHours()).padStart(2, '0')}:${String(eatenAtDate.getMinutes()).padStart(2, '0')}`
    const name = food.name
    const amount = `${log.servings} 份`
    const kcal = (food.perServing.kcal * log.servings).toFixed(0)
    const protein = (food.perServing.proteinG * log.servings).toFixed(1)
    const carbs = food.perServing.carbsG ? (food.perServing.carbsG * log.servings).toFixed(1) : ''
    const fat = food.perServing.fatG ? (food.perServing.fatG * log.servings).toFixed(1) : ''
    // 注：食物庫目前沒有專門的纖維欄位，CSV 保留空欄供補充
    const fiber = ''
    const tags = food.tags?.join(';') ?? ''
    const note = log.note ?? ''

    return [date, time, name, amount, kcal, protein, carbs, fat, fiber, tags, note]
      .map(v => {
        // CSV 逃脫：含逗號、引號或換行的欄位要用雙引號包裹，引號內部要雙倍
        const str = String(v ?? '')
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`
        }
        return str
      })
      .join(',')
  }).filter(Boolean)

  return [...profileLines, headers.join(','), ...rows].join('\n')
}

/**
 * 將飲食紀錄匯出成 JSON 格式。
 * 包含完整的用餐紀錄、食物庫對照、個人檔案。
 */
export function buildNutritionJson(snapshot: NutritionSnapshot, dateStart?: string, dateEnd?: string): string {
  const { mealLogs, foodItems, bodyProfile } = snapshot

  // 篩選日期範圍
  const filtered = mealLogs.filter(log => {
    const isoDate = toIsoDateString(log.eatenAt)
    if (dateStart && isoDate < dateStart) return false
    if (dateEnd && isoDate > dateEnd) return false
    return true
  })

  // 蒐集這個時間範圍內用到的食物
  const usedFoodIds = new Set(filtered.map(log => log.foodItemId))
  const referencedFoods = foodItems.filter(f => usedFoodIds.has(f.id))

  const data = {
    exportedAt: new Date().toISOString(),
    exportedAtLocal: new Date().toLocaleString('zh-TW'),
    dateRange: dateStart && dateEnd ? { start: dateStart, end: dateEnd } : { start: null, end: null },
    bodyProfile: bodyProfile ?? null,
    mealLogs: filtered,
    foodItems: referencedFoods,
    summary: {
      totalMeals: filtered.length,
      uniqueFoods: referencedFoods.length,
      dateRange: {
        earliest: filtered.length > 0 ? toIsoDateString(Math.min(...filtered.map(l => l.eatenAt))) : null,
        latest: filtered.length > 0 ? toIsoDateString(Math.max(...filtered.map(l => l.eatenAt))) : null
      }
    }
  }

  return JSON.stringify(data, null, 2)
}

/**
 * 解析 CSV 內容並回傳用餐紀錄清單（不寫回資料庫）。
 */
export function parseNutritionCsv(csvContent: string, foodItems: FoodItem[]): { logs: Partial<MealLog>[], errors: string[] } {
  const lines = csvContent.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
  if (lines.length < 2) return { logs: [], errors: ['CSV 格式不對：至少要有表頭和一筆記錄'] }

  const headers = lines[0].split(',')
  const dateIdx = headers.findIndex(h => h.includes('日期'))
  const timeIdx = headers.findIndex(h => h.includes('時間'))
  const nameIdx = headers.findIndex(h => h.includes('食物'))
  const amountIdx = headers.findIndex(h => h.includes('份量'))

  if (dateIdx < 0 || nameIdx < 0) {
    return { logs: [], errors: ['找不到必要的欄位：日期、食物名稱'] }
  }

  // 建立食物對照表：名稱 → id
  const foodByName = new Map<string, string>()
  foodItems.forEach(f => {
    foodByName.set(f.name.toLowerCase(), f.id)
    f.aliases.forEach(alias => foodByName.set(alias.toLowerCase(), f.id))
  })

  const logs: Partial<MealLog>[] = []
  const errors: string[] = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    const values = parseCSVLine(line)

    try {
      const dateStr = values[dateIdx]?.trim()
      const timeStr = values[timeIdx]?.trim()
      const foodName = values[nameIdx]?.trim()
      const amountStr = values[amountIdx]?.trim()

      if (!dateStr || !foodName) {
        errors.push(`第 ${i + 1} 列：缺少日期或食物名稱，略過`)
        continue
      }

      const foodId = foodByName.get(foodName.toLowerCase())
      if (!foodId) {
        errors.push(`第 ${i + 1} 列：找不到食物「${foodName}」，略過（可在食物庫新增後重新匯入）`)
        continue
      }

      // 解析日期與時間
      let eatenAt: number
      try {
        const datePart = dateStr.split('-').map(Number)
        let datetime = new Date(datePart[0], datePart[1] - 1, datePart[2])

        if (timeStr) {
          const [hours, minutes] = timeStr.split(':').map(Number)
          datetime.setHours(hours, minutes, 0, 0)
        } else {
          datetime.setHours(12, 0, 0, 0)
        }

        eatenAt = datetime.getTime()
      } catch {
        errors.push(`第 ${i + 1} 列：日期格式不對「${dateStr}」，略過`)
        continue
      }

      // 解析份量
      const servings = amountStr ? parseFloat(amountStr) : 1
      if (isNaN(servings) || servings <= 0) {
        errors.push(`第 ${i + 1} 列：份量無效「${amountStr}」，用預設值 1 份`)
      }

      logs.push({
        id: `import-${Date.now()}-${i}`, // 臨時 id，上層要自己換成 uuid
        foodItemId: foodId,
        servings: isNaN(servings) || servings <= 0 ? 1 : servings,
        eatenAt,
        note: values[11]?.trim() // 假設備註在第 11 欄
      })
    } catch (error) {
      errors.push(`第 ${i + 1} 列：解析失敗 ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return { logs, errors }
}

/**
 * 解析 JSON 內容並回傳用餐紀錄清單。
 */
export function parseNutritionJson(jsonContent: string): { logs: Partial<MealLog>[], errors: string[], bodyProfile?: BodyProfile } {
  const errors: string[] = []

  try {
    const data = JSON.parse(jsonContent) as any

    if (!Array.isArray(data.mealLogs)) {
      return { logs: [], errors: ['JSON 格式不對：缺少 mealLogs 陣列'] }
    }

    // 驗證每筆 log
    const logs = data.mealLogs
      .filter((log: any) => {
        if (!log.foodItemId || typeof log.servings !== 'number' || typeof log.eatenAt !== 'number') {
          errors.push(`記錄不完整，略過：${JSON.stringify(log).slice(0, 50)}`)
          return false
        }
        return true
      })
      .map((log: any) => ({
        id: log.id || `import-${Date.now()}-${Math.random()}`,
        foodItemId: log.foodItemId,
        servings: log.servings,
        eatenAt: log.eatenAt,
        note: log.note
      }))

    return {
      logs,
      errors,
      bodyProfile: data.bodyProfile
    }
  } catch (error) {
    return {
      logs: [],
      errors: [`JSON 解析失敗：${error instanceof Error ? error.message : String(error)}`]
    }
  }
}

/**
 * 解析 CSV 一行（處理引號轉義）。
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    const nextChar = line[i + 1]

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // 轉義的引號
        current += '"'
        i++ // skip next quote
      } else {
        // 進出引號區域
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += char
    }
  }

  result.push(current)
  return result
}
