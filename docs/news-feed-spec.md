# 新聞 JSON 輸出規格(給新聞站方實作)

> 本文件是**資料契約**。新聞站(`news.nori.idv.tw`)需依此產出一份 JSON 檔,
> 供桌面寵物程式「DesktopST」定時抓取,讓角色用聊天口吻跟使用者分享新聞。
> 站方**只負責產出 JSON**,過濾 / 隨機挑選 / 角色口吻都由 DesktopST 端處理。

> ### 📌 定位說明(請先讀)
> DesktopST 的新聞模組支援**多種來源類型**,使用者可自由新增 / 刪除:
> - `keyword`:使用者輸入興趣關鍵字,程式自動組成 Google News RSS(一般使用者主力)
> - `rss`:使用者貼任意 RSS / Atom 網址(進階使用者)
> - `json`:**就是本文件定義的格式**(用於 `news.nori.idv.tw` 這類「自架聚合站」)
>
> 也就是說,**本站是「json 類來源之一」,不是整個模組的核心資料源。**
> 對 DesktopST 的一般使用者而言,本站預設可能不啟用;它主要服務作者本人與想自架聚合站的人。
> 站方只需專心把 `news.json` 產好即可,不必理會其他來源類型。

---

## 1. 你要做的事(一句話)

你現在已經有一個「自動產生的純閱覽頁」(HTML)。
**請用產生那個頁面的同一份資料,額外輸出一個 `news.json` 靜態檔。**
不需要做 API、不需要資料庫查詢、不需要登入驗證——就是每次更新新聞時,順手多寫一個 JSON 檔到網站根目錄。

---

## 2. 檔案位置與存取

| 項目 | 要求 |
|---|---|
| URL | `https://news.nori.idv.tw/news.json`(根目錄,固定路徑,不要帶日期) |
| 編碼 | **UTF-8(不含 BOM)** |
| Content-Type | `application/json; charset=utf-8` |
| 存取權限 | 公開可讀,**不需要驗證 / Cookie** |
| 更新方式 | 每次爬蟲更新新聞時一併覆寫此檔(覆寫,不要每次換檔名) |

> 抓取端是 Electron 主程序(Node.js `fetch`),不是瀏覽器,**所以不需要設定 CORS**。
> 但若你方便加上 `Access-Control-Allow-Origin: *` 也無妨,不影響。

---

## 3. JSON 結構

### 3.1 最外層

```json
{
  "version": 1,
  "generatedAt": "2026-06-03T08:02:00+08:00",
  "categories": ["遊戲開發", "AI", "Steam", "科技", "產業"],
  "items": [ /* 新聞物件陣列,見 3.2 */ ]
}
```

| 欄位 | 型別 | 必填 | 說明 |
|---|---|:--:|---|
| `version` | number | ✅ | 格式版本號,目前固定 `1`。未來改格式才 +1 |
| `generatedAt` | string | ✅ | 這份 JSON 的產生時間,ISO 8601 **含時區**(用 `+08:00`) |
| `categories` | string[] | ⬜ | 本次資料出現過的所有分類,供設定畫面列選項用。可省略 |
| `items` | object[] | ✅ | 新聞陣列,**最新的排前面**。建議上限 100 則 |

### 3.2 單則新聞物件(`items[]`)

```json
{
  "id": "gnn-20260603-abc123",
  "title": "某遊戲公司宣布新作開發中",
  "summary": "開發團隊在訪談中透露,新作將採用全新引擎,預計兩年內推出。",
  "source": "巴哈姆特 GNN",
  "category": "遊戲開發",
  "tags": ["遊戲開發", "引擎"],
  "url": "https://gnn.gamer.com.tw/detail.php?sn=xxxxx",
  "publishedAt": "2026-06-03T07:40:00+08:00",
  "image": "https://.../thumb.jpg"
}
```

