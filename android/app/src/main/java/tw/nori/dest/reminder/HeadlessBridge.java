package tw.nori.dest.reminder;

import android.content.Context;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * headless WebView 用的原生介面（`window.DestHeadless`）。
 *
 * 為什麼需要這一層：headless WebView **沒有 Capacitor Bridge**，
 * 拿不到 Filesystem／SecureStorage／CapacitorHttp 那些外掛。
 * 所以這裡把「檔案、金鑰、HTTP」三件事補回去，JS 端再包成
 * `core/adapters` 的介面形狀（`src/mobile/headless/bridgeAdapters.ts`）——
 * 這樣既有的 `reminderSpeak.ts`／`chat.ts` 完全不必改就能在 headless 跑。
 *
 * 檔案根目錄用 `context.getFilesDir()`，與 `@capacitor/filesystem` 的
 * `Directory.Data` 是**同一個目錄**（實測 plugin 原始碼：DATA → filesDir）。
 * 不一致的話 headless 會讀到一個空的資料夾，然後安靜地什麼都提醒不了。
 *
 * ⚠️ 這些方法跑在 WebView 的 binder thread，不是 UI thread。
 * 檔案讀寫都很小（settings／單則對話），同步做沒問題；
 * **HTTP 一定要非同步**，否則會把 JS 執行緒卡住直到逾時。
 */
public class HeadlessBridge {

  private static final String TAG = "ReminderAlarm";

  public interface Callback {
    /** JS 端跑完了。`resultJson` 見 `src/mobile/headless/reminderHeadless.ts` 的 HeadlessResult。 */
    void onComplete(String resultJson);

    /** 把一段 JS 丟回 WebView 執行（HTTP 回呼用）。 */
    void evaluate(String js);
  }

  private final Context context;
  private final Callback callback;
  private final ExecutorService http = Executors.newFixedThreadPool(2);

  public HeadlessBridge(Context context, Callback callback) {
    this.context = context.getApplicationContext();
    this.callback = callback;
  }

  public void shutdown() {
    http.shutdownNow();
  }

  // ── 檔案 ────────────────────────────────────────────────

  @JavascriptInterface
  public String readFile(String path) {
    File f = resolve(path);
    if (f == null || !f.isFile()) return null;
    try (FileInputStream in = new FileInputStream(f)) {
      return new String(readAll(in), StandardCharsets.UTF_8);
    } catch (Exception e) {
      Log.w(TAG, "headless readFile 失敗 " + path + ": " + e.getMessage());
      return null;
    }
  }

  @JavascriptInterface
  public String readFileBase64(String path) {
    File f = resolve(path);
    if (f == null || !f.isFile()) return null;
    try (FileInputStream in = new FileInputStream(f)) {
      return Base64.encodeToString(readAll(in), Base64.NO_WRAP);
    } catch (Exception e) {
      return null;
    }
  }

  @JavascriptInterface
  public boolean writeFile(String path, String data) {
    File f = resolve(path);
    if (f == null) return false;
    try {
      File parent = f.getParentFile();
      if (parent != null && !parent.exists() && !parent.mkdirs()) return false;
      try (OutputStream out = new FileOutputStream(f)) {
        out.write(data.getBytes(StandardCharsets.UTF_8));
      }
      return true;
    } catch (Exception e) {
      Log.w(TAG, "headless writeFile 失敗 " + path + ": " + e.getMessage());
      return false;
    }
  }

  @JavascriptInterface
  public boolean exists(String path) {
    File f = resolve(path);
    return f != null && f.exists();
  }

  /** 回傳 JSON 陣列字串（檔名，不含路徑）。 */
  @JavascriptInterface
  public String listDir(String path) {
    File f = resolve(path == null || path.isEmpty() || ".".equals(path) ? "" : path);
    JSONArray arr = new JSONArray();
    if (f != null && f.isDirectory()) {
      String[] names = f.list();
      if (names != null) {
        for (String n : names) arr.put(n);
      }
    }
    return arr.toString();
  }

