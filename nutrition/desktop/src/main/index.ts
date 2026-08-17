import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { NutritionSession } from '@core/nutrition'
import { nutritionDesktopStorage } from '../storage'

let nutritionSession: NutritionSession | null = null

async function getSession(): Promise<NutritionSession> {
  nutritionSession ??= await NutritionSession.boot(nutritionDesktopStorage)
  return nutritionSession
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

  ipcMain.handle('nutrition:add-demo-meal', async (_event, foodItemId?: string) => {
    const session = await getSession()
    const now = Date.now()
    const foodItem = session.foodItems.find((item) => item.id === foodItemId) ?? session.foodItems[0] ?? {
      id: 'demo-food',
      name: '示範三明治',
      aliases: ['三明治'],
      perServing: { kcal: 400, proteinG: 25 },
      photoKeys: [],
      source: 'user' as const,
      createdAt: now,
      updatedAt: now
    }
    if (!session.foodItems.some((item) => item.id === foodItem.id)) await session.saveFoodItem(foodItem)
    await session.saveMealLog({
      id: `demo-meal-${now}`,
      foodItemId: foodItem.id,
      servings: 1,
      eatenAt: now,
      createdAt: now,
      updatedAt: now
    })
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
