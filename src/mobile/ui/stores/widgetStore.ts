import { create } from 'zustand'
import {
  DEFAULT_WIDGET_CONFIG,
  isPinnedMessage,
  WIDGET_LINE_LIMIT,
  type PinnedWidgetMessage,
  type WidgetConfig
} from '@core/character/widgetSnapshot'
import {
  pinWidgetMessage,
  readWidgetConfig,
  setWidgetAppearance,
  setWidgetShowAvatar,
  unpinWidgetMessage
} from '../../runtime/widgetPins'
import { refreshWidgetCache } from '../../runtime/widgetBridge'

/**
 * 桌面小工具設定的 UI 狀態（`docs/mobile-android-widget-plan.md` §11.3）。
 *
 * 為什麼需要一個 store 而不是各元件自己讀檔：釘選狀態要**同時**反映在三個
 * 地方——聊天泡泡上的圖釘、訊息選單的「釘選／取消釘選」、小工具設定頁——
 * 各自讀檔的話改了其中一個，另外兩個要等重新掛載才會更新
 * （owner 2026-08-23 回報「釘選了沒有反應」有一半是這個）。
 *
 * ⚠️ **每次改完設定都要 `refreshWidgetCache()`**，這裡已經包在每支 action 裡了，
 * 呼叫端不要自己再呼叫一次。
 */

interface WidgetState {
  config: WidgetConfig
  /** 讀過檔了沒。還沒讀完前聊天畫面不要畫圖釘（避免閃一下才出現）。 */
  loaded: boolean
  load: () => Promise<void>
  /** 未滿上限就加在尾端；已滿時 `replaceIndex` 指定要換掉哪一格。 */
  pin: (message: PinnedWidgetMessage, replaceIndex?: number) => Promise<void>
  unpin: (messageId: string) => Promise<void>
  setShowAvatar: (showAvatar: boolean) => Promise<void>
  /** 配色與底色透明度（§14.2）。 */
  setAppearance: (appearance: WidgetConfig['appearance']) => Promise<void>
  /** 對話內容變了（送出訊息、切換對話⋯⋯）時重算一次小工具快照。 */
  refresh: () => Promise<void>
}

export const useWidgetStore = create<WidgetState>((set, get) => ({
  config: { ...DEFAULT_WIDGET_CONFIG },
  loaded: false,

  load: async () => {
    const config = await readWidgetConfig().catch(() => ({ ...DEFAULT_WIDGET_CONFIG }))
    set({ config, loaded: true })
  },

  pin: async (message, replaceIndex) => {
    const config = await pinWidgetMessage(message, replaceIndex)
    set({ config, loaded: true })
    await refreshWidgetCache(config)
  },

  unpin: async (messageId) => {
    const config = await unpinWidgetMessage(messageId)
    set({ config, loaded: true })
    await refreshWidgetCache(config)
  },

  setShowAvatar: async (showAvatar) => {
    const config = await setWidgetShowAvatar(showAvatar)
    set({ config, loaded: true })
    await refreshWidgetCache(config)
  },

  setAppearance: async (appearance) => {
    const config = await setWidgetAppearance(appearance)
    set({ config, loaded: true })
    await refreshWidgetCache(config)
  },

  refresh: async () => {
    // 設定本身沒變，但顯示內容（目前對話最新一則）可能變了。
    // 用手上這份 config 就好，不必再讀一次檔。
    await refreshWidgetCache(get().loaded ? get().config : undefined)
  }
}))

/** 這則訊息有沒有被釘選。聊天泡泡的圖釘與訊息選單共用。 */
export function useIsPinned(messageId: string): boolean {
  return useWidgetStore((s) => s.loaded && isPinnedMessage(s.config.pinnedMessages, messageId))
}

export { WIDGET_LINE_LIMIT }
