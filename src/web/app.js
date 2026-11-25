const state = {
  tab: 'shelf',
  loggedIn: false,
  books: [],
  book: null,
  chapters: [],
  chapterIdx: 0,
  chapterText: '',
  paragraphs: [],
  pages: [],
  pageIndex: 0,
  pageWidth: 0,
  pageHeight: 0,
  showToc: false,
  showBatch: false,
  selected: new Set(),
  rangeDraft: '1-10',
  fontScale: 1,
  qr: null,
  qrPhase: 'idle',
  otp: '',
  loading: false,
  official: { configured: false, prefix: '', source: 'none', getKeyUrl: 'https://weread.qq.com/r/weread-skills' },
  officialKeyDraft: '',
  officialBusy: false,
  tunnel: { configured: false, prefix: '', source: 'none', path: '' },
  tunnelKeyDraft: '',
  tunnelBusy: false,
}

const els = {
  body: document.getElementById('body'),
  error: document.getElementById('error'),
  toast: document.getElementById('toast'),
  loginMeta: document.getElementById('login-meta'),
  bottom: document.getElementById('bottom'),
  bottomTitle: document.getElementById('bottom-title'),
  bottomMeta: document.getElementById('bottom-meta'),
  tabShelf: document.getElementById('tab-shelf'),
  tabReading: document.getElementById('tab-reading'),
  tabSettings: document.getElementById('tab-settings'),
}

let toastTimer = 0
let qrAbort = 0
const pointer = { x: 0, y: 0, selecting: false }

