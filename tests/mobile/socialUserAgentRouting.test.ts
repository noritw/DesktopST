import { describe, expect, it } from 'vitest'
import { shouldUseNativeFetch } from '../../src/mobile/adapters/httpAdapter'
import { BROWSER_USER_AGENT, SOCIAL_BOT_USER_AGENT } from '@core/util/htmlFetch'

/**
 * 社群抓取要繞過 Capacitor patch 過的 `fetch`（2026-09-18，Pixel 10a 實測）。
 *
 * ## 背景
 *
 * Capacitor 的 fetch patch 對 **GET 與非 GET 走完全不同的兩條路**：
 * 非 GET 直接進原生 plugin、headers 原樣送出；GET 卻改寫成 proxy 網址交回
 * WebView 自己的 fetch，而 Android WebView 會把 `User-Agent` 拔掉
 * （Chromium bug 40450316）。Capacitor 有還原機制，但**實機上沒有生效**。
 *
 * 症狀極有辨識度：**噗浪成功、FB／Threads 失敗**——只有後兩家需要
 * 「不像瀏覽器」的 UA。桌面走 Node fetch 完全沒事，所以只有手機壞。
 *
 * ## 這裡守什麼
 *
 * 真正的行為只能靠真機驗證，但「有沒有挑對要改道的請求」是純判斷。
 * **最重要的是下面那條「一般網頁不可以被改道」**：`fetchHtmlDoc` 對每個請求
 * 都會設 UA，判斷若寫成「有 UA 就走原生」，新聞抓取與一般連結閱讀會整批
 * 換到另一條路——那些本來就是好的，改動它們只是平白引進風險。
 */
describe('shouldUseNativeFetch', () => {
  it('社群 bot UA → 走原生（這是唯一壞掉、需要修的那條）', () => {
    expect(shouldUseNativeFetch('https://www.facebook.com/x/posts/1', {
      headers: { 'User-Agent': SOCIAL_BOT_USER_AGENT }
    })).toBe(true)
  })

  it('⚠️ 一般網頁的瀏覽器 UA → **不可以**改道', () => {
    expect(shouldUseNativeFetch('https://example.com/article', {
      headers: { 'User-Agent': BROWSER_USER_AGENT }
    })).toBe(false)
  })

  it('沒有 UA、或完全沒有 headers → 不改道', () => {
    expect(shouldUseNativeFetch('https://example.com/a', { headers: { Accept: 'text/html' } })).toBe(false)
    expect(shouldUseNativeFetch('https://example.com/a', {})).toBe(false)
    expect(shouldUseNativeFetch('https://example.com/a', undefined)).toBe(false)
  })

  it('header 名稱大小寫不影響判斷', () => {
    expect(shouldUseNativeFetch('https://x.test/a', {
      headers: { 'user-agent': SOCIAL_BOT_USER_AGENT }
    })).toBe(true)
  })

  it('`Headers` 物件與陣列形式也要認得（SDK 傳進來的可能是這兩種）', () => {
    expect(shouldUseNativeFetch('https://x.test/a', {
      headers: new Headers({ 'User-Agent': SOCIAL_BOT_USER_AGENT })
    })).toBe(true)
    expect(shouldUseNativeFetch('https://x.test/a', {
      headers: [['User-Agent', SOCIAL_BOT_USER_AGENT]]
    })).toBe(true)
  })

  it('非字串的 input（Request／URL）不改道——原生層只吃網址字串', () => {
    expect(shouldUseNativeFetch(new URL('https://x.test/a'), {
      headers: { 'User-Agent': SOCIAL_BOT_USER_AGENT }
    })).toBe(false)
  })
})
