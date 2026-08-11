package tw.nori.dest.reminder;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.app.NotificationCompat;

import org.json.JSONObject;

/**
 * 提醒到點時，在背景跑一次「現場生成台詞」。
 *
 * 做法與理由見 `docs/mobile-standalone-reminder-plan.md` §2.1：
 * 起一個隱藏 WebView 載入既有的手機版 HTML（帶 headless 旗標），
 * 讓 `reminderSpeak.ts` 原封不動跑一遍。**TS 邏輯零重寫**，
 * 桌面與手機仍是同一份 prompt 組裝。
 *
 * 為什麼要前景服務：BroadcastReceiver 只有約 10 秒，不夠一次 LLM 往返。
 * exact alarm 觸發時系統會給暫時的白名單豁免，允許從廣播啟動前景服務。
 *
 * 已知代價：通知欄會短暫出現一則「正在準備提醒⋯⋯」（Android 規定，避不掉），
 * 幾秒後就被角色講的話取代。
 */
public class ReminderForegroundService extends Service {

  private static final String TAG = "ReminderAlarm";

  public static final String EXTRA_ID = "reminderId";
  public static final String EXTRA_SCREEN_ON = "screenOn";
  public static final String EXTRA_OCCURRENCE_AT = "occurrenceAtMs";

  /** 準備中的那則低調通知，用獨立頻道（IMPORTANCE_LOW＝不出聲、不彈橫幅）。 */
  private static final String PREP_CHANNEL_ID = "dest-reminder-prep-v1";
  private static final int PREP_NOTIFICATION_ID = 90210;

  /**
   * 整趟的預算。WebView 冷啟 1–3 秒 ＋ LLM 2–5 秒是常態，
   * 45 秒是給網路很慢時的餘裕；short service 上限 3 分鐘，還很寬。
   * 逾時就走離線底線（快取台詞）。
   */
  private static final long TIMEOUT_MS = 45_000;

  private final Handler main = new Handler(Looper.getMainLooper());
  private WebView webView;
  private HeadlessBridge bridge;
  private Runnable timeout;
  private boolean finished = false;
  private String reminderId;

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    if (intent == null) {
      stopSelf();
      return START_NOT_STICKY;
    }

    reminderId = intent.getStringExtra(EXTRA_ID);
    boolean screenOn = intent.getBooleanExtra(EXTRA_SCREEN_ON, true);
    long occurrenceAtMs = intent.getLongExtra(EXTRA_OCCURRENCE_AT, 0L);
    if (reminderId == null) {
      stopSelf();
      return START_NOT_STICKY;
    }

    startForegroundCompat();
    startHeadless(reminderId, screenOn, occurrenceAtMs);

    timeout = () -> {
      Log.w(TAG, "headless 逾時，改用快取台詞: " + reminderId);
      fallbackToCache(reminderId);
      finish();
    };
    main.postDelayed(timeout, TIMEOUT_MS);

