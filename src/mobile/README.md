# `src/mobile/` — 手機獨立版（Capacitor）

> 狀態：**骨架**。B2 只放了設定與這份說明，實作在 B3–B5。
> 規劃見 `docs/multi-device-platform-roadmap.md` §4.2 / §4.5 / §11。

## 這一層是什麼

`src/core/` 的平台外殼，對應 `src/main/`（Electron 那一側）。

```
src/core/     純 TypeScript，業務邏輯只有這一份
src/main/     Electron adapter  ← 已有
src/mobile/   Capacitor adapter ← 這裡
```

**業務邏輯不寫在這裡。** 這層只負責把平台 API 包成 `core/adapters/` 的介面形狀。
若發現有邏輯非寫在這裡不可，那表示 `core/` 的某個東西沒抽乾淨——去修 core，不要在這裡補。

## 五個 adapter 要對到什麼

`src/main/adapters/` 是已經寫好的參考實作，逐一對照即可。

| 介面 | Electron（已實作） | Capacitor 對應 | 需要的套件 |
|---|---|---|---|
| `StorageAdapter` | `fs` | Filesystem | `@capacitor/filesystem` |
| `SecretAdapter` | `safeStorage`（DPAPI） | Android Keystore | 需選一個安全儲存外掛 |
| `HttpAdapter` | Node `fetch` | `CapacitorHttp`（繞過 CORS） | `@capacitor/core` 內建 |
| `SchedulerAdapter` | `setTimeout` ＋ `powerMonitor` | AlarmManager | `@capacitor/local-notifications` 或自訂外掛 |
| `NotifierAdapter` | `Notification` | Local Notifications | `@capacitor/local-notifications` |

上述外掛**尚未安裝**——刻意的，避免裝了一堆沒有呼叫端的相依。實作到哪個裝哪個。

### 兩個已知的坑

1. **`HttpAdapter.supportsStreaming` 在這裡要回 `false`**。
   Capacitor 原生 HTTP 對 fetch streaming 支援不佳（roadmap §4.3）。
   呼叫端已經被要求先問這個旗標，所以回 false 是正常路徑、不是降級失敗。

2. **`SyncStorageAdapter` 不要實作**。Filesystem plugin 只有非同步 API。
   那個同步介面純粹是給桌面既有路徑沿用的，手機端不該有。

## 尚未做、需要時再做的事

- `npx cap add android`：會生成 `android/` 原生專案。目前**刻意沒生成**，
  因為還沒有 `webDir` 可同步，且生成的樹會在無人建置的情況下逐漸過時。
  等 B3 的手機 UI 能 build 出 `out/mobile` 再做。
- **簽章 keystore**：roadmap §10.5 列為「仍待確認」，由 owner 決定產生與保管方式。
  **不要自行產生一把。** 弄丟 keystore 等於所有使用者都無法升級（§11.3）。
