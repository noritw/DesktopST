package tw.nori.dest.weather;

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

import tw.nori.dest.reminder.HeadlessBridge;
import tw.nori.dest.reminder.ReminderNotifier;
import tw.nori.dest.widget.DeSTWidgetProvider;

/**
 * 小工具 `onUpdate` 判斷節流間隔到了之後，轉交這裡跑一次天氣主動發話／
 * 早安簡報的 headless 檢查。設計依據：
 * `docs/weather-proactive-mobile-kickoff.md` §3.4／§6／§8 第 7 步。
 *
 * 跟 `ReminderForegroundService` 是同一套機制（隱藏 WebView ＋
 * {@link HeadlessBridge}），刻意不重寫一份——差異只在：
 * - 啟動來源是 `DeSTWidgetProvider.onUpdate()`，不是鬧鐘廣播
 * - 沒有「快取台詞」底線可退（沒講到就等下一輪 `onUpdate()`，不遺失資料）
 * - 完成後**直接呼叫** {@link DeSTWidgetProvider#updateAll}——原生對原生，
 *   不必像前景 UI 那樣繞 Capacitor 的 {@code DeSTWidgetBridgePlugin}
 *   （headless WebView 沒有 Capacitor Bridge）。
 */
public class WeatherForegroundService extends Service {

  /** 沿用跟提醒 headless 同一個 log tag 的姊妹 tag，`adb logcat -s WeatherProactive` 可單獨追。 */
  private static final String TAG = "WeatherProactive";

  private static final String PREP_CHANNEL_ID = "dest-weather-prep-v1";
  private static final int PREP_NOTIFICATION_ID = 90211;

  /** 通知 id 的命名空間；不是真正的提醒 id，只是拿來給 `ReminderNotifier` 雜湊用。 */
  private static final String NOTIFY_ID = "weather-proactive";

  /** 天氣 API＋LLM 往返一般幾秒內完成；45 秒比照提醒的預算，逾時就放棄這一輪。 */
  private static final long TIMEOUT_MS = 45_000;

  private final Handler main = new Handler(Looper.getMainLooper());
  private WebView webView;
  private HeadlessBridge bridge;
  private Runnable timeout;
  private boolean finished = false;

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    startForegroundCompat();
    startHeadless();

    timeout = () -> {
      Log.w(TAG, "headless 逾時，放棄這一輪");
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
          "天氣檢查中",
          NotificationManager.IMPORTANCE_LOW
        );
        ch.setDescription("定期檢查天氣是否有轉變，幾秒內結束");
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
      }
    }

    Notification n = new NotificationCompat.Builder(this, PREP_CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_popup_reminder)
      .setContentTitle("正在檢查天氣⋯⋯")
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setOngoing(true)
      .build();

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(PREP_NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE);
    } else {
      startForeground(PREP_NOTIFICATION_ID, n);
    }
  }

  private void startHeadless() {
    bridge = new HeadlessBridge(this, new HeadlessBridge.Callback() {
      @Override
      public void onComplete(String resultJson) {
        main.post(() -> {
          handleResult(resultJson);
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
    webView.getSettings().setAllowFileAccess(true);
    webView.addJavascriptInterface(bridge, "DestHeadless");
    webView.setWebViewClient(new WebViewClient());

    Log.i(TAG, "headless 啟動");
    webView.loadUrl("file:///android_asset/public/index.html?headless=weather-proactive");
  }

  /**
   * JS 回報的結果（見 `src/mobile/headless/weatherProactiveHeadless.ts` 的
   * `WeatherHeadlessResult`）。`notify=false` 是正常結果之一（沒偵測到轉變、
   * 被剎車擋下、影子模式⋯），不是錯誤。
   */
  private void handleResult(String resultJson) {
    try {
      JSONObject o = new JSONObject(resultJson);
      if (o.optBoolean("notify", false)) {
        String title = o.optString("title", "");
        String body = o.optString("body", "");
        if (title.isEmpty() || body.trim().isEmpty()) {
          Log.i(TAG, "headless 回了空內容，不發通知");
        } else {
          byte[] avatar = ReminderNotifier.decodeAvatarBase64(o.optString("avatarBase64", null));
          ReminderNotifier.notify(this, NOTIFY_ID, title, body, null, avatar);
          Log.i(TAG, "已發出通知");
        }
      } else {
        Log.i(TAG, "判定不發通知（" + o.optString("reason", "?") + "）");
      }
    } catch (Exception e) {
      Log.e(TAG, "headless 結果解析失敗: " + e.getMessage());
    }

    /*
     * 通知只是其中一個管道（kickoff §6.1「兩個管道都要」）。訊息已經寫進對話，
     * 小工具本來就該反映最新內容——不論這次有沒有發通知都刷新，
     * 沒講到話時只是重繪同樣的內容，成本可忽略。
     */
    DeSTWidgetProvider.updateAll(this);
  }

  private void finish() {
    if (finished) return;
    finished = true;
    if (timeout != null) main.removeCallbacks(timeout);
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

  public static Intent intentFor(Context context) {
    return new Intent(context, WeatherForegroundService.class);
  }
}
