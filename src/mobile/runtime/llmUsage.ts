import type { PlatformAdapters, StorageAdapter } from '@core/adapters'
import { MODULES_DIR } from '@core/store/keys'
import type { LlmUsageRecord } from '@core/llm/usage'
import { localDay } from './walk'

/**
 * 用量帳本落地（獨立模式）。一天一檔，裝置本地，不進 S2、不進設定包。
 * 背景那一趟寫自己的檔，免得跟前景互相覆蓋。
 */

const DIR = `${MODULES_DIR}/desktopst.llm-usage`
const SETTINGS_KEY = `${DIR}/settings.json`
export const KEEP_DAYS = 90
const DAY_FILE = /(\d{4}-\d{2}-\d{2})(-bg)?\.json$/

export interface UsageSettings {
  /** 開著時記的筆數標成測試 */
  testing: boolean
  /** 試算用：1 點等於多少美元 */
  usdPerPoint: number
}

export async function loadUsageSettings(storage: StorageAdapter): Promise<UsageSettings> {
  const raw = await storage.readJson<Partial<UsageSettings>>(SETTINGS_KEY)
  return {
    testing: raw?.testing === true,
    usdPerPoint: typeof raw?.usdPerPoint === 'number' && raw.usdPerPoint > 0 ? raw.usdPerPoint : 0.001
  }
}

// 同一個檔的讀改寫要排隊；放模組層，因為 session 可能同時有兩份
let queue: Promise<unknown> = Promise.resolve()

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn)
  queue = run.catch(() => {})
  return run
}

export function saveUsageSettings(storage: StorageAdapter, patch: Partial<UsageSettings>): Promise<UsageSettings> {
  return enqueue(async () => {
    const next = { ...(await loadUsageSettings(storage)), ...patch }
    await storage.writeJson(SETTINGS_KEY, next)
    return next
  })
}

/** 等排隊中的都寫完。背景那一趟結束前要呼叫，WebView 隨後就會被收掉。 */
export async function flushUsage(): Promise<void> {
  await queue
}

export function recordUsage(storage: StorageAdapter, record: LlmUsageRecord, background: boolean): void {
  void enqueue(async () => {
    const { testing } = await loadUsageSettings(storage)
    const key = `${DIR}/${localDay(record.at)}${background ? '-bg' : ''}.json`
    const list = await storage.readJson<LlmUsageRecord[]>(key)
    await storage.writeJson(key, [...(Array.isArray(list) ? list : []), testing ? { ...record, test: true } : record])
  }).catch((e) => console.warn('[usage] 記錄失敗', e))
}

/** 讓這組 adapters 發出的每次 LLM 呼叫都記帳。 */
export function withUsageRecording(adapters: PlatformAdapters, background: boolean): PlatformAdapters {
  return {
    ...adapters,
    http: {
      fetch: (input, init) => adapters.http.fetch(input, init),
      supportsStreaming: adapters.http.supportsStreaming,
      onLlmUsage: (r) => recordUsage(adapters.storage, r, background)
    }
  }
}

async function dayFiles(storage: StorageAdapter): Promise<Array<{ key: string; day: string }>> {
  return (await storage.list(DIR)).flatMap((path) => {
    const m = DAY_FILE.exec(path)
    return m ? [{ key: `${DIR}/${m[0]}`, day: m[1] }] : []
  })
}

/** 讀 `since`（含）之後的紀錄，順手清掉過期的檔。 */
export async function loadUsage(storage: StorageAdapter, since: number): Promise<LlmUsageRecord[]> {
  await flushUsage()
  const first = localDay(since)
  const oldest = localDay(Date.now() - KEEP_DAYS * 86_400_000)
  const out: LlmUsageRecord[] = []
  for (const f of await dayFiles(storage)) {
    if (f.day < oldest) await storage.remove(f.key)
    else if (f.day >= first) {
      const list = await storage.readJson<LlmUsageRecord[]>(f.key)
      if (Array.isArray(list)) out.push(...list)
    }
  }
  return out.filter((r) => r.at >= since).sort((a, b) => b.at - a.at)
}

export function clearUsage(storage: StorageAdapter): Promise<void> {
  return enqueue(async () => {
    for (const f of await dayFiles(storage)) await storage.remove(f.key)
  })
}
