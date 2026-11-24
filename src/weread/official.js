/**
 * Official WeChat Reading Agent Gateway client (Tencent/WeChatReading skill).
 * Auth: WEREAD_API_KEY (wrk-…) — does NOT replace cookie-based chapter HTML reading.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from '../store.js'

const GATEWAY = 'https://i.weread.qq.com/api/agent/gateway'
const SKILL_VERSION = '1.0.6'
const KEY_FILE = () => join(dataDir(), 'official-api-key.txt')

export const OFFICIAL_APIS = [
  '/readdata/detail',
  '/shelf/sync',
  '/store/search',
  '/book/info',
  '/book/chapterinfo',
  '/book/getprogress',
  '/user/notebooks',
  '/book/bookmarklist',
  '/review/list/mine',
  '/review/list',
  '/book/underlines',
  '/book/bestbookmarks',
  '/book/readreviews',
  '/review/single',
  '/book/recommend',
  '/book/similar',
]

export function loadOfficialApiKey() {
  const fromEnv = String(process.env.WEREAD_API_KEY || '').trim()
  if (fromEnv) return fromEnv
  try {
    const file = KEY_FILE()
    if (!existsSync(file)) return ''
    return String(readFileSync(file, 'utf8')).trim().split(/\r?\n/)[0].trim()
  } catch {
    return ''
  }
}

export function saveOfficialApiKey(key) {
  const value = String(key || '').trim()
  if (!value) throw new Error('API Key 为空')
  if (!/^wrk-/i.test(value)) {
    throw new Error('官方 API Key 应以 wrk- 开头（在 weread.qq.com/r/weread-skills 获取）')
  }
  writeFileSync(KEY_FILE(), `${value}\n`, { mode: 0o600 })
  return { ok: true, path: KEY_FILE(), prefix: `${value.slice(0, 8)}…` }
}

export function clearOfficialApiKey() {
  const file = KEY_FILE()
  if (existsSync(file)) writeFileSync(file, '')
  return { ok: true }
}

export function officialKeyStatus() {
  const key = loadOfficialApiKey()
  return {
    configured: Boolean(key),
    source: process.env.WEREAD_API_KEY ? 'env:WEREAD_API_KEY' : key ? 'file' : 'none',
    path: KEY_FILE(),
    prefix: key ? `${key.slice(0, 8)}…` : '',
    skillVersion: SKILL_VERSION,
    getKeyUrl: 'https://weread.qq.com/r/weread-skills',
  }
}

export function formatDurationSeconds(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}小时${m}分钟`
  if (m > 0) return `${m}分钟${s ? `${s}秒` : ''}`.replace(/秒$/, s ? '秒' : '')
  return `${s}秒`
}

export function formatUnixDate(ts) {
  const n = Number(ts)
  if (!Number.isFinite(n) || n <= 0) return null
  const d = new Date(n * (n > 1e12 ? 1 : 1000))
  if (Number.isNaN(d.getTime())) return null
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export async function officialGateway(apiName, params = {}) {
  const key = loadOfficialApiKey()
  if (!key) {
    const err = new Error(
      '未配置官方 WEREAD_API_KEY。请打开 https://weread.qq.com/r/weread-skills 获取 Key，然后：export WEREAD_API_KEY=wrk-… 或写入 ~/.weread-reader/official-api-key.txt，或调用 weread_set_official_key。',
    )
    err.code = 'OFFICIAL_KEY_MISSING'
    throw err
  }

  const name = String(apiName || '').trim()
  if (!name.startsWith('/')) {
    throw new Error(`api_name 必须以 / 开头，收到：${name}`)
  }

  const body = {
    ...params,
    api_name: name,
    skill_version: SKILL_VERSION,
  }
  // Never allow nested params bag by mistake
  delete body.params

  const res = await fetch(GATEWAY, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'User-Agent': 'weread-reader-app/0.3',
    },
    body: JSON.stringify(body),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(`官方 Gateway HTTP ${res.status}: ${data?.errmsg || data?.errMsg || res.statusText}`)
  }
  const code = data?.errcode ?? data?.errCode
  if (code != null && code !== 0) {
    throw new Error(data?.errmsg || data?.errMsg || `官方接口错误 ${code}`)
  }
  return data
}

/** Summarize /readdata/detail for humans + keep raw. */
export function summarizeReadingStats(data = {}, mode = 'monthly') {
  const totalSec = Number(data.totalReadTime) || 0
  const avgSec = Number(data.dayAverageReadTime) || 0
  const longest = Array.isArray(data.readLongest)
    ? data.readLongest.slice(0, 10).map((row) => ({
        title: row.book?.title || row.albumInfo?.title || '',
        author: row.book?.author || '',
        bookId: row.book?.bookId || '',
        readTimeSec: row.readTime,
        readTime: formatDurationSeconds(row.readTime),
        tags: row.tags || [],
      }))
    : []
  const preferCategory = Array.isArray(data.preferCategory)
    ? data.preferCategory.slice(0, 8).map((c) => ({
        title: c.categoryTitle || c.parentCategoryTitle || '',
        readingTime: formatDurationSeconds(c.readingTime),
        readingCount: c.readingCount,
      }))
    : []

  return {
    mode,
    baseTime: data.baseTime,
    baseDate: formatUnixDate(data.baseTime),
    totalReadTimeSec: totalSec,
    totalReadTime: formatDurationSeconds(totalSec),
    dayAverageReadTimeSec: avgSec,
    dayAverageReadTime: formatDurationSeconds(avgSec),
    readDays: data.readDays,
    compare: data.compare,
    preferCategoryWord: data.preferCategoryWord,
    preferTimeWord: data.preferTimeWord,
    readStat: data.readStat || [],
    readLongest: longest,
    preferCategory,
    rank: data.rank || null,
    unitNote: '官方字段 totalReadTime / readTime 单位均为秒；展示已换算为小时分钟。',
    raw: data,
  }
}

export function summarizeProgress(data = {}) {
  const book = data.book || {}
  const progress = Number(book.progress)
  const readSec = Number(book.recordReadingTime) || 0
  return {
    bookId: data.bookId || book.bookId,
    progressPercent: Number.isFinite(progress) ? progress : null,
    progressLabel: Number.isFinite(progress) ? `${progress}%` : null,
    chapterUid: book.chapterUid,
    chapterOffset: book.chapterOffset,
    updateTime: formatUnixDate(book.updateTime),
    finishTime: formatUnixDate(book.finishTime),
    isStartReading: book.isStartReading,
    recordReadingTimeSec: readSec,
    recordReadingTime: formatDurationSeconds(readSec),
    note: 'progress 为 0–100 的整数百分比；只有 100 且存在 finishTime 才表示读完。',
    raw: data,
  }
}
