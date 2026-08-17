export const MAX_FOOD_PHOTOS = 3

/** \u98df\u7269\u5eab\u7167\u7247\u5b58\u653e\u4f4d\u7f6e\uff0c\u6a5f\u672c\u984d\u5916\u5b58 Uint8Array \u4e8c\u9032\u4f4d\uff0c\u4e0d\u9032 JSON snapshot\u3002 */
export function foodPhotoKey(foodItemId: string, index: number): string {
  return `food-photos/${foodItemId}/${index}.webp`
}

/** \u9910\u6b21\u7167\u7247\u53ea\u6709\u4e00\u5f35\uff0c\u8207\u98df\u7269\u5eab\u7167\u7247\u5206\u958b\u5b58\u653e\u3002 */
export function mealPhotoKey(mealLogId: string): string {
  return `meal-photos/${mealLogId}.webp`
}

/**
 * \u627e\u51fa\u76ee\u524d photoKeys \u6c92\u7528\u5230\u7684\u6700\u5c0f index\uff0c\u907f\u514d\u522a\u9664\u4e2d\u9593\u90a3\u5f35\u5f8c\u518d\u65b0\u589e\u6642
 * \u7528\u300c\u76ee\u524d\u5f35\u6578\u300d\u7576 index \u800c\u649e\u540d\u84cb\u6389\u9084\u7559\u8457\u7684\u6a94\u6848\u3002
 */
export function nextFreeFoodPhotoIndex(foodItemId: string, existingKeys: readonly string[]): number {
  const used = new Set(existingKeys)
  let index = 0
  while (used.has(foodPhotoKey(foodItemId, index))) index++
  return index
}
