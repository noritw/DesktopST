# 即時氣象查詢 — 功能設計文件

> **狀態**：規劃中（待實作）
> **分類**：天氣擴充功能，位於設定 → 擴充 → 天氣資訊 → 進階

---

## 1. 功能定位

### 現有天氣注入（維持不變）

使用 Open-Meteo（免費、無需 API Key），定時取得當前溫度、濕度、天氣描述，
注入到「自動說話」或「提醒發話」的 system prompt。
屬於**背景式、主動推播**的上下文資訊。

### 本功能：即時氣象查詢

偵測使用者對話中出現的氣象關鍵詞，**在回應前**主動查詢中央氣象署 API，
將即時資料注入 prompt，讓角色能給出有據可查的回答。
屬於**被動式、對話觸發**的即時查詢。

| | 現有天氣注入 | 即時氣象查詢（本功能）|
|---|---|---|
| 資料來源 | Open-Meteo | 中央氣象署 Open Data |
| 觸發時機 | 自動說話、提醒 | 使用者對話含特定關鍵詞 |
| 查詢時機 | 定時快取（30 分鐘）| 對話發送當下即時查詢 |
| API Key | 不需要 | 需要（免費申請）|
| 資料類型 | 當前溫度、濕度 | 預報、地震、颱風 |

---

## 2. 觸發機制

### 2.1 關鍵詞分類

使用者訊息在送出前進行關鍵詞比對，命中才觸發查詢（不啟動 LLM 分類，避免額外延遲）。

#### 天氣預報類

```
明天、後天、大後天、這幾天
下雨、晴天、放晴、陰天、颳風、下雪
帶傘、雨衣、要穿幾件、穿短袖、穿長袖
幾度、溫度、熱嗎、冷嗎、變熱、變冷、熱不熱、冷不冷
天氣怎麼樣、天氣如何、天氣
```

觸發後查詢：**F-C0032-001**（縣市 36 小時天氣預報）

#### 地震類

```
地震、有感、搖晃、震了、剛剛抖了
地震幾級、震央、幾點的地震
```

觸發後查詢：**E-A0016-001**（顯著有感地震報告）

#### 颱風類

```
颱風、颱風來了、颱風警報、颱風假
有沒有颱風、颱風幾級、颱風路徑
```

觸發後查詢：**W-C0034-005**（颱風消息）

### 2.2 比對邏輯

- 優先順序：地震 > 颱風 > 天氣預報（一次只觸發一種）
- 單次對話只查詢一次，不重複觸發
- 若本功能未啟用（無 API Key 或 toggle 關閉），完全跳過，不影響正常對話流程

---

## 3. 資料來源：中央氣象署 Open Data

- **平台**：https://opendata.cwa.gov.tw/
- **授權**：免費使用，需註冊取得 API Key
- **Key 格式**：`CWA-XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX`
- **請求方式**：`GET https://opendata.cwa.gov.tw/api/v1/rest/datastore/{資料集ID}?Authorization={API_KEY}`

### 3.1 天氣預報

**資料集**：`F-C0032-001`（一般天氣預報，各縣市，36 小時）

**請求範例**：
```
GET /api/v1/rest/datastore/F-C0032-001
  ?Authorization={KEY}
  &locationName={縣市名稱}    ← 可選，不帶則回傳全台
  &elementName=Wx,PoP,MinT,MaxT
```

**取用欄位**：
- `Wx`：天氣現象（晴時多雲、陰天、雨天…）
- `PoP`：降雨機率（%）
- `MinT` / `MaxT`：最低 / 最高溫度（℃）

**注入格式範例**：
```
[即時查詢：天氣預報]
台北市今明天氣：今晚至明晨多雲，明天白天多雲時晴。
降雨機率：今晚 30%，明天白天 10%。
氣溫：18–26℃。
（資料來源：中央氣象署，{查詢時間}）
```

### 3.2 地震

**資料集**：`E-A0016-001`（顯著有感地震報告）

**請求範例**：
```
GET /api/v1/rest/datastore/E-A0016-001
  ?Authorization={KEY}
  &limit=1    ← 只取最近一筆
```

**取用欄位**：
- `EarthquakeNo`：地震編號
- `OriginTime`：發生時間
- `EpicenterLocation`：震央描述
- `EarthquakeMagnitude.MagnitudeValue`：規模
- `FocalDepth`：深度（km）
- 各縣市震度（Intensity）

**注入格式範例**：
```
[即時查詢：最近地震]
最近一次顯著有感地震（2026/06/05 14:32）
規模 M4.8，震央：台東縣近海，深度 15 km
台北市震度：2 級
（資料來源：中央氣象署）
```

若最近地震發生時間超過 6 小時，加上提示：「此地震發生於 {N} 小時前。」

### 3.3 颱風

**資料集**：`W-C0034-005`（颱風消息）

