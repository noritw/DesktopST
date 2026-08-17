export const MAX_FOOD_PHOTOS = 3

/** \u98df\u7269\u5eab\u7167\u7247\u5b58\u653e\u4f4d\u7f6e\uff0c\u6a5f\u672c\u984d\u5916\u5b58 Uint8Array \u4e8c\u9032\u4f4d\uff0c\u4e0d\u9032 JSON snapshot\u3002 */
export function foodPhotoKey(foodItemId: string, index: number): string {
  return `food-photos/${foodItemId}/${index}.webp`
}

/** \u9910\u6b21\u7167\u7247\u53ea\u6709\u4e00\u5f35\uff0c\u8207\u98df\u7269\u5eab\u7167\u7247\u5206\u958b\u5b58\u653e\u3002 */
export function mealPhotoKey(mealLogId: string): string {
  return `meal-photos/${mealLogId}.webp`
}
