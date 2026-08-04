import { useEffect, useState } from 'react'
import { getData } from '../stores/appStore'

/**
 * 角色頭像位址（清單 D6）。
 *
 * ⚠️ **不可以直接讀 `character.avatar`。** 遙控模式那是電腦上的本機檔案路徑，
 * WebView 載不動；獨立模式是沙箱位址。兩邊都得經過 `DataSource.avatarUrl()`
 * （`core/data/types.ts` 已寫明這條）。
 *
 * 快取放模組層而不是元件內：頭像列與「誰在場」清單會同時問同一批角色，
 * 每個元件各查一次等於同樣的請求送好幾遍。
 * 沒有失效機制 —— 位址在一次 app 生命週期內不會變（換頭像會整個重載狀態）。
 */
const cache = new Map<string, Promise<string | null>>()

function lookup(id: string): Promise<string | null> {
  let p = cache.get(id)
  if (!p) {
    p = getData()
      .characters.avatarUrl(id)
      .catch(() => null)
    cache.set(id, p)
  }
  return p
}

/** 回傳頭像位址；還在查或查不到都是 `null`，呼叫端顯示 🐾。 */
export function useAvatarUrl(id: string): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void lookup(id).then((u) => {
      if (alive) setUrl(u)
    })
    return () => {
      alive = false
    }
  }, [id])

  return url
}
