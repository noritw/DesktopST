/** 音效等靜態資源的 URL（開發用 /file，打包用 ./file 相對於 index.html）。 */
export function staticFileUrl(filename: string): string {
  return `./${filename}`
}
