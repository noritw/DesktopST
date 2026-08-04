import { describe, it, expect, beforeEach } from 'vitest'
import { useComposerStore } from '../../src/mobile/ui/stores/composerStore'

/**
 * 輸入框草稿（B3 階段 2c）。
 *
 * 值得測的原因是**它有兩個以上的寫入者**：使用者打字、隨機工具插 token（C3），
 * 之後還有新聞報的「聊這個」（F10）。插入點算錯的症狀是
 * 「token 跑到句子中間某個奇怪的位置」—— 看畫面才會發現，而且很難重現。
 */

const reset = (): void => {
  useComposerStore.setState({ text: '', caret: null, respond: true })
}

const store = () => useComposerStore.getState()

beforeEach(reset)

describe('insert', () => {
  it('插在游標處，不是字尾 —— 先打完句子再回頭補一顆骰子是常見用法', () => {
    store().setText('我要擲一下看看', 4)
    store().insert('[🎲1d20]')
    expect(store().text).toBe('我要擲一[🎲1d20]下看看')
  })

  it('插完游標停在插入內容之後，接著打字才會接在後面', () => {
    store().setText('abc', 1)
    store().insert('XY')
    expect(store().caret).toBe(3)
    store().insert('Z')
    expect(store().text).toBe('aXYZbc')
  })

  it('還沒動過游標時插在最後', () => {
    store().setText('abc')
    store().insert('!')
    expect(store().text).toBe('abc!')
  })

  it('游標超出文字長度時夾回範圍內，不會產生 undefined 或空洞', () => {
    // 換過對話、外部改寫文字之後，記著的位置可能已經比文字還長。
    store().setText('ab', 99)
    store().insert('!')
    expect(store().text).toBe('ab!')
  })

  it('連續插入兩顆 token 會照順序排好', () => {
    store().setText('擲：', 3)
    store().insert('[🎲1d6]')
    store().insert('[🎲1d8]')
    expect(store().text).toBe('擲：[🎲1d6][🎲1d8]')
  })
})

describe('clear', () => {
  it('清掉文字與游標', () => {
    store().setText('abc', 2)
    store().clear()
    expect(store().text).toBe('')
    expect(store().caret).toBeNull()
  })

  it('**不重設 `respond`** —— 那是使用者的習慣，不該每送一則就跳回預設', () => {
    store().setRespond(false)
    store().clear()
    expect(store().respond).toBe(false)
  })
})

describe('setText', () => {
  it('不給 caret 時保留原本的位置（打字以外的路徑不該亂動游標）', () => {
    store().setText('abc', 2)
    store().setText('abcd')
    expect(store().caret).toBe(2)
  })
})
