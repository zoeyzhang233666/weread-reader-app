/**
 * Rebuild a shelf book into a downloadable file.
 *
 * Weread does NOT expose the original uploaded binary. We reconstruct:
 *  - format=txt  → UTF-8 .txt (chapter texts)
 *  - format=epub / pdf → EPUB3 (.epub) from decrypted chapter XHTML + images
 *    (PDF on shelf is also served as HTML shards; true original PDF bytes are unavailable)
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseChapterBlocks, extractBodyHtml } from '../chapterHtml.js'
import { dataDir } from '../store.js'
import { buildZip } from '../zip.js'
import { fetchImageBytes, isWereadImageUrl } from './images.js'
import * as weread from './client.js'

const MAX_CHAPTERS = 800
const IMAGE_CONCURRENCY = 3

function safeFileBase(title, bookId) {
  const raw = String(title || bookId || 'book')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return raw || String(bookId || 'book')
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function mapPool(items, concurrency, worker) {
  const list = Array.isArray(items) ? items : []
  const out = new Array(list.length)
  let cursor = 0
  async function run() {
    while (cursor < list.length) {
      const i = cursor++
      out[i] = await worker(list[i], i)
    }
  }
  const n = Math.max(1, Math.min(concurrency, list.length || 1))
  await Promise.all(Array.from({ length: n }, () => run()))
  return out
}

function wrapChapterXhtml({ title, bodyHtml, style = '' }) {
  const body = extractBodyHtml(bodyHtml) || `<p>${xmlEscape(title)}</p>`
  const css = String(style || '')
    .replace(/<\/style>/gi, '')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh" xml:lang="zh">
<head>
  <meta charset="utf-8" />
  <title>${xmlEscape(title)}</title>
  <style type="text/css">
    body { font-family: "PingFang SC", "Microsoft YaHei", serif; line-height: 1.7; margin: 1em; }
    img { max-width: 100%; height: auto; }
    ${css}
  </style>
</head>
<body>
${body}
</body>
</html>
`
}

/**
 * Collect img refs to fetch. Relative cover paths (leftover from original EPUB)
 * are resolved to the book cover CDN URL when available.
 * @returns {{ key: string, fetchUrl: string }[]}
 */
function collectImageTargets(html, { coverUrl = '' } = {}) {
  const out = []
  const seen = new Set()
  const re = /<img\b[^>]*\b(?:src|data-src)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi
  let m
  while ((m = re.exec(String(html || '')))) {
    const src = (m[1] || m[2] || m[3] || '').trim()
    if (!src || seen.has(src)) continue
    let fetchUrl = ''
    if (isWereadImageUrl(src)) {
      fetchUrl = src
    } else if (
      coverUrl &&
      !/^https?:\/\//i.test(src) &&
      !/^data:/i.test(src) &&
      /(cover|frontcover)/i.test(src)
    ) {
      fetchUrl = coverUrl
    }
    if (!fetchUrl) continue
    seen.add(src)
    out.push({ key: src, fetchUrl })
  }
  return out
}

function rewriteImageSrcs(html, urlToLocal) {
  return String(html || '').replace(/<img\b[^>]*>/gi, (tag) => {
    let next = tag
    for (const [src, local] of urlToLocal.entries()) {
      if (!src || !local) continue
      const esc = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      next = next.replace(
        new RegExp(`(?:src|data-src)\\s*=\\s*(["'])${esc}\\1`, 'gi'),
        `src="${local}"`,
      )
      next = next.replace(
        new RegExp(`(?:src|data-src)\\s*=\\s*${esc}(?=[\\s>/])`, 'gi'),
        `src="${local}"`,
      )
    }
    return next
  })
}

