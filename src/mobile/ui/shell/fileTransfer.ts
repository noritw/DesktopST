/**
 * 選檔與存檔（階段 3 的匯入匯出）。
 *
 * 這是一個**平台接縫**：網頁版（掃 QR 那條路徑）走 `<input type=file>` 與
 * Blob 下載；APK 之後要改走 Capacitor Filesystem／Share，才能存進「下載」資料夾
 * 並讓使用者用系統的分享選單送出去。
 *
 * ⚠️ **現在只寫網頁那半是刻意的**（比照 `localDataSource` 的先例）：
 * Capacitor Filesystem 外掛還沒裝，而 APK 要到階段 7 才第一次真的 build 出來
 * （`src/mobile/README.md`：用到哪個裝哪個）。先寫一份猜的實作，
 * 接上時多半要重寫。這支檔案的存在就是為了讓那天只要改這裡。
 */

/** 讓使用者挑一個檔案。取消時回 `null`。 */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    // ⚠️ 沒有「取消」事件可以靠：使用者按取消時多數瀏覽器什麼都不發。
    // 元件因此不能等這個 Promise 來收 loading 狀態 —— 它可能永遠不 resolve(File)。
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.click()
  })
}

/** 把位元組存成檔案。 */
export function downloadBytes(bytes: Uint8Array, filename: string, mime = 'application/octet-stream'): void {
  // 複製一份再包進 Blob：`Uint8Array` 的 buffer 型別上可能是 SharedArrayBuffer，
  // 而 Blob 只吃一般的 ArrayBuffer。複製也順帶避免共用同一塊記憶體。
  const blob = new Blob([new Uint8Array(bytes).slice().buffer as ArrayBuffer], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 立刻 revoke 會讓部分瀏覽器來不及開始下載。
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function mimeForFilename(filename: string): string {
  if (filename.endsWith('.png')) return 'image/png'
  if (filename.endsWith('.json')) return 'application/json'
  return 'application/octet-stream'
}
