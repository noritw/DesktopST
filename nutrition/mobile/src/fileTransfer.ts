/**
 * 選檔與存檔（搬家包匯出／匯入）。跟 DeST 本體的
 * `src/mobile/ui/shell/fileTransfer.ts` 是同一套已經真機驗證過的做法，
 * 直接複製一份而不是 import 那支——這個 App 刻意不 import DeST 的 UI 殼層
 * 程式碼（見 CLAUDE.md §3.1），核心以外的東西各自一份。
 */

/**
 * 讓使用者挑一個檔案。取消時回 `null`。
 * `accept` 刻意不列副檔名／MIME 清單——Android 對自訂副檔名常常整片灰掉不能選，
 * 格式的把關留給選完之後（JSON.parse 失敗就報錯）。
 */
export function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.hidden = true
    document.body.appendChild(input)
    input.onchange = () => {
      input.remove()
      resolve(input.files?.[0] ?? null)
    }
    input.click()
  })
}

/**
 * 把位元組存成檔案。網頁走 `<a download>`；APK 走 Capacitor Filesystem 寫進快取
 * 再用 Share 叫出系統分享面板（存去下載、傳電腦、丟雲端硬碟由使用者自己選）。
 */
export async function downloadBytes(bytes: Uint8Array, filename: string, mime = 'application/octet-stream'): Promise<void> {
  const { Capacitor } = await import('@capacitor/core')
  if (Capacitor.isNativePlatform()) {
    await shareViaNativeFilesystem(bytes, filename)
    return
  }
  const blob = new Blob([new Uint8Array(bytes).slice().buffer as ArrayBuffer], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

async function shareViaNativeFilesystem(bytes: Uint8Array, filename: string): Promise<void> {
  const { Filesystem, Directory } = await import('@capacitor/filesystem')
  const { Share } = await import('@capacitor/share')
  const { bytesToBase64 } = await import('@core/util/base64')
  const safeName = filename.replace(/[/\\]/g, '_').trim() || 'export'

  const CHUNK_BYTES = 384 * 1024
  await Filesystem.writeFile({ path: safeName, data: bytesToBase64(bytes.subarray(0, CHUNK_BYTES)), directory: Directory.Cache })
  for (let offset = CHUNK_BYTES; offset < bytes.length; offset += CHUNK_BYTES) {
    await Filesystem.appendFile({ path: safeName, data: bytesToBase64(bytes.subarray(offset, offset + CHUNK_BYTES)), directory: Directory.Cache })
  }
  const { uri } = await Filesystem.getUri({ path: safeName, directory: Directory.Cache })
  await Share.share({ files: [uri], title: safeName })
}