    return START_NOT_STICKY;
  }

  private void startForegroundCompat() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      NotificationManager nm = getSystemService(NotificationManager.class);
      if (nm != null) {
        NotificationChannel ch = new NotificationChannel(
          PREP_CHANNEL_ID,
          "提醒準備中",
          NotificationManager.IMPORTANCE_LOW
        );
        ch.setDescription("提醒觸發時短暫顯示，幾秒後就會換成角色說的話");
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
      }
    }

    Notification n = new NotificationCompat.Builder(this, PREP_CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_popup_reminder)
      .setContentTitle("正在準備提醒⋯⋯")
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setOngoing(true)
      .build();

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(PREP_NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE);
    } else {
      startForeground(PREP_NOTIFICATION_ID, n);
    }
  }

  private void startHeadless(String id, boolean screenOn, long occurrenceAtMs) {
    bridge = new HeadlessBridge(this, new HeadlessBridge.Callback() {
      @Override
      public void onComplete(String resultJson) {
        main.post(() -> {
          handleResult(id, resultJson);
          finish();
        });
      }

      @Override
      public void evaluate(String js) {
        main.post(() -> {
          if (webView != null) webView.evaluateJavascript(js, null);
        });
      }
    });

    webView = new WebView(this);
    webView.getSettings().setJavaScriptEnabled(true);
    webView.getSettings().setDomStorageEnabled(true);
    /*
     * 載的是 file://android_asset，而 LLM 端點是 https。
     * 混合內容的判定對 file:// 特別嚴，索性全部走原生 httpRequest——
     * 這裡開放只是避免 WebView 對自己的資源多做限制。
     */
    webView.getSettings().setAllowFileAccess(true);
    webView.addJavascriptInterface(bridge, "DestHeadless");
    webView.setWebViewClient(new WebViewClient());

    String url =
      "file:///android_asset/public/index.html?headless=reminder&reminderId=" +
      android.net.Uri.encode(id) +
      "&screenOn=" +
      (screenOn ? "1" : "0") +
      "&occurrenceAt=" +
      occurrenceAtMs;
    Log.i(TAG, "headless 啟動: " + id);
    webView.loadUrl(url);
  }

  /**
   * JS 回報的結果。
   *
   * `notify=false` 是**正常結果之一**（情境不符、離線又關掉降級⋯⋯），
   * 不是錯誤——這種時候刻意什麼都不做，歷史紀錄由 JS 那側自己寫了。
   */
  private void handleResult(String id, String resultJson) {
    try {
      JSONObject o = new JSONObject(resultJson);
      if (!o.optBoolean("notify", false)) {
        Log.i(TAG, "headless 判定不發通知（" + o.optString("reason", "?") + "）: " + id);
        /*
         * `useCache` 只有在 TS 那條路整個壞掉時才是 true。
         * 「情境不符」「使用者關掉離線降級」是**判定結果**，
         * TS 側已經把快取考慮進去了——原生再補一則會讓「安靜略過」失效。
         */
        if (o.optBoolean("useCache", false)) fallbackToCache(id);
        return;
      }
      String title = o.optString("title", "提醒");
      String body = o.optString("body", "");
      if (body.trim().isEmpty()) {
        Log.i(TAG, "headless 回了空台詞，不發通知: " + id);
        return;
      }
      ReminderNotifier.notify(this, id, title, body);
      Log.i(TAG, "headless 生成成功並已發出通知: " + id);
    } catch (Exception e) {
      Log.e(TAG, "headless 結果解析失敗，改用快取台詞: " + e.getMessage());
      fallbackToCache(id);
    }
  }

  /** headless 沒回應／壞掉時的底線：用註冊鬧鐘時存下的快取台詞。 */
  private void fallbackToCache(String id) {
    ReminderAlarmStore.Entry entry = new ReminderAlarmStore(this).get(id);
    String body = entry == null || entry.body == null ? "" : entry.body.trim();
    if (body.isEmpty()) {
      Log.i(TAG, "沒有快取台詞可用，不發通知: " + id);
      return;
    }
    String title = entry.title == null || entry.title.isEmpty() ? "提醒" : entry.title;
    ReminderNotifier.notify(this, id, title, body);
  }

  private void finish() {
    if (finished) return;
    finished = true;
    if (timeout != null) main.removeCallbacks(timeout);
    // 響過就把紀錄清掉，下一輪由 JS 在前景重排
    if (reminderId != null) new ReminderAlarmStore(this).remove(reminderId);
    destroyWebView();
    stopForeground(true);
    stopSelf();
  }

  private void destroyWebView() {
    if (bridge != null) {
      bridge.shutdown();
      bridge = null;
    }
    if (webView != null) {
      webView.loadUrl("about:blank");
      webView.destroy();
      webView = null;
    }
  }

  @Override
  public void onDestroy() {
    destroyWebView();
    super.onDestroy();
  }

  /** 讓 receiver 可以用同一組 extras 啟動。 */
  public static Intent intentFor(
    Context context,
    String reminderId,
    boolean screenOn,
    long occurrenceAtMs
  ) {
    Intent i = new Intent(context, ReminderForegroundService.class);
    i.putExtra(EXTRA_ID, reminderId);
    i.putExtra(EXTRA_SCREEN_ON, screenOn);
    i.putExtra(EXTRA_OCCURRENCE_AT, occurrenceAtMs);
    return i;
  }
}
