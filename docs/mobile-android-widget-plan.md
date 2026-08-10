# 手機獨立版 —— Android 桌面小工具功能計畫書 (Android App Widget Plan)

> **建立時間**：2026-08-10 (2026-08-10 補充便利貼電腦端同步)
> **狀態**：規格與架構已定案，待實作
> **目標**：讓使用者可在 Android 主畫面（Home Screen）放置角色小工具，支援「角色陪伴對話模式」與「桌面便利貼模式」。支援角色圖片（或無圖純文字）、表情切換、顯示最後對白、最新提醒內容或個人便利貼，點擊可快速拉起 App 進行對話/編輯。

---

## 1. 核心需求與特點

1. **雙小工具模式 (Dual Widget Modes)**：
   * **角色陪伴與提醒模式**：顯示角色圖（帶表情）、角色名稱、最後對白或最新提醒。
   * **桌面便利貼模式**：將原本桌面版的便利貼（Pinned Note）概念延伸至 Android 主畫面。可顯示個人備忘筆記，並可自由選擇**搭配特定角色圖**或**純文字無圖片**。
2. **與電腦桌面版 100% 同步 (Desktop Sync)**：
   * 便利貼資料 (`pinnedNotes`) 納入 **S1「從電腦重新拉設定」** 與 **S2 跨裝置同步** 機制中。
   * 在電腦版建立、編輯或調整底色的便利貼，手機按「與電腦同步」即可立刻拉取並同步反映在 Android 主畫面的小工具上！
3. **多則便利貼處置 (Multiple Pinned Notes)**：
   * **方案 A（獨立綁定，最直覺）**：主畫面可放置多個獨立的便利貼小工具，放置時自由選擇要顯示哪一則備忘筆記。
   * **方案 B（單一小工具內翻頁）**：小工具右上角提供左右切換箭頭 `◄ 1/3 ►`。
4. **便利貼色彩與桌面版 100% 同步**：
   便利貼底色選項完全對齊桌面版 `NOTE_COLORS` 色彩面板（共 9 色）：
   * 奶油黃 (`#FFE8AA`) - 預設
   * 粉橘 (`#FFD6B8`)
   * 薄荷綠 (`#CBFBC4`)
   * 粉藍綠 (`#B8F4EA`)
   * 天藍 (`#AAEEFF`)
   * 粉紅 (`#FFBBBB`)
   * 薰衣草 (`#F0BBFF`)
   * 純白 (`#FFFFFF`)
   * 黑底白字 (`#1F2423`)
5. **角色視覺與 Token 省流**：直接顯示角色卡原本設定的圖片 (`avatar`)；若角色卡**無表情圖片**則提前略過情緒 LLM 呼叫，節省 API Token。
6. **便利貼色彩與話題連動**：該便利貼內容會同步載入給角色，作為 AI 聊天的**桌面話題素材 (Pinned Notes Context)**。
7. **快速對話/編輯入口**：點擊小工具任意區域，直接拉起 DesktopST App 並定位至對應角色或便利貼編輯視窗。

---

## 2. 系統架構與兩種小工具模式

```
 [電腦端 Desktop DeST 便利貼] ──(S1 從電腦拉設定 / S2 同步)──> [手機端 pinnedNotes]
                                                                  │
                 [使用者於主畫面新增 DeST Widget] ─────────────────┤
                                │                                 │
                                ▼                                 ▼
                   [選擇小工具模式 (Configure)]
                                │
       ┌────────────────────────┴────────────────────────┐
       ▼                                                 ▼
【模式 1: 角色陪伴與提醒模式】                      【模式 2: 桌面便利貼模式】
 顯示角色圖片 (帶表情/無表情)                        選擇要顯示哪一則便利貼 (多則可獨立放)
 顯示最後對白 / 最新提醒文案                        自選搭配角色圖 OR 無圖片純文字
 點擊 ──> 進入角色聊天頁                             選擇背景色 (同步桌面版 NOTE_COLORS 9色)
                                                    同步至 pinnedNotes (作為聊天話題)
                                                    點擊 ──> 開啟便利貼編輯視窗
```

---

## 3. 小工具佈局與尺寸規格 (Widget Layouts)

支援兩種標準 Android 小工具尺寸，並依據「角色模式」與「便利貼模式」動態切換 Layout：

