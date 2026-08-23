import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WIDGET_APPEARANCE,
  normalizeWidgetAppearance,
  resolveWidgetColors,
  toAndroidColor,
  toCssColor,
  widgetColorsToCss
} from '../../src/shared/widgetAppearance'
import { DARK_THEME_IDS, isDarkTheme, THEMES, THEME_IDS, THEME_LABELS } from '../../src/shared/colorThemes'

describe('toAndroidColor', () => {
  it('#RRGGBB → 不透明的 #AARRGGBB', () => {
    expect(toAndroidColor('#F7FFFC')).toBe('#FFF7FFFC')
  })

  it('#RGB 展開成六碼', () => {
    expect(toAndroidColor('#0AF')).toBe('#FF00AAFF')
  })

  it('CSS 的 rgba() 也要吃得下——色表裡的 border 就是這個格式，而 Android 的 Color.parseColor 不吃', () => {
    expect(toAndroidColor('rgba(0,0,0,0.08)')).toBe('#14000000')
    expect(toAndroidColor('rgba(255,255,255,0.14)')).toBe('#24FFFFFF')
  })

  it('rgb() 沒有 alpha 時當作不透明', () => {
    expect(toAndroidColor('rgb(18,18,18)')).toBe('#FF121212')
  })

  it('alphaScale 會乘上去（底色透明度就是這樣套的）', () => {
    expect(toAndroidColor('#FFFFFF', 0)).toBe('#00FFFFFF')
    expect(toAndroidColor('#FFFFFF', 0.5)).toBe('#80FFFFFF')
    expect(toAndroidColor('#FFFFFF', 1)).toBe('#FFFFFFFF')
  })

  it('已經帶 alpha 的 #AARRGGBB 會跟 alphaScale 相乘', () => {
    expect(toAndroidColor('#80FFFFFF', 0.5)).toBe('#40FFFFFF')
  })

  it('解析不出來回 null（呼叫端自己決定退路）', () => {
    expect(toAndroidColor('not-a-color')).toBeNull()
    expect(toAndroidColor('')).toBeNull()
  })
})

describe('normalizeWidgetAppearance', () => {
  it('沒設定過就是「跟隨 App 配色 ＋ 不透明」', () => {
    expect(normalizeWidgetAppearance(null)).toEqual(DEFAULT_WIDGET_APPEARANCE)
    expect(normalizeWidgetAppearance(undefined)).toEqual({ theme: null, bgOpacity: 100 })
  })

  it('不認得的主題 id 退回 null（跟隨 App），不要硬套一組', () => {
    expect(normalizeWidgetAppearance({ theme: 'neon', bgOpacity: 50 }).theme).toBeNull()
    expect(normalizeWidgetAppearance({ theme: 'cyber', bgOpacity: 50 }).theme).toBe('cyber')
  })

  it('透明度夾在 0–100 並取整', () => {
    expect(normalizeWidgetAppearance({ bgOpacity: -30 }).bgOpacity).toBe(0)
    expect(normalizeWidgetAppearance({ bgOpacity: 300 }).bgOpacity).toBe(100)
    expect(normalizeWidgetAppearance({ bgOpacity: 42.6 }).bgOpacity).toBe(43)
    expect(normalizeWidgetAppearance({ bgOpacity: Number.NaN }).bgOpacity).toBe(100)
  })
})

