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
      'Access-Control-Allow-Headers': 'Content-Type',
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
      const { deviceId, tunnelUrl } = body
      if (!deviceId || !tunnelUrl) return new Response('Bad Request', { status: 400 })
      await env.DEST_RELAY.put(deviceId, tunnelUrl, { expirationTtl: 86400 })
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

    const tunnelUrl = await env.DEST_RELAY.get(deviceId)
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

    const remainingPath = '/' + pathParts.slice(1).join('/') + url.search
    const backendUrl = tunnelUrl + remainingPath

    try {
      const backendResponse = await fetch(backendUrl, {
        method: request.method,
        headers: request.headers,
        body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      })

      const responseHeaders = new Headers(backendResponse.headers)
      Object.keys(corsHeaders).forEach(k => responseHeaders.set(k, corsHeaders[k]))

      // 注入 relay/tunnel 資訊到 HTML
      if (backendResponse.headers.get('content-type')?.includes('text/html')) {
        const text = await backendResponse.text()
        const relayPageUrl = `${url.protocol}//${url.host}/${deviceId}`
        const tunnelWsUrl = tunnelUrl.replace(/^http/, 'ws')
        const inject = `<script>
window.__relayDeviceId='${deviceId}';
window.__relayPageUrl='${relayPageUrl}';
window.__tunnelWsUrl='${tunnelWsUrl}';
(function(){
  var _f=window.fetch;
  window.fetch=function(input,init){
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
      return new Response(`Proxy error: ${e.message}`, { status: 502 })
    }
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
