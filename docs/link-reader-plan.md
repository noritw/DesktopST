# 連結閱讀：貼網址讓角色讀內文（公開網頁版）

> 狀態：**已實作並實測可用**（2026-09-13）。桌面／手機獨立版／遙控三條路都接上，
> 自動測試 50 項通過；一般網頁與 **YouTube 說明欄** owner 都已實測可讀。
> 少數次要項目仍未逐一驗（模組開關關閉、情境覆蓋、行動網路流量），清單見 §7。

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

> ⚠️ **上面這段有例外，2026-09-18 起。**
> 「SPA 抽不到正文」對**瀏覽器 UA** 成立，但這些站另外有一套給連結預覽用的
> 靜態輸出，換個 UA 就拿得到。**噗浪／Facebook／Threads 的單篇公開貼文
> 現在讀得到了**，見 §10。本節講的「登入牆讀不到」仍然完全成立且沒有改變
> ——§10 拿到的全是公開內容，不碰任何帳號。

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
src/core/link/youtube.ts     YouTube 影片說明欄（特例，§9）
src/core/link/social.ts      噗浪／FB／Threads 單篇公開貼文（特例，§10）
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

社群貼文另有一組（`social.ts`，§10）：

| 常數 | 值 | 為什麼 |
|---|---|---|
| `BODY_MAX` | 1500 | 主文進 prompt 的上限 |
| `MAX_REPLIES` / `REPLY_MAX` / `REPLIES_MAX` | 15／200／1200 | 噗浪熱門噗可以有好幾百則回應 |
| `RESPONSES_TIMEOUT_MS` | 6000 | 回應串是第二趟請求，拿不到就算了，不能拖累主文 |

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

- [x] 桌面：貼一般新聞／部落格連結 → 角色講得出文章裡的具體內容（2026-09-13 通過）
- [ ] 桌面：貼 X／Instagram 連結 → 角色直說打不開，**沒有**編造內容
      （⚠️ **Facebook／Threads／噗浪已經改成讀得到了**，社群貼文的待驗清單在 §10.6）
- [ ] 桌面：貼需要登入的頁面 → 理由是「需要登入」而不是「讀取失敗」
- [ ] 桌面：一則訊息貼三個連結 → 只讀前兩個，不報錯
- [ ] 桌面：設定 → 擴充 → 連結閱讀關掉後，貼網址不再抓（可看 DevTools `[link-diag]`）
- [ ] 桌面：情境覆蓋設成「此情境關閉」時真的不抓
- [x] 手機獨立版：基本讀取通過（2026-09-13，owner：「能讀的連結和桌面版差不多」）
- [ ] 手機遙控模式：走電腦那條，行為應與桌面一致
- [ ] 手機：設定 → 模組開關 → 「連結閱讀」開關會同步到電腦（S2 M5）
- [ ] 長文（>1500 字）確認有走輔助模型濃縮（`[link-diag] extracted` 後看是否打模型）
- [x] **YouTube**：貼一支影片 → 角色講得出標題／頻道／說明欄重點（2026-09-13 通過）
- [ ] **YouTube**：角色**沒有**談論畫面、對白、劇情細節（那句「你沒有看過這支影片」有生效）
- [ ] **YouTube**：說明欄只有連結與 hashtag 的頻道 → 角色說「沒有可用的說明文字」而不是唸 Patreon 連結
- [ ] **YouTube**：頻道頁／播放清單網址 → 仍然回報讀不到（不該走影片路徑）
- [ ] **YouTube 流量**：手機行動網路貼一支影片，確認沒有吃掉 1.2 MB（Range 有生效；YouTube 若不理 Range 仍會是整份，這條只是想知道實際狀況）

---

## 8. 之後可能要做的

- **PDF**：目前 `unsupported-type` 直接放棄。要做的話得引 pdf parser，桌面容易、手機麻煩。
- **YouTube**：說明欄版**已實作**（見 §9.8）。字幕那條路**已實測不通，見 §9**。官方 Data API 版（§9.4）刻意延後，理由見 §9.8。
- **快取**：同一個網址短時間內貼兩次會抓兩次。news enrich 有 4 小時快取可以比照。
- **登入牆**：見 §2 的 A／B 兩條路。公開的社群貼文**不需要走這兩條**，已用免登入的
  預覽端點做掉（§10）；還是只有真正要登入的頁面（私密社團、個人動態消息）才需要。
- **社群熱門話題來源**：見 §10.5，是另一個題目。

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

### 9.8 實際做了哪一版（2026-09-13）

**做了：watch 頁的靜態 meta 版**（`core/link/youtube.ts`）。零設定、零新依賴，
桌面與手機同一份。

