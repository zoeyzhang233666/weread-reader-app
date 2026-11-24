import { buildChaptersMarkdown, paragraphsFromText } from './exportText.js'
import { parseChapterRange } from './range.js'
import { clearSession, loadSession, saveSession } from './store.js'
import * as weread from './weread/client.js'
import { createQrSession, finishLoginFromInfo, pollLoginInfo, refreshCookie } from './weread/login.js'

const COOKIE_REFRESH_MS = 45 * 60 * 1000
const MAX_BATCH = 40

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

  const maybeRefresh = async ({ force = false, patientEmpty = false } = {}) => {
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

    async chapters(bookId) {
      const cookie = requireCookie()
      const list = await weread.getChapters(cookie, bookId)
      return { chapters: list }
    },

    async chapter(bookId, chapterUid) {
      const cookie = requireCookie()
      const content = await weread.getChapterContent(cookie, bookId, chapterUid)
      return {
        format: content.format,
        text: content.text,
        paragraphs: paragraphsFromText(content.text),
      }
    },

    async exportChapters({ bookId, bookTitle = '', author = '', chapterUids = [], range = '' } = {}) {
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
      for (const chapterUid of uids) {
        const meta = byUid.get(String(chapterUid))
        const content = await weread.getChapterContent(cookie, bookId, chapterUid)
        chapters.push({
          chapterUid,
          title: meta?.title || `章节 ${chapterUid}`,
          chapterIdx: meta?.chapterIdx,
          text: content.text,
          paragraphs: paragraphsFromText(content.text),
        })
      }
      const markdown = buildChaptersMarkdown({
        bookTitle: bookTitle || bookId,
        author,
        chapters,
      })
      return { chapters, markdown, count: chapters.length }
    },
  }
}
