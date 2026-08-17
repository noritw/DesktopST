import type { BodyProfile, FoodItem, MealLog } from '@core/nutrition'

export function foodItem(overrides: Partial<FoodItem> = {}): FoodItem {
  return {
    id: 'food-1',
    name: '燻雞三明治',
    aliases: ['sandwich', '雞肉堡'],
    perServing: { kcal: 400, proteinG: 25 },
    photoKeys: [],
    source: 'user',
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

export function mealLog(overrides: Partial<MealLog> = {}): MealLog {
  return {
    id: 'meal-1',
    foodItemId: 'food-1',
    servings: 1,
    eatenAt: new Date(2026, 7, 17, 12, 0).getTime(),
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

export const bodyProfile: BodyProfile = {
  id: 'body-1',
  heightCm: 175,
  weightKg: 80,
  ageYears: 30,
  activityLevel: 'sedentary',
  dailyKcalLimit: 2_000,
  dailyProteinGoalG: 100,
  createdAt: 1,
  updatedAt: 1
}
