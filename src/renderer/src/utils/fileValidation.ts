const ALLOWED = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])

/** 由檔名取得副檔名（小寫，含點） */
export function extFromFilename(filename: string): string {
  const i = filename.lastIndexOf('.')
  if (i < 0) return ''
  return filename.slice(i).toLowerCase()
}

export function isAllowedImageExt(ext: string): boolean {
  const e = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`
  return ALLOWED.has(e)
}
