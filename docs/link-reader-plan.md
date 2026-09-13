# 連結閱讀：貼網址讓角色讀內文（公開網頁版）

> 狀態：**已實作，桌面／手機獨立版／遙控三條路都接上，自動測試通過（34 項），
> 真機／實際使用尚未驗證**（2026-09-13）。
> 待驗清單見 §7。

---

## 1. 這是什麼

使用者在聊天訊息裡貼網址時，回應前先把那一頁抓回來、抽出正文，
注入 system context 讓角色「看過再回答」。

之前完全沒有這條路徑：訊息裡的 `https://…` 對模型來說只是一串字，
它會憑網址猜內容——而且講得很像真的。

---

## 2. 範圍：只做公開網頁

**需要登入才看得到的頁面一律讀不到，這是範圍不是 bug。**

抓取是從 Electron 主行程（Node `fetch`）／手機原生層（CapacitorHttp）發出的，
那裡沒有、也拿不到使用者瀏覽器的 cookie——Chrome 在 Windows 上還有
App-Bound Encryption 把 cookie 綁死，同一台電腦的其他程式也解不開。

而且社群站還有更前面一道障礙：X／Facebook／Instagram／Threads 都是 SPA，
HTML 原始碼裡幾乎沒有正文，**有沒有 cookie 都抽不到**。所以這些站
（`detect.ts` 的 `JS_RENDERED_HOSTS`）**連抓都不抓**，直接標成讀不到——
抓了只是白花一次網路往返，還會得到一個看不懂的失敗理由。

登入牆要支援的話有兩條路，都是獨立的大工程，**目前都沒做**：

| 路線 | 做法 | 代價 |
|---|---|---|
| A. Electron 內建瀏覽器 | 開 `BrowserWindow` 讓使用者在 DeST 裡登入一次，cookie 存 Electron 自己的 session partition，抓取改走 `net.fetch` 綁那個 session | 要再登入一次、session 會過期、反爬會擋、**手機完全沒有對應做法** |
| B. 瀏覽器擴充功能 | 在已登入的分頁按一下，把渲染後的內文送進 DeST | 體驗最好（拿得到 JS 渲染結果），但等於多維護一個產品 |

現成的替代路：新聞面板的「進對話內容」可以手動貼正文
（`cacheManualPromptContext`）。

---

## 3. 程式在哪

```
src/core/util/htmlFetch.ts   抓 HTML／抽正文／抽標題（與 news enrich 共用同一份）
src/core/link/detect.ts      從訊息抽網址、社群站與內網位址判定（純函式）
src/core/link/reader.ts      主流程：抓 → 抽 → 太長就濃縮 → 組 [Link] 注入
src/core/link/types.ts       LinkFetchStatus 等
src/core/link/moduleId.ts    desktopst.link-reader
src/main/linkReader.ts       桌面薄殼（綁 electronHttp）
```

掛入點三處，都只是加一行進既有的 context 陣列：

| 路徑 | 檔案 |
|---|---|
| 桌面（遙控模式也走這條） | `src/main/ipcHandlers.ts` 的 `sendMsgBody`，`extraContextParts` |
| 手機獨立版 | `src/mobile/runtime/chat.ts` 的 `extraContext` |

`htmlFetch.ts` 是從 `core/news/enrich.ts` 搬出來的——兩邊要的東西一模一樣
（同一組瀏覽器 UA、同一套 `<article>`／`<main>` 抽取），沒有理由抄第二份。
`enrich.ts` 仍 re-export `extractArticleText`，既有 import 不用改。

---

## 4. 四個刻意的設計

### 4.1 不花輔助模型判斷意圖

對話新聞搜尋要先打一次輔助模型問「這句是不是在問時事」；連結閱讀不需要，
**貼網址本身就是最明確的意圖**。所以一般聊天完全沒有額外成本——
訊息裡沒有 `http(s)://` 時 `getLinkContext()` 立刻回 `null`。

### 4.2 讀不到的連結也要進 prompt