- 影片 id 認得 `watch?v=`／`youtu.be/`／`shorts/`／`live/`／`embed/`；
  非影片網址（頻道頁、播放清單）回 `null`，照樣落回 `js-rendered` 說讀不到
- 說明欄優先挖 `ytInitialPlayerResponse` 的 `videoDetails.shortDescription`
  （**完整**），挖不到才退 `og:description`（YouTube 會截到 ~150 字）
- **只抓開頭 256 KB**（`Range` header）。watch 頁 1.2 MB 以上，手機用行動網路
  貼一支就吃掉 1.2 MB、送訊息前多等好幾秒。YouTube 不理 Range 時會回整份 200，
  照原樣處理，不會壞
- 雜訊判斷（`looksLikeJunkDescription`）：去掉網址與 hashtag 後不足 60 字就
  判定沒有可用說明——只保留標題，不要讓角色冒出「我看到你有 Patreon」
- 注入時**一定**附上「這是說明欄不是影片內容，你沒有看過這支影片」

**刻意沒做：Data API 版（§9.4）。**

不是因為不好——它 3 KB 對 1.24 MB、官方合約、拿得到時長與上傳日期，各方面都更好。
是因為它要存一把 API key，而金鑰欄位得動 `core/store/settings.ts` 的
hydrate／persist 加解密路徑和 `mobile/runtime/session.ts` 的保險絲——**就是
2026-08-13「獨立版的 API Key 不見了」那段程式**（CLAUDE.md §5 有整段說明）。
那個風險不該跟一個還沒真機驗過的新功能綁在一起。

要補的話，順序是：先讓說明欄版跑一陣子確認有用 → 再單獨開一次金鑰欄位，
並且**一次只動這一件事**，方便出事時定位。`settingsSnapshot.ts` 的同步子集
**永遠不放金鑰**，這條沒有例外。

---

## 10. 社群貼文：噗浪／Facebook／Threads（2026-09-18 實作）

### 10.1 §2 那個「社群站一律讀不到」的結論，只對了一半

§2 當時寫「X／Facebook／Instagram／Threads 都是 SPA，HTML 原始碼裡幾乎沒有
正文，**有沒有 cookie 都抽不到**」。前半句是對的，但它推出的結論太早了：

**空殼是因為我們送的是瀏覽器 UA。** 這些站另外準備了一套給第三方做連結預覽
與嵌入的靜態輸出（就是你貼連結到 Discord／LINE 時對方伺服器抓的那個），
只要 UA 不像瀏覽器就會吐出來。實測：

| 網址 | 瀏覽器 UA | 非瀏覽器 UA |
|---|---|---|
| FB 貼文頁 | **HTTP 400** | 200 ＋ `og:*` |
| FB `plugins/post.php` | **HTTP 400** | 200 ＋ 全文 |
| Threads 貼文頁 | 275 KB 空殼、`<title>Threads` | 200 ＋ `og:*` |
| 噗浪貼文頁 | 正常（本來就是 SSR） | 正常 |

**不需要冒充 `facebookexternalhit`**——實測連 `curl/8.4.0` 都拿得到，
所以用具名的 `DesktopSTBot/1.0 (+https://nori.tw/DeST/)`
（`core/util/htmlFetch.ts` 的 `SOCIAL_BOT_USER_AGENT`）。用具名的比較誠實，
對方要擋也擋得掉。

⚠️ **這跟登入牆是兩件事，不要混。** §2 講的「需要登入才看得到的頁面讀不到」
仍然成立且沒有改變——這裡拿到的全是**公開**內容，走的是免登入、不帶 cookie、
與使用者帳號完全無關的端點。**沒有任何一條路會碰到使用者的社群帳號**，
所以不存在「機器人被 Ban」的問題（owner 最初的顧慮就是這個）。

### 10.2 四種來源拿得到的東西差很多

| 來源 | 主文 | 回應串 | 靠什麼 |
|---|---|---|---|
| **噗浪** | 全文 | ✅ **整串** | 頁面是 SSR ＋ `POST /Responses/get` |
| **FB 粉專／個人公開貼文** | **全文** | ✗ | `plugins/post.php` 官方嵌入 |
| **FB 社團貼文** | ⚠️ **只有 ~190 字摘要** | ✗ | `og:description` |
| **Threads** | 全文 | ✗ | `/embed` ＋ `og:description` 後備 |

四家都支援**兩種網址形式**：正規網址，以及 App 裡「複製連結」給的短網址
（`/share/…`，要先解析，見 §10.3）。


