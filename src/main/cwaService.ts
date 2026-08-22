/**
 * 中央氣象署 Open Data API 查詢服務 —— 桌面薄殼。
 *
 * 邏輯本體已搬到 `core/weather/realtimeQuery.ts`（背景天氣的 `cwaFetch` 等
 * 已經在 `core/weather/cwa.ts`），這裡只補上 Electron 的 HTTP adapter。
 * 手機獨立版走同一份 core，見 `mobile/runtime/chat.ts`。
 */
import {
  detectQueryType as coreDetectQueryType,
  fetchCwaBackgroundWeather as coreFetchCwaBackgroundWeather,
  fetchCwaData as coreFetchCwaData,
  testCwaApiKey as coreTestCwaApiKey,
  type RealtimeQueryResult,
  type RealtimeQueryType
} from '../core/weather'
import { electronHttp } from './adapters/httpAdapter'

const deps = { http: electronHttp }

export type { RealtimeQueryResult, RealtimeQueryType }

export function fetchCwaBackgroundWeather(apiKey: string, county: string): Promise<string | null> {
  return coreFetchCwaBackgroundWeather(deps, apiKey, county)
}

export function testCwaApiKey(apiKey: string): Promise<{ ok: boolean; error?: string }> {
  return coreTestCwaApiKey(deps, apiKey)
}

export function detectQueryType(message: string): RealtimeQueryType | null {
  return coreDetectQueryType(message)
}

/** 根據 type 查詢 CWA API，回傳組好的 prompt 注入字串；失敗時拋例外 */
export function fetchCwaData(
  type: RealtimeQueryType,
  apiKey: string,
  forecastCounty: string
): Promise<RealtimeQueryResult> {
  return coreFetchCwaData(deps, type, apiKey, forecastCounty)
}