少了這句，模型會照著網址裡的關鍵字掰出一篇它沒看過的文章。
所以失敗的連結一樣列進 `[Link]` 區塊，寫明原因，並附一句
「不要憑網址猜內容」。`tests/link/reader.test.ts` 有守這句話。

### 4.3 只有一個設定欄位

`AppSettings.linkReader.enabled`，其他（一次最多讀幾個、多長才濃縮）全是常數。

模組底下多一個子設定，就多一個 S2 M5 同步子集要記得補的欄位——
`weather.polish` 那次就是這樣漏掉的（CLAUDE.md §4）。開關本身走既有的
「模組開關」清單（`desktopst.link-reader`），那條路的同步與情境覆蓋早就通了，
不必另外接線。

### 4.4 內網位址不讀

`localhost`／`127.x`／`10.x`／`192.168.x`／`172.16-31.x`／`*.local` 一律跳過。
讀這些沒有意義，而且桌面版的 `mobileServer` 本身就跑在 localhost——
讓聊天訊息能指使主行程去打本機任意連接埠不是個好主意。

---

## 5. 常數（`reader.ts`／`detect.ts`）

| 常數 | 值 | 為什麼 |
|---|---|---|
| `MAX_LINKS_PER_MESSAGE` | 2 | 每個連結都是一次外部抓取＋可能一次輔助模型呼叫 |
| `FETCH_TIMEOUT_MS` | 8000 | 比照 news enrich |
| `MIN_ARTICLE_LEN` | 80（去空白） | 低於此視為沒抓到，再分登入牆／空頁 |
| `DIRECT_MAX_LEN` | 1500 | 不超過就直接進 prompt，不花輔助模型 |
| `SUMMARY_INPUT_MAX` | 12000 | 丟給輔助模型的正文上限，比照 news enrich |

---

## 6. 踩過／繞過的坑

- **網址正則不能無腦吃到空白為止**。`https://example.com/a，然後呢` 會把整句話
  吞進網址。但也不能只收 ASCII——`zh.wikipedia.org/zh-tw/臺北市` 這種貼上去
  就是沒編碼的中文。做法是**允許中文字、但中文標點一律當結束**，
  尾端再修一次西文標點；`)` 要看括號有沒有配對（維基網址本身就帶右括號）。
- **逾時一定要掛在 `signal` 上**。CapacitorHttp 忽略 `init.signal`，
  `mobile/adapters/httpAdapter.ts` 已經用 `Promise.race` 把 signal 翻成 reject，
  所以只有掛在 signal 上的逾時在手機上才真的有效（CLAUDE.md §5）。
- **`Promise.race` 的計時器要清掉**。race 先跑完之後留著的 12 秒 timer 會一直
  吊著事件迴圈。`news/enrich.ts` 的 `summarizeWithUtility` 還是舊寫法，
  下次動它時可以順手改。
- **輔助模型失敗不能讓整條路斷掉**：正文已經抓到了，退回截斷原文照樣有用。
- **斜線指令把網址剝壞了**（2026-09-13 owner 首次實測當場中）。`ipcHandlers.ts`
  的 `/news`／`/weather` 解析原本是無錨定的全域取代，`https://news.cnyes.com/news/id/…`
  被剝成 `https:/.cnyes.com/id/…`。**`[Link]` 區塊本身是對的**（抓取用的是未經剝除的
  `payload.content`），壞的是使用者訊息文字本身——所以角色看到一串壞網址，
  回「我看不懂這些網址」，看起來像模型太弱其實不是。已抽到
  `core/prompt/slashCommands.ts` 並加回歸測試。這也是為什麼 §7 的待驗清單
  建議先看 debug prompt 而不是只看角色講什麼。

---

## 7. 待驗清單（實際用過才算數）

