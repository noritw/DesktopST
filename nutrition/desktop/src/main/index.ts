import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import {
  applyMigrationPack,
  buildMigrationPack,
  collectReferencedPhotoKeys,
  NUTRITION_PACK_EXTENSION,
  NutritionSession,
  type MigrationMergeMode,
  type NutritionMigrationPack,
  type NutritionSnapshot
} from '@core/nutrition'
import { nutritionDesktopStorage } from '../storage'

let nutritionSession: NutritionSession | null = null

async function getSession(): Promise<NutritionSession> {
  nutritionSession ??= await NutritionSession.boot(nutritionDesktopStorage)
  return nutritionSession
}

function snapshotPayload(session: NutritionSession): NutritionSnapshot {
  return {
    foodItems: [...session.foodItems],
    mealLogs: [...session.mealLogs],
    bodyProfile: session.bodyProfile,
    settings: session.settings
  }
}

function registerNutritionHandlers(): void {
  ipcMain.handle('nutrition:load', async () => {
    const session = await getSession()
    return {
      foodItems: [...session.foodItems],
      mealLogs: [...session.mealLogs],
      bodyProfile: session.bodyProfile,
      settings: session.settings
    }
  })

  ipcMain.handle('nutrition:log-meal', async (_event, foodItemId: string, eatenAt: number) => {
    const session = await getSession()
    const foodItem = session.foodItems.find((item) => item.id === foodItemId)
    if (foodItem && Number.isFinite(eatenAt)) {
      const now = Date.now()
      await session.saveMealLog({
        id: `meal-${now}-${Math.round(Math.random() * 1e6)}`,
        foodItemId: foodItem.id,
        servings: 1,
        eatenAt,
        createdAt: now,
        updatedAt: now
      })
    }
    return {
      foodItems: [...session.foodItems],
      mealLogs: [...session.mealLogs],
      bodyProfile: session.bodyProfile,
      settings: session.settings
    }
  })

  ipcMain.handle('nutrition:remove-meal', async (_event, id: string) => {
    const session = await getSession()
    await session.removeMealLog(id)
    return {
      foodItems: [...session.foodItems],
      mealLogs: [...session.mealLogs],
      bodyProfile: session.bodyProfile,
      settings: session.settings
    }
  })

  ipcMain.handle('nutrition:save-food', async (_event, foodItem) => {
    const session = await getSession()
    await session.saveFoodItem(foodItem)
    return {
      foodItems: [...session.foodItems],
      mealLogs: [...session.mealLogs],
      bodyProfile: session.bodyProfile,
      settings: session.settings
    }
  })

  ipcMain.handle('nutrition:remove-food', async (_event, id: string) => {
    const session = await getSession()
    await session.removeFoodItem(id)
    return {
      foodItems: [...session.foodItems],
      mealLogs: [...session.mealLogs],
      bodyProfile: session.bodyProfile,
      settings: session.settings
    }
  })

  ipcMain.handle('nutrition:read-photo', async (_event, key: string) => {
    return nutritionDesktopStorage.readBinary(key)
  })

  ipcMain.handle('nutrition:write-photo', async (_event, key: string, bytes: Uint8Array) => {
    await nutritionDesktopStorage.writeBinary(key, bytes)
  })

  ipcMain.handle('nutrition:remove-photo', async (_event, key: string) => {
    await nutritionDesktopStorage.remove(key)
  })

  ipcMain.handle('nutrition:update-meal', async (_event, id: string, patch: { servings: number; eatenAt: number; scope: 'meal' | 'food'; name: string; kcal: number; proteinG: number }) => {
    const session = await getSession()
    const current = session.mealLogs.find((mealLog) => mealLog.id === id)
    if (current && Number.isFinite(patch.servings) && patch.servings > 0 && Number.isFinite(patch.eatenAt)) {
      if (patch.scope === 'food') {
        const foodItem = session.foodItems.find((item) => item.id === current.foodItemId)
        if (foodItem) {
          await session.saveFoodItem({ ...foodItem, name: patch.name, perServing: { ...foodItem.perServing, kcal: patch.kcal, proteinG: patch.proteinG }, updatedAt: Date.now() })
        }
        await session.saveMealLog({ ...current, servings: patch.servings, eatenAt: patch.eatenAt, override: undefined, updatedAt: Date.now() })
      } else {
        await session.saveMealLog({ ...current, servings: patch.servings, eatenAt: patch.eatenAt, override: { name: patch.name, kcal: patch.kcal, proteinG: patch.proteinG }, updatedAt: Date.now() })
      }
    }
    return {
      foodItems: [...session.foodItems],
      mealLogs: [...session.mealLogs],
      bodyProfile: session.bodyProfile,
      settings: session.settings
    }
  })

  ipcMain.handle('nutrition:save-profile', async (_event, profile) => {
    const session = await getSession()
    await session.saveBodyProfile(profile)
    return {
      foodItems: [...session.foodItems],
      mealLogs: [...session.mealLogs],
      bodyProfile: session.bodyProfile,
      settings: session.settings
    }
  })

  ipcMain.handle('nutrition:set-meal-photo', async (_event, id: string, photoKey: string | null) => {
    const session = await getSession()
    const current = session.mealLogs.find((mealLog) => mealLog.id === id)
    if (current) {
      await session.saveMealLog({ ...current, photoKey: photoKey ?? undefined, updatedAt: Date.now() })
    }
    return {
      foodItems: [...session.foodItems],
      mealLogs: [...session.mealLogs],
      bodyProfile: session.bodyProfile,
      settings: session.settings
    }
  })

  ipcMain.handle('nutrition:export-pack', async (event) => {
    const session = await getSession()
    const snapshot = snapshotPayload(session)
    const photoKeys = collectReferencedPhotoKeys(snapshot)
    const photoBytes = new Map<string, Uint8Array>()
    for (const key of photoKeys) {
      const bytes = await nutritionDesktopStorage.readBinary(key)
      if (bytes) photoBytes.set(key, bytes)
    }
    const pack = buildMigrationPack(snapshot, photoBytes)
    const window = BrowserWindow.fromWebContents(event.sender)
    const defaultName = `飲食記錄搬家包-${new Date().toISOString().slice(0, 10)}${NUTRITION_PACK_EXTENSION}`
    const dialogOptions = {
      defaultPath: defaultName,
      filters: [{ name: '飲食記錄搬家包', extensions: [NUTRITION_PACK_EXTENSION.slice(1)] }]
    }
    const result = window ? await dialog.showSaveDialog(window, dialogOptions) : await dialog.showSaveDialog(dialogOptions)
    if (result.canceled || !result.filePath) return { ok: false as const }
    await writeFile(result.filePath, JSON.stringify(pack), 'utf8')
    return { ok: true as const, path: result.filePath }
  })

  ipcMain.handle('nutrition:import-pack', async (event, mode: MigrationMergeMode) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const dialogOptions = {
      properties: ['openFile'] as Array<'openFile'>,
      filters: [{ name: '飲食記錄搬家包', extensions: [NUTRITION_PACK_EXTENSION.slice(1), 'json'] }]
    }
    const result = window ? await dialog.showOpenDialog(window, dialogOptions) : await dialog.showOpenDialog(dialogOptions)
    if (result.canceled || result.filePaths.length === 0) return { ok: false as const }
    let pack: NutritionMigrationPack
    try {
      pack = JSON.parse(await readFile(result.filePaths[0], 'utf8')) as NutritionMigrationPack
    } catch {
      return { ok: false as const, error: 'invalid-file' as const }
    }
    if (!pack || typeof pack !== 'object' || !Array.isArray(pack.foodItems)) return { ok: false as const, error: 'invalid-file' as const }

    const session = await getSession()
    const { snapshot, photosToWrite } = applyMigrationPack(snapshotPayload(session), pack, mode)
    for (const { key, bytes } of photosToWrite) await nutritionDesktopStorage.writeBinary(key, bytes)
    await session.replaceSnapshot(snapshot)
    return { ok: true as const, snapshot: snapshotPayload(session) }
  })
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 640,
    minHeight: 480,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  const devServerUrl = process.env.ELECTRON_RENDERER_URL
  if (devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerNutritionHandlers()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
