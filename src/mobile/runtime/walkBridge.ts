import type { StorageAdapter } from '@core/adapters'
import { resolveStrideMeters, type WalkSettings } from '@core/walk'
import type { WidgetColors } from '@shared/widgetAppearance'

/** 陪伴同行的原生橋接（對應 `android/.../walk/WalkStepsPlugin.kt`）。 */

export type WalkAccessState = 'ok' | 'unsupported' | 'needs_update' | 'no_permission' | 'error'

export interface WalkAccess {
  state: WalkAccessState
  backgroundSupported: boolean
  backgroundGranted: boolean
}

interface WalkStepsPlugin {
  status(): Promise<WalkAccess>
  requestAccess(): Promise<WalkAccess>
  openSettings(): Promise<void>
  readDays(o: { days: string[] }): Promise<{ totals: Record<string, number> }>
  lastSteps(): Promise<{ day?: string; steps?: number }>
  refreshWidget(): Promise<void>
}

const UNSUPPORTED: WalkAccess = { state: 'unsupported', backgroundSupported: false, backgroundGranted: false }
const READ_TIMEOUT_MS = 10_000

/** 包一層物件：直接回傳 plugin proxy 會讓 await 永遠卡住（CLAUDE.md §5）。 */
async function loadPlugin(): Promise<{ plugin: WalkStepsPlugin } | null> {
  const core = await import('@capacitor/core').catch(() => null)
  if (!core || !core.Capacitor.isNativePlatform()) return null
  return { plugin: core.registerPlugin<WalkStepsPlugin>('WalkSteps') }
}

/** Capacitor 的呼叫不保證會 settle，外面自己包逾時。 */
function withTimeout<T>(p: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), READ_TIMEOUT_MS)
    p.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) }
    )
  })
}

export async function walkAccess(): Promise<WalkAccess> {
  const loaded = await loadPlugin()
  if (!loaded) return UNSUPPORTED
  return withTimeout(loaded.plugin.status()).catch(() => ({ ...UNSUPPORTED, state: 'error' as const }))
}

/** 等使用者按授權，不能加逾時。 */
export async function requestWalkAccess(): Promise<WalkAccess> {
  const loaded = await loadPlugin()
  if (!loaded) return UNSUPPORTED
  return loaded.plugin.requestAccess()
}

export async function openWalkSettings(): Promise<void> {
  await (await loadPlugin())?.plugin.openSettings()
}

/** 讀不到就擲例外，**不會**用 0 代替。 */
export async function readWalkDays(days: string[]): Promise<Record<string, number>> {
  const loaded = await loadPlugin()
  if (!loaded) throw new Error('unsupported')
  return (await withTimeout(loaded.plugin.readDays({ days }))).totals
}

/** 小工具上次讀到的今日步數，只供畫面先顯示，不可拿來記帳。 */
export async function lastWidgetSteps(day: string): Promise<number | undefined> {
  const loaded = await loadPlugin()
  if (!loaded) return undefined
  const r = await withTimeout(loaded.plugin.lastSteps()).catch(() => null)
  return r?.day === day && typeof r.steps === 'number' ? r.steps : undefined
}

/** 寫給原生小工具看的資料。**改這裡一定要同步改 `WalkWidgetProvider.kt` 的解析**。 */
export async function writeWalkWidget(
  storage: StorageAdapter,
  input: { settings: WalkSettings; companionCount: number; avatars: Uint8Array[]; colors: WidgetColors }
): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const key = `walk-widget/avatar${i}.png`
    if (input.avatars[i]) await storage.writeBinary(key, input.avatars[i])
    else await storage.remove(key).catch(() => {})
  }
  await storage.writeJson('walk-widget/state.json', {
    enabled: input.settings.enabled,
    strideMeters: resolveStrideMeters(input.settings),
    companionCount: input.companionCount,
    avatarCount: input.avatars.length,
    colors: input.colors
  })
  await (await loadPlugin())?.plugin.refreshWidget().catch(() => {})
}
