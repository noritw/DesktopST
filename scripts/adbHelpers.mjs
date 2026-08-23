/**
 * `adb` 相關的小工具，`build-mobile-apk.mjs`（debug）與 `mobile-tool.mjs` 的
 * 正式簽章裝機動作共用。
 *
 * 抽出來的理由：QR 配對合併那次（2026-08-24）才踩到「同一套判斷邏輯在三支
 * 腳本各抄一份，改一處漏兩處」的坑（`getLocalIp()` 的 Tailscale 排序問題），
 * 這裡不想重蹈覆轍——`adb install` 的判斷是新增功能時第一個會被複製貼上的對象。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export function findAdb() {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
    process.env.ANDROID_HOME ? path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb.exe') : '',
    process.env.ANDROID_SDK_ROOT ? path.join(process.env.ANDROID_SDK_ROOT, 'platform-tools', 'adb.exe') : ''
  ].filter(Boolean)

  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }

  try {
    const which = spawnSync('where.exe', ['adb'], { encoding: 'utf8' })
    const first = (which.stdout || '').split(/\r?\n/).map((s) => s.trim()).find(Boolean)
    if (first && fs.existsSync(first)) return first
  } catch {
    /* ignore */
  }
  return null
}

export function hasAdbDevice(adb) {
  const result = spawnSync(adb, ['devices'], { encoding: 'utf8' })
  if (result.status !== 0) return false
  return (result.stdout || '')
    .split(/\r?\n/)
    .slice(1)
    .some((line) => /\tdevice$/.test(line))
}

/**
 * 嘗試 USB 直裝，回傳是否成功。找不到 adb／沒裝置／簽章不符都印出對應訊息
 * 後回 `false`，呼叫端接著改走區網 QR 下載即可。
 */
export function tryAdbInstall(apkPath) {
  const adb = findAdb()
  if (!adb) {
    console.log('本機找不到 adb。改走區網下載。')
    return false
  }
  if (!hasAdbDevice(adb)) {
    console.log('沒有可用的 adb device（USB 偵錯未開或沒接上）。改走區網下載。')
    return false
  }
  console.log('偵測到 USB 裝置，嘗試 adb install -r ...')
  const install = spawnSync(adb, ['install', '-r', apkPath], { stdio: 'inherit' })
  if (install.status === 0) {
    console.log('已安裝到手機。直接打開 DeST 即可測。')
    return true
  }
  console.log('adb install 失敗（權限／簽名衝突常見，例如手機上裝的是不同簽章）。改走區網下載。')
  return false
}
