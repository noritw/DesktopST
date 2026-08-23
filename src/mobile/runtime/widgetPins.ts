import * as keys from '@core/store/keys'
import {
  DEFAULT_WIDGET_CONFIG,
  normalizeWidgetConfig,
  WIDGET_LINE_LIMIT,
  type PinnedWidgetMessage,
  type WidgetConfig
} from '@core/character/widgetSnapshot'
import { capacitorAdapters } from '../adapters'

/**
 * 桌面小工具的裝置本地設定（`docs/mobile-android-widget-plan.md` §2.2 A 層）。
 *
 * 跟 `faceCropConfig.ts` 同一類：mobile-only 裝置偏好，兩種資料來源模式
 * （獨立／遙控）都讀寫同一份 `widget-config.json`，不進同步／搬家包。
 *
 * 這裡只管檔案讀寫，**不負責觸發小工具重繪**——呼叫端改完設定要自己呼叫
 * `refreshWidgetCache()`（UI 一律走 `ui/stores/widgetStore.ts`，那邊已經包好了）。
 */

export async function readWidgetConfig(): Promise<WidgetConfig> {
  const raw = await capacitorAdapters.storage.readJson<unknown>(keys.WIDGET_CONFIG_KEY)
  return normalizeWidgetConfig(raw)
}

export async function writeWidgetConfig(config: WidgetConfig): Promise<void> {
  await capacitorAdapters.storage.writeJson(keys.WIDGET_CONFIG_KEY, config)
}

/**
 * 釘選一則訊息。**未滿上限就加在尾端；已滿則取代 `replaceIndex` 指定的那一格**
 * （維持陣列順序——使用者體感上「換掉第一句」就該顯示在原本第一句的位置）。
 * 已經釘過同一則就原樣返回，不會重複。
 */
export async function pinWidgetMessage(
  message: PinnedWidgetMessage,
  replaceIndex?: number
): Promise<WidgetConfig> {
  const config = await readWidgetConfig()
  const pins = [...config.pinnedMessages]
  if (pins.some((p) => p.messageId === message.messageId)) return config

  if (pins.length < WIDGET_LINE_LIMIT) pins.push(message)
  else pins[replaceIndex ?? WIDGET_LINE_LIMIT - 1] = message

  const next = { ...config, pinnedMessages: pins }
  await writeWidgetConfig(next)
  return next
}

/** 取消釘選（依 messageId，聊天畫面與小工具設定頁共用同一支）。 */
export async function unpinWidgetMessage(messageId: string): Promise<WidgetConfig> {
  const config = await readWidgetConfig()
  const next = { ...config, pinnedMessages: config.pinnedMessages.filter((p) => p.messageId !== messageId) }
  await writeWidgetConfig(next)
  return next
}

export async function setWidgetShowAvatar(showAvatar: boolean): Promise<WidgetConfig> {
  const config = await readWidgetConfig()
  const next = { ...config, showAvatar }
  await writeWidgetConfig(next)
  return next
}

/** 配色與底色透明度（§14.2）。`theme: null` ＝ 跟隨 App 目前的配色。 */
export async function setWidgetAppearance(appearance: WidgetConfig['appearance']): Promise<WidgetConfig> {
  const config = await readWidgetConfig()
  const next = { ...config, appearance }
  await writeWidgetConfig(next)
  return next
}

export { DEFAULT_WIDGET_CONFIG }
