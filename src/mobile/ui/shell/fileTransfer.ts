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

/**
 * 讓使用者挑一個檔案。取消時回 `null`。
 *
 * ⚠️ **`accept` 在手機上要給「大類」不要給「一串具體格式」。**
 * Android 的 Chrome 會把 `accept` 轉成丟給相簿 App 的篩選條件：`image/*` 一切正常，
 * 但換成 `image/png,image/jpeg,…` 這種具體清單時，Google 相簿等 App 常常就篩不出
 * 任何東西——症狀是「點了相簿，一張圖都沒有」（owner 2026-08-05 實機回報）。
 * 副檔名形式（`.png,.dstpack`）更糟：Android 沒有副檔名的概念，自訂副檔名對映不到
 * 任何 MIME，檔案會整片灰掉不能選。
 * `ui/chat/Composer.tsx` 的聊天傳圖從頭到尾沒出過事，用的就是 `image/*`。
 * **格式的把關留給選完之後**（`avatarFile.ts` 會驗），不要在選圖器上把關。
 *
 * ⚠️ **`<input>` 一定要先掛進 DOM 再 `.click()`。**
 * 原本用 `document.createElement` 生一個從沒掛進文件樹的 input，桌面瀏覽器與
 * `npm run dev:mobile` 的桌機模擬都測得過，但手機上跳去相簿選圖、切回瀏覽器後
 * `change` 事件收不到——症狀是「選了圖但完全沒反應」（owner 2026-08-05 兩度實機
 * 回報）。`ui/chat/Composer.tsx` 的圖片附件一直是好的，因為那支的 `<input>` 是
 * 寫在 JSX 裡、`hidden` 但確實在畫面上，不是憑空生一個丟著。這裡照同樣的作法。
 */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.hidden = true
    document.body.appendChild(input)

    input.onchange = () => {
      input.remove()
      resolve(input.files?.[0] ?? null)
    }

    // ⚠️ **刻意不用 `window focus` 猜「使用者取消了」。**
    // 曾經加過：跳去選圖器再切回來時補一次檢查，順便把懸空的 input 清掉。
    // 結果剛拍的照片（檔案較大，Android 的系統選圖器交還檔案前有明顯延遲）
    // 反而被這個猜測搶先判定成「取消」，`onchange` 才姍姍來遲時 input 已經被拔掉——
    // owner 2026-08-05 實機回報「隨手拍的照片選不進去」正是這個（gallery 裡現成的
    // 小圖通常快到不會踩到，才會看起來像是「有些圖可以、有些不行」）。
    // 取消時 input 就留著（隱形、不掛在畫面上任何可見的地方），
    // 只是輕微的 DOM 孤兒節點，換來的是選圖不會被自己的「智慧判斷」搶答。
    input.click()
  })
}

/**
 * 把位元組存成檔案，讓使用者拿到手（缺口 #3：角色卡／設定包匯出）。
 *
 * 網頁（掃 QR 那條路徑）走 `<a download>` ＋ Blob，瀏覽器自己存進下載資料夾。
 * APK 裡沒有「下載資料夾」這回事、`<a download>` 在 Capacitor WebView 裡也是
 * 靜靜的沒反應——改走 Capacitor Filesystem 寫進快取，再用 Share 叫出系統分享面板
 * （存去下載、傳 LINE、丟雲端硬碟都由使用者自己選，比我們代猜路徑更貼近手機的用法）。
 *
 * Capacitor 外掛動態載入：瀏覽器煙測與 vitest 沒有原生 plugin，靜態 import 會炸。
 */
export async function downloadBytes(
  bytes: Uint8Array,
  filename: string,
  mime = 'application/octet-stream'
): Promise<void> {
  const { Capacitor } = await import('@capacitor/core')
  if (Capacitor.isNativePlatform()) {
    await shareViaNativeFilesystem(bytes, filename)
    return
  }

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

async function shareViaNativeFilesystem(bytes: Uint8Array, filename: string): Promise<void> {
  const { Filesystem, Directory } = await import('@capacitor/filesystem')
  const { Share } = await import('@capacitor/share')
  const { bytesToBase64 } = await import('@core/util/base64')

  // 檔名來自角色名字（自由文字），濾掉路徑分隔符與控制字元，
  // 否則 Filesystem.writeFile 可能被導去寫進非預期的子目錄。
  const safeName = filename.replace(/[/\\]/g, '_').trim() || 'export'

  // Directory.Cache：分享完不必自己清，系統會照 app 快取的一般規則回收。
  /*
   * A character pack may include many original avatars and expressions. Sending one
   * complete base64 string through the WebView-to-native bridge keeps the zip,
   * base64 string, and bridge JSON copy alive at once, which can make Android kill
   * the app. Write small chunks instead. Each chunk is a multiple of 3 bytes so
   * its base64 representation does not add padding in the middle of the file.
   */
  const CHUNK_BYTES = 384 * 1024
  await Filesystem.writeFile({
    path: safeName,
    data: bytesToBase64(bytes.subarray(0, CHUNK_BYTES)),
    directory: Directory.Cache
  })
  for (let offset = CHUNK_BYTES; offset < bytes.length; offset += CHUNK_BYTES) {
    await Filesystem.appendFile({
      path: safeName,
      data: bytesToBase64(bytes.subarray(offset, offset + CHUNK_BYTES)),
      directory: Directory.Cache
    })
  }
  const { uri } = await Filesystem.getUri({ path: safeName, directory: Directory.Cache })
  // Use the modern native-file path so Android always invokes FileProvider sharing.
  await Share.share({ files: [uri], title: safeName })
}

export function mimeForFilename(filename: string): string {
  if (filename.endsWith('.png')) return 'image/png'
  if (filename.endsWith('.json')) return 'application/json'
  return 'application/octet-stream'
}
