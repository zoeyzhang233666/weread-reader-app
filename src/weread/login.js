import { cookieFromLoginInfo, mergeCookieHeader } from './cookie.js'

const BASE = 'https://weread.qq.com'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

function loginHeaders(extra = {}) {
  return {
    'User-Agent': UA,
    Referer: `${BASE}/`,
    Origin: BASE,
    Accept: 'application/json, text/plain, */*',
    ...extra,
  }
}

export function confirmUrlForUid(uid) {
  return `${BASE}/web/confirm?uid=${encodeURIComponent(uid)}`
}

export async function createQrSession() {
  const res = await fetch(`${BASE}/web/login/getuid`, {
    method: 'POST',
    headers: loginHeaders({ 'Content-Type': 'application/json' }),
    body: '{}',
  })
  const data = await res.json().catch(() => ({}))
  const uid = String(data.uid || '').trim()
  if (!uid) {
    const hint = data?.errMsg || data?.errmsg || data?.logicCode || `HTTP ${res.status}`
    throw new Error(`微信读书未返回登录 uid（${hint}）。请检查本机能否访问 weread.qq.com。`)
  }
  return {
    uid,
    qrUrl: confirmUrlForUid(uid),
    expiresInSec: 180,
  }
}

function classifyLoginInfo(data) {
  if (!data || typeof data !== 'object') return { status: 'pending' }
  const logic = String(data.logicCode || data.errcode || data.errCode || '')
  const msg = data.errMsg || data.errmsg || data.msg || ''
  if (logic === 'LOGIN_TIMEOUT' || logic === '-1') {
    return { status: 'expired', error: '二维码已过期，请刷新后重试。' }
  }
  if (logic === 'NEED_OTP' || data.needOtp === true) {
    return { status: 'need_otp' }
  }
  if (logic === 'OTP_NOT_MATCH') {
    return { status: 'need_otp', error: '验证码不正确。' }
  }
  if (logic === 'OTP_EXPIRED') {
    return { status: 'expired', error: '验证码已过期，请刷新二维码。' }
  }
  if (logic && logic !== '0' && !['NEED_OTP', 'OTP_NOT_MATCH', 'OTP_EXPIRED', 'LOGIN_TIMEOUT'].includes(logic)) {
    // Known reject / risk-control style responses from Weread web login
    if (/fail|deny|forbid|risk|limit|error|拒绝|失败|异常|封/i.test(`${logic} ${msg}`)) {
      return {
        status: 'error',
        error: msg
          ? `登录失败：${msg}`
          : `登录失败（${logic}）。请用「微信 → 扫一扫」（不要用微信读书 App 内扫码），并确认手机微信能打开网页版微信读书。`,
      }
    }
  }
  const hasCreds = (data.skey || data.accessToken) && (data.vid != null || data.webLoginVid != null)
  if (hasCreds || data.succeed === true) {
    return { status: 'ok', info: data }
  }
  return { status: 'pending' }
}

export async function pollLoginInfo(uid, { otp = '', timeoutMs = 25_000 } = {}) {
  const body = { uid: String(uid || '').trim() }
  if (otp) body.otp = String(otp)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${BASE}/web/login/getinfo`, {
      method: 'POST',
      headers: loginHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { status: 'pending', error: `Weread HTTP ${res.status}` }
    }
    return classifyLoginInfo(data)
  } catch (error) {
    if (error?.name === 'AbortError') return { status: 'pending' }
    const message = error instanceof Error ? error.message : String(error)
    if (/timeout|aborted|network/i.test(message)) return { status: 'pending' }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function initSessionCookies(info) {
  const seed = cookieFromLoginInfo(info)
  const res = await fetch(`${BASE}/web/login/session/init`, {
    method: 'POST',
    headers: loginHeaders({
      'Content-Type': 'application/json',
      Cookie: seed,
    }),
    body: JSON.stringify({
      vid: info.vid ?? info.webLoginVid,
      skey: info.skey ?? info.accessToken,
      pf: info.pf ?? 0,
      code: info.code || '',
      expireMode: info.expireMode ?? 0,
      isAutoLogout: info.isAutoLogout ?? 0,
    }),
  })
  const setCookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : []
  if (!setCookies.length) return seed
  return mergeCookieHeader(seed, setCookies)
}

export async function finishLoginFromInfo(info, { getUser, refreshCookie: refresh } = {}) {
  let cookie = cookieFromLoginInfo(info)
  try {
    cookie = await initSessionCookies(info)
  } catch {
    // Assembled wr_* cookies are enough for many accounts.
  }
  if (typeof getUser === 'function') {
    const result = await getUser(cookie)
    if (result?.cookie) cookie = result.cookie
  }
  if (typeof refresh === 'function') {
    try {
      const refreshed = await refresh(cookie)
      if (refreshed?.cookie) cookie = refreshed.cookie
    } catch {
      // Keep the session cookie even if homepage enrichment fails.
    }
  }
  return cookie
}

export async function refreshCookie(cookie) {
  const current = String(cookie || '').trim()
  if (!current) return { cookie: '', changed: false }
  const res = await fetch(BASE, {
    method: 'HEAD',
    headers: loginHeaders({ Cookie: current }),
    redirect: 'manual',
  })
  const setCookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : []
  if (!setCookies.length) {
    // Some environments omit Set-Cookie on HEAD; try GET homepage.
    const getRes = await fetch(BASE, {
      method: 'GET',
      headers: loginHeaders({ Cookie: current, Accept: 'text/html' }),
      redirect: 'manual',
    })
    const getSet = typeof getRes.headers.getSetCookie === 'function'
      ? getRes.headers.getSetCookie()
      : []
    if (!getSet.length) return { cookie: current, changed: false }
    const next = mergeCookieHeader(current, getSet)
    return { cookie: next, changed: next !== current }
  }
  const next = mergeCookieHeader(current, setCookies)
  return { cookie: next, changed: next !== current }
}
