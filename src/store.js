import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DIR = join(homedir(), '.weread-reader')
const FILE = join(DIR, 'session.json')

function ensureDir() {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true })
}

export function loadSession() {
  try {
    if (!existsSync(FILE)) return { cookie: '', cookieUpdatedAt: 0 }
    const raw = JSON.parse(readFileSync(FILE, 'utf8'))
    return {
      cookie: String(raw.cookie || ''),
      cookieUpdatedAt: Number(raw.cookieUpdatedAt || 0) || 0,
    }
  } catch {
    return { cookie: '', cookieUpdatedAt: 0 }
  }
}

export function saveSession(patch) {
  ensureDir()
  const current = loadSession()
  const next = {
    cookie: patch.cookie != null ? String(patch.cookie) : current.cookie,
    cookieUpdatedAt: patch.cookieUpdatedAt != null
      ? Number(patch.cookieUpdatedAt) || 0
      : current.cookieUpdatedAt,
  }
  writeFileSync(FILE, JSON.stringify(next, null, 2))
  return next
}

export function clearSession() {
  return saveSession({ cookie: '', cookieUpdatedAt: 0 })
}

export function dataDir() {
  ensureDir()
  return DIR
}

const TUNNEL_KEY_FILE = join(DIR, 'tunnel-runtime-api-key.txt')

export function tunnelKeyPath() {
  return TUNNEL_KEY_FILE
}

export function loadTunnelRuntimeKey() {
  try {
    if (!existsSync(TUNNEL_KEY_FILE)) return ''
    return String(readFileSync(TUNNEL_KEY_FILE, 'utf8')).trim().split(/\r?\n/)[0].trim()
  } catch {
    return ''
  }
}

export function saveTunnelRuntimeKey(key) {
  const value = String(key || '').trim()
  if (!value) throw new Error('隧道 Runtime API Key 为空')
  if (!/^sk-/i.test(value)) {
    throw new Error('隧道 Key 一般以 sk- 开头（OpenAI Platform Runtime API Key）')
  }
  ensureDir()
  writeFileSync(TUNNEL_KEY_FILE, `${value}\n`, { mode: 0o600 })
  return {
    ok: true,
    path: TUNNEL_KEY_FILE,
    prefix: `${value.slice(0, 7)}…`,
    configured: true,
  }
}

export function clearTunnelRuntimeKey() {
  ensureDir()
  writeFileSync(TUNNEL_KEY_FILE, '')
  return { ok: true, configured: false, path: TUNNEL_KEY_FILE }
}

export function tunnelKeyStatus() {
  const key = loadTunnelRuntimeKey()
  return {
    configured: Boolean(key),
    path: TUNNEL_KEY_FILE,
    prefix: key ? `${key.slice(0, 7)}…` : '',
    source: key ? 'file' : 'none',
  }
}
