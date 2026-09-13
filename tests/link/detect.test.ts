import { describe, expect, it } from 'vitest'
import {
  extractLinkUrls,
  isJsRenderedHost,
  isPrivateHost,
  MAX_LINKS_PER_MESSAGE
} from '@core/link/detect'

/**
 * 連結偵測（貼網址讓角色讀內文，2026-09-13）。
 * 這一層完全不碰 I/O，所以坑都在字串處理：中文標點黏在網址尾巴、
 * 維基百科網址本身帶括號、同一個連結貼兩次。
 */
describe('extractLinkUrls', () => {
  it('抓得到句子中間的網址', () => {
    expect(extractLinkUrls('你看這篇 https://example.com/a 寫得不錯')).toEqual(['https://example.com/a'])
  })

  it('剝掉尾端的中文標點', () => {
    expect(extractLinkUrls('看這個 https://example.com/a。')).toEqual(['https://example.com/a'])
    expect(extractLinkUrls('看這個 https://example.com/a，然後呢')).toEqual(['https://example.com/a'])
    expect(extractLinkUrls('「https://example.com/a」')).toEqual(['https://example.com/a'])
  })

  it('網址自帶的成對括號要留著（維基百科那種）', () => {
    const url = 'https://zh.wikipedia.org/wiki/Foo_(bar)'
    expect(extractLinkUrls(`參考 ${url}`)).toEqual([url])
  })

  it('沒配對的右括號才砍掉（整段被括號包起來的情況）', () => {
    expect(extractLinkUrls('（來源：https://example.com/a）')).toEqual(['https://example.com/a'])
  })

  it('同一個網址只算一次', () => {
    const text = 'https://example.com/a 跟 https://example.com/a'
    expect(extractLinkUrls(text)).toEqual(['https://example.com/a'])
  })

  it('超過上限的連結直接忽略，不報錯', () => {
    const text = 'https://a.com/1 https://b.com/2 https://c.com/3'
    const got = extractLinkUrls(text)
    expect(got).toHaveLength(MAX_LINKS_PER_MESSAGE)
    expect(got).toEqual(['https://a.com/1', 'https://b.com/2'])
  })

  it('裸網域與檔名不算網址（誤判的代價比漏抓高）', () => {
    expect(extractLinkUrls('去 www.example.com 看看，還有 報告.txt')).toEqual([])
  })

  it('沒有網址時回空陣列', () => {
    expect(extractLinkUrls('今天天氣真好')).toEqual([])
    expect(extractLinkUrls('')).toEqual([])
  })
})

describe('isPrivateHost', () => {
  it('本機與內網位址一律擋下', () => {
    for (const h of ['localhost', '127.0.0.1', '10.1.2.3', '192.168.1.5', '172.16.0.1', '169.254.1.1', 'nas.local', '::1']) {
      expect(isPrivateHost(h), h).toBe(true)
    }
  })

  it('一般公開主機不受影響', () => {
    for (const h of ['example.com', '8.8.8.8', '172.32.0.1', 'localhost.example.com']) {
      expect(isPrivateHost(h), h).toBe(false)
    }
  })
})

describe('isJsRenderedHost', () => {
  it('社群／影音站含子網域都命中', () => {
    for (const h of ['x.com', 'twitter.com', 'www.facebook.com', 'm.facebook.com', 'youtu.be', 'www.youtube.com', 'threads.net']) {
      expect(isJsRenderedHost(h), h).toBe(true)
    }
  })

  it('只是名字裡有的不算（後綴比對不能用 includes）', () => {
    for (const h of ['notfacebook.com', 'example.com', 'myx.com.tw']) {
      expect(isJsRenderedHost(h), h).toBe(false)
    }
  })
})