- [ ] 桌面：貼一般新聞／部落格連結 → 角色講得出文章裡的具體內容
- [ ] 桌面：貼 X／Facebook 連結 → 角色直說打不開，**沒有**編造內容
- [ ] 桌面：貼需要登入的頁面 → 理由是「需要登入」而不是「讀取失敗」
- [ ] 桌面：一則訊息貼三個連結 → 只讀前兩個，不報錯
- [ ] 桌面：設定 → 擴充 → 連結閱讀關掉後，貼網址不再抓（可看 DevTools `[link-diag]`）
- [ ] 桌面：情境覆蓋設成「此情境關閉」時真的不抓
- [ ] 手機獨立版：同上前三條（`adb logcat | grep link-diag`）
- [ ] 手機遙控模式：走電腦那條，行為應與桌面一致
- [ ] 手機：設定 → 模組開關 → 「連結閱讀」開關會同步到電腦（S2 M5）
- [ ] 長文（>1500 字）確認有走輔助模型濃縮（`[link-diag] extracted` 後看是否打模型）

---

## 8. 之後可能要做的

- **PDF**：目前 `unsupported-type` 直接放棄。要做的話得引 pdf parser，桌面容易、手機麻煩。
- **YouTube**：現在歸在 `js-rendered`。字幕那條路**已實測不通，見 §9**；可行的降級版（官方 Data API 拿簡介）也在 §9.4。
- **快取**：同一個網址短時間內貼兩次會抓兩次。news enrich 有 4 小時快取可以比照。
- **登入牆**：見 §2 的 A／B 兩條路。

---

## 9. YouTube：實測結論與為什麼此路不通

> 2026-09-13 owner 問「YouTube 影片有辦法經由字幕檔去讀嗎」，當場在他自己的
> 電腦上實測完的結論。**這一節的重點是「不要再走一遍」**——這種「查過了、
> 此路不通、原因是這個」的結論不寫下來，半年後一定有人（包括 AI）重新推導一次。

### 9.1 實測結果

owner 家用網路、Windows、curl ＋ PowerShell，未登入：

| 步驟 | 結果 |
|---|---|
| 抓 `youtube.com/watch?v=…` | ✅ 1.24 MB，內容是 zh_TW 正常頁，**沒有同意頁也沒有 bot 檢查** |
| HTML 裡有沒有 `captionTracks` | ✅ 有 |
| 挖出 `baseUrl`（`api/timedtext?…`）去抓 | ❌ **HTTP 200，長度 0** |

**清單給你、內容不給。** 這是 PO Token（Proof of Origin）的典型症狀。

### 9.2 ⚠️ 這不是「沒登入」的問題

最容易誤判的一點，**而且會害人走錯方向去做 OAuth**。

PO Token 要的不是「你是誰」，是「你是不是真的瀏覽器裡真的播放器」——
是來源證明（attestation），不是身分憑證。證據就在上表：**未登入照樣抓得到
1.24 MB 的 watch 頁和完整的字幕清單**，被擋的只有最後那一步。

反過來也成立：**帶著完整登入 cookie 去打 timedtext，一樣回空的**，
因為還是沒有播放器現算出來的那個 token。

### 9.3 所以 OAuth 授權（像 Google 日曆那樣）也不行

兩層都不行：

1. OAuth 發的是身分憑證，換不出 PO Token——兩者解決的是不同問題。
2. 更硬的一層：官方 YouTube Data API 的 `captions.download`
   **只能下載自己擁有的影片**的字幕。這是 API 的權限範圍，不是申請 scope
   能解鎖的。對別人的影片本來就沒有字幕讀取權。

### 9.4 但同一趟查到一個更好的降級方案：`videos.list`

官方 Data API 的 `videos.list` 拿得到**完整的影片簡介**，而且**只要 API key，
不用 OAuth**：

```
GET https://www.googleapis.com/youtube/v3/videos
    ?part=snippet,contentDetails&id=<videoId>&key=<API_KEY>
```

比「抓 watch 頁挖 meta」全面更好：