async function api(path, init = {}) {
  const res = await fetch(path, {
    cache: 'no-store',
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
  return body
}

function showError(message) {
  if (!message) {
    els.error.classList.add('hidden')
    els.error.textContent = ''
    return
  }
  els.error.textContent = message
  els.error.classList.remove('hidden')
}

function showToast(message) {
  els.toast.textContent = message
  els.toast.classList.remove('hidden')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 2600)
}

function parseChapterRange(input, total) {
  const max = Math.max(0, Number(total) || 0)
  if (!max) return []
  const picked = new Set()
  for (const part of String(input || '').trim().split(/[,，\s]+/).filter(Boolean)) {
    const range = part.match(/^(\d+)\s*[-~～到至]\s*(\d+)$/)
    if (range) {
      let start = Number(range[1])
      let end = Number(range[2])
      if (start > end) [start, end] = [end, start]
      for (let n = start; n <= end; n += 1) if (n >= 1 && n <= max) picked.add(n - 1)
      continue
    }
    const single = Number(part)
    if (Number.isFinite(single) && single >= 1 && single <= max) picked.add(single - 1)
  }
  return [...picked].sort((a, b) => a - b)
}

function paginateParagraphs(paragraphs, title, width, height, fontScale) {
  const w = Math.max(1, Math.floor(width))
  const h = Math.max(1, Math.floor(height))
  if (!paragraphs.length || w < 40 || h < 40) return paragraphs.length ? [paragraphs] : [[]]

  const probe = document.createElement('div')
  probe.style.cssText = `position:fixed;left:-10000px;top:0;width:${w}px;height:${h}px;overflow:hidden;visibility:hidden;font-size:${16 * fontScale}px;line-height:1.85;font-family:Microsoft YaHei,PingFang SC,sans-serif;`
  document.body.appendChild(probe)

  const titleEl = document.createElement('h3')
  titleEl.style.cssText = 'margin:0 0 14px;font-size:1.05em;font-weight:600;'
  titleEl.textContent = title || ''

  const makeP = (text) => {
    const p = document.createElement('p')
    p.style.cssText = 'margin:0 0 1em;white-space:pre-wrap;word-break:break-word;'
    p.textContent = text
    return p
  }

  const fits = (items, withTitle) => {
    const nodes = []
    if (withTitle && title) nodes.push(titleEl.cloneNode(true))
    for (const item of items) nodes.push(makeP(item.text))
    probe.replaceChildren(...nodes)
    return probe.scrollHeight <= h + 0.5
  }

  const pages = []
  let current = []
  let first = true
  for (const item of paragraphs) {
    const next = [...current, item]
    if (fits(next, first)) {
      current = next
      continue
    }
    if (current.length) {
      pages.push(current)
      first = false
      current = []
    }
    current = [item]
  }
  if (current.length) pages.push(current)
  probe.remove()
  return pages.length ? pages : [[]]
}

function chapter() {
  return state.chapters[state.chapterIdx] || null
}

function rebuildPages() {
  const clip = document.querySelector('.clip')
  if (!clip) return
  const width = Math.max(1, Math.floor(clip.clientWidth))
  const height = Math.max(1, Math.floor(clip.clientHeight))
  state.pageWidth = width
  state.pageHeight = height
  state.pages = paginateParagraphs(
    state.paragraphs,
    chapter()?.title || '',
    width,
    height,
    state.fontScale,
  )
  state.pageIndex = Math.max(0, Math.min(state.pageIndex, state.pages.length - 1))
  applyTransform()
}

function applyTransform() {
  const strip = document.querySelector('.strip')
  if (!strip || !state.pageWidth) return
  strip.style.width = `${Math.max(1, state.pages.length) * state.pageWidth}px`
  strip.style.transform = `translate3d(${-state.pageIndex * state.pageWidth}px,0,0)`
  strip.querySelectorAll('.page').forEach((page) => {
    page.style.width = `${state.pageWidth}px`
  })
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const area = document.createElement('textarea')
  area.value = text
  document.body.appendChild(area)
  area.select()
  document.execCommand('copy')
  area.remove()
}

function updateLoginMeta() {
  const qr = state.loggedIn ? '扫码✓' : '扫码未登录'
  const key = state.official?.configured
    ? `官方Key✓(${state.official.prefix || 'wrk-…'})`
    : '官方Key未填'
  els.loginMeta.textContent = `${qr} · ${key}`
}

async function refreshStatus() {
  const status = await api('/api/status')
  state.loggedIn = Boolean(status.loggedIn)
  if (status.official) state.official = status.official
  if (status.tunnel) state.tunnel = status.tunnel
  updateLoginMeta()
  return status
}

async function refreshOfficialStatus() {
  state.official = await api('/api/official/status')
  updateLoginMeta()
  return state.official
}

async function refreshTunnelStatus() {
  state.tunnel = await api('/api/tunnel/status')
  return state.tunnel
}

async function refreshSettingsStatus() {
  await Promise.all([refreshOfficialStatus(), refreshTunnelStatus()])
}

async function saveOfficialKeyFromUi() {
  const input = document.getElementById('official-key-input')
  const value = String(input?.value || state.officialKeyDraft || '').trim()
  if (!value) {
    showError('请先粘贴 wrk- 开头的官方 API Key')
    return
  }
  state.officialBusy = true
  render()
  try {
    await api('/api/official/key', {
      method: 'POST',
      body: JSON.stringify({ apiKey: value }),
    })
    state.officialKeyDraft = ''
    await refreshOfficialStatus()
    showError('')
    showToast('官方 API Key 已保存')
  } catch (error) {
    showError(error.message)
  } finally {
    state.officialBusy = false
    render()
  }
}

async function clearOfficialKeyFromUi() {
  state.officialBusy = true
  render()
  try {
    await api('/api/official/key', { method: 'DELETE' })
    state.officialKeyDraft = ''
    await refreshOfficialStatus()
    showToast('已清除官方 API Key')
  } catch (error) {
    showError(error.message)
  } finally {
    state.officialBusy = false
    render()
  }
}

async function testOfficialKeyFromUi() {
  state.officialBusy = true
  render()
  try {
    const result = await api('/api/official/test', { method: 'POST', body: '{}' })
    showError('')
    showToast(`Key 可用：本月阅读 ${result.totalReadTime || '—'}，有效 ${result.readDays ?? '—'} 天`)
  } catch (error) {
    showError(error.message)
  } finally {
    state.officialBusy = false
    render()
  }
}

async function saveTunnelKeyFromUi() {
  const input = document.getElementById('tunnel-key-input')
  const value = String(input?.value || state.tunnelKeyDraft || '').trim()
  if (!value) {
    showError('请先粘贴 sk- 开头的隧道 Runtime API Key')
    return
  }
  state.tunnelBusy = true
  render()
  try {
    await api('/api/tunnel/key', {
      method: 'POST',
      body: JSON.stringify({ apiKey: value }),
    })
    state.tunnelKeyDraft = ''
    await refreshTunnelStatus()
    showError('')
    showToast('隧道 Key 已保存到本机，下次启动隧道不用再输入')
  } catch (error) {
    showError(error.message)
  } finally {
    state.tunnelBusy = false
    render()
  }
}

async function clearTunnelKeyFromUi() {
  state.tunnelBusy = true
  render()
  try {
    await api('/api/tunnel/key', { method: 'DELETE' })
    state.tunnelKeyDraft = ''
    await refreshTunnelStatus()
    showToast('已清除隧道 Key')
  } catch (error) {
    showError(error.message)
  } finally {
    state.tunnelBusy = false
    render()
  }
}

async function loadShelf({ patient = false } = {}) {
  state.loading = true
  try {
    const shelf = await api(`/api/shelf${patient ? '?patient=1' : ''}`)
    state.books = shelf.books || []
    showError('')
  } catch (error) {
    showError(error.message)
    if (/未登录|扫码|过期/.test(error.message)) {
      state.loggedIn = false
      els.loginMeta.textContent = '未登录'
    }
  } finally {
    state.loading = false
    render()
  }
}

async function openChapter(index, { startAtEnd = false } = {}) {
  const current = state.chapters[index]
  if (!state.book || !current) return
  state.loading = true
  render()
  try {
    const body = await api(`/api/chapter?bookId=${encodeURIComponent(state.book.bookId)}&chapterUid=${encodeURIComponent(current.chapterUid)}`)
    state.chapterIdx = index
    state.chapterText = body.text || ''
    state.paragraphs = body.paragraphs || []
    state.pageIndex = startAtEnd ? 9999 : 0
    state.tab = 'reading'
    showError('')
  } catch (error) {
    showError(error.message)
  } finally {
    state.loading = false
    render()
    requestAnimationFrame(() => {
      rebuildPages()
      if (startAtEnd) state.pageIndex = Math.max(0, state.pages.length - 1)
      applyTransform()
      updateBottom()
    })
  }
}

async function openBook(book) {
  state.loading = true
  render()
  try {
    const body = await api(`/api/chapters?bookId=${encodeURIComponent(book.bookId)}`)
    state.book = book
    state.chapters = body.chapters || []
    state.selected = new Set()
    state.showToc = false
    state.showBatch = false
    state.rangeDraft = state.chapters.length ? `1-${Math.min(10, state.chapters.length)}` : '1-10'
    els.tabReading.disabled = false
    await openChapter(0)
  } catch (error) {
    showError(error.message)
    state.loading = false
    render()
  }
}

function pageBy(dir) {
  if (state.tab !== 'reading' || !state.book) return
  if (dir > 0) {
    if (state.pageIndex < state.pages.length - 1) {
      state.pageIndex += 1
      applyTransform()
      updateBottom()
      return
    }
    if (state.chapterIdx < state.chapters.length - 1) void openChapter(state.chapterIdx + 1)
    return
  }
  if (state.pageIndex > 0) {
    state.pageIndex -= 1
    applyTransform()
    updateBottom()
    return
  }
  if (state.chapterIdx > 0) void openChapter(state.chapterIdx - 1, { startAtEnd: true })
}

async function startQr() {
  const generation = ++qrAbort
  state.qrPhase = 'starting'
  state.otp = ''
  render()
  try {
    const session = await api('/api/auth/qr/start', { method: 'POST', body: '{}' })
    if (generation !== qrAbort) return
    // Prefer server-local QR (PNG data URL). Fallback only if older server build.
    const qrDataUrl = session.qrDataUrl
      || `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(session.qrUrl)}`
    state.qr = { ...session, qrDataUrl }
    state.qrPhase = 'waiting'
    render()
    while (generation === qrAbort) {
      const result = await api('/api/auth/qr/wait', {
        method: 'POST',
        body: JSON.stringify({ uid: session.uid, otp: state.otp || undefined }),
      })
      if (generation !== qrAbort) return
      if (result.status === 'ok') {
        state.qr = null
        state.qrPhase = 'idle'
        await refreshStatus()
        await loadShelf({ patient: true })
        showToast('登录成功')
        return
      }
      if (result.status === 'need_otp') {
        state.qrPhase = 'need_otp'
        if (result.error) showError(result.error)
        render()
        return
      }
      if (result.status === 'expired' || result.status === 'error') {
        state.qrPhase = result.status
        showError(result.error || '登录失败')
        render()
        return
      }
    }
  } catch (error) {
    state.qrPhase = 'error'
    showError(error.message)
    render()
  }
}

function stopQr() {
  qrAbort += 1
  state.qr = null
  state.qrPhase = 'idle'
  state.otp = ''
  render()
}

async function copyCurrent() {
  if (!state.book || !state.chapterText.trim()) {
    showToast('当前章节没有可复制的内容')
    return
  }
  const md = [
    `# ${state.book.title}`,
    '',
    `- 章节：${chapter()?.title || ''}`,
    state.book.author ? `- 作者：${state.book.author}` : '',
    '',
    state.chapterText.trim(),
    '',
  ].filter(Boolean).join('\n')
  await copyText(md)
  showToast('已复制本章')
}

async function exportSelected() {
  if (!state.book || !state.selected.size) {
    showToast('请先用区间选章，例如 1-10')
    return
  }
  const chapterUids = state.chapters
    .filter(item => state.selected.has(String(item.chapterUid)))
    .map(item => String(item.chapterUid))
  state.loading = true
  render()
  try {
    const body = await api('/api/chapters/export', {
      method: 'POST',
      body: JSON.stringify({
        bookId: state.book.bookId,
        bookTitle: state.book.title,
        author: state.book.author,
        chapterUids,
      }),
    })
    await copyText(body.markdown)
    showToast(`已复制 ${chapterUids.length} 章`)
  } catch (error) {
    showError(error.message)
  } finally {
    state.loading = false
    render()
  }
}

function applyRange() {
  const indexes = parseChapterRange(state.rangeDraft, state.chapters.length)
  if (!indexes.length) {
    showToast('区间无效，例如 1-10')
    return
  }
  state.selected = new Set(indexes.map(i => String(state.chapters[i].chapterUid)))
  showToast(`已选 ${indexes.length} 章`)
  render()
}

function updateBottom() {
  const current = chapter()
  els.bottom.classList.toggle('hidden', !(state.tab === 'reading' && state.book))
  els.bottomTitle.textContent = current?.title || state.book?.title || ''
  els.bottomMeta.textContent = state.book
    ? `页 ${state.pageIndex + 1}/${Math.max(1, state.pages.length)} · 章 ${state.chapterIdx + 1}/${state.chapters.length} · ↑↓翻页 · ←→翻章`
    : ''
  document.getElementById('btn-prev-chapter').disabled = !(state.chapterIdx > 0)
  document.getElementById('btn-next-chapter').disabled = !(state.chapterIdx < state.chapters.length - 1)
  document.getElementById('btn-prev-page').disabled = !(state.pageIndex > 0 || state.chapterIdx > 0)
  document.getElementById('btn-next-page').disabled = !(state.pageIndex < state.pages.length - 1 || state.chapterIdx < state.chapters.length - 1)
}

function renderLogin() {
  return `
    <div class="login">
      <h3>微信扫码登录</h3>
      <p>扫码后登录态保存在本机 ~/.weread-reader。MCP / ChatGPT 隧道会使用同一登录态。</p>
      <p class="hint" style="color:var(--muted);font-size:13px;line-height:1.5;max-width:420px;margin:0 auto">
        必须用手机 <strong>微信 → 扫一扫</strong>。<strong>不要</strong>用「微信读书」App 里的扫一扫。
        Skill 的 <code>wrk-</code> Key 不能代替扫码。
        公司网络若浏览器能上微信读书、本软件扫码失败：请更新到最新安装包（会自动跟系统代理），或设置环境变量 <code>HTTPS_PROXY</code>。
      </p>
      ${state.qr?.qrDataUrl
        ? `<div class="qr"><img src="${state.qr.qrDataUrl}" alt="登录二维码" width="240" height="240" /><div class="meta">${
          state.qrPhase === 'waiting' ? '等待微信扫码确认…'
            : state.qrPhase === 'need_otp' ? '请输入验证码'
              : state.qrPhase === 'expired' ? '二维码已过期'
                : state.qrPhase === 'error' ? '登录失败'
                  : ''
        }</div></div>`
        : '<div class="qr-placeholder">点击下方按钮生成二维码</div>'}
      ${state.qr?.qrUrl ? `<p class="hint" style="word-break:break-all;font-size:11px;color:var(--faint);max-width:420px;margin:0 auto">确认链接：${escapeHtml(state.qr.qrUrl)}</p>` : ''}
      ${state.qrPhase === 'need_otp' ? `
        <div class="row" style="justify-content:center">
          <input id="otp-input" value="${state.otp}" placeholder="验证码" maxlength="8" style="width:120px;padding:8px 10px;border:1px solid var(--line2);border-radius:8px" />
          <button class="btn primary" id="otp-submit" type="button">验证</button>
        </div>` : ''}
      <div class="row" style="justify-content:center">
        <button class="btn primary" id="qr-start" type="button">${state.qr ? '刷新二维码' : '生成二维码'}</button>
        ${state.qr ? '<button class="btn" id="qr-stop" type="button">取消</button>' : ''}
      </div>
    </div>
  `
}

function renderSettings() {
  const ok = Boolean(state.official?.configured)
  const tunnelOk = Boolean(state.tunnel?.configured)
  return `
    <div class="settings">
      <div class="settings-card">
        <h3>三样凭证，各管一块</h3>
        <p><strong>扫码登录</strong>：读章节正文 / 图片（Cookie）。不能替代下面两个 Key。</p>
        <p><strong>官方 Skill Key</strong>（wrk-…）：阅读时长、进度、笔记、搜索。</p>
        <p><strong>隧道 Runtime Key</strong>（sk-…）：仅 ChatGPT 网页连本机 MCP 时需要；WorkBuddy / Cursor 本地不用。</p>
        <p class="hint">全部只保存在本机 ~/.weread-reader/，已加入 .gitignore，不会上传 GitHub。</p>
      </div>
      <div class="settings-card">
        <h3>① 扫码登录（读正文）</h3>
        <div class="status-pill" data-ok="${state.loggedIn ? '1' : '0'}">${state.loggedIn ? '已扫码登录' : '未扫码登录'}</div>
        <p class="hint">在「书架」页扫码。登录态：~/.weread-reader/session.json</p>
        ${!state.loggedIn ? '<button class="btn primary" id="goto-shelf-login" type="button">去书架扫码</button>' : '<button class="btn" id="goto-shelf" type="button">打开书架</button>'}
      </div>
      <div class="settings-card">
        <h3>② 官方 Skill Key（wrk-…）</h3>
        <div class="status-pill" data-ok="${ok ? '1' : '0'}">${ok ? `已配置 ${escapeHtml(state.official.prefix || 'wrk-…')}` : '尚未配置'}</div>
        <p class="hint">文件：~/.weread-reader/official-api-key.txt</p>
        <label class="hint" for="official-key-input">粘贴 wrk- 开头的 Key</label>
        <input id="official-key-input" type="password" autocomplete="off" spellcheck="false"
          placeholder="${ok ? '已保存，如需更换请重新粘贴' : 'wrk-xxxxxxxx'}"
          value="${escapeHtml(state.officialKeyDraft)}" />
        <div class="row">
          <button class="btn primary" id="official-key-save" type="button" ${state.officialBusy ? 'disabled' : ''}>保存</button>
          <button class="btn" id="official-key-test" type="button" ${state.officialBusy || !ok ? 'disabled' : ''}>测试</button>
          <button class="btn" id="official-key-clear" type="button" ${state.officialBusy || !ok ? 'disabled' : ''}>清除</button>
        </div>
        <p class="hint">获取：<a href="https://weread.qq.com/r/weread-skills" target="_blank" rel="noreferrer">weread.qq.com/r/weread-skills</a></p>
      </div>
      <div class="settings-card">
        <h3>③ 隧道 Runtime Key（sk-…，ChatGPT 用）</h3>
        <div class="status-pill" data-ok="${tunnelOk ? '1' : '0'}">${tunnelOk ? `已配置 ${escapeHtml(state.tunnel.prefix || 'sk-…')}` : '尚未配置'}</div>
        <p class="hint">文件：~/.weread-reader/tunnel-runtime-api-key.txt。保存后双击隧道启动器不必再输入。</p>
        <label class="hint" for="tunnel-key-input">粘贴 sk- 开头的 Key</label>
        <input id="tunnel-key-input" type="password" autocomplete="off" spellcheck="false"
          placeholder="${tunnelOk ? '已保存，如需更换请重新粘贴' : 'sk-…'}"
          value="${escapeHtml(state.tunnelKeyDraft)}" />
        <div class="row">
          <button class="btn primary" id="tunnel-key-save" type="button" ${state.tunnelBusy ? 'disabled' : ''}>保存</button>
          <button class="btn" id="tunnel-key-clear" type="button" ${state.tunnelBusy || !tunnelOk ? 'disabled' : ''}>清除</button>
        </div>
      </div>
    </div>
  `
}

function renderShelf() {
  if (!state.loggedIn) return renderLogin()
  return `
    <div class="shelf">
      <div class="head">
        <button class="btn" id="shelf-refresh" type="button">刷新</button>
        <button class="btn" id="shelf-logout" type="button">退出登录</button>
        <button class="btn" id="shelf-settings" type="button">官方 Key 设置</button>
        <span class="meta">${state.loading && !state.books.length ? '同步中…' : `${state.books.length} 本`}</span>
        <span class="meta">${state.official?.configured ? '官方Key✓' : '官方Key未填（设置页）'}</span>
      </div>
      ${state.books.length ? state.books.map(book => `
        <button class="book" type="button" data-book-id="${book.bookId}">
          ${book.cover ? `<img src="${book.cover}" alt="" />` : '<div class="cover"></div>'}
          <div><strong>${escapeHtml(book.title)}</strong><span>${escapeHtml(book.author || '')}</span></div>
          <span>${typeof book.progress === 'number' ? `${book.progress}%` : ''}</span>
        </button>
      `).join('') : '<div class="empty">书架为空，可再点刷新</div>'}
    </div>
  `
}

function renderReading() {
  if (!state.book) return '<div class="empty">先从书架打开一本书</div>'
  const pages = state.pages.length ? state.pages : [state.paragraphs]
  return `
    <div class="chrome">
      <div class="head">
        <h2>${escapeHtml(state.book.title)}</h2>
        <button class="btn compact" id="toggle-toc" type="button">${state.showToc ? '收起目录' : '目录'}</button>
        <button class="btn compact" id="toggle-batch" type="button">批量复制</button>
        <button class="btn compact" id="font-down" type="button">A-</button>
        <button class="btn compact" id="font-up" type="button">A+</button>
      </div>
      ${state.showBatch ? `
        <div class="batch">
          <div class="row">
            <input id="range-input" value="${escapeHtml(state.rangeDraft)}" placeholder="例如 1-10 或 1,3,5-8" />
            <button class="btn compact" id="range-apply" type="button">按区间选</button>
            <button class="btn compact" id="range-all" type="button">全选</button>
            <button class="btn compact" id="range-clear" type="button">清空</button>
          </div>
          <div class="row">
            <button class="btn primary compact" id="range-copy" type="button">复制选中</button>
            <span class="meta">已选 ${state.selected.size} 章</span>
          </div>
        </div>` : ''}
      ${state.showToc ? `
        <div class="toc">
          ${state.chapters.map((item, index) => `
            <button class="toc-item" type="button" data-chapter-index="${index}" data-active="${index === state.chapterIdx ? '1' : '0'}" data-picked="${state.selected.has(String(item.chapterUid)) ? '1' : '0'}">
              <span class="meta">${index + 1}</span>
              <span>${escapeHtml(item.title)}</span>
            </button>
          `).join('')}
        </div>` : ''}
    </div>
    <div class="frame">
      <div class="clip">
        ${!state.paragraphs.length && !state.loading
          ? '<div class="empty">本章没有可读正文</div>'
          : `<div class="strip">${pages.map((pageParagraphs, index) => `
              <section class="page">
                ${index === 0 && chapter()?.title ? `<h3>${escapeHtml(chapter().title)}</h3>` : ''}
                ${pageParagraphs.map(p => `<p>${escapeHtml(p.text)}</p>`).join('')}
              </section>
            `).join('')}</div>`}
      </div>
    </div>
  `
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function render() {
  document.documentElement.style.setProperty('--font-scale', String(state.fontScale))
  els.tabShelf.dataset.active = state.tab === 'shelf' ? '1' : '0'
  els.tabReading.dataset.active = state.tab === 'reading' ? '1' : '0'
  els.tabSettings.dataset.active = state.tab === 'settings' ? '1' : '0'
  els.body.dataset.mode = state.tab === 'reading' && state.book ? 'reading' : 'shelf'
  els.body.innerHTML = state.tab === 'reading'
    ? renderReading()
    : state.tab === 'settings'
      ? renderSettings()
      : renderShelf()
  updateBottom()
  bindDynamic()
  if (state.tab === 'reading' && state.book) {
    requestAnimationFrame(() => {
      rebuildPages()
      updateBottom()
    })
  }
}

function bindDynamic() {
  document.getElementById('qr-start')?.addEventListener('click', () => void startQr())
  document.getElementById('qr-stop')?.addEventListener('click', stopQr)
  document.getElementById('otp-submit')?.addEventListener('click', () => {
    state.otp = document.getElementById('otp-input')?.value || ''
    void startQr()
  })
  document.getElementById('official-key-input')?.addEventListener('input', (event) => {
    state.officialKeyDraft = event.target.value || ''
  })
  document.getElementById('official-key-save')?.addEventListener('click', () => void saveOfficialKeyFromUi())
  document.getElementById('official-key-test')?.addEventListener('click', () => void testOfficialKeyFromUi())
  document.getElementById('official-key-clear')?.addEventListener('click', () => void clearOfficialKeyFromUi())
  document.getElementById('tunnel-key-input')?.addEventListener('input', (event) => {
    state.tunnelKeyDraft = event.target.value || ''
  })
  document.getElementById('tunnel-key-save')?.addEventListener('click', () => void saveTunnelKeyFromUi())
  document.getElementById('tunnel-key-clear')?.addEventListener('click', () => void clearTunnelKeyFromUi())
  document.getElementById('goto-shelf-login')?.addEventListener('click', () => {
    state.tab = 'shelf'
    render()
  })
  document.getElementById('goto-shelf')?.addEventListener('click', () => {
    state.tab = 'shelf'
    render()
  })
  document.getElementById('shelf-settings')?.addEventListener('click', () => {
    state.tab = 'settings'
    void refreshSettingsStatus().then(() => render())
  })
  document.getElementById('shelf-refresh')?.addEventListener('click', () => void loadShelf({ patient: true }))
  document.getElementById('shelf-logout')?.addEventListener('click', async () => {
    stopQr()
    await api('/api/auth/logout', { method: 'POST', body: '{}' })
    state.loggedIn = false
    state.books = []
    state.book = null
    els.tabReading.disabled = true
    await refreshStatus()
    render()
  })
  els.body.querySelectorAll('[data-book-id]').forEach((node) => {
    node.addEventListener('click', () => {
      const book = state.books.find(item => item.bookId === node.dataset.bookId)
      if (book) void openBook(book)
    })
  })
  document.getElementById('toggle-toc')?.addEventListener('click', () => {
    state.showToc = !state.showToc
    render()
  })
  document.getElementById('toggle-batch')?.addEventListener('click', () => {
    state.showBatch = !state.showBatch
    if (state.showBatch) state.showToc = true
    render()
  })
  document.getElementById('font-down')?.addEventListener('click', () => {
    state.fontScale = Math.max(0.85, Math.round((state.fontScale - 0.08) * 100) / 100)
    render()
  })
  document.getElementById('font-up')?.addEventListener('click', () => {
    state.fontScale = Math.min(1.6, Math.round((state.fontScale + 0.08) * 100) / 100)
    render()
  })
  document.getElementById('range-apply')?.addEventListener('click', () => {
    state.rangeDraft = document.getElementById('range-input')?.value || ''
    applyRange()
  })
  document.getElementById('range-all')?.addEventListener('click', () => {
    state.selected = new Set(state.chapters.map(item => String(item.chapterUid)))
    render()
  })
  document.getElementById('range-clear')?.addEventListener('click', () => {
    state.selected = new Set()
    render()
  })
  document.getElementById('range-copy')?.addEventListener('click', () => void exportSelected())
  els.body.querySelectorAll('[data-chapter-index]').forEach((node) => {
    node.addEventListener('click', () => void openChapter(Number(node.dataset.chapterIndex)))
  })

  const clip = document.querySelector('.clip')
  if (clip) {
    clip.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return
      pointer.x = event.clientX
      pointer.y = event.clientY
      pointer.selecting = false
    })
    clip.addEventListener('pointermove', (event) => {
      if (Math.abs(event.clientX - pointer.x) > 4 || Math.abs(event.clientY - pointer.y) > 4) {
        pointer.selecting = true
      }
    })
    clip.addEventListener('click', (event) => {
      if (event.target.closest('button, a, input')) return
      const selection = window.getSelection?.()
      if (selection && String(selection).trim()) return
      if (pointer.selecting) return
      const rect = clip.getBoundingClientRect()
      const x = event.clientX - rect.left
      pageBy(x < rect.width * 0.32 ? -1 : 1)
    })
  }
}

