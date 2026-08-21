import { describe, expect, it } from 'vitest'
import {
  clampOffset,
  computeCropRect,
  coverScale,
  imageScreenOrigin,
  type CropLayout
} from '../../src/mobile/ui/characters/avatarCropMath'

function layout(over: Partial<CropLayout> = {}): CropLayout {
  return {
    naturalW: 1000,
    naturalH: 1000,
    frameSize: 300,
    viewW: 400,
    viewH: 800,
    baseScale: coverScale(300, 1000, 1000),
    userScale: 1,
    offsetX: 0,
    offsetY: 0,
    ...over
  }
}

describe('coverScale', () => {
  it('取短邊貼齊裁切框所需的縮放倍率', () => {
    // 1000x1000 的圖，裁切框 300 → 短邊（也是唯一邊）貼齊框需要 0.3 倍
    expect(coverScale(300, 1000, 1000)).toBeCloseTo(0.3)
    // 長方形圖片：短邊（500）要貼齊 300 的框
    expect(coverScale(300, 2000, 500)).toBeCloseTo(0.6)
  })
})

describe('clampOffset', () => {
  it('圖片剛好覆蓋裁切框（無縮放餘裕）時夾到 0——不能動', () => {
    // naturalSize * scale === frameSize：完全貼齊，一動就會露出透明
    expect(clampOffset(50, 300, 300, 1)).toBeCloseTo(0)
    expect(clampOffset(-50, 300, 300, 1)).toBeCloseTo(0)
  })

  it('放大後有餘裕時，允許平移到邊界但不超過', () => {
    // naturalSize=1000, scale=0.3 → 顯示尺寸 300，跟框一樣大，沒有餘裕
    // 放大到 userScale 使總 scale=0.6 → 顯示尺寸 600，框 300，單邊餘裕 (600-300)/2=150
    const scale = 0.6
    expect(clampOffset(200, 1000, 300, scale)).toBe(150)
    expect(clampOffset(-200, 1000, 300, scale)).toBe(-150)
    expect(clampOffset(100, 1000, 300, scale)).toBe(100) // 沒超界，原樣回傳
  })
})

describe('imageScreenOrigin', () => {
  it('無縮放無平移時，圖片（cover 後跟框一樣大）置中於 viewport', () => {
    const l = layout()
    const { screenLeft, screenTop, scale } = imageScreenOrigin(l)
    expect(scale).toBeCloseTo(0.3)
    // 顯示尺寸 = 1000*0.3 = 300，跟 viewW=400 置中：screenLeft = 200 - 150 = 50
    expect(screenLeft).toBeCloseTo(50)
    // viewH=800 置中：screenTop = 400 - 150 = 250
    expect(screenTop).toBeCloseTo(250)
  })

  it('offset 會直接加在置中位置上（螢幕像素，不受 scale 影響）', () => {
    const l = layout({ offsetX: 20, offsetY: -10 })
    const { screenLeft, screenTop } = imageScreenOrigin(l)
    expect(screenLeft).toBeCloseTo(70)
    expect(screenTop).toBeCloseTo(240)
  })
})

describe('computeCropRect', () => {
  it('無縮放無平移時，裁切框對應原圖正中央的完整範圍', () => {
    const { sx, sy, sSize } = computeCropRect(layout())
    // baseScale=0.3 時裁切框(300)對應原圖 300/0.3=1000（=整張圖，因為圖片剛好 cover）
    expect(sSize).toBeCloseTo(1000)
    expect(sx).toBeCloseTo(0)
    expect(sy).toBeCloseTo(0)
  })

  it('放大 2 倍後，裁切框對應原圖範圍縮小一半，且置中', () => {
    const l = layout({ userScale: 2 })
    const { sx, sy, sSize } = computeCropRect(l)
    // scale = 0.3*2 = 0.6，sSize = 300/0.6 = 500（原圖 1000 的一半，置中）
    expect(sSize).toBeCloseTo(500)
    expect(sx).toBeCloseTo(250)
    expect(sy).toBeCloseTo(250)
  })

  it('平移後，裁切框對應原圖的範圍跟著偏移（方向要對：往右拖圖，裁切範圍往左移）', () => {
    // 放大到有餘裕，再往右拖 60px（offsetX 正值＝圖片往右移）
    const l = layout({ userScale: 2, offsetX: 60 })
    const base = computeCropRect(layout({ userScale: 2 }))
    const shifted = computeCropRect(l)
    // 圖片往右移，裁切框相對圖片的取樣點要往左移（sx 變小）
    // offsetX 60px 除以 scale(0.6) = 100 個原圖像素
    expect(shifted.sx).toBeCloseTo(base.sx - 100)
    expect(shifted.sy).toBeCloseTo(base.sy)
  })

  it('非正方形圖片（直式照片）：cover 後長邊超出框，裁切範圍只取中間那一截', () => {
    // 1000(寬) x 2000(高)，框 300 → 短邊(1000)貼齊框，scale = 300/1000 = 0.3
    const l = layout({ naturalW: 1000, naturalH: 2000, baseScale: coverScale(300, 1000, 2000) })
    const { sx, sy, sSize } = computeCropRect(l)
    expect(sSize).toBeCloseTo(1000)
    expect(sx).toBeCloseTo(0)
    // 高度方向：置中裁切，(2000-1000)/2 = 500
    expect(sy).toBeCloseTo(500)
  })
})
