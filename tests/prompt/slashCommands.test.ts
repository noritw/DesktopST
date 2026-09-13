import { describe, expect, it } from 'vitest'
import { parseSlashCommands } from '@core/prompt/slashCommands'

/**
 * 斜線指令解析。
 *
 * 這支存在的理由就是 2026-09-13 那個 bug：原本的 `/\/news\b/gi` 會把
 * `https://news.cnyes.com/news/id/…` 剝成 `https:/.cnyes.com/id/…`，
 * 角色看到壞掉的網址就回「我看不懂這些網址」。下面第一組是回歸測試。
 */
describe('網址不能被當成斜線指令', () => {
  it('新聞網址原封不動，也不觸發 /news', () => {
    const url = 'https://news.cnyes.com/news/id/6551476'
    const r = parseSlashCommands(`我覺得今天有點悶熱…\n${url}\n是說這篇你們看得到嗎？`)
    expect(r.news).toBe(false)
    expect(r.stripped).toContain(url)
  })

  it('路徑含 /weather 的網址同理', () => {
    const url = 'https://example.com/weather/today'
    const r = parseSlashCommands(`看這個 ${url}`)
    expect(r.weather).toBe(false)
    expect(r.stripped).toContain(url)
  })

  it('沒有指令時原字串原樣回傳（連 trim 都不做，別動使用者的字）', () => {
    const raw = '  今天天氣真好  '
    const r = parseSlashCommands(raw)
    expect(r.stripped).toBe(raw)
  })
})

describe('真的下指令時照樣認得', () => {
  it('行首', () => {
    const r = parseSlashCommands('/news 今天有什麼大事')
    expect(r.news).toBe(true)
    expect(r.stripped).toBe('今天有什麼大事')
  })

  it('句尾', () => {
    const r = parseSlashCommands('今天有什麼大事 /news')
    expect(r.news).toBe(true)
    expect(r.stripped).toBe('今天有什麼大事')
  })

  it('換行後也算（空白包含 \\n）', () => {
    const r = parseSlashCommands('今天有什麼大事\n/news')
    expect(r.news).toBe(true)
    expect(r.stripped).toBe('今天有什麼大事')
  })

  it('大小寫不拘', () => {
    expect(parseSlashCommands('/NEWS 嗨').news).toBe(true)
    expect(parseSlashCommands('/Weather 嗨').weather).toBe(true)
  })

  it('兩個指令可以同時下', () => {
    const r = parseSlashCommands('/news /weather 今天怎樣')
    expect(r.news).toBe(true)
    expect(r.weather).toBe(true)
    expect(r.stripped).toContain('今天怎樣')
    expect(r.stripped).not.toContain('/news')
    expect(r.stripped).not.toContain('/weather')
  })

  it('只是開頭像而已的字不算（/newsletter）', () => {
    const r = parseSlashCommands('/newsletter 是什麼')
    expect(r.news).toBe(false)
    expect(r.stripped).toContain('/newsletter')
  })
})
