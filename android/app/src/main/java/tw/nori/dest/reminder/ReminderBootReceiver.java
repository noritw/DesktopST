package tw.nori.dest.reminder;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

import java.util.List;

/**
 * 開機後重新註冊鬧鐘。
 *
 * AlarmManager 的鬧鐘在重開機後全部消失，而 App 不一定會被打開
 * ——獨立版提醒的整個前提就是「使用者把 App 劃掉了」。
 * 沒有這支的話，手機重開一次，所有提醒就靜靜地永遠不會再響。
 *
 * 也接 `MY_PACKAGE_REPLACED`：更新 App 同樣會清掉鬧鐘。
 */
public class ReminderBootReceiver extends BroadcastReceiver {

  private static final String TAG = "ReminderAlarm";

  @Override
  public void onReceive(Context context, Intent intent) {
    String action = intent.getAction();
    if (action == null) return;
    if (
      !Intent.ACTION_BOOT_COMPLETED.equals(action) &&
      !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
    ) {
      return;
    }

    ReminderAlarmStore store = new ReminderAlarmStore(context);
    List<ReminderAlarmStore.Entry> entries = store.all();
    long now = System.currentTimeMillis();
    int restored = 0;

    for (ReminderAlarmStore.Entry e : entries) {
      if (e.triggerAtMs <= now) {
        /*
         * 關機期間錯過的：不補發。
         * 「早上八點該吃藥」在中午開機時跳出來只會造成混亂，
         * 而且 daily／interval 的下一輪本來就會由 JS 在前景重排。
         */
        store.remove(e.id);
        continue;
      }
      ReminderScheduler.schedule(context, e);
      restored++;
    }

    Log.i(TAG, "開機重註冊鬧鐘：" + restored + " 則（" + action + "）");
  }
}
