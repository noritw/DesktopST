import { Notification } from 'electron'
import type { NotifierAdapter, NotifyOptions } from '../../core/adapters'

/**
 * Electron 端的通知 adapter。
 *
 * 現行桌面版的提醒是叫角色說話（`character:force-speak`），不走系統通知，
 * 所以這支目前沒有呼叫端——它存在是為了讓手機端有對應的形狀可實作
 * （手機在背景時只能靠系統通知）。
 */
export const electronNotifier: NotifierAdapter = {
  async notify(opts: NotifyOptions): Promise<void> {
    if (!Notification.isSupported()) return
    new Notification({
      title: opts.title,
      body: opts.body,
      silent: opts.silent ?? false
    }).show()
  }
}