| | 抓 watch 頁 | Data API |
|---|---|---|
| 流量 | **1.24 MB** | ~3 KB |
| 簡介 | `og:description` 只有截斷的 ~150 字 | 完整，結構化 |
| 穩定性 | regex 挖 HTML，改版就壞 | 官方合約 |
| 附帶 | 要自己挖 | 頻道、時長、上傳日期都有 |

配額 10,000 units/天，`videos.list` 一次 1 unit，實質無限。

**設計成選填**：填了 key 走 API，沒填退回抓 watch 頁的 og meta，
兩條都失敗才回報讀不到。理由是「要先去申請一把 key」會撞到
roadmap 目標④（新手三步上手），不能當必要條件。

⚠️ 做這個降級版時**一定要在注入文字裡明講「這是影片的說明文字，不是影片內容」**，
否則角色會照著簡介裝作看過影片——跟 §4.2「不要憑網址猜內容」是同一類問題。
另外影片簡介常常是一堆 hashtag、贊助連結、時間軸，要做雜訊判斷
（連結密度／有效句子數），太爛就照樣回報讀不到。

### 9.5 剩下的路，以及為什麼都不建議

| 路線 | 為什麼不做 |
|---|---|
| 模擬 InnerTube client（yt-dlp 在做的） | 要持續追 YouTube 改版＝長期維護負擔；yt-dlp 現在自己也得靠外掛跑 YouTube 的 JS 來算 PO Token，難度可想而知。也踩 ToS |
| 綁 yt-dlp 執行檔 | 桌面可行但要跟著更新、幾十 MB、防毒可能誤判；**手機完全不可能**，會撕開現在 `core/` 桌面手機共用的結構 |
| 付費第三方字幕 API | 對方自己養代理池扛對抗。撞 roadmap 目標②（不另付費）③（敏感資料不放第三方） |
| `youtube-transcript` 類 npm 套件 | 本質就是 §9.1 那套流程，所以**現在大多壞掉或時好時壞**，issue 區長期堆著 "returns empty"。教學文最多、看起來最簡單，但已經不 work |

### 9.6 為什麼瀏覽器裡的工具做得到（Comet／擴充功能那類）

因為它們**在播放器旁邊**。PO Token 是播放器在瀏覽器裡現算的簽章——
播放器自己當然有，它就是簽章的來源。從外面 curl 等於在沒有播放器的情況下
要求一個只有播放器簽得出來的東西。

順帶釐清這類工具的四種機制，判斷「某某 AI 怎麼做到的」時用得上：

| 機制 | 有沒有使用者 session | 讀得到登入頁？ | 例 |
|---|---|---|---|
| ① 自己就是瀏覽器（Chromium 分支） | ✅ 同一個 profile | ✅ | Comet、Dia、Edge Copilot |
| ② 瀏覽器擴充（content script） | ✅ 同一個分頁 | ✅ | 各種側邊欄助手 |
| ③ 遠端無頭瀏覽器 | ❌ | ❌ 只看得到登出版 | 多數「深度研究」後端 |
| ④ 操作電腦（截圖＋點擊） | ✅ 使用者的畫面 | ✅ | computer use 類 |

DeST 現在的位置比③還外面（連 JS 都不渲染）。§2 提的 A／B 兩條路
其實就是①和②的縮小版——而且 **B（瀏覽器擴充）同時是 YouTube 字幕唯一乾淨的解**，
因為擴充在頁面裡，播放器的字幕軌拿得到。

也就是說「讀登入牆」和「讀 YouTube」不是兩個需求，是同一個需求的兩個表現。
合併看的話 B 的性價比比單看登入牆時高——但代價沒變小：多一個要維護的產品、
Chrome Web Store 審查、**手機完全用不到**（撞「手機獨立版是一般使用者第一優先」）。
**要做之前先問 owner。**

### 9.7 Gemini 為什麼看起來做得到

因為 Google 自己就是 YouTube，後端直接拿得到轉錄稿，不必跟自家防爬機制搏鬥。
這是資料所有權的優勢，不是技術優勢，**別人複製不了，不要拿它當「所以應該做得到」的依據**。
