export { HttpClient } from './httpClient'
export type { HttpClientOptions } from './httpClient'
export { RemoteDataSource } from './remoteDataSource'
export type { RemoteDataSourceOptions } from './remoteDataSource'
export { LocalDataSource } from './localDataSource'

import type { DataSource } from '@core/data'
import { LocalDataSource } from './localDataSource'
import { RemoteDataSource } from './remoteDataSource'
import type { RemoteDataSourceOptions } from './remoteDataSource'

export type AppMode = 'standalone' | 'remote'

/**
 * 依模式挑一個資料來源。**UI 只呼叫這支一次，之後拿到的東西沒有模式之分。**
 *
 * 網頁版（掃 QR）永遠只能是 `'remote'` —— 網頁由電腦提供，電腦沒開就連不上。
 * 這是拓樸限制不是取捨（roadmap §4.5），所以那條路徑不需要也不該給選擇。
 */
export function createDataSource(mode: 'standalone'): DataSource
export function createDataSource(mode: 'remote', opts: RemoteDataSourceOptions): DataSource
export function createDataSource(mode: AppMode, opts?: RemoteDataSourceOptions): DataSource {
  if (mode === 'remote') {
    if (!opts) throw new Error('remote mode requires connection options')
    return new RemoteDataSource(opts)
  }
  return new LocalDataSource()
}
