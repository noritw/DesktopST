import * as fs from 'fs'
import * as path from 'path'
import { pathToFileURL } from 'url'
import type { DesktopSTModule, ModuleContext, ModuleContextProvider } from './moduleTypes'

const builtInModules = new Map<string, DesktopSTModule>()
const activeModules = new Set<string>()
const contextProviders: Array<{ moduleId: string; fn: ModuleContextProvider }> = []

export function registerContextProvider(provider: ModuleContextProvider, moduleId = ''): void {
  contextProviders.push({ moduleId, fn: provider })
}

/**
 * 收集所有模組的 context provider 回傳值，過濾空值後回傳字串陣列。
 * 傳入 isModuleEnabled 時，依模組 id 過濾（例如場景覆蓋強制關閉的模組不注入）。
 */
export async function collectModuleContext(
  isModuleEnabled?: (moduleId: string) => boolean
): Promise<string[]> {
  const active = isModuleEnabled
    ? contextProviders.filter(p => !p.moduleId || isModuleEnabled(p.moduleId))
    : contextProviders
  if (active.length === 0) return []
  const results = await Promise.all(active.map(p => {
    try { return p.fn() } catch { return null }
  }))
  return results.filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
}

/** 已註冊模組清單（供情境模組開關 UI 列出外部模組等用途）。 */
export function listRegisteredModules(): Array<Pick<DesktopSTModule, 'id' | 'name' | 'kind' | 'riskLevel'>> {
  return [...builtInModules.values()].map(m => ({ id: m.id, name: m.name, kind: m.kind, riskLevel: m.riskLevel }))
}

export function registerBuiltInModule(module: DesktopSTModule): void {
  builtInModules.set(module.id, module)
}

function isDesktopSTModule(value: unknown): value is DesktopSTModule {
  if (!value || typeof value !== 'object') return false
  const m = value as Record<string, unknown>
  return typeof m.id === 'string' && typeof m.activate === 'function'
}

/**
 * 掃描 baseDir 下的子資料夾，動態載入個人外部模組（不在主 repo 內、不受版本更新影響）。
 * 找不到資料夾或載入失敗都只記錄警告，不影響其他模組或主程式啟動。
 */
export async function loadExternalModules(baseDir: string): Promise<void> {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(baseDir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = path.join(baseDir, entry.name)
    const candidates = ['index.cjs', 'index.mjs', 'index.js']
    const entryFile = candidates.map(f => path.join(dir, f)).find(f => fs.existsSync(f))
    if (!entryFile) continue

    try {
      const mod = await import(pathToFileURL(entryFile).href)
      const def = (mod?.default ?? mod) as unknown
      if (!isDesktopSTModule(def)) {
        console.warn(`[modules] external module at ${dir} does not export a valid module definition, skipped`)
        continue
      }
      registerBuiltInModule({ ...def, kind: 'external' })
    } catch (e) {
      console.warn(`[modules] failed to load external module at ${dir}:`, e)
    }
  }
}

export async function activateModules(ctx: ModuleContext): Promise<void> {
  for (const module of builtInModules.values()) {
    if (activeModules.has(module.id)) continue
    // per-module 包裝 registerContextProvider，讓 provider 綁定註冊它的模組 id（供場景覆蓋過濾）
    const moduleCtx: ModuleContext = {
      ...ctx,
      host: {
        ...ctx.host,
        registerContextProvider: provider => registerContextProvider(provider, module.id)
      }
    }
    await module.activate(moduleCtx)
    activeModules.add(module.id)
  }
}

export async function deactivateModules(ctx: ModuleContext): Promise<void> {
  for (const module of [...builtInModules.values()].reverse()) {
    if (!activeModules.has(module.id)) continue
    await module.deactivate?.(ctx)
    activeModules.delete(module.id)
  }
}
