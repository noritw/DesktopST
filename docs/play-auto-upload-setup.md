# Google Play 自動上傳：一次性設定步驟

> 2026-10-12 建立。目的：發版時腳本直接把 AAB 送上 Play 正式版，不用再手動開 Play Console 上傳。
> 這份是 **owner 要親手做的設定**（Claude 碰不到 Google Cloud／Play Console 帳號，也不該拿到金鑰）。
> 設定完成後，腳本那一半見文末 §4。

整件事的原理：在 Google Cloud 開一個「服務帳戶」（機器人帳號），拿它的 JSON 金鑰當身分，
再到 Play Console 把它當成一個使用者邀請進來、只給發布 DeST 的權限。之後腳本用這把金鑰呼叫
**Google Play Android Developer API** 上傳。

預計時間：操作 15 分鐘，**但權限生效可能要等最多 24～36 小時**（見 §3）。

---

## 1. Google Cloud 那一半

1. 打開 <https://console.cloud.google.com/>，用你的 Google 帳號登入（用哪個帳號都行，
   不必是 Play 開發者帳號本身，兩邊權限是分開管的）。
2. 左上角專案選單 →「新增專案」。名稱隨意，例如 `dest-play-publisher`。建好後確認左上角已切到這個專案。
3. 啟用 API：左側選單「API 和服務」→「程式庫」→ 搜尋 **Google Play Android Developer API** → 點進去 →「啟用」。
   - ⚠️ 名字很像的還有「Google Play Developer Reporting API」「Google Play Integrity API」，**不是那兩個**。
4. 建立服務帳戶：左側選單「IAM 與管理」→「服務帳戶」→「建立服務帳戶」。
   - 名稱：`play-publisher`（隨意）
   - 「授予這個服務帳戶專案存取權」（角色）：**直接略過，什麼都不用選**。發布權限是在 Play Console 給的，不是這裡。
   - 完成。
5. 產生金鑰：點進剛建好的服務帳戶 →「金鑰」分頁 →「新增金鑰」→「建立新的金鑰」→ 選 **JSON** →「建立」。
   瀏覽器會下載一個 `.json` 檔。
   - 如果出現「已停用服務帳戶金鑰建立」之類的錯誤，那是組織政策 `iam.disableServiceAccountKeyCreation`
     擋的（通常只有公司 Workspace 帳號才會遇到）。改用個人 Gmail 開 Cloud 專案就好。
6. 把下載的檔案**改名並搬到**：

   ```
   D:\DesktopST\android\play-service-account.json
   ```

   這個檔名已經寫進 `.gitignore`，不會被 commit。
7. 打開那個 JSON，找 `client_email` 欄位，長得像
   `play-publisher@dest-play-publisher.iam.gserviceaccount.com`——**只抄這一行**，下一步要用。

## 2. Play Console 那一半

8. 打開 <https://play.google.com/console/>，用**開發者帳號（海苔遊戲工房）的管理員**登入。
9. 最左側選單（在 App 清單那一層，不是點進 DeST 裡面）→「使用者和權限」→「邀請新使用者」。
10. 電子郵件地址：貼上第 7 步的 `client_email`。
11. **帳戶權限**分頁：**全部不要勾**（尤其不要給管理員、財務資料）。
12. **應用程式權限**分頁 →「新增應用程式」→ 勾 **DeST** →「套用」，接著只勾這三項：
    - 查看應用程式資訊（唯讀）／*View app information (read-only)*
    - 將應用程式發布到正式版、排除裝置及使用 Play 應用程式簽署／*Release to production, exclude devices, and use Play App Signing*
    - 將應用程式發布到測試群組／*Release apps to testing tracks*

    中文介面的措辭可能跟上面略有出入，認英文那幾個字就對了。其他（回覆評論、管理商店資訊、財務……）都不用。
    食記之後上架時，再回來這裡把食記加進同一個服務帳戶即可，不必另開。
13. 「邀請使用者」→ 確認。服務帳戶不會收信、也不用接受邀請，按下去就生效（理論上）。

## 3. 等權限生效

Google 自己的說法與實際經驗都是：**剛設好的服務帳戶，API 可能回 403
`The caller does not have permission`，最長要等 24～36 小時**。這不是設錯，是 Google 那邊在傳播權限。
設好隔天再請 Claude 跑驗證比較省事。

## 4. 現況（2026-10-12 已完成並驗證）

服務帳戶 `play-publisher@dest-calendar.iam.gserviceaccount.com`（沿用日曆的 Cloud 專案 `dest-calendar`）。
金鑰放在 `android/play-service-account.json`。**權限設好當下就通了，不用等那 24 小時**。
`--check` 乾跑已通過（讀得到正式版 510），**還沒有用真的版本上傳過**——第一次真的送審是下次發版。

- **腳本**：`scripts/play-upload.mjs`。`--check` 乾跑（開 edit、讀正式版、丟掉 edit，不用掉 versionCode）；
  不帶參數就上傳 `out/apk/DeST-v<版本>-release.aab` 到正式版並送審。其他參數見檔頭。
- **`release.bat`**：一開始多問「送 Google Play？」與「最新異動」（只有升版號＋金鑰在的時候才問）；
  在 GitHub Release **之後**才打 AAB 並送出，失敗不影響前面的步驟。
- **`MobileST.bat [6]`**：選 DeST 時，打完 AAB 會問要不要直接送審。

## 5. 安全須知

- 這把金鑰**能替你對 DeST 發布新版本**，等同半把 keystore。不要傳給任何人、不要放雲端硬碟公開資料夾、不要貼到聊天裡。
- 好消息是它**可以隨時作廢重發**（不像 keystore 弄丟就完了）：懷疑外洩就到 Cloud Console
  服務帳戶 →「金鑰」把那把刪掉，再建一把新的；或直接在 Play Console 把那個使用者移除。
- 所以它**不需要像 keystore 那樣另外備份**，弄丟了重做第 5 步就好。

## 參考

- 官方：[Google Play Developer API — Getting Started](https://developers.google.com/android-publisher/getting_started)
