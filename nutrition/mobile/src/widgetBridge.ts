/**
 * 橋接 Android 桌面小工具（`android/.../widget/NutritionWidgetProvider.kt`）。
 * JS 沒有辦法直接發 Android broadcast，存檔／App 離開前景這兩個更新時機
 * （`docs/nutrition-widget-plan.md` §3）都要靠這支薄外掛跳回原生層重算。
 * 只有原生殼裝了這個外掛，瀏覽器煙測直接跳過（CLAUDE.md：外掛一律動態 import()）。
 */
export async function refreshNutritionWidget(): Promise<void> {
  const core = await import('@capacitor/core').catch(() => null)
  if (!core || !core.Capacitor.isNativePlatform()) return
  const bridge = core.registerPlugin<{ refresh(): Promise<void> }>('NutritionWidgetBridge')
  await bridge.refresh().catch(() => {})
}
