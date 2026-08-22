import * as keys from '@core/store/keys'
import type { CharacterDisplayConfigMap, FaceCropRect } from '@core/character/displayImage'
import { capacitorAdapters } from '../adapters'

/**
 * 框選的臉部顯示範圍（`docs/mobile-character-expression-plan.md` §3.1）。
 *
 * ⚠️ **這是裝置偏好，不是「獨立模式」或「遙控模式」的資料**——不管手機當下
 * 連的是哪一種模式，這份設定永遠讀寫同一份 `character-display-config.json`
 * （`capacitorAdapters.storage`，跟 `MODE_PREF_KEY` 同一類：見
 * `mobile/ui/stores/connectionStore.ts`）。`LocalDataSource` 與
 * `RemoteDataSource` 都呼叫這裡的函式，不要各自維護一份邏輯。
 */
export async function getFaceCrop(characterId: string): Promise<FaceCropRect | null> {
  const map = (await capacitorAdapters.storage.readJson<CharacterDisplayConfigMap>(keys.CHARACTER_DISPLAY_CONFIG_KEY)) ?? {}
  return map[characterId]?.faceCrop ?? null
}

export async function setFaceCrop(characterId: string, rect: FaceCropRect | null): Promise<void> {
  const map = { ...((await capacitorAdapters.storage.readJson<CharacterDisplayConfigMap>(keys.CHARACTER_DISPLAY_CONFIG_KEY)) ?? {}) }
  if (rect) {
    map[characterId] = { ...map[characterId], faceCrop: rect }
  } else if (map[characterId]) {
    const { faceCrop: _drop, ...rest } = map[characterId]
    void _drop
    if (Object.keys(rest).length === 0) delete map[characterId]
    else map[characterId] = rest
  }
  await capacitorAdapters.storage.writeJson(keys.CHARACTER_DISPLAY_CONFIG_KEY, map)
}

/**
 * 依比例矩形（0–1）裁切一張圖片（`data:` 或同源 `blob:` URL 皆可），輸出正方形
 * PNG data URL。`rect` 是對「來源圖」框選當下算出的比例，套到不同尺寸的圖片
 * （例如另一張表情圖）會依該圖片自己的寬高重新換算——構圖差異大時可能會歪，
 * 這是 MVP 已知風險（見計畫書 §7），不是 bug。
 */
export function cropImageToFace(imageSrc: string, rect: FaceCropRect): Promise<string> {
  const OUTPUT_SIZE = 512
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      try {
        const sx = rect.x * img.naturalWidth
        const sy = rect.y * img.naturalHeight
        const sSize = rect.size * Math.min(img.naturalWidth, img.naturalHeight)
        const canvas = document.createElement('canvas')
        canvas.width = OUTPUT_SIZE
        canvas.height = OUTPUT_SIZE
        const ctx = canvas.getContext('2d')
        if (!ctx) { reject(new Error('no-2d-context')); return }
        ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE)
        resolve(canvas.toDataURL('image/png'))
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    }
    img.onerror = () => reject(new Error('decode-failed'))
    img.src = imageSrc
  })
}
