import type { FoodItem, MealLog } from './types'

export interface FoodKeywordMatch {
  foodItem: FoodItem
  matchScore: 100 | 80 | 60
  displayContext: {
    brand?: string
    flavor?: string
    useCount: number
    lastEatenAt?: number
  }
}

type RankedCandidate = {
  foodItem: FoodItem
  matchScore: number
  displayContext: FoodKeywordMatch['displayContext']
  index: number
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function scoreTerm(query: string, term: string): 100 | 80 | 60 | 0 {
  const normalizedTerm = normalize(term)
  if (!normalizedTerm) return 0
  if (normalizedTerm === query) return 100
  if (normalizedTerm.startsWith(query)) return 80
  if (normalizedTerm.includes(query)) return 60
  return 0
}

export function deriveUsageMetricsFromMealLogs(
  foodItemId: string,
  mealLogs: MealLog[]
): { useCount: number; lastEatenAt?: number } {
  const matchingLogs = mealLogs.filter((log) => log.foodItemId === foodItemId)
  return {
    useCount: matchingLogs.length,
    lastEatenAt: matchingLogs.length > 0
      ? Math.max(...matchingLogs.map((log) => log.eatenAt))
      : undefined
  }
}

export function matchFoodKeyword(
  query: string,
  foodItems: FoodItem[],
  mealLogs: MealLog[] = []
): FoodKeywordMatch[] {
  const normalizedQuery = normalize(query)
  if (!normalizedQuery) return []

  return foodItems
    .map((foodItem, index) => {
      const terms = [foodItem.name, ...foodItem.aliases]
      const matchScore = Math.max(...terms.map((term) => scoreTerm(normalizedQuery, term)))
      const derived = deriveUsageMetricsFromMealLogs(foodItem.id, mealLogs)
      const useCount = foodItem.useCount ?? derived.useCount
      const lastEatenAt = foodItem.lastEatenAt ?? derived.lastEatenAt
      const displayContext: FoodKeywordMatch['displayContext'] = { useCount }
      if (foodItem.brand) displayContext.brand = foodItem.brand
      if (foodItem.flavor) displayContext.flavor = foodItem.flavor
      if (lastEatenAt !== undefined) displayContext.lastEatenAt = lastEatenAt
      return {
        foodItem,
        matchScore,
        displayContext,
        index
      }
    })
    .filter((match): match is RankedCandidate & { matchScore: 100 | 80 | 60 } => match.matchScore > 0)
    .sort((a, b) =>
      b.matchScore - a.matchScore
      || b.displayContext.useCount - a.displayContext.useCount
      || (b.displayContext.lastEatenAt ?? 0) - (a.displayContext.lastEatenAt ?? 0)
      || a.index - b.index
    )
    .map(({ index: _index, ...match }) => match)
}
