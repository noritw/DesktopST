/**
 * 壓縮使用者選取的圖片後轉成可寫入 StorageAdapter 的二進位（webp）。
 * 桌面與手機各自一份（各自建置系統獨立），內容故意保持最小。
 */
export async function compressImageFile(file: File, maxDimension = 1024, quality = 0.82): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no-canvas-context')
    ctx.drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('toBlob-failed'))), 'image/webp', quality)
    })
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    bitmap.close()
  }
}
