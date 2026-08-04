import { describe, it, expect, beforeEach } from 'vitest'
import { useUiStore, handleBack } from '../../src/mobile/ui/stores/uiStore'

/**
 * 燈箱的翻頁與邊界（清單 B4）。
 *
 * 邊界值得測，是因為兩種錯法在畫面上長得一樣（都是「按了沒反應」），
 * 但一種是正確的停在最後一張、另一種是索引已經越界、圖變空白。
 */

const store = () => useUiStore.getState()

beforeEach(() => {
  useUiStore.setState({ lightbox: null, dialog: null, stack: [] })
})

describe('open', () => {
  it('指定從第幾張開始', () => {
    store().openLightbox(['a', 'b', 'c'], 1)
    expect(store().lightbox).toEqual({ images: ['a', 'b', 'c'], index: 1 })
  })

  it('索引超出範圍時夾回去，不會開出一張空白', () => {
    store().openLightbox(['a', 'b'], 9)
    expect(store().lightbox?.index).toBe(1)
    store().openLightbox(['a', 'b'], -3)
    expect(store().lightbox?.index).toBe(0)
  })

  it('空陣列不開 —— 沒有東西可看的燈箱只會讓人以為當掉', () => {
    store().openLightbox([])
    expect(store().lightbox).toBeNull()
  })
})

describe('step', () => {
  it('往前往後都走得動', () => {
    store().openLightbox(['a', 'b', 'c'], 1)
    store().stepLightbox(1)
    expect(store().lightbox?.index).toBe(2)
    store().stepLightbox(-1)
    expect(store().lightbox?.index).toBe(1)
  })

  it('到頭就停住，不繞回去（繞回去會分不清有沒有看完）', () => {
    store().openLightbox(['a', 'b'], 0)
    store().stepLightbox(-1)
    expect(store().lightbox?.index).toBe(0)
    store().stepLightbox(1)
    store().stepLightbox(1)
    expect(store().lightbox?.index).toBe(1)
  })

  it('燈箱沒開時 step 不會炸也不會憑空開一個', () => {
    store().stepLightbox(1)
    expect(store().lightbox).toBeNull()
  })
})

describe('返回鍵', () => {
  it('燈箱在最上層，返回先關它而不是關掉底下的畫面', () => {
    store().push('conversations')
    store().openLightbox(['a'])
    expect(handleBack()).toBe(true)
    expect(store().lightbox).toBeNull()
    // 底下那層要還在
    expect(store().stack).toHaveLength(1)
  })
})
