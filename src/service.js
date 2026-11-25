import { blocksToMarkdown, parseChapterBlocks, summarizeBlocksForMcp } from './chapterHtml.js'
import { buildChaptersMarkdown, paragraphsFromText } from './exportText.js'
import { parseChapterRange } from './range.js'
import {
  clearSession,
  loadSession,
  saveSession,
  tunnelKeyStatus as getTunnelKeyStatus,
  saveTunnelRuntimeKey,
  clearTunnelRuntimeKey,
} from './store.js'
import * as weread from './weread/client.js'
import { fetchImageBatch, fetchImageBytes, isWereadImageUrl } from './weread/images.js'
import { createQrSession, finishLoginFromInfo, pollLoginInfo, refreshCookie } from './weread/login.js'
import { makeQrDataUrl } from './weread/qr.js'
import * as official from './weread/official.js'

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
      const session = await createQrSession()
      let qrDataUrl = ''
      try {
        qrDataUrl = makeQrDataUrl(session.qrUrl)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`生成本地二维码失败：${message}`)
      }
      return {
        ...session,
        qrDataUrl,
        scanHint: '请用手机「微信 → 扫一扫」扫描（不要用微信读书 App 内的扫一扫）',
      }
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

    /** Bookshelf folders (Weread archive / 书单分组). */
    async shelfGroups({ patient = false } = {}) {
      const shelf = await this.shelf({ patient })
      const groups = (shelf.groups || []).map((g) => ({
        groupId: g.groupId,
        archiveId: g.archiveId,
        name: g.name,
        bookCount: g.bookCount,
        albumCount: g.albumCount,
        updateTime: g.updateTime,
      }))
      return {
        groupCount: groups.length,
        groups,
        source: 'cookie:/web/shelf/sync archive[]',
        note: 'Official gateway /shelf/sync also returns archive[] (name+bookIds) but omits archiveId; Cookie sync is preferred for stable groupId.',
      }
    },

    async shelfGroupBooks({ groupId, name, patient = false } = {}) {
      const id = String(groupId || '').trim()
      const n = String(name || '').trim()
      if (!id && !n) throw new Error('需要 groupId 或 name（书架分组 ID / 名称，如「神作」「仙草」）')
      const shelf = await this.shelf({ patient })
      const group = weread.findShelfGroup(shelf.groups || [], { groupId: id, name: n })
      if (!group) {
        const available = (shelf.groups || []).map((g) => `${g.name}(${g.groupId})`).join('、')
        throw new Error(`未找到分组「${id || n}」。现有分组：${available || '无'}`)
      }
      const idSet = new Set(group.bookIds.map(String))
      const books = (shelf.books || []).filter((b) => idSet.has(String(b.bookId)))
      // Preserve archive order when possible
      const byId = new Map(books.map((b) => [String(b.bookId), b]))
      const ordered = group.bookIds.map((bid) => byId.get(String(bid))).filter(Boolean)
      return {
        group: {
          groupId: group.groupId,
          archiveId: group.archiveId,
          name: group.name,
          bookCount: group.bookCount,
        },
        bookCount: ordered.length,
        books: ordered,
        missingBookIds: group.bookIds.filter((bid) => !byId.has(String(bid))),
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

    /** Proxy a Weread CDN chapter image for the local reader UI (needs login cookie). */
    async proxyChapterImage(src) {
      const cookie = requireCookie()
      const url = String(src || '').trim()
      if (!url) return { ok: false, status: 400, error: '缺少 src' }
      if (!isWereadImageUrl(url) && !/^data:image\//i.test(url)) {
        return { ok: false, status: 400, error: '仅允许微信读书图片域名' }
      }
      const file = await fetchImageBytes(url, cookie)
      if (!file?.ok) {
        return { ok: false, status: file?.status || 502, error: file?.error || '拉取图片失败' }
      }
      return {
        ok: true,
        mimeType: file.mimeType,
        buffer: Buffer.from(file.base64, 'base64'),
      }
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

    // ——— Official Agent Gateway (wrk- API Key; stats / notes / search / …) ———

    officialStatus() {
      return official.officialKeyStatus()
    },

    setOfficialKey(key) {
      return official.saveOfficialApiKey(key)
    },

    clearOfficialKey() {
      return official.clearOfficialApiKey()
    },

    tunnelKeyStatus() {
      return getTunnelKeyStatus()
    },

    setTunnelKey(key) {
      return saveTunnelRuntimeKey(key)
    },

    clearTunnelKey() {
      return clearTunnelRuntimeKey()
    },

    async officialCall(apiName, params = {}) {
      const name = String(apiName || '').trim()
      if (!official.OFFICIAL_APIS.includes(name) && name !== '/_list') {
        throw new Error(`不允许的 api_name：${name}。允许：${official.OFFICIAL_APIS.join(', ')}`)
      }
      return official.officialGateway(name, params && typeof params === 'object' ? params : {})
    },

    async readingStats({ mode = 'monthly', baseTime } = {}) {
      const params = { mode: String(mode || 'monthly') }
      if (baseTime != null && baseTime !== '') params.baseTime = Number(baseTime)
      const data = await official.officialGateway('/readdata/detail', params)
      return official.summarizeReadingStats(data, params.mode)
    },

    async searchBooks({ keyword, scope = 10, context = '' } = {}) {
      const kw = String(keyword || '').trim()
      if (!kw) throw new Error('需要 keyword')
      const data = await official.officialGateway('/store/search', {
        keyword: kw,
        scope: Number(scope) || 10,
        context: String(context || kw),
      })
      return data
    },

    async bookProgress(bookId) {
      const id = String(bookId || '').trim()
      if (!id) throw new Error('需要 bookId')
      const data = await official.officialGateway('/book/getprogress', { bookId: id })
      return official.summarizeProgress(data)
    },

    async officialBookInfo(bookId) {
      const id = String(bookId || '').trim()
      if (!id) throw new Error('需要 bookId')
      return official.officialGateway('/book/info', { bookId: id })
    },

    async listNotebooks({ count = 50, lastSort } = {}) {
      const params = { count: Math.min(100, Math.max(1, Number(count) || 50)) }
      if (lastSort != null && lastSort !== '') params.lastSort = Number(lastSort)
      return official.officialGateway('/user/notebooks', params)
    },

    async bookNotes(bookId) {
      const id = String(bookId || '').trim()
      if (!id) throw new Error('需要 bookId')
      const [bookmarks, reviews] = await Promise.all([
        official.officialGateway('/book/bookmarklist', { bookId: id }).catch((e) => ({
          error: e instanceof Error ? e.message : String(e),
        })),
        official.officialGateway('/review/list/mine', { bookId: id }).catch((e) => ({
          error: e instanceof Error ? e.message : String(e),
        })),
      ])
      return { bookId: id, bookmarks, reviews }
    },

    async bookReviews({ bookId, count = 20 } = {}) {
      const id = String(bookId || '').trim()
      if (!id) throw new Error('需要 bookId')
      return official.officialGateway('/review/list', {
        bookId: id,
        count: Math.min(50, Math.max(1, Number(count) || 20)),
      })
    },

    async recommendBooks({ bookId, context = '给我推荐几本书', count = 12 } = {}) {
      const id = String(bookId || '').trim()
      const ctx = String(context || '给我推荐几本书')
      if (id) {
        return official.officialGateway('/book/similar', {
          bookId: id,
          context: ctx,
          count: Number(count) || 12,
          maxIdx: 0,
        })
      }
      return official.officialGateway('/book/recommend', { context: ctx })
    },

    async hotBookmarks({ bookId, chapterUid = 0 } = {}) {
      const id = String(bookId || '').trim()
      if (!id) throw new Error('需要 bookId')
      return official.officialGateway('/book/bestbookmarks', {
        bookId: id,
        chapterUid: Number(chapterUid) || 0,
      })
    },
  }
}
