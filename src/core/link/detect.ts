/**
 * 從使用者訊息裡挑出「值得去讀」的網址（純函式，不碰 I/O）。
 */

/**
 * 一次最多讀幾個連結。
 *
 * 2 是刻意壓低的：每個連結都是一次外部抓取＋可能一次輔助模型呼叫，
 * 而貼一串連結的人通常也不期待角色每篇都讀完。超過的直接忽略，
 * 不進 prompt、也不報錯。
 */
export const MAX_LINKS_PER_MESSAGE = 2

/**
 * 內文由 JS 產生或需要登入的站——**連抓都不要抓**。
 *
 * 抓了只會拿到空殼 HTML，然後被判成 `empty`，白花一次網路往返，
 * 使用者還會看到一個看不懂的失敗理由。直接標成 `js-rendered`，
 * 在 prompt 裡老實說「這種站讀不到」比較有用。
 *
 * 比對方式是「主機名等於，或以 `.` 結尾相符」，所以 `m.facebook.com`
 * 會被 `facebook.com` 命中，但 `notfacebook.com` 不會。
 */
const JS_RENDERED_HOSTS = [
  'x.com', 'twitter.com', 't.co',
  'facebook.com', 'fb.com', 'fb.watch',
  'instagram.com', 'threads.net', 'threads.com',
  'linkedin.com',
  'tiktok.com',
  'youtube.com', 'youtu.be',
  'discord.com', 'slack.com',
  'notion.so', 'docs.google.com', 'drive.google.com'
]

/** 主機名是否落在清單內（含子網域） */
function hostMatches(host: string, list: string[]): boolean {
  const h = host.toLowerCase().replace(/^www\./, '')
  return list.some(d => h === d || h.endsWith(`.${d}`))
}

/**
 * 內網／本機位址。
 *
 * 讀這些沒有意義（角色讀不到你的 NAS 也不該去讀），而且桌面版的
 * `mobileServer` 本身就跑在 localhost——讓聊天訊息能指使主行程去打本機
 * 任意連接埠不是個好主意。
 */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true
  if (h === '::1' || h === '[::1]') return true
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    if (a === 127 || a === 10 || a === 0) return true
    if (a === 192 && b === 168) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 169 && b === 254) return true
  }
  return false
}

export function isJsRenderedHost(host: string): boolean {
  return hostMatches(host, JS_RENDERED_HOSTS)
}

/**
 * 尾端標點修剪。
 *
 * 網址後面幾乎一定跟著中文標點（「這篇你看一下 https://… 。」），
 * 而 `)` 要看括號有沒有配對——維基百科的網址本身就帶右括號
 * （`…/wiki/Foo_(bar)`），一律砍掉會讀到 404。
 */
function trimTrailingPunctuation(raw: string): string {
  let url = raw
  for (;;) {
    const last = url.slice(-1)
    if (/[.,;:!?、，。！？…"'“”‘’「」『』]/.test(last)) {
      url = url.slice(0, -1)
      continue
    }
    if (last === ')' || last === '）' || last === ']' || last === '】') {
      const open = last === ')' ? '(' : last === '）' ? '（' : last === ']' ? '[' : '【'
      const opens = url.split(open).length - 1
      const closes = url.split(last).length - 1
      if (closes > opens) {
        url = url.slice(0, -1)
        continue
      }
    }
    break
  }
  return url
}

/**
 * 從訊息裡抽出網址，去重後最多回傳 `limit` 個。
 *
 * 只認 `http(s)://` 開頭的完整網址——`www.foo.com` 這種裸網域不收：
 * 判斷「這是不是網址」的誤判成本比漏抓高（把句子裡的 `檔案.txt`
 * 當成網址去抓，使用者完全不知道發生什麼事）。
 */
export function extractLinkUrls(text: string, limit = MAX_LINKS_PER_MESSAGE): string[] {
  if (!text) return []
  const out: string[] = []
  const seen = new Set<string>()
  // 允許網址裡有中文（`zh.wikipedia.org/zh-tw/臺北市` 這種貼上去就是沒編碼的），
  // 但**中文標點一律當結束**——否則「…/a，然後呢」會把整句話吞進網址裡。
  const re = /https?:\/\/[^\s<>"'`{}|\\^，。、；：！？…—　（）【】「」『』〈〉《》]+/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const url = trimTrailingPunctuation(m[0])
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      continue
    }
    if (!parsed.hostname) continue
    const key = parsed.href
    if (seen.has(key)) continue
    seen.add(key)
    out.push(url)
    if (out.length >= limit) break
  }
  return out
}
