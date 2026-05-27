/**
 * DesktopST Relay Worker
 * - POST /register       DeST 啟動時登記 tunnel URL
 * - GET  /{deviceId}     代理 mobile.html，注入 relay/tunnel 資訊
 * - ANY  /{deviceId}/... 代理 API 請求到 tunnel
 * WebSocket 直連 tunnel，不走這裡代理（避免連線堆積）
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const path = url.pathname

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-DesktopST-Token, Authorization',
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    // POST /register — DeST 登記當前 tunnel URL
    if (request.method === 'POST' && path === '/register') {
      let body
      try { body = await request.json() } catch {
        return new Response('Bad Request', { status: 400 })
      }
      const { deviceId, tunnelUrl, deviceSecret, accessToken } = body
      if (!deviceId || !tunnelUrl || !deviceSecret || !accessToken) return new Response('Bad Request', { status: 400 })
      if (!isValidTunnelUrl(tunnelUrl)) return new Response('Bad tunnelUrl', { status: 400 })

      const existing = await readDeviceRecord(env, deviceId)
      if (existing?.deviceSecret && existing.deviceSecret !== deviceSecret) {
        return new Response('Forbidden', { status: 403 })
      }

      await writeDeviceRecord(env, deviceId, {
        tunnelUrl,
        deviceSecret,
        accessToken,
        updatedAt: Date.now()
      })
      return new Response('OK')
    }

    // GET / — 健康檢查
    if (path === '/' || path === '/health') {
      return new Response('DesktopST Relay OK')
    }

    // /{deviceId} 或 /{deviceId}/...
    const pathParts = path.slice(1).split('/')
    const deviceId = pathParts[0]
    if (!deviceId) return new Response('DesktopST Relay')

    const record = await readDeviceRecord(env, deviceId)
    const tunnelUrl = record?.tunnelUrl
    if (!tunnelUrl || tunnelUrl === 'offline') {
      return new Response(statusPage('裝置離線', 'DesktopST 目前未執行，請先開啟電腦上的程式。', false), {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      })
    }
    if (tunnelUrl === 'starting') {
      return new Response(statusPage('連線中', 'DesktopST 正在啟動，請稍候…', true), {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      })
    }

    const accessToken = getRequestToken(request, url)
    if (!record?.accessToken || accessToken !== record.accessToken) {
      return new Response(statusPage('未授權', '請從 DesktopST 重新掃描 QR Code。', false), {
        status: 401,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      })
    }

    const backendSearch = new URLSearchParams(url.search)
    backendSearch.delete('token')
    const search = backendSearch.toString()
    const remainingPath = '/' + pathParts.slice(1).join('/') + (search ? `?${search}` : '')
    const backendUrl = tunnelUrl + remainingPath

    try {
      const backendHeaders = new Headers(request.headers)
      backendHeaders.set('X-DesktopST-Token', record.accessToken)
      const backendResponse = await fetch(backendUrl, {
        method: request.method,
        headers: backendHeaders,
        body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      })

      const responseHeaders = new Headers(backendResponse.headers)
      Object.keys(corsHeaders).forEach(k => responseHeaders.set(k, corsHeaders[k]))

      // 注入 relay/tunnel 資訊到 HTML
      if (backendResponse.headers.get('content-type')?.includes('text/html')) {
        const text = await backendResponse.text()
        const relayPageUrl = `${url.protocol}//${url.host}/${deviceId}?token=${encodeURIComponent(record.accessToken)}`
        const wsSep = tunnelUrl.includes('?') ? '&' : '?'
        const tunnelWsUrl = `${tunnelUrl.replace(/^http/, 'ws')}${wsSep}token=${encodeURIComponent(record.accessToken)}`
        const inject = `<script>
window.__relayDeviceId='${deviceId}';
window.__relayPageUrl='${relayPageUrl}';
window.__tunnelWsUrl='${tunnelWsUrl}';
window.__mobileToken='${record.accessToken}';
(function(){
  var _f=window.fetch;
  window.fetch=function(input,init){
    init=init||{};
    var h=new Headers(init.headers||{});
    h.set('X-DesktopST-Token',window.__mobileToken);
    init.headers=h;
    if(typeof input==='string'&&input.startsWith('/')&&!input.startsWith('/'+window.__relayDeviceId))
      input='/'+window.__relayDeviceId+input;
    return _f.call(this,input,init);
  };
})();
</script>`
        return new Response(text.replace('</head>', inject + '</head>'), {
          status: backendResponse.status,
          headers: responseHeaders,
        })
      }

      return new Response(backendResponse.body, {
        status: backendResponse.status,
        headers: responseHeaders,
      })
    } catch (e) {
      return new Response(statusPage('連線中斷', '目前無法連到這台電腦，頁面將嘗試重新整理。', true), {
        status: 502,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      })
    }
  }
}

async function readDeviceRecord(env, deviceId) {
  const raw = await env.DEST_RELAY.get(deviceId)
  if (!raw) return null
  try {
    const record = JSON.parse(raw)
    if (record && typeof record === 'object') return record
  } catch {}
  return { tunnelUrl: raw }
}

async function writeDeviceRecord(env, deviceId, record) {
  await env.DEST_RELAY.put(deviceId, JSON.stringify(record), { expirationTtl: 86400 })
}

function getRequestToken(request, url) {
  const queryToken = url.searchParams.get('token') || ''
  const headerToken = request.headers.get('X-DesktopST-Token') || ''
  const auth = request.headers.get('Authorization') || ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  return queryToken || headerToken || bearer
}

function isValidTunnelUrl(tunnelUrl) {
  if (tunnelUrl === 'starting' || tunnelUrl === 'offline') return true
  try {
    const url = new URL(tunnelUrl)
    return url.protocol === 'https:' && /^[a-z0-9-]+\.trycloudflare\.com$/.test(url.hostname)
  } catch {
    return false
  }
}

function statusPage(title, message, autoRefresh) {
  const refresh = autoRefresh ? '<meta http-equiv="refresh" content="5">' : ''
  return `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">${refresh}
<title>DesktopST</title>
<style>body{font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#F7FFFC;color:#3D5A52}
.card{text-align:center;padding:32px;background:#fff;border-radius:20px;box-shadow:0 2px 16px rgba(0,0,0,.08);max-width:300px}
h2{margin:0 0 12px;font-size:20px}p{margin:0;color:#7AA898;font-size:14px;line-height:1.6}</style>
</head><body><div class="card"><div style="font-size:48px">${autoRefresh ? '⏳' : '💤'}</div>
<h2>${title}</h2><p>${message}${autoRefresh ? '<br><br>頁面將自動重新整理…' : ''}</p></div></body></html>`
}