### 3.1 2x2 輕量小卡 (Small Widget)
* **角色模式**：角色圖 + 名字 + 對話/提醒泡泡（微縮 2 行）。
* **便利貼模式**：
  * **有角色圖**：小型角色圖片 + 便利貼標題/內文。
  * **純文字無圖**：滿版彩色便利貼備忘卡（高字級便於閱讀）。

### 3.2 4x2 / 4x3 完整面板 (Medium / Large Widget)
* **角色模式**：
  * 左側：角色圖片（依對話情緒顯示 `emotions` 對應表情圖；無表情圖則顯示主圖片 `avatar`）。
  * 右側：對話框（顯示完整提醒文案或最近 3 行對白）+ 時間標籤 + 「對話」快捷按鈕。
* **便利貼模式**：
  * 左側（可選）：自選角色圖片或隱藏。
  * 右側/全版：桌面版 9 色選定背景 + 完整便利貼標題與內文 + 左右切換箭頭 `◄ 1/N ►`。

---

## 4. 表情切換與 Token 省流機制

1. **提前檢查表情設定 (Token-Saving Check)**：
   * 在進行 LLM 生成或發話前，檢查 `character.emotions` 與 `character.spriteIds` 是否有值。若無任何表情圖檔，**完全不進行情緒分類 API 呼叫**。
2. **情緒標籤匹配與渲染 (若有表情圖檔)**：
   * 當角色訊息或提醒生成並帶有 `emotion` 屬性時，讀取對照表找到對應圖片檔填入 `RemoteViews.setImageViewBitmap()`。

---

## 5. 原生元件與檔案結構

### 5.1 Android 原生層
* `android/app/src/main/java/tw/nori9/dest/widget/DeSTAppWidgetProvider.java`
  * 處理小工具生命週期、模式判定（角色模式 vs 便利貼模式）與廣播更新。
* `android/app/src/main/java/tw/nori9/dest/widget/DeSTWidgetConfigureActivity.java`
  * 小工具放置時的設定頁面：選擇「小工具類型（陪伴對話 / 便利貼）」、「發話角色 / 指定便利貼」、「是否顯示角色圖」、「便利貼底色 (對齊桌面版 9 色 NOTE_COLORS)」。
* `android/app/src/main/res/layout/widget_dest_character_small.xml` (2x2)
* `android/app/src/main/res/layout/widget_dest_character_large.xml` (4x2)
* `android/app/src/main/res/layout/widget_dest_note_small.xml` (2x2 便利貼)
* `android/app/src/main/res/layout/widget_dest_note_large.xml` (4x2 便利貼)

### 5.2 前端 / Bridge 層
* `src/mobile/runtime/widgetSync.ts`
  * 同步最新對話快照、提醒台詞與便利貼數據 (`pinnedNotes`) 至 Android `SharedPreferences`。

---

## 6. 接手 AI 實作步驟順序

1. **第一步（Android 小工具版面設計）**：
   在 `android/app/src/main/res/layout/` 建立角色陪伴小工具與便利貼小工具 XML 佈局。
2. **第二步（小工具配置視窗 ConfigureActivity 與 9 色選色器）**：
   撰寫 `DeSTWidgetConfigureActivity.java`，對齊桌面版 `NOTE_COLORS` 9 色底色，讓使用者自由挑選類型、選擇指定便利貼或角色、自訂便利貼顏色與無圖片/有圖片切換。
3. **第三步（AppWidgetProvider 與 Token 省流）**：
   實作 `DeSTAppWidgetProvider.java` 渲染邏輯，支援獨立便利貼與切換，且無表情圖檔時提前略過情緒分類呼叫。
4. **第四步（AndroidManifest 註冊）**：
   在 `AndroidManifest.xml` 中註冊 `DeSTAppWidgetProvider` 與 `DeSTWidgetConfigureActivity`。
5. **第五步（Bridge 與 S1/S2 便利貼數據連動）**：
   將便利貼數據 (`pinnedNotes`) 納入 S1「從電腦重新拉設定」端點與 S2 跨裝置同步機制中，並經由 `widgetSync.ts` 即時觸發小工具更新。
6. **第六步（真機測試）**：
   在 Pixel 10a 實機測試「從電腦重新拉設定」後，電腦版便利貼成功同步至手機並反映在 Android 桌面小工具上。