| 欄位 | 型別 | 必填 | 說明 |
|---|---|:--:|---|
| `id` | string | ✅ | **全站唯一且穩定**的識別碼。⚠️ 見下方「id 規則」 |
| `title` | string | ✅ | 新聞標題,純文字(不要留 HTML 標籤) |
| `summary` | string | ✅ | 1–3 句摘要,純文字。沒有摘要時可放空字串 `""` |
| `source` | string | ✅ | 來源名稱,如 `"巴哈姆特 GNN"`、`"TechNews"` |
| `category` | string | ⬜ | 主分類(單一),對應 `categories` 其中一項 |
| `tags` | string[] | ⬜ | 關鍵字標籤,DesktopST 會用它做興趣比對。建議盡量提供 |
| `url` | string | ✅ | 原文連結,完整 `https://` 絕對網址 |
| `publishedAt` | string | ✅ | 新聞發布時間,ISO 8601 含時區。抓不到時退而用爬取時間 |
| `image` | string | ⬜ | 縮圖網址(完整絕對網址)。沒有就省略此欄,**不要放空字串** |

---

## 4. ⚠️ `id` 規則(最重要)

DesktopST 會記住「已經跟使用者聊過哪些新聞」,靠的就是 `id`。所以:

- **同一則新聞,每次輸出的 `id` 必須一樣**(穩定,不能每次重新編號)。
- **不同新聞的 `id` 不能重複**(唯一)。
- 建議組成:`來源前綴 + 原文唯一識別`,例如 `"gnn-{原站文章sn}"`、`"technews-{文章id}"`。
- 真的找不到原站 id 時,可用 `來源 + 原文URL 的 hash`(如 SHA1 前 8 碼)當 id——重點是**同一篇 URL 永遠算出同一個 id**。

> 反例:用流水號 `1, 2, 3...` 或用「在列表中的位置」當 id ❌
> 因為下次更新後位置會變,會被誤判成新新聞 → 角色重複聊同一則。

---

## 5. 文字內容注意事項

- `title` / `summary` 一律**純文字**:不要 HTML 標籤、不要 `&amp;` 之類的 HTML escape(請還原成 `&`)。
- 不要在文字裡塞來源名或時間(例如不要 `"【GNN】標題..."`),那些放對應欄位即可。
- 摘要請精簡,1–3 句即可,太長對 LLM 沒幫助也浪費。

---

## 6. 驗收方式(做完請自我檢查)

1. 瀏覽器直接開 `https://news.nori.idv.tw/news.json` 能看到 JSON,中文不亂碼。
2. 用任意 JSON 驗證器確認**格式合法**(no trailing comma、引號正確)。
3. 隨機抽一則檢查:`id`、`title`、`source`、`url`、`publishedAt` 五個必填欄位都有值。
4. **連續更新兩次**後,比對同一篇新聞的 `id` 是否維持不變(這條最關鍵)。
5. `generatedAt` 與 `publishedAt` 都帶 `+08:00` 時區。

---

## 7. 最小可用範例(可直接拿去當樣板)

```json
{
  "version": 1,
  "generatedAt": "2026-06-03T08:02:00+08:00",
  "categories": ["遊戲開發", "AI"],
  "items": [
    {
      "id": "technews-987654",
      "title": "新型 AI 模型在推理任務上超越前代",
      "summary": "研究團隊發表新模型,在數學與程式推理測試上有明顯進步。",
      "source": "TechNews",
      "category": "AI",
      "tags": ["AI", "模型"],
      "url": "https://technews.tw/2026/06/03/example/",
      "publishedAt": "2026-06-03T07:55:00+08:00"
    },
    {
      "id": "gnn-1234567",
      "title": "某獨立遊戲宣布登陸 Steam",
      "summary": "預計今年夏季推出,支援繁體中文。",
      "source": "巴哈姆特 GNN",
      "category": "遊戲開發",
      "tags": ["Steam", "獨立遊戲"],
      "url": "https://gnn.gamer.com.tw/detail.php?sn=1234567",
      "publishedAt": "2026-06-03T07:40:00+08:00"
    }
  ]
}
```

---

## 8. 之後若要支援多個輸出檔(選用,現在不用做)

未來 DesktopST 可能想分頻道抓(例如只抓遊戲類),屆時可再加
`news-game.json`、`news-tech.json` 等,格式與本文件完全相同。
**目前階段只要做好 `news.json` 一個即可。**