**FB 社團為什麼只有摘要**：`plugins/post.php` 對社團貼文會回一段
「貼文已無法取得」而不是 HTTP 錯誤（社團不支援嵌入），所以只剩 og 那條，
而 og 是給預覽用的、~190 字就以 `...` 結尾。實測確認**全文沒有藏在頁面裡**
（把 357 KB 整份 decode 後搜過，那段文字只出現 2 次，都是同一個截斷版的 meta）。
`mbasic.facebook.com`／`m.facebook.com` 一律踢到 `login.php`，也沒用。

因此 `readOgExcerpt()` 回傳的 `sourceKind` 一律是 **`social-excerpt`**，
`buildLinkInjection()` 會加一句「這只是開頭預覽、不是全文」。
**這句是防止角色把腰斬的貼文當全文認真討論的唯一保險，跟 YouTube 那句
「你沒有看過這支影片」是同一個機制，不要拿掉。**

### 10.3 三個實作上的坑

- **⚠️ Threads 嵌入頁不可以拿第一個 `TextContentContainer`**（最難發現的一個）。
  貼文是回覆時，嵌入頁會**先畫被回覆的母貼文**再畫目標貼文，兩個 class 都含
  `TextContentContainer`。拿第一個的結果是「讀一則貼文卻拿回另一個人的貼文」
  ——`status` 是 ok、長度正常、看起來完全成功，只有內容整個不對。
  目標貼文的 class 多一個 `Full`（`TextContentContainerFull`），用它認。
  母貼文照樣抽出來當前情提要（回覆脫離上文常常等於沒有資訊）。
- **正文容器要配對 div 深度，不能用非貪婪比對**。FB 的 `post_message` 裡面有
  `text_exposed_root`，噗浪的 `text_holder` 裡面有圖片區塊；
  `<div[^>]*>([\s\S]*?)<\/div>` 會停在第一個 `</div>`，正文被腰斬一半，
  而且斬得很漂亮、長度檢查照樣會過。`sliceBalancedDiv()` 負責這件事。
- **行內標籤要整個拿掉、不留空白**。`stripTags()` 把每個標籤換成一個空格，
  對段落標籤是對的，對行內標籤卻會在句子中間戳出空格——FB 把每個 hashtag
  包在自己的 `<span>` 裡，於是「#以色列的模式無疑是最具啟發性的。」會變成
  「 #以色列的模式無疑是最具啟發性的 。」，標點跟字分家，像壞掉的 OCR。
  另外 `decodeHtmlEntities()` 一定要處理**數值實體**：這三家把中文與 emoji
  整片寫成 `&#x4e2d;`，不解的話抽出來的「正文」是一長串 `&#x...;`，
  長度檢查照樣會過然後原樣進 prompt。

- **⚠️ 手機端：Capacitor 的 fetch patch 會弄丟 GET 的自訂 `User-Agent`**
  （2026-09-18 Pixel 10a 實測，這條是整個功能在手機上唯一的阻礙）。
  `native-bridge.js` 對 **GET 與非 GET 走兩條完全不同的路**：非 GET 直接進原生
  `CapacitorHttp` plugin、headers 原樣送出；GET 卻改寫成 proxy 網址、交回
  WebView 自己的 fetch，而 Android WebView 會把 `User-Agent` 拔掉
  （Chromium bug 40450316）。Capacitor 把 UA 抄到 `x-cap-user-agent` 再由
  `WebViewLocalServer` 還原，**但實機上這條還原沒有生效**。
  **症狀非常容易誤判**：桌面完全正常、手機上「噗浪成功、FB／Threads 失敗」
  ——看起來像手機沒吃到新程式，其實程式有跑，只是 UA 被換成 WebView 自己的
  瀏覽器 UA，FB 回 HTTP 400、Threads 回空殼。
  修法：`mobile/adapters/httpAdapter.ts` 的 `shouldUseNativeFetch()`——UA 等於
  `SOCIAL_BOT_USER_AGENT` 時改直接呼叫原生 `CapacitorHttp.request()`
  （那正是 POST 走的路，而噗浪回應串是 POST、實機本來就通，等於已驗證過）。
  **不要放寬成「有 UA 就走原生」**：`fetchHtmlDoc` 對每個請求都設 UA，
  放寬等於把新聞抓取與一般連結閱讀整批改道，那些本來就是好的
  （`tests/mobile/socialUserAgentRouting.test.ts` 守這條）。

