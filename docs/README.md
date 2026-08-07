# docs/ — 文件索引（必讀／選讀）

> 給接手 AI 與人類維護者。**新對話不要整包讀完 docs/**。
> 每次對話預設只讀 repo 根目錄的 [`CLAUDE.md`](../CLAUDE.md)。

---

## A. 每次對話必讀（已濃縮進 CLAUDE.md）

| 檔 | 說明 |
|---|---|
| [`../CLAUDE.md`](../CLAUDE.md) | **唯一預設必讀**：硬規則、現況、進行中的坑、依任務選讀表 |
| [`../AGENTS.md`](../AGENTS.md) | 薄轉址，內容以 CLAUDE.md 為準（避免兩份漂移吃 Token） |

---

## B. 依任務選讀（開對應段落即可）

| 檔 | 何時讀 | 怎麼讀 |
|---|---|---|
| [`b3-mobile-ui-plan.md`](b3-mobile-ui-plan.md) | 做 B3 手機 UI | 文首＋§4.9；再只開當下階段／落地筆記 |
| [`mobile-html-feature-inventory.md`](mobile-html-feature-inventory.md) | 對照還缺哪些功能 | §6 勾選清單、§7 缺口總表 |
| [`multi-device-platform-roadmap.md`](multi-device-platform-roadmap.md) | 提案架構／散布／同步 | **§2、§8**；必要時 §4.5–4.7。勿整份 |
| [`DesktopST-Spec.md`](../DesktopST-Spec.md) | 實作某規格功能 | **對應章節**，勿整本 |
| [`progress-log.md`](progress-log.md) | 查舊決策／已知坑 | **Grep 關鍵字**，勿整份 |
| [`future-lorebook.md`](future-lorebook.md) | Lorebook 規格細節 | 整份可讀（不長） |
| [`future-nutrition-module.md`](future-nutrition-module.md) | 飲食熱量模組 B9（含換機搬家包） | 開工該模組時整份讀 |
| [`news-reader-mobile-plan.md`](news-reader-mobile-plan.md) | B3 階段 6 個人新聞報 | 開工階段 6 時 |
| [`news-article-context-design.md`](news-article-context-design.md) | 新聞進 prompt 上下文補強（摘要／全文） | 實作該功能前 |
| [`../scripts/README-mobile-stub.md`](../scripts/README-mobile-stub.md) | 假 mobileServer 驗證 | 驗手機 API 時 |
| [`../tests/README.md`](../tests/README.md) | vitest 範圍與快照 | 寫／改 core 測試時 |

---

## C. 背景／歷史（幾乎不必主動讀）

| 檔 | 備註 |
|---|---|
| [`pre-b3-work-assessment.md`](pre-b3-work-assessment.md) | B3 開工前評估；B2.x 已完成，**勿當現況** |
| [`b3-android-architecture-review-2026-08-05.md`](b3-android-architecture-review-2026-08-05.md) | 一次性架構檢視紀錄 |
| [`module-system-roadmap.md`](module-system-roadmap.md)／[`module-host-next-step.md`](module-host-next-step.md) | 模組宿主；動模組系統時再查 |
| [`remote-control-plan.md`](remote-control-plan.md)／[`remote-control-module-refactor.md`](remote-control-module-refactor.md) | 遙控；B6 前相關 |
| [`news-module-*.md`](news-module-design.md)、[`news-feed-spec.md`](news-feed-spec.md)、[`news-conversation-search-spec.md`](news-conversation-search-spec.md)、[`weather-realtime-query-spec.md`](weather-realtime-query-spec.md) | 新聞／天氣已實作規格；改行為時對照 |
| [`news-future-*.md`](news-future-keyword-groups.md) | **構想／未定案**，勿當待辦強制實作 |
| [`future-character-impression.md`](future-character-impression.md) | B8，完全延後 |
| [`future-nutrition-module.md`](future-nutrition-module.md) | **B9 飲食熱量模組（已定案待辦）**；換機匯出匯入見該檔 §5。開工前讀；勿與 B3 搶主線 |
| [`bubble-layer-state-machine.md`](bubble-layer-state-machine.md) | 桌面泡泡層 |
| [`performance-optimization-review-2026-05-30.md`](performance-optimization-review-2026-05-30.md) | 舊效能筆記 |
| `*-setup.html`／`license.html`／`api-key-guide.html` | 給使用者的教學頁，不是 AI 開工讀物 |

---

## D. 維護約定

- **進度標題／下一步**只更新 `CLAUDE.md`（與必要時 b3 計畫文首、§4.9）。
- 長篇踩坑與取捨追加到 `progress-log.md` 或 b3 計畫對應 §4.xx，**不要塞回 CLAUDE.md**。
- 若 CLAUDE.md 又膨脹到難以一次讀完：先把「已不會再踩的坑」搬進 progress-log。