**請求範例**：
```
GET /api/v1/rest/datastore/W-C0034-005
  ?Authorization={KEY}
```

**取用邏輯**：
- 若目前無颱風：回傳空陣列或空資料，注入「目前無颱風警報」
- 若有颱風：取颱風名稱、現在位置、強度、預測路徑說明

**注入格式範例（有颱風）**：
```
[即時查詢：颱風消息]
目前有輕度颱風「○○」在台灣東南方海面，預計 48 小時後轉向。
（資料來源：中央氣象署）
```

**注入格式範例（無颱風）**：
```
[即時查詢：颱風消息]
目前西太平洋無颱風或熱帶低氣壓影響台灣。
（資料來源：中央氣象署）
```

---

## 4. 設定 UI 設計

位於：設定 → 擴充 → 天氣資訊 → 「設定」按鈕開啟的面板

在現有天氣設定內容下方新增進階區塊（預設收起）：

```
────────────────────────────────
▼ 即時氣象查詢（進階）
────────────────────────────────

[✓] 啟用即時氣象查詢
    偵測到「地震」「颱風」「明天天氣」等關鍵詞時，
    自動查詢中央氣象署取得即時資料。

中央氣象署 API Key
[CWA-XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX     ]
↗ 申請免費 API Key（開啟瀏覽器）

預設縣市（天氣預報用）
[台北市  ▾]   ← 下拉，選項為台灣 22 縣市
若未選，使用天氣設定的位置名稱（IP 偵測或手動輸入）

[測試連線]   ← 打一次 API 確認 Key 正確
```

啟用 toggle 在 API Key 填寫後才可開啟；
若 Key 欄位清空，toggle 自動關閉。

---

## 5. 資料結構

### 5.1 設定欄位（新增至 `WeatherSettings`）

```typescript
interface WeatherSettings {
  // 現有欄位（不變）
  enabled: boolean
  polish: boolean
  locationName: string
  latitude: number
  longitude: number
  locationSource: 'ip' | 'manual' | ''

  // 新增：即時氣象查詢
  realtimeQuery?: {
    enabled: boolean           // 功能開關
    cwaApiKey: string          // 中央氣象署 API Key（safeStorage 加密）
    forecastCounty: string     // 天氣預報縣市，空字串 = 用 locationName
  }
}
```

### 5.2 查詢結果型別（內部使用）

```typescript
type RealtimeQueryType = 'forecast' | 'earthquake' | 'typhoon'

interface RealtimeQueryResult {
  type: RealtimeQueryType
  injectionText: string   // 組好的 prompt 注入字串
  fetchedAt: Date
}
```

---

## 6. 實作計畫

### 新增檔案

- `src/main/cwaService.ts` — CWA API 查詢邏輯（三種資料集）

### 修改檔案

| 檔案 | 修改內容 |
|---|---|
| `src/main/types.ts` | `WeatherSettings.realtimeQuery` 欄位 |
| `src/renderer/src/types/index.ts` | 同上（前端型別同步） |
| `src/main/weatherService.ts` | `getRealtimeQueryContextString()` — 偵測觸發並呼叫 cwaService |
| `src/main/ipcHandlers.ts` | 在送出訊息前呼叫即時查詢；新增 `weather:test-cwa-key` IPC |
| `src/main/secureStore.ts` | `cwaApiKey` 加密存取（同現有 LLM API Key 模式） |
| `src/renderer/src/windows/SettingsWindow.tsx` | 天氣設定面板加入進階區塊 UI |

### 訊息流程（修改 ipcHandlers.ts）

```
chat:send-message 收到使用者訊息
  ↓
若 weather.realtimeQuery.enabled
  → detectQueryType(userMessage)   ← 關鍵詞比對，回傳 type | null
  → 若命中：cwaService.fetch(type) ← 非同步，timeout 5 秒
  → 組 injectionText 附入 ctxParts
  ↓
照原有流程送 LLM
```

---

## 7. 邊界條件

| 情境 | 處理方式 |
|---|---|
| API Key 無效 / 過期 | 靜默跳過，不注入，不影響對話；設定頁顯示最後一次測試狀態 |
| API 逾時（> 5 秒）| 靜默跳過 |
| 颱風 API 無颱風資料 | 注入「目前無颱風警報」文字 |
| 地震最近一筆超過 24 小時 | 仍注入，但加上「此資料為 {N} 小時前」說明 |
| 使用者在台灣境外 | 僅颱風 / 地震仍有意義；天氣預報縣市若未設定則跳過 |
| 功能未啟用 | 完全跳過，零效能影響 |

---

## 8. 不在本次範圍內

- Google News 或其他新聞搜尋（另案討論）
- 空氣品質 AQI 查詢
- 多日天氣預報（目前只取 36 小時）
- 自動偵測使用者提到的縣市名稱（第一版用固定預設縣市）
