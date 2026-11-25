/**
 * Detect OS / env HTTP(S) proxy and apply to process.env so Node fetch
 * (with --use-env-proxy) can reach weread.qq.com on corp networks.
 *
 * Browser often uses system proxy automatically; the embedded Node runtime does not.
 */
import { execFileSync } from 'node:child_process'
import { platform } from 'node:os'

function alreadySet() {
  return Boolean(
    process.env.HTTPS_PROXY
    || process.env.https_proxy
    || process.env.HTTP_PROXY
    || process.env.http_proxy
    || process.env.ALL_PROXY
    || process.env.all_proxy,
  )
}

function normalizeProxyUrl(raw) {
  let value = String(raw || '').trim()
  if (!value || value === '0' || /^direct/i.test(value)) return ''
  // Windows IE style: "http=127.0.0.1:7890;https=127.0.0.1:7890" or "127.0.0.1:7890"
  if (value.includes('=')) {
    const map = {}
    for (const part of value.split(';')) {
      const [k, v] = part.split('=').map((s) => String(s || '').trim())
      if (k && v) map[k.toLowerCase()] = v
    }
    value = map.https || map.http || map.all || Object.values(map)[0] || ''
  }
  if (!value) return ''
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    value = `http://${value}`
  }
  return value
}

function detectMacProxy() {
  try {
    const sc = execFileSync('scutil', ['--proxy'], { encoding: 'utf8', timeout: 3000 })
    let host = ''
    let port = ''
    let httpsEnable = false
    let httpEnable = false
    for (const line of sc.split(/\r?\n/)) {
      if (line.includes('HTTPSEnable')) httpsEnable = /:\s*1\b/.test(line)
      if (line.includes('HTTPEnable')) httpEnable = /:\s*1\b/.test(line)
      if (line.includes('HTTPSProxy')) host = line.split(':').slice(1).join(':').trim() || host
      if (line.includes('HTTPSPort')) port = line.split(':').slice(1).join(':').trim() || port
      if (!host && line.includes('HTTPProxy')) host = line.split(':').slice(1).join(':').trim()
      if (!port && line.includes('HTTPPort')) port = line.split(':').slice(1).join(':').trim()
    }
    if ((httpsEnable || httpEnable) && host && port && host !== '0') {
      return `http://${host}:${port}`
    }
  } catch {
    // ignore
  }
  return ''
}

function detectWinProxy() {
  // 1) WinHTTP
  try {
    const out = execFileSync('netsh', ['winhttp', 'show', 'proxy'], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    })
    const m = out.match(/Proxy Server\(s\)\s*:\s*(.+)/i)
      || out.match(/代理服务器\s*:\s*(.+)/)
    if (m) {
      const url = normalizeProxyUrl(m[1])
      if (url) return url
    }
  } catch {
    // ignore
  }

  // 2) IE / Internet Settings (what Edge/Chrome often use)
  try {
    const script = [
      "$p = Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings' -ErrorAction Stop;",
      "if ([int]$p.ProxyEnable -ne 1) { '' } else { [string]$p.ProxyServer }",
    ].join(' ')
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', timeout: 8000, windowsHide: true },
    ).trim()
    const url = normalizeProxyUrl(out)
    if (url) return url
  } catch {
    // ignore
  }
  return ''
}

/**
 * @returns {{ applied: boolean, proxy: string, source: string }}
 */
export function applySystemProxy() {
  if (alreadySet()) {
    const proxy = normalizeProxyUrl(
      process.env.HTTPS_PROXY
      || process.env.https_proxy
      || process.env.HTTP_PROXY
      || process.env.http_proxy
      || process.env.ALL_PROXY
      || process.env.all_proxy,
    )
    return { applied: false, proxy, source: 'env' }
  }

  let proxy = ''
  let source = 'none'
  const os = platform()
  if (os === 'darwin') {
    proxy = detectMacProxy()
    source = proxy ? 'mac-scutil' : 'none'
  } else if (os === 'win32') {
    proxy = detectWinProxy()
    source = proxy ? 'win-system' : 'none'
  }

  if (!proxy) return { applied: false, proxy: '', source }

  process.env.HTTPS_PROXY = proxy
  process.env.HTTP_PROXY = proxy
  process.env.ALL_PROXY = proxy
  if (!process.env.NO_PROXY && !process.env.no_proxy) {
    process.env.NO_PROXY = '127.0.0.1,localhost,::1'
  }
  return { applied: true, proxy, source }
}
