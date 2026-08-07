export { HttpClient } from './httpClient'
export type { HttpClientOptions } from './httpClient'
export { RemoteDataSource } from './remoteDataSource'
export type { RemoteDataSourceOptions } from './remoteDataSource'
export { LocalDataSource } from './localDataSource'
export { getDeviceIdentity, setDeviceNickname } from './deviceIdentity'
export type { DeviceIdentity } from './deviceIdentity'

import type { DataSource } from '@core/data'
import type { PlatformAdapters } from '@core/adapters'
import { LocalDataSource } from './localDataSource'
import { RemoteDataSource } from './remoteDataSource'
import type { RemoteDataSourceOptions } from './remoteDataSource'
import { bootStandaloneSession } from '../runtime/session'
import type { BootStandaloneOptions } from '../runtime/session'

export type AppMode = 'standalone' | 'remote'

/**
 * 依模式挑一個資料來源。
 *
 * 獨立模式是 async（要解封金鑰、讀沙箱、種預設）；遙控仍同步建構。
 */
export async function createDataSource(
  mode: 'standalone',
  adapters: PlatformAdapters,
  bootOpts?: BootStandaloneOptions
): Promise<DataSource>
export async function createDataSource(
  mode: 'remote',
  opts: RemoteDataSourceOptions
): Promise<DataSource>
export async function createDataSource(
  mode: AppMode,
  adaptersOrOpts: PlatformAdapters | RemoteDataSourceOptions,
  bootOpts?: BootStandaloneOptions
): Promise<DataSource> {
  if (mode === 'remote') {
    return new RemoteDataSource(adaptersOrOpts as RemoteDataSourceOptions)
  }
  const session = await bootStandaloneSession(adaptersOrOpts as PlatformAdapters, bootOpts)
  return new LocalDataSource(session)
}
