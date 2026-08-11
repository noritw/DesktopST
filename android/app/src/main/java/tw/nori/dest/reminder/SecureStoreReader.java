package tw.nori.dest.reminder;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;
import android.util.Log;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * 讀出 `@aparajita/capacitor-secure-storage` 存的 master key。
 *
 * 為什麼需要它：API Key 並不是直接放在 SecureStorage 裡，而是
 * **用一把 master key 加密後寫進 `settings.json`**（見 `secretAdapter.ts`／
 * `secretCrypto.ts`）。headless WebView 沒有 Capacitor Bridge，
 * 拿不到那個外掛，所以得由原生層把 master key 取出來交給它。
 *
 * ⚠️ **這支與外掛的內部儲存格式綁在一起**（SharedPreferences 檔名、
 * U+0010 分隔的 ciphertext∥iv、AndroidKeyStore alias ＝ prefixedKey）。
 * 升級 `@aparajita/capacitor-secure-storage` 時要回來確認一次；
 * 讀不到時回 `null`，headless 端會退回「用快取台詞」而不是整個崩掉。
 *
 * key 名稱要與 `secretAdapter.ts` 的 `KEY_PREFIX + MASTER_KEY_ID` 一致。
 */
public class SecureStoreReader {

  private static final String TAG = "ReminderAlarm";

  private static final String SHARED_PREFERENCES = "WSSecureStorageSharedPreferences";
  private static final String ANDROID_KEY_STORE = "AndroidKeyStore";
  private static final String CIPHER_TRANSFORMATION = "AES/GCM/NoPadding";
  /**
   * 外掛用 U+0010 (DLE) 把 ciphertext 與 IV 接起來。
   * 寫成 `(char) 0x10` 而不是字面上的控制字元——看不見的字元最容易在編輯／轉檔時被吃掉。
   */
  private static final char DATA_IV_SEPARATOR = (char) 0x10;
  private static final int BASE64_FLAGS = Base64.NO_PADDING + Base64.NO_WRAP;

  /** 對應 secretAdapter.ts 的 `dest_` + `master-key-v1`。 */
  private static final String MASTER_KEY_ALIAS = "dest_master-key-v1";

  /** 回傳 base64 的 master key（32 bytes），拿不到時回 null。 */
  public static String masterKeyBase64(Context context) {
    try {
      SharedPreferences prefs = context.getSharedPreferences(
        SHARED_PREFERENCES,
        Context.MODE_PRIVATE
      );
      String stored = prefs.getString(MASTER_KEY_ALIAS, null);
      if (stored == null) {
        Log.w(TAG, "SecureStorage 裡沒有 master key（使用者可能還沒設過 API Key）");
        return null;
      }

      int sep = stored.indexOf(DATA_IV_SEPARATOR);
      if (sep < 0) {
        Log.e(TAG, "master key 格式不符（找不到 IV 分隔符），外掛版本可能變了");
        return null;
      }
      byte[] data = Base64.decode(stored.substring(0, sep), BASE64_FLAGS);
      byte[] iv = Base64.decode(stored.substring(sep + 1), BASE64_FLAGS);

      KeyStore ks = KeyStore.getInstance(ANDROID_KEY_STORE);
      ks.load(null);
      KeyStore.SecretKeyEntry entry = (KeyStore.SecretKeyEntry) ks.getEntry(MASTER_KEY_ALIAS, null);
      if (entry == null) {
        Log.e(TAG, "AndroidKeyStore 沒有對應的金鑰");
        return null;
      }

      SecretKey key = entry.getSecretKey();
      Cipher cipher = Cipher.getInstance(CIPHER_TRANSFORMATION);
      cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, iv));
      // 外掛存的是「base64 字串」的明文，不是原始位元組
      return new String(cipher.doFinal(data), StandardCharsets.UTF_8);
    } catch (Exception e) {
      Log.e(TAG, "讀取 master key 失敗: " + e.getMessage());
      return null;
    }
  }
}
