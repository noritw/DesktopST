import { describe, expect, it } from 'vitest'
import { withCacheBuster } from '../../src/mobile/ui/characters/useAvatarUrl'

/**
 * 獨立模式選新頭像後欄位「閃一下又變空」的成因：`avatarUrl()` 在獨立模式
 * 回的是 `data:image/png;base64,...`，在後面接 `?v=1` 這種 cache buster
 * 會把它變成非法的 data URI，`<img>` 悄悄 `onerror`、沒有任何錯誤訊息。
 * 遙控模式回的是真的網址（`/api/avatar/:id`），接 `?v=` 才有意義。
 */
describe('withCacheBuster', () => {
  it('data: URI 不接版本號——接了會把 base64 內容弄壞', () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'
    expect(withCacheBuster(dataUrl, 1)).toBe(dataUrl)
  })

  it('一般網址（遙控模式）會接上 ?v=', () => {
    expect(withCacheBuster('http://192.168.1.20:3721/api/avatar/c1', 3)).toBe(
      'http://192.168.1.20:3721/api/avatar/c1?v=3'
    )
  })

  it('網址已經帶 query string 時改用 &', () => {
    expect(withCacheBuster('http://192.168.1.20:3721/api/avatar/c1?token=abc', 2)).toBe(
      'http://192.168.1.20:3721/api/avatar/c1?token=abc&v=2'
    )
  })

  it('沒有版本號（從沒換過主圖）時原樣回傳', () => {
    expect(withCacheBuster('http://192.168.1.20:3721/api/avatar/c1', undefined)).toBe(
      'http://192.168.1.20:3721/api/avatar/c1'
    )
  })
})
