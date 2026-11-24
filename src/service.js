import { blocksToMarkdown, parseChapterBlocks, summarizeBlocksForMcp } from './chapterHtml.js'
import { buildChaptersMarkdown, paragraphsFromText } from './exportText.js'
import { parseChapterRange } from './range.js'
import { clearSession, loadSession, saveSession } from './store.js'
import * as weread from './weread/client.js'
import { fetchImageBatch } from './weread/images.js'
import { createQrSession, finishLoginFromInfo, pollLoginInfo, refreshCookie } from './weread/login.js'

const COOKIE_REFRESH_MS = 45 * 60 * 1000
const MAX_BATCH = 40
const DEFAULT_IMAGE_LIMIT = 4
const MAX_IMAGE_LIMIT = 10

function clampInt(value, { min = 0, max = 100, fallback = 0 } = {}) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

export function createService() {
  let session = loadSession()

  const persistCookie = (cookie) => {
    session = saveSession({ cookie, cookieUpdatedAt: Date.now() })
    return session.cookie
  }

  const requireCookie = () => {
    const cookie = String(session.cookie || '').trim()
    if (!cookie) {
      const error = new Error('未登录。请先在 App 中扫码登录微信读书。')
      error.code = 'UNAUTHORIZED'
      throw error
    }
    return cookie
  }

  const maybeRefresh = async ({ force = false } = {}) => {
    const cookie = String(session.cookie || '').trim()
    if (!cookie) return null
    const age = Date.now() - (session.cookieUpdatedAt || 0)
    if (!force && session.cookieUpdatedAt > 0 && age < COOKIE_REFRESH_MS) return cookie
    try {
      const refreshed = await refreshCookie(cookie)
      if (refreshed.changed) {
        const verified = await weread.getUser(refreshed.cookie)
        return persistCookie(verified.cookie || refreshed.cookie)
      }
      if (!session.cookieUpdatedAt) {
        session = saveSession({ cookie, cookieUpdatedAt: Date.now() })
      }
      return cookie
    } catch {
      return cookie
    }
  }

  const loadRichChapter = async (cookie, bookId, chapterUid) => {
    const content = await weread.getChapterContent(cookie, bookId, chapterUid)
    const parsed = content.html
      ? parseChapterBlocks(content.html)
      : { blocks: content.text ? [{ type: 'text', text: content.text }] : [], images: [], tables: [], imageCount: 0, tableCount: 0 }
    return { content, parsed }
  }

  return {
    status() {
      session = loadSession()
      return {
        loggedIn: Boolean(String(session.cookie || '').trim()),
        dataDir: undefined,
      }
    },

    async startQr() {
      return createQrSession()
    },

    async waitQr({ uid, otp = '' } = {}) {
      const poll = await pollLoginInfo(uid, { otp: String(otp || '') })
      if (poll.status !== 'ok') {
        return { status: poll.status, error: poll.error || undefined }
      }
      const cookie = await finishLoginFromInfo(poll.info, {
        getUser: weread.getUser,
        refreshCookie,
      })
      persistCookie(cookie)
      try {
        await weread.getShelf(cookie, { retries: 5, patientEmpty: true })
      } catch {
        // warm only
      }
      return { status: 'ok', loggedIn: true }
    },

    async logout() {
      clearSession()
      session = loadSession()
      return { ok: true }
    },

    async shelf({ patient = false } = {}) {
      let cookie = requireCookie()
      cookie = (await maybeRefresh()) || cookie
      try {
        return await weread.getShelf(cookie, {
          retries: patient ? 5 : 3,
          patientEmpty: patient,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (/过期|Login|扫码|expired/i.test(message)) {
          const retry = await maybeRefresh({ force: true })
          if (retry && retry !== cookie) {
            return weread.getShelf(retry, { retries: patient ? 5 : 3, patientEmpty: patient })
          }
        }
        throw error
      }
    },

    async bookInfo(bookId) {
      const cookie = requireCookie()
      const id = String(bookId || '').trim()
      if (!id) throw new Error('需要 bookId')
      const [info, chapters] = await Promise.all([
        weread.getBookInfo(cookie, id),
        weread.getChapters(cookie, id).catch(() => []),
      ])
      return weread.normalizeBookInfo(info, { chapterCount: chapters.length || null })
    },

    async chapters(bookId) {
      const cookie = requireCookie()
      const list = await weread.getChapters(cookie, bookId)
      return { chapters: list }
    },

    /** Plain chapter (backward compatible). */
    async chapter(bookId, chapterUid) {
      const cookie = requireCookie()
      const content = await weread.getChapterContent(cookie, bookId, chapterUid)
      return {
        format: content.format,
        text: content.text,
        paragraphs: paragraphsFromText(content.text),
      }
    },

    /**
     * Rich chapter for MCP / API.
     * options:
     *  - includeHtml, includeBlocks
     *  - includeImages + imageOffset + imageLimit (bytes via images[])
     */
    async chapterRich(bookId, chapterUid, options = {}) {
      const cookie = requireCookie()
      const id = String(bookId || '').trim()
      const uid = String(chapterUid || '').trim()
      if (!id || !uid) throw new Error('需要 bookId 与 chapterUid')

      const includeHtml = Boolean(options.includeHtml)
      const includeBlocks = options.includeBlocks !== false
      const includeImages = Boolean(options.includeImages)
      const imageOffset = clampInt(options.imageOffset, { min: 0, max: 10_000, fallback: 0 })
      const imageLimit = clampInt(options.imageLimit, {
        min: 1,
        max: MAX_IMAGE_LIMIT,
        fallback: DEFAULT_IMAGE_LIMIT,
      })

      const { content, parsed } = await loadRichChapter(cookie, id, uid)
      const richMarkdown = blocksToMarkdown(parsed.blocks, { imageMode: 'url' })

      const payload = {
        bookId: id,
        chapterUid: uid,
        format: content.format,
        text: content.text,
        paragraphs: paragraphsFromText(content.text),
        markdown: richMarkdown,
        imageCount: parsed.imageCount,
        tableCount: parsed.tableCount,
        imageOffset,
        imageLimit: includeImages ? imageLimit : 0,
        imagesReturned: 0,
        imagesHasMore: false,
        images: [],
        imageErrors: [],
      }

      if (includeBlocks) {
        Object.assign(payload, summarizeBlocksForMcp(parsed, { includeHtml, html: content.html }))
      } else if (includeHtml) {
        payload.html = content.html || ''
      }

      if (includeImages && parsed.images.length) {
        const slice = parsed.images.slice(imageOffset, imageOffset + imageLimit)
        payload.imagesHasMore = imageOffset + slice.length < parsed.images.length
        const fetched = await fetchImageBatch(slice.map(img => img.src), cookie, { concurrency: 3 })
        for (let i = 0; i < slice.length; i++) {
          const meta = slice[i]
          const file = fetched[i]
          if (file?.ok) {
            payload.images.push({
              index: meta.index,
              src: meta.src,
              alt: meta.alt,
              mimeType: file.mimeType,
              byteLength: file.byteLength,
              base64: file.base64,
            })
          } else {
            payload.imageErrors.push({
              index: meta.index,
              src: meta.src,
              error: file?.error || 'fetch failed',
            })
          }
        }
        payload.imagesReturned = payload.images.length
      }

      return payload
    },

    async chapterImages(bookId, chapterUid, options = {}) {
      return this.chapterRich(bookId, chapterUid, {
        includeHtml: false,
        includeBlocks: true,
        includeImages: true,
        imageOffset: options.imageOffset,
        imageLimit: options.imageLimit,
      })
    },

    async exportChapters({
      bookId,
      bookTitle = '',
      author = '',
      chapterUids = [],
      range = '',
      rich = false,
      includeImages = false,
      imageOffset = 0,
      imageLimit = DEFAULT_IMAGE_LIMIT,
    } = {}) {
      const cookie = requireCookie()
      const catalog = await weread.getChapters(cookie, bookId)
      let uids = Array.isArray(chapterUids)
        ? chapterUids.map(uid => String(uid || '').trim()).filter(Boolean)
        : []
      if (!uids.length && range) {
        const indexes = parseChapterRange(range, catalog.length)
        uids = indexes.map(index => String(catalog[index].chapterUid))
      }
      if (!bookId || !uids.length) {
        throw new Error('需要 bookId，以及 chapterUids 或 range（如 1-10）')
      }
      if (uids.length > MAX_BATCH) {
        throw new Error(`一次最多导出 ${MAX_BATCH} 章`)
      }
      const byUid = new Map(catalog.map(item => [String(item.chapterUid), item]))
      const chapters = []
      const collectedImages = []

      for (const chapterUid of uids) {
        const meta = byUid.get(String(chapterUid))
        if (rich || includeImages) {
          const { content, parsed } = await loadRichChapter(cookie, bookId, chapterUid)
          chapters.push({
            chapterUid,
            title: meta?.title || `章节 ${chapterUid}`,
            chapterIdx: meta?.chapterIdx,
            text: content.text,
            markdown: blocksToMarkdown(parsed.blocks, { imageMode: 'url' }),
            imageCount: parsed.imageCount,
            tableCount: parsed.tableCount,
            paragraphs: paragraphsFromText(content.text),
          })
          for (const img of parsed.images) {
            collectedImages.push({
              chapterUid,
              chapterTitle: meta?.title || `章节 ${chapterUid}`,
              ...img,
            })
          }
        } else {
          const content = await weread.getChapterContent(cookie, bookId, chapterUid)
          chapters.push({
            chapterUid,
            title: meta?.title || `章节 ${chapterUid}`,
            chapterIdx: meta?.chapterIdx,
            text: content.text,
            paragraphs: paragraphsFromText(content.text),
          })
        }
      }

      const markdown = buildChaptersMarkdown({
        bookTitle: bookTitle || bookId,
        author,
        chapters,
        rich: Boolean(rich || includeImages),
      })

      const result = {
        chapters,
        markdown,
        count: chapters.length,
        imageCount: collectedImages.length,
        images: [],
        imageErrors: [],
        imagesHasMore: false,
      }

      if (includeImages && collectedImages.length) {
        const offset = clampInt(imageOffset, { min: 0, max: 10_000, fallback: 0 })
        const limit = clampInt(imageLimit, { min: 1, max: MAX_IMAGE_LIMIT, fallback: DEFAULT_IMAGE_LIMIT })
        const slice = collectedImages.slice(offset, offset + limit)
        result.imagesHasMore = offset + slice.length < collectedImages.length
        const fetched = await fetchImageBatch(slice.map(img => img.src), cookie, { concurrency: 3 })
        for (let i = 0; i < slice.length; i++) {
          const meta = slice[i]
          const file = fetched[i]
          if (file?.ok) {
            result.images.push({
              chapterUid: meta.chapterUid,
              chapterTitle: meta.chapterTitle,
              index: meta.index,
              src: meta.src,
              alt: meta.alt,
              mimeType: file.mimeType,
              byteLength: file.byteLength,
              base64: file.base64,
            })
          } else {
            result.imageErrors.push({
              chapterUid: meta.chapterUid,
              index: meta.index,
              src: meta.src,
              error: file?.error || 'fetch failed',
            })
          }
        }
      }

      return result
    },
  }
}
