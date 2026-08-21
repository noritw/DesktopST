# 下一輪開工指令（角色卡匯出 → S2 同步）

> 建立時間：2026-08-12。這份是給接手 AI 的完整指令，貼進新對話開頭即可開工。

---

貼這段給我：

```
先讀 CLAUDE.md（不要整份掃其他文件）。

獨立版目前只剩兩項缺口，照這個順序做：

① 角色卡／設定包匯出（`docs/mobile-standalone-gap-inventory.md` #3）
   - src/mobile/data/localDataSource.ts 的 characters.exportCard／exportPack
     還是 pending，匯入已可用（S1），這次要把匯出接上
   - 需要 Capacitor Filesystem 寫檔 + 分享 intent（動態 import，
     瀏覽器煙測與 vitest 沒有原生 plugin，見 CLAUDE.md §5）
   - 桌面既有的匯出邏輯在哪、格式是什麼，先讀 core/ 對應檔案，
     不要重新設計格式，獨立版要跟桌面匯出的檔案互通
   - 做完先問我要不要繼續 S2，不要自己接著做

② 對話與電腦雙向同步（S2）
   - 設計文件已經寫好：docs/mobile-mode-switch-sync.md（整份要讀）
   - 背景資料在 roadmap §4.7（模式分層、S1-S3、API Key 判定、星狀拓樸），
     只讀那一段，不要整份 roadmap
   - S1（單向匯入）已完成，可以參考它的資料流長什麼樣子
   - 這塊改動範圍大（雙向同步、衝突處理），開工前先跟我確認一次
     實作範圍要切多細、要不要分階段驗收，不要一次做到底才給我看

兩項都遵守：
- 業務邏輯寫 core/，手機端只做薄轉呼叫
- 改完資料要 events.push({ kind: 'state-invalidated' })
- 每個子功能做完 npm test + npm run typecheck，不要累積到最後才測
- 涉及 Android 原生層或需要真機驗證的部分，做完要提醒我開 USB 偵錯讓你測
- 完工後同步更新 CLAUDE.md §4 現況表與 gap-inventory.md，不要留給我自己記得
```

---

## 為什麼是這個順序

角色卡匯出範圍小、風險低（純資料操作，跟著既有格式走），適合先暖身。
S2 同步範圍大（雙向、有衝突處理），且 `gap-inventory.md` 本來就排在匯出後面，
owner 2026-08-09 的排序也是先求獨立版功能完整、S2 最後做。

## 這次盤點順便發現、但沒動的東西

- **`b3-mobile-ui-plan.md` 第 1188 行**提到「地方新聞」是描述一個**歷史 bug**
  （POST settings 沒淺層合併會把哪些欄位清掉），保留原樣沒問題，不要誤刪。
- 桌面獨有、確認刻意不搬到手機的三項（不是缺口，不要在下一輪誤當成待辦）：
  背景定時抓新聞、對話新聞搜尋（`conversationSearch`）、新聞搬家包（`readerPack`）。
