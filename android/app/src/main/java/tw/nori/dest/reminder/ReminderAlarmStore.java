package tw.nori.dest.reminder;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * 已註冊鬧鐘的落地紀錄。
 *
 * 為什麼需要它：AlarmManager 的鬧鐘在**手機重開機後會全部消失**，
 * 而 App 不一定會被打開（正是獨立版提醒要解決的情境——使用者把 App 劃掉了）。
 * 所以每註冊一個鬧鐘就在這裡留一份，開機後由 ReminderBootReceiver 重新註冊。
 *
 * ⚠️ 這裡存的 `body` 是**離開前景時生成的快取台詞**
 * （見 docs/mobile-standalone-reminder-plan.md §2.1 的底線機制）。
 * 它不是「最終要講的話」——現場生成成功時會被覆蓋掉。
 * 之所以要先存進來，是因為鬧鐘響的時候 WebView 不一定活著。
 */
public class ReminderAlarmStore {

  private static final String PREFS = "dest_reminder_alarms";
  private static final String KEY_IDS = "__ids";

  private final SharedPreferences prefs;

  public ReminderAlarmStore(Context context) {
    this.prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
  }

  public static class Entry {
    public String id;
    public long triggerAtMs;
    public String title;
    public String body;
    /** "always" 或 "screen_on_only"，語意見 core/reminder/gate.ts */
    public String wakeMode;
    /** "skip" 或 "notify_on_unlock" */
    public String inactiveBehavior;

    JSONObject toJson() throws JSONException {
      JSONObject o = new JSONObject();
      o.put("id", id);
      o.put("triggerAtMs", triggerAtMs);
      o.put("title", title == null ? "" : title);
      o.put("body", body == null ? "" : body);
      o.put("wakeMode", wakeMode == null ? "always" : wakeMode);
      o.put("inactiveBehavior", inactiveBehavior == null ? "skip" : inactiveBehavior);
      return o;
    }

    static Entry fromJson(JSONObject o) {
      Entry e = new Entry();
      e.id = o.optString("id");
      e.triggerAtMs = o.optLong("triggerAtMs");
      e.title = o.optString("title");
      e.body = o.optString("body");
      e.wakeMode = o.optString("wakeMode", "always");
      e.inactiveBehavior = o.optString("inactiveBehavior", "skip");
      return e;
    }
  }

  public void put(Entry entry) {
    try {
      prefs.edit().putString(entry.id, entry.toJson().toString()).apply();
      addId(entry.id);
    } catch (JSONException ignored) {
      // 寫不進去就算了，下次前景啟動時 JS 會重新註冊一輪
    }
  }

  public Entry get(String id) {
    String raw = prefs.getString(id, null);
    if (raw == null) return null;
    try {
      return Entry.fromJson(new JSONObject(raw));
    } catch (JSONException e) {
      return null;
    }
  }

  public void remove(String id) {
    prefs.edit().remove(id).apply();
    List<String> ids = ids();
    ids.remove(id);
    saveIds(ids);
  }

  public void clear() {
    prefs.edit().clear().apply();
  }

  public List<Entry> all() {
    List<Entry> out = new ArrayList<>();
    for (String id : ids()) {
      Entry e = get(id);
      if (e != null) out.add(e);
    }
    return out;
  }

  private List<String> ids() {
    List<String> out = new ArrayList<>();
    String raw = prefs.getString(KEY_IDS, "");
    if (raw.isEmpty()) return out;
    for (String s : raw.split("\n")) {
      if (!s.isEmpty()) out.add(s);
    }
    return out;
  }

  private void addId(String id) {
    List<String> ids = ids();
    if (!ids.contains(id)) {
      ids.add(id);
      saveIds(ids);
    }
  }

  private void saveIds(List<String> ids) {
    prefs.edit().putString(KEY_IDS, String.join("\n", ids)).apply();
  }
}
