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

function collectImageUrls(html) {
  const urls = []
  const re = /<img\b[^>]*\b(?:src|data-src)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi
  let m
  while ((m = re.exec(String(html || '')))) {
    const src = (m[1] || m[2] || m[3] || '').trim()
    if (src && isWereadImageUrl(src)) urls.push(src)
  }
  return [...new Set(urls)]
}

function rewriteImageSrcs(html, urlToLocal) {
  return String(html || '').replace(
    /(<img\b[^>]*\b)(?:src|data-src)(\s*=\s*)(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi,
    (full, pre, eq, a, b, c) => {
      const src = (a || b || c || '').trim()
      const local = urlToLocal.get(src)
      if (!local) return full
      return `${pre}src${eq}"${local}"`
    },
  )
}

async function exportTxt(cookie, { bookId, info, chapters, onProgress }) {
  const parts = []
  parts.push(`${info.title || bookId}`)
  if (info.author) parts.push(`作者：${info.author}`)
  parts.push('')
  let done = 0
  for (const ch of chapters) {
    const content = await weread.getChapterContent(cookie, bookId, ch.chapterUid)
    parts.push(`\n\n# ${ch.title || `章节 ${ch.chapterUid}`}\n`)
    parts.push(content.text || '')
    done += 1
    onProgress?.({ done, total: chapters.length, title: ch.title })
    await sleep(40)
  }
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
  let imageSeq = 0
  let done = 0

  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i]
    const content = await weread.getChapterContent(cookie, bookId, ch.chapterUid)
    let html = content.html || `<p>${xmlEscape(content.text || '')}</p>`
    const urls = collectImageUrls(html)
    const fetched = await mapPool(urls, IMAGE_CONCURRENCY, async (src) => {
      if (urlToLocal.has(src)) return null
      const file = await fetchImageBytes(src, cookie)
      if (!file?.ok) return null
      const ext = (file.mimeType.split('/')[1] || 'jpg').replace('jpeg', 'jpg')
      const localName = `images/img_${String(++imageSeq).padStart(4, '0')}.${ext}`
      urlToLocal.set(src, localName)
      imageEntries.push({
        name: `OEBPS/${localName}`,
        data: Buffer.from(file.base64, 'base64'),
        mediaType: file.mimeType,
        localName,
      })
      return localName
    })
    void fetched
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
    onProgress?.({ done, total: chapters.length, title: ch.title })
    await sleep(40)
  }

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

  const info = await weread.normalizeBookInfo(await weread.getBookInfo(cookie, id))
  const chapters = await weread.getChapters(cookie, id)
  if (!chapters.length) throw new Error('该书没有可导出的章节（可能无权限或需 App 阅读）')
  if (chapters.length > maxChapters) {
    throw new Error(`章节过多（${chapters.length}），当前上限 ${maxChapters}`)
  }

  const shelfFormat = String(info.format || '').toLowerCase() || 'txt'
  let exported
  if (shelfFormat === 'txt') {
    exported = await exportTxt(cookie, { bookId: id, info, chapters, onProgress })
  } else if (shelfFormat === 'epub' || shelfFormat === 'pdf') {
    exported = await exportEpub(cookie, { bookId: id, info, chapters, onProgress })
  } else {
    throw new Error(`暂不支持导出格式：${shelfFormat || '(unknown)'}`)
  }

  const filename = `${safeFileBase(info.title, id)}.${exported.extension}`
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
