package tw.nori.dest.reminder;

import android.app.AlarmManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.List;

/**
 * 提醒鬧鐘的 JS ↔ 原生介面。
 *
 * 分工（見 docs/mobile-standalone-reminder-plan.md §2.1）：
 * **原生只負責喚醒與發通知，所有 prompt 組裝與「該不該響」的判定留在 TS。**
 * 唯一的例外是螢幕狀態——只有原生問得到 `PowerManager.isInteractive()`，
 * 所以 `wakeMode` 會一起交給原生（語意仍以 core/reminder/gate.ts 為準）。
 *
 * JS 傳來的 `body` 是**離開前景時生成的快取台詞**，作為離線底線。
 * 現場生成（headless WebView）接上之後，這個值只會在生成失敗時派上用場。
 */
@CapacitorPlugin(name = "DestReminders")
public class ReminderPlugin extends Plugin {

  private ReminderAlarmStore store;

  @Override
  public void load() {
    store = new ReminderAlarmStore(getContext());
    ReminderNotifier.ensureChannel(getContext());
  }

  @PluginMethod
  public void schedule(PluginCall call) {
    String id = call.getString("id");
    Long at = call.getLong("triggerAtMs");
    if (id == null || id.isEmpty() || at == null) {
      call.reject("id 與 triggerAtMs 為必填");
      return;
    }

    ReminderAlarmStore.Entry e = new ReminderAlarmStore.Entry();
    e.id = id;
    e.triggerAtMs = at;
    e.title = call.getString("title", "提醒");
    e.body = call.getString("body", "");
    e.wakeMode = call.getString("wakeMode", "always");
    e.inactiveBehavior = call.getString("inactiveBehavior", "skip");

    store.put(e);
    ReminderScheduler.schedule(getContext(), e);
    call.resolve();
  }

  @PluginMethod
  public void cancel(PluginCall call) {
    String id = call.getString("id");
    if (id == null) {
      call.reject("id 為必填");
      return;
    }
    ReminderScheduler.cancel(getContext(), id);
    store.remove(id);
    call.resolve();
  }

  @PluginMethod
  public void cancelAll(PluginCall call) {
    for (ReminderAlarmStore.Entry e : store.all()) {
      ReminderScheduler.cancel(getContext(), e.id);
    }
    store.clear();
    call.resolve();
  }

  /**
   * 取出「已到期但因為螢幕暗著而押後」的提醒（`inactiveBehavior: notify_on_unlock`）。
   * JS 在回到前景時呼叫，拿到之後自己重新生成當下的台詞再發——
   * 押後那一刻生的話等使用者亮屏時已經過時了。
   */
  @PluginMethod
  public void takeDeferred(PluginCall call) {
    JSArray ids = new JSArray();
    List<ReminderAlarmStore.Entry> all = store.all();
    for (ReminderAlarmStore.Entry e : all) {
      if (e.triggerAtMs == 0) {
        ids.put(e.id);
        store.remove(e.id);
      }
    }
    JSObject ret = new JSObject();
    ret.put("ids", ids);
    call.resolve(ret);
  }

  /**
   * Android 12+ 的「鬧鐘與提醒」授權狀態。
   *
   * ⚠️ 這個權限**不是宣告就有**，要使用者自己去系統設定開。
   * 沒開的話鬧鐘會退回不精準模式（誤差可能數分鐘），
   * 所以前端要看到 false 就引導使用者，不能靜默失敗。
   */
  @PluginMethod
  public void canScheduleExact(PluginCall call) {
    JSObject ret = new JSObject();
    boolean ok = true;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      AlarmManager am = getContext().getSystemService(AlarmManager.class);
      ok = am != null && am.canScheduleExactAlarms();
    }
    ret.put("granted", ok);
    // Android 11 以下沒有這個開關，UI 不必顯示引導
    ret.put("applicable", Build.VERSION.SDK_INT >= Build.VERSION_CODES.S);
    call.resolve(ret);
  }

  /** 開啟系統的「鬧鐘與提醒」設定頁。 */
  @PluginMethod
  public void openExactAlarmSettings(PluginCall call) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
      call.resolve();
      return;
    }
    Intent i = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
    i.setData(Uri.parse("package:" + getContext().getPackageName()));
    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    getContext().startActivity(i);
    call.resolve();
  }
}
