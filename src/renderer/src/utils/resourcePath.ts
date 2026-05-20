/** 音效等靜態資源的 URL（開發用 dev server 完整 URL，打包用 ./file 相對於 index.html）。 */
export function staticFileUrl(filename: string): string {
  // 開發環境：使用 Vite dev server 的完整 URL（避免 Electron renderer 路徑解析問題）
  const devUrl = window.electronBuild?.rendererUrl
  if (devUrl) {
    const base = devUrl.endsWith('/') ? devUrl : `${devUrl}/`
    return `${base}${filename}`
  }
  // 打包環境：使用相對路徑（相對於 index.html）
  return `./${filename}`
}
