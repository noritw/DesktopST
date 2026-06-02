import type { DesktopSTModule, ModuleContext } from './moduleTypes'

const builtInModules = new Map<string, DesktopSTModule>()
const activeModules = new Set<string>()

export function registerBuiltInModule(module: DesktopSTModule): void {
  builtInModules.set(module.id, module)
}

export async function activateModules(ctx: ModuleContext): Promise<void> {
  for (const module of builtInModules.values()) {
    if (activeModules.has(module.id)) continue
    await module.activate(ctx)
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
