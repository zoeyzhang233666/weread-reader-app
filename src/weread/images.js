/** Fetch Weread CDN chapter images for MCP ImageContent (no OCR). */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

const MIME_FROM_MAGIC = [
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 },
  { mime: 'image/png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: 'image/gif', test: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 },
  { mime: 'image/webp', test: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 },
  { mime: 'image/svg+xml', test: (b) => /^\s*<svg[\s>]/i.test(Buffer.from(b).toString('utf8').slice(0, 64)) },
]

function sniffMime(buf, headerMime = '') {
  const header = String(headerMime || '').split(';')[0].trim().toLowerCase()
  if (header.startsWith('image/')) return header
  for (const row of MIME_FROM_MAGIC) {
    if (row.test(buf)) return row.mime
  }
  return 'application/octet-stream'
}

export function isWereadImageUrl(url) {
  try {
    const u = new URL(String(url || ''))
    return (
      (u.protocol === 'https:' || u.protocol === 'http:') &&
      /(^|\.)weread\.qq\.com$/i.test(u.hostname)
    )
  } catch {
    return false
  }
}

/**
 * Download one image. Never throws for network/HTTP failures — returns { ok:false }.
 */
export async function fetchImageBytes(url, cookie = '') {
  const src = String(url || '').trim()
  if (!src) return { ok: false, error: 'empty url' }
  if (!isWereadImageUrl(src) && !/^data:image\//i.test(src)) {
    return { ok: false, error: 'unsupported image host', src }
  }

  if (/^data:image\//i.test(src)) {
    const m = src.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/i)
    if (!m) return { ok: false, error: 'bad data-url', src }
    return {
      ok: true,
      src,
      mimeType: m[1].toLowerCase(),
      base64: m[2],
      byteLength: Buffer.from(m[2], 'base64').length,
    }
  }

  try {
    const headers = {
      'User-Agent': UA,
      Referer: 'https://weread.qq.com/',
      Origin: 'https://weread.qq.com',
    }
    if (cookie) headers.Cookie = cookie
    const res = await fetch(src, { headers, redirect: 'follow' })
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}`, src, status: res.status }
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (!buf.length) return { ok: false, error: 'empty body', src }
    const mimeType = sniffMime(buf, res.headers.get('content-type'))
    if (!mimeType.startsWith('image/')) {
      return { ok: false, error: `not an image (${mimeType})`, src }
    }
    return {
      ok: true,
      src,
      mimeType,
      base64: buf.toString('base64'),
      byteLength: buf.length,
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      src,
    }
  }
}

export async function fetchImageBatch(urls, cookie = '', { concurrency = 3 } = {}) {
  const list = Array.isArray(urls) ? urls : []
  const out = new Array(list.length)
  let cursor = 0
  async function worker() {
    while (cursor < list.length) {
      const i = cursor++
      out[i] = await fetchImageBytes(list[i], cookie)
    }
  }
  const n = Math.max(1, Math.min(concurrency, list.length || 1))
  await Promise.all(Array.from({ length: n }, () => worker()))
  return out
}