describe('resolveWidgetColors', () => {
  it('theme 為 null 時用傳進來的 App 配色', () => {
    const colors = resolveWidgetColors({ theme: null, bgOpacity: 100 }, 'cyber')
    expect(colors.bg).toBe(toAndroidColor(THEMES.cyber.bg))
    expect(colors.text).toBe(toAndroidColor(THEMES.cyber.text))
  })

  it('指定了主題就用指定的那組，不理 App 配色', () => {
    const colors = resolveWidgetColors({ theme: 'sepia', bgOpacity: 100 }, 'cyber')
    expect(colors.bg).toBe(toAndroidColor(THEMES.sepia.bg))
  })

  it('透明度只作用在底色，文字顏色維持不透明', () => {
    const colors = resolveWidgetColors({ theme: 'mint', bgOpacity: 0 }, 'mint')
    expect(colors.bg.startsWith('#00')).toBe(true)
    expect(colors.text.startsWith('#FF')).toBe(true)
    expect(colors.textSub.startsWith('#FF')).toBe(true)
  })

  it('按鈕的 accent **不跟著底色透明度淡掉**——按鈕要按得到就要看得見', () => {
    const colors = resolveWidgetColors({ theme: 'mint', bgOpacity: 0 }, 'mint')
    expect(colors.accent.startsWith('#FF')).toBe(true)
    expect(colors.accentStrong.startsWith('#FF')).toBe(true)
  })

  it('accent 跟著主題走（不是寫死的淺綠）——owner 回報「改了配色按鈕還是原本的淺綠色」', () => {
    expect(resolveWidgetColors({ theme: 'cyber', bgOpacity: 100 }).accent).toBe(toAndroidColor(THEMES.cyber.mint))
    expect(resolveWidgetColors({ theme: 'blush', bgOpacity: 100 }).accent).toBe(toAndroidColor(THEMES.blush.mint))
  })

  it('12 組配色每一組都算得出四個合法的 #AARRGGBB', () => {
    for (const id of Object.keys(THEMES) as (keyof typeof THEMES)[]) {
      const colors = resolveWidgetColors({ theme: id, bgOpacity: 60 }, 'mint')
      for (const value of Object.values(colors)) {
        expect(value).toMatch(/^#[0-9A-F]{8}$/)
      }
    }
  })
})

describe('colorThemes（色表本身的完整性）', () => {
  it('剛好 12 組，而且每一組都有對應的中文名稱', () => {
    expect(THEME_IDS).toHaveLength(12)
    for (const id of THEME_IDS) expect(THEME_LABELS[id]).toBeTruthy()
  })

  it('深色主題名單就是 dark／sepia／cyber', () => {
    expect(DARK_THEME_IDS).toEqual(['dark', 'sepia', 'cyber'])
    expect(isDarkTheme('cyber')).toBe(true)
    expect(isDarkTheme('mint')).toBe(false)
  })

  it('每一組都有畫小工具需要的那幾個欄位', () => {
    for (const id of THEME_IDS) {
      const t = THEMES[id]
      for (const key of ['bg', 'surface', 'text', 'sub', 'border', 'mint', 'mint2'] as const) {
        expect(t[key], `${id}.${key}`).toBeTruthy()
      }
    }
  })
})

describe('toCssColor（Android #AARRGGBB → CSS #RRGGBBAA）', () => {
  it('把 alpha 從最前面搬到最後面', () => {
    expect(toCssColor('#FFF7FFFC')).toBe('#F7FFFCFF')
    expect(toCssColor('#00F7FFFC')).toBe('#F7FFFC00')
    expect(toCssColor('#80AAEEDD')).toBe('#AAEEDD80')
  })

  it('不是八碼就原樣回傳（別把已經是 CSS 格式的再轉一次）', () => {
    expect(toCssColor('#AAEEDD')).toBe('#AAEEDD')
    expect(toCssColor('rgba(0,0,0,0.1)')).toBe('rgba(0,0,0,0.1)')
  })

  it('轉兩次不等於原值——這就是塞錯格式會安靜壞掉的原因', () => {
    // 兩種格式都是合法的八碼十六進位，所以搞錯不會噴錯，只會顏色全錯。
    expect(toCssColor(toCssColor('#FFF7FFFC'))).not.toBe('#F7FFFCFF')
  })

  it('整組轉換：透明度真的落在 CSS 認得的位置', () => {
    const css = widgetColorsToCss(resolveWidgetColors({ theme: 'mint', bgOpacity: 0 }, 'mint'))
    expect(css.bg.endsWith('00')).toBe(true)
    expect(css.text.endsWith('FF')).toBe(true)
  })
})