  // ── 金鑰 ────────────────────────────────────────────────

  /**
   * base64 的 master key，用來解開 settings.json 裡的 API Key。
   * 拿不到時回 null——JS 端會退回「用快取台詞」，不會整個崩掉。
   */
  @JavascriptInterface
  public String masterKey() {
    return SecureStoreReader.masterKeyBase64(context);
  }

  // ── HTTP ────────────────────────────────────────────────

  /**
   * 非同步 HTTP。完成時呼叫 `window.__destHeadlessHttp(callbackId, responseJson)`。
   *
   * 為什麼不讓 JS 直接 `fetch`：headless WebView 載的是 `file://`，
   * origin 是 null，打 LLM API 會被 CORS 擋掉——這也正是前景要 CapacitorHttp 的原因。
   */
  @JavascriptInterface
  public void httpRequest(String requestJson, String callbackId) {
    http.execute(() -> {
      JSONObject res = new JSONObject();
      HttpURLConnection conn = null;
      try {
        JSONObject req = new JSONObject(requestJson);
        URL url = new URL(req.getString("url"));
        conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod(req.optString("method", "GET"));
        conn.setConnectTimeout(req.optInt("connectTimeoutMs", 15000));
        conn.setReadTimeout(req.optInt("readTimeoutMs", 60000));

        JSONObject headers = req.optJSONObject("headers");
        if (headers != null) {
          for (Iterator<String> it = headers.keys(); it.hasNext(); ) {
            String k = it.next();
            conn.setRequestProperty(k, headers.getString(k));
          }
        }

        String body = req.optString("body", null);
        if (body != null && !body.isEmpty()) {
          conn.setDoOutput(true);
          try (OutputStream out = conn.getOutputStream()) {
            out.write(body.getBytes(StandardCharsets.UTF_8));
          }
        }

        int status = conn.getResponseCode();
        InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
        String text = in == null ? "" : new String(readAll(in), StandardCharsets.UTF_8);

        res.put("ok", true);
        res.put("status", status);
        res.put("body", text);
      } catch (Exception e) {
        try {
          res.put("ok", false);
          res.put("error", e.getMessage() == null ? e.toString() : e.getMessage());
        } catch (Exception ignored) {
          // JSONException 在這裡不可能發生
        }
      } finally {
        if (conn != null) conn.disconnect();
      }

      callback.evaluate(
        "window.__destHeadlessHttp && window.__destHeadlessHttp(" +
        JSONObject.quote(callbackId) +
        "," +
        JSONObject.quote(res.toString()) +
        ")"
      );
    });
  }

  // ── 收尾 ────────────────────────────────────────────────

  @JavascriptInterface
  public void complete(String resultJson) {
    callback.onComplete(resultJson);
  }

  @JavascriptInterface
  public void log(String message) {
    Log.i(TAG, "[headless] " + message);
  }

  // ── 內部 ────────────────────────────────────────────────

  /**
   * 相對 key → 檔案。
   *
   * key 的規則見 `core/adapters/storage.ts`：以 `/` 分隔、不以 `/` 開頭、不含 `..`。
   * 這裡再擋一次——headless 的輸入雖然來自我們自己的 JS，
   * 但路徑逃逸這種東西不該只靠上游守。
   */
  private File resolve(String path) {
    if (path == null) return null;
    if (path.startsWith("/") || path.contains("..")) {
      Log.w(TAG, "headless 收到不合法的路徑: " + path);
      return null;
    }
    return path.isEmpty() ? context.getFilesDir() : new File(context.getFilesDir(), path);
  }

  private static byte[] readAll(InputStream in) throws Exception {
    ByteArrayOutputStream bos = new ByteArrayOutputStream();
    byte[] buf = new byte[8192];
    int n;
    while ((n = in.read(buf)) != -1) bos.write(buf, 0, n);
    return bos.toByteArray();
  }
}