els.tabShelf.addEventListener('click', () => {
  state.tab = 'shelf'
  render()
})
els.tabReading.addEventListener('click', () => {
  if (!state.book) return
  state.tab = 'reading'
  render()
})
els.tabSettings.addEventListener('click', () => {
  state.tab = 'settings'
  void refreshSettingsStatus().then(() => render()).catch((error) => {
    showError(error.message)
    render()
  })
})
document.getElementById('btn-prev-chapter').addEventListener('click', () => {
  if (state.chapterIdx > 0) void openChapter(state.chapterIdx - 1, { startAtEnd: true })
})
document.getElementById('btn-next-chapter').addEventListener('click', () => {
  if (state.chapterIdx < state.chapters.length - 1) void openChapter(state.chapterIdx + 1)
})
document.getElementById('btn-prev-page').addEventListener('click', () => pageBy(-1))
document.getElementById('btn-next-page').addEventListener('click', () => pageBy(1))
document.getElementById('btn-copy').addEventListener('click', () => void copyCurrent())

window.addEventListener('keydown', (event) => {
  if (state.tab !== 'reading' || !state.book) return
  if (event.altKey || event.ctrlKey || event.metaKey) return
  const tag = event.target?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    if (state.chapterIdx < state.chapters.length - 1) void openChapter(state.chapterIdx + 1)
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault()
    if (state.chapterIdx > 0) void openChapter(state.chapterIdx - 1, { startAtEnd: true })
  } else if (event.key === 'ArrowDown' || event.key === 'PageDown' || event.key === ' ') {
    event.preventDefault()
    pageBy(event.shiftKey ? -1 : 1)
  } else if (event.key === 'ArrowUp' || event.key === 'PageUp') {
    event.preventDefault()
    pageBy(-1)
  }
})

window.addEventListener('resize', () => {
  if (state.tab === 'reading') {
    rebuildPages()
    updateBottom()
  }
})

await refreshStatus()
if (state.loggedIn) await loadShelf({ patient: true })
else render()
