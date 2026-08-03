import type { PlatformAdapters } from '../../core/adapters'
import { electronStorage } from './storageAdapter'
import { electronSecrets } from './secretAdapter'
import { electronHttp } from './httpAdapter'
import { electronScheduler } from './schedulerAdapter'
import { electronNotifier } from './notifierAdapter'

export { electronStorage, electronSecrets, electronHttp, electronScheduler, electronNotifier }

/**
 * 桌面版的平台能力總集。
 *
 * 之後把 `llm/`、`news/trigger`、`pngUtils` 等搬進 `core/` 時，
 * 由 `main/` 這邊把這包傳進去；手機版會傳一包 Capacitor 的實作。
 */
export const electronAdapters: PlatformAdapters = {
  storage: electronStorage,
  secrets: electronSecrets,
  http: electronHttp,
  scheduler: electronScheduler,
  notifier: electronNotifier
}
