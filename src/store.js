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
