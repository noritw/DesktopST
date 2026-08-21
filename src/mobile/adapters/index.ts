import type { PlatformAdapters } from '../../core/adapters'
import { capacitorStorage } from './storageAdapter'
import { capacitorSecrets, initCapacitorSecrets } from './secretAdapter'
import { capacitorHttp } from './httpAdapter'
import { capacitorScheduler } from './schedulerAdapter'
import { capacitorNotifier } from './notifierAdapter'

export {
  capacitorStorage,
  capacitorSecrets,
  initCapacitorSecrets,
  capacitorHttp,
  capacitorScheduler,
  capacitorNotifier
}
export { createMemoryStorage } from './memoryStorage'
export {
  createSecretAdapterFromKey,
  generateMasterKey,
  unavailableSecrets
} from './secretCrypto'

/**
 * 手機版平台能力總集。
 *
 * ⚠️ 使用前若會碰到 API Key／settings，先 `await initCapacitorSecrets()`。
 */
export const capacitorAdapters: PlatformAdapters = {
  storage: capacitorStorage,
  secrets: capacitorSecrets,
  http: capacitorHttp,
  scheduler: capacitorScheduler,
  notifier: capacitorNotifier
}