async function exportTxt(cookie, { bookId, info, chapters, onProgress }) {
  const parts = []
  parts.push(`${info.title || bookId}`)
  if (info.author) parts.push(`作者：${info.author}`)
  parts.push('')
  let done = 0
  const total = chapters.length
  for (const ch of chapters) {
    const content = await weread.getChapterContent(cookie, bookId, ch.chapterUid)
    parts.push(`\n\n# ${ch.title || `章节 ${ch.chapterUid}`}\n`)
    parts.push(content.text || '')
    done += 1
    onProgress?.({
      stage: 'chapters',
      done,
      total,
      title: ch.title,
      percent: Math.min(95, Math.round((done / Math.max(total, 1)) * 95)),
      message: `正在导出章节 ${done}/${total}`,
    })
    await sleep(40)
  }
  onProgress?.({ stage: 'packing', done: total, total, percent: 98, message: '正在打包 TXT…' })
  const buffer = Buffer.from(parts.join('\n'), 'utf8')
  return {
    format: 'txt',
    extension: 'txt',
    mimeType: 'text/plain; charset=utf-8',
    buffer,
    chapterCount: chapters.length,
    note: '由章节正文重建的 TXT（非平台原始上传文件字节）。',
  }
}

async function exportEpub(cookie, { bookId, info, chapters, onProgress }) {
  const chapterFiles = []
  const imageEntries = []
  const urlToLocal = new Map()
  const fetchUrlToZipPath = new Map()
  let imageSeq = 0
  let done = 0
  const total = chapters.length
  const coverUrl = String(info.cover || '').trim()

  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i]
    const content = await weread.getChapterContent(cookie, bookId, ch.chapterUid)
    let html = content.html || `<p>${xmlEscape(content.text || '')}</p>`
    const targets = collectImageTargets(html, { coverUrl })
    await mapPool(targets, IMAGE_CONCURRENCY, async (target) => {
      if (urlToLocal.has(target.key)) return null
      // Reuse already-fetched bytes when multiple keys resolve to same CDN URL.
      if (fetchUrlToZipPath.has(target.fetchUrl)) {
        const zipPath = fetchUrlToZipPath.get(target.fetchUrl)
        // Chapters live under OEBPS/chapters/ → need ../images/...
        urlToLocal.set(target.key, `../${zipPath}`)
        return zipPath
      }
      const file = await fetchImageBytes(target.fetchUrl, cookie)
      if (!file?.ok) return null
      const ext = (file.mimeType.split('/')[1] || 'jpg').replace('jpeg', 'jpg')
      const zipPath = `images/img_${String(++imageSeq).padStart(4, '0')}.${ext}`
      fetchUrlToZipPath.set(target.fetchUrl, zipPath)
      // XHTML is in OEBPS/chapters/*.xhtml; images are OEBPS/images/*
      urlToLocal.set(target.key, `../${zipPath}`)
      imageEntries.push({
        name: `OEBPS/${zipPath}`,
        data: Buffer.from(file.base64, 'base64'),
        mediaType: file.mimeType,
        localName: zipPath,
      })
      return zipPath
    })
    html = rewriteImageSrcs(html, urlToLocal)
    const fileName = `chapters/chap_${String(i + 1).padStart(4, '0')}.xhtml`
    chapterFiles.push({
      href: fileName,
      title: ch.title || `章节 ${i + 1}`,
      id: `chap${i + 1}`,
      data: wrapChapterXhtml({
        title: ch.title || `章节 ${i + 1}`,
        bodyHtml: html,
        style: content.style || '',
      }),
    })
    done += 1
    onProgress?.({
      stage: 'chapters',
      done,
      total,
      title: ch.title,
      percent: Math.min(95, Math.round((done / Math.max(total, 1)) * 95)),
      message: `正在导出章节 ${done}/${total}${imageSeq ? `（插图 ${imageSeq}）` : ''}`,
    })
    await sleep(40)
  }
  onProgress?.({
    stage: 'packing',
    done: total,
    total,
    percent: 98,
    message: `正在打包 EPUB（${imageSeq} 张插图）…`,
  })

  const manifestItems = [
    ...chapterFiles.map((c) => `<item id="${c.id}" href="${c.href}" media-type="application/xhtml+xml"/>`),
    ...imageEntries.map((img, idx) => (
      `<item id="img${idx + 1}" href="${img.localName}" media-type="${img.mediaType}"/>`
    )),
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
  ]
  const spine = chapterFiles.map((c) => `<itemref idref="${c.id}"/>`).join('\n    ')
  const navLis = chapterFiles.map((c, i) => (
    `<li><a href="${c.href}">${xmlEscape(c.title || `章节 ${i + 1}`)}</a></li>`
  )).join('\n        ')

  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="3.0" xml:lang="zh">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">weread-${xmlEscape(bookId)}</dc:identifier>
    <dc:title>${xmlEscape(info.title || bookId)}</dc:title>
    <dc:creator>${xmlEscape(info.author || 'Unknown')}</dc:creator>
    <dc:language>zh</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}</meta>
  </metadata>
  <manifest>
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine>
    ${spine}
  </spine>
