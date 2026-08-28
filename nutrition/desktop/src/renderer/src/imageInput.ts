/**
 * 壓縮使用者選取的圖片後轉成可寫入 StorageAdapter 的二進位（webp）。
 * 桌面與手機各自一份（各自建置系統獨立），內容故意保持最小。
 */
export async function compressImageFile(file: File, maxDimension = 1024, quality = 0.82): Promise<Uint8Array> {
  const image = await decodeImageSource(file)
  try {
    const scale = Math.min(1, maxDimension / Math.max(image.width, image.height))
    const width = Math.max(1, Math.round(image.width * scale))
    const height = Math.max(1, Math.round(image.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no-canvas-context')
    ctx.drawImage(image.source, 0, 0, width, height)
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('toBlob-failed'))), 'image/webp', quality)
    })
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    image.close()
  }
}

/**
 * 某些「旋轉過」的照片會讓 `createImageBitmap` 直接丟 InvalidStateError 讀不出來
 * （手機版 Pixel 10a、Google 相簿實測踩到，桌面沿用同一份修法保持一致）。
 * 退回用 `<img>` 解碼一次：瀏覽器對 `<img>` 的容錯度比 `createImageBitmap` 高，
 * 而且天生會套用 EXIF 方向，副作用是連原本「沒壞但方向讀反」的照片也一併修正。
 */
async function decodeImageSource(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  try {
    const bitmap = await createImageBitmap(file)
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }
  } catch {
    const url = URL.createObjectURL(file)
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image()
        el.onload = () => resolve(el)
        el.onerror = () => reject(new Error('image-decode-failed'))
        el.src = url
      })
      return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) }
    } catch (error) {
      URL.revokeObjectURL(url)
      throw error
    }
  }
}