- **⚠️ 「複製連結」給的是短網址，正規形式的判定會全部漏掉**
  （2026-09-18 owner 實測當場中）。在 App 裡點「複製連結」，
  Threads 給 `threads.com/share/<code>`、FB 給 `facebook.com/share/p/<code>`，
  **兩家都不是** `/@user/post/<code>` 那種正規形式——只認正規形式的話，
  **使用者最常用的那條路剛好全部讀不到**，而且症狀就是普通的「讀不到」，
  完全看不出是網址格式沒認。
  短網址是 302 轉正規網址，但 `/embed` 與 `plugins/post.php` **都不吃短網址**
  （前者 404、後者回「貼文已無法取得」），一定要先解析。
  解析方式**不是讀 `Location`**（`fetchHtmlDoc` 只回內文，手機那條路也不見得
  交得出最終網址），而是抓跟隨重導後那一頁、從 **`og:url`** 反推
  （`canonicalFromSharePage()`）——那一頁本來就要抓（解析失敗時的摘要後備靠它），
  等於沒有多花請求。
  ⚠️ **FB 不能直接拿 `og:url` 當正規網址**：它給的是
  `/<ownerId>/posts/<一長串中文 slug>/<storyId>/`，那個形式丟進嵌入端點會被拒，
  只有 `permalink.php?story_fbid=…&id=…` 吃——所以要從 og:url 把兩個數字 id
  挖出來自己組。`story.php` 跟 `permalink.php` 是同一組參數的兩種寫法，
  `parseSocialLink` 直接正規化成後者。

### 10.4 脆弱度分級（壞掉時先看這裡）

FB／Threads 走的是 Meta **對外公開的**預覽與嵌入端點，相對穩定。
噗浪的 `POST /Responses/get` 是**它網站自己的 AJAX 端點、不是官方 API**，
沒有相容性承諾，改版壞掉的機率最高——所以它失敗時只是少了回應串，
主文照樣回得出來，不可以讓整條路斷掉（有測試守）。

Meta 那邊真的改了的話，症狀會是「安靜地退回摘要」或「讀不到」。
診斷方法：看 `[social-diag]` 的 `fb-embed-fallback-og`／`threads-embed-fallback-og`
有沒有開始一直出現。

### 10.5 刻意沒做

- **熱門話題來源**。這條做的是「貼網址讀單篇」，不是「找出現在在紅什麼」。
  噗浪有個免登入的公開端點 `https://www.plurk.com/Stats/topReplurks`
  直接回熱門噗 JSON，真要做的話那是最低成本的入口；Threads 得去建 Meta App
  走 keyword search（2200 次／24h），FB 沒有。**這是另一個題目，先問 owner。**
- **FB／Threads 的回應串**。兩家都沒有免登入的公開端點。
- **X／Instagram／TikTok**。沒測過，不要假設同一招通用。

### 10.6 待驗清單（真機／實際使用才算數）

**2026-09-18 已在 Pixel 10a 真機驗證通過**（透過 adb 實際在聊天裡送出連結）：

- [x] 手機獨立版：**FB 粉專貼文** → 角色講得出 188 字摘要**之後**的內容
      （「支持系統、能自己選」「把高壓軍隊當職訓場」都在後半段）→ 官方嵌入的全文路徑有效
- [x] 手機獨立版：**Threads 回覆貼文** → 角色談的是**目標貼文**（紅太陽紅茶要藍勾勾），
      同時用上了母貼文脈絡（祖克柏）→ `TextContentContainerFull` 的修正有效
- [x] 手機獨立版：**噗浪** → 主文＋整串回應（角色主動說「四則回應都在」）
- [x] 手機端走 CapacitorHttp 的 POST（噗浪回應串）確實送得出去
- [x] 手機獨立版：**Threads「複製連結」短網址** `/share/<code>` → 讀得到全文
- [x] 手機獨立版：**FB「複製連結」短網址** `/share/p/<code>` → 讀得到全文

剩下的：

- [ ] 桌面：貼噗浪連結 → 角色講得出主文**與回應串**裡的內容
- [ ] 桌面：貼 FB 粉專長貼文 → 角色講得出 190 字**之後**的內容（證明嵌入那條有生效）
- [ ] 桌面：貼 FB 社團貼文 → 角色**明講自己只看到開頭**，沒有硬下總結
- [ ] 桌面：貼 Threads 回覆貼文 → 角色談的是**你貼的那一則**，不是母貼文
- [ ] 桌面：貼私密社團／限定對象貼文 → 誠實回報讀不到，沒有編造
- [ ] 桌面：貼社群**個人頁／社團首頁**（非單篇） → 仍回報讀不到（不該走貼文路徑）
- [ ] 手機獨立版：四種來源各試一次，行為與桌面一致
- [ ] 手機：確認 CapacitorHttp 那條路的 POST（噗浪回應）真的送得出去
      ——桌面走 Node fetch，手機走原生橋接，**這是兩條不同的路**
- [ ] 模組開關關掉後不再抓（`desktopst.link-reader`，沿用既有開關）
