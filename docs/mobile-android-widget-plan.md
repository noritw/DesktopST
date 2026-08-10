# 手機獨立版 —— Android 桌面小工具功能計畫書 (Android App Widget Plan)

> **建立時間**：2026-08-10 (2026-08-10 修正圖片說明)
> **狀態**：規格與架構已定案，待實作
> **目標**：讓使用者可在 Android 主畫面（Home Screen）放置角色小工具，顯示角色圖片（直接取用角色卡設定）、因應情緒切換表情圖片、顯示最後一句對白或最新提醒內容，點擊可快速拉起 App 進行對話。

---

## 1. 核心需求與特點

1. **角色視覺呈現**：直接顯示角色卡原本設定的圖片 (`avatar`)，且**支援表情動態切換**（依據對話或提醒中的表情標籤 `[emotion: happy]` 載入角色卡 `emotions` / `spriteIds` 對應的表情圖片）。
2. **文字與提醒呈現**：動態顯示「最後一句角色對白」或「最新發出的提醒內容」。
3. **快速對話入口**：點擊小工具任意區域，直接拉起 DesktopST App 並定位至該角色的聊天畫面。
4. **與提醒系統連動**：當背景精準鬧鐘 (`ReminderWorker`) 觸發提醒時，同步更新桌面小工具上的台詞與表情圖片。

---

## 2. 技術架構與資料流 (Architecture)

```
[對話發生 / 提醒觸發 (ReminderWorker)]
                 │
                 ▼
[更新 Android SharedPreferences / 本地快照]
 (包含: characterName, imagePath, emotion, text, timestamp)
                 │
                 ▼
[發送廣播 AppWidgetManager.ACTION_APPWIDGET_UPDATE]
                 │
                 ▼
     [DeSTAppWidgetProvider (Native)]
                 │
                 ├─> 解析角色圖片與情緒圖檔 (BitmapFactory)
                 ├─> 組合 RemoteViews 佈局
                 └─> 呼叫 AppWidgetManager.updateAppWidget() 刷新主畫面小工具
```

---

## 3. 小工具佈局與尺寸規格 (Widget Layouts)

支援兩種標準 Android 小工具尺寸：

### 3.1 2x2 輕量小卡 (Small Widget)
* **視覺內容**：角色圖（帶表情）+ 角色名字 + 對話泡泡（微縮內文 2 行）。
* **適用情境**：節省主畫面空間，作為桌面陪伴與提醒小卡。

### 3.2 4x2 / 4x3 完整對話面板 (Medium / Large Widget)
* **視覺內容**：
  * 左側：角色圖片（依對話情緒顯示 `emotions` 對應表情圖）。
  * 右側：對話框（顯示完整提醒文案或最近 3 行對白）+ 時間標籤 + 「對話」快捷按鈕。
* **適用情境**：主畫面角色陪伴、即時閱讀提醒台詞與故事對白。

---

## 4. 表情動態切換機制 (Emotion Sprite Engine)

1. **情緒標籤讀取**：
   * 當角色訊息或提醒生成時，提取 `emotion` 屬性（如：`happy`, `sad`, `blush`, `angry`）。
2. **圖檔匹配與渲染**：
   * 讀取角色卡設定的 `emotions` / `spriteIds` 對照表，找到該情緒對應的圖片檔。
   * Native `AppWidgetProvider` 讀取該圖片解碼為 `Bitmap` 並填入 `RemoteViews.setImageViewBitmap()`。
3. **預設降級**：
   * 若無對應表情圖片，自動降級顯示角色卡的主圖片 (`avatar`)。

---

## 5. 原生元件與檔案結構

### 5.1 Android 原生層
* `android/app/src/main/java/tw/nori9/dest/widget/DeSTAppWidgetProvider.java`
  * 繼承 `AppWidgetProvider`，處理小工具生命週期與廣播更新。
* `android/app/src/main/res/layout/widget_dest_character_small.xml` (2x2)
* `android/app/src/main/res/layout/widget_dest_character_large.xml` (4x2)
* `android/app/src/main/res/xml/dest_appwidget_info.xml` (小工具元數據定義)

### 5.2 前端 / Bridge 層
* `src/mobile/runtime/widgetSync.ts`
  * 前端收到新對話或觸發提醒時，呼叫 Native Bridge 同步最新快照至 Android `SharedPreferences` 並引發小工具刷新。

---

## 6. 接手 AI 實作步驟順序

1. **第一步（Android 小工具版面設計）**：
   在 `android/app/src/main/res/layout/` 建立 2x2 與 4x2 小工具 XML 佈局。
2. **第二步（AppWidgetProvider 與表情圖片載入）**：
   撰寫 `DeSTAppWidgetProvider.java`，實作 `Bitmap` 解碼與 `emotions` 表情圖片替換邏輯。
3. **第三步（AndroidManifest 註冊）**：
   在 `AndroidManifest.xml` 中註冊 `DeSTAppWidgetProvider` 與小工具 receiver。
4. **第四步（Bridge 與數據同步）**：
   在 `src/mobile/runtime/` 新增 `widgetSync.ts`，在聊天發話與提醒觸發點連動更新小工具快照。
5. **第五步（真機測試）**：
   在 Pixel 10a 實機將小工具新增至 Android 主畫面，測試發送訊息/提醒時角色圖片與情緒表情的動態刷新。