</package>
`

  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh" xml:lang="zh">
<head><meta charset="utf-8" /><title>目录</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>目录</h1>
    <ol>
        ${navLis}
    </ol>
  </nav>
</body>
</html>
`

  const container = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`

  const entries = [
    { name: 'mimetype', data: 'application/epub+zip', store: true },
    { name: 'META-INF/container.xml', data: container },
    { name: 'OEBPS/content.opf', data: opf },
    { name: 'OEBPS/nav.xhtml', data: nav },
    ...chapterFiles.map((c) => ({ name: `OEBPS/${c.href}`, data: c.data })),
    ...imageEntries.map((img) => ({ name: img.name, data: img.data })),
  ]

  return {
    format: 'epub',
    extension: 'epub',
    mimeType: 'application/epub+zip',
    buffer: buildZip(entries),
    chapterCount: chapters.length,
    imageCount: imageEntries.length,
    note: info.format === 'pdf'
      ? '书架标注为 PDF，但网页接口只提供章节 HTML，已重建为 EPUB3（非原始 PDF 字节）。'
      : '由章节 XHTML/插图重建的 EPUB3（非平台原始上传文件字节）。',
  }
}

/**
 * Export one book according to shelf format.
 * @returns {Promise<{
 *   bookId: string, title: string, author: string, shelfFormat: string,
 *   format: string, extension: string, mimeType: string, buffer: Buffer,
 *   filename: string, chapterCount: number, imageCount?: number, note: string
 * }>}
 */
export async function exportBookFile(cookie, bookId, { onProgress, maxChapters = MAX_CHAPTERS } = {}) {
  const id = String(bookId || '').trim()
  if (!id) throw new Error('需要 bookId')

  onProgress?.({ stage: 'info', done: 0, total: 0, percent: 1, message: '正在读取书籍信息…' })
  const info = await weread.normalizeBookInfo(await weread.getBookInfo(cookie, id))
  onProgress?.({ stage: 'info', done: 0, total: 0, percent: 3, message: '正在获取章节列表…' })
  const chapters = await weread.getChapters(cookie, id)
  if (!chapters.length) throw new Error('该书没有可导出的章节（可能无权限或需 App 阅读）')
  if (chapters.length > maxChapters) {
    throw new Error(`章节过多（${chapters.length}），当前上限 ${maxChapters}`)
  }

  const shelfFormat = String(info.format || '').toLowerCase() || 'txt'
  onProgress?.({
    stage: 'chapters',
    done: 0,
    total: chapters.length,
    percent: 5,
    message: `共 ${chapters.length} 章，开始导出…`,
  })
  let exported
  if (shelfFormat === 'txt') {
    exported = await exportTxt(cookie, { bookId: id, info, chapters, onProgress })
  } else if (shelfFormat === 'epub' || shelfFormat === 'pdf') {
    exported = await exportEpub(cookie, { bookId: id, info, chapters, onProgress })
  } else {
    throw new Error(`暂不支持导出格式：${shelfFormat || '(unknown)'}`)
  }

  const filename = `${safeFileBase(info.title, id)}.${exported.extension}`
  onProgress?.({
    stage: 'done',
    done: chapters.length,
    total: chapters.length,
    percent: 100,
    message: '导出完成',
    filename,
  })
  return {
    bookId: id,
    title: info.title || id,
    author: info.author || '',
    shelfFormat,
    format: exported.format,
    extension: exported.extension,
    mimeType: exported.mimeType,
    buffer: exported.buffer,
    filename,
    chapterCount: exported.chapterCount,
    imageCount: exported.imageCount || 0,
    note: exported.note,
    byteLength: exported.buffer.length,
  }
}

export function saveExportToDownloads(exported) {
  const dir = join(dataDir(), 'downloads')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, exported.filename)
  writeFileSync(path, exported.buffer)
  return { path, dir }
}
