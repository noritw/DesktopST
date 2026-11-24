import { Capacitor } from '@capacitor/core'

/** 模擬步數只給並存測試版與開發伺服器，正式版看不到。 */
export async function isWalkTestBuild(): Promise<boolean> {
  if (import.meta.env.DEV) return true
  if (!Capacitor.isNativePlatform()) return false
  try {
    const mod = await import('@capacitor/app')
    return (await mod.App.getInfo()).id.endsWith('.walktest')
  } catch {
    return false
  }
}
