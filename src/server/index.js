#!/usr/bin/env node
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { extname, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applySystemProxy } from '../net/systemProxy.js'
import { createService } from '../service.js'
import { dataDir } from '../store.js'
import { createMcpHandler } from './mcp.js'

// Corp networks: browser uses system proxy; Node fetch needs env + --use-env-proxy.
const proxyInfo = applySystemProxy()

const __dirname = dirname(fileURLToPath(import.meta.url))
const WEB_DIR = join(__dirname, '../web')
const PORT = Number(process.env.WEREAD_PORT || 17831)
const HOST = process.env.WEREAD_HOST || '127.0.0.1'

const service = createService()
const mcp = createMcpHandler(service)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, mcp-session-id',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  })
  res.end(body)
}

function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  })
  res.end(text)
}

async function readJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return {}
  return JSON.parse(raw)
}

function staticPath(urlPath) {
  const clean = decodeURIComponent(String(urlPath || '/').split('?')[0])
  if (clean === '/' || clean === '') return join(WEB_DIR, 'index.html')
  const target = join(WEB_DIR, clean.replace(/^\/+/, ''))
  if (!target.startsWith(WEB_DIR)) return null
  return target
}

async function handleApi(req, res, path) {
  try {
    if (path === '/api/status' && req.method === 'GET') {
      sendJson(res, 200, {
        ...service.status(),
        official: service.officialStatus(),
        tunnel: service.tunnelKeyStatus(),
        dataDir: dataDir(),
        port: PORT,
      })
      return
    }
    if (path === '/api/official/status' && req.method === 'GET') {
      sendJson(res, 200, service.officialStatus())
      return
    }
    if (path === '/api/official/key' && req.method === 'POST') {
      const body = await readJson(req)
      sendJson(res, 200, service.setOfficialKey(String(body.apiKey || body.key || '')))
      return
    }
    if (path === '/api/official/key' && req.method === 'DELETE') {
      sendJson(res, 200, service.clearOfficialKey())
      return
    }
    if (path === '/api/official/test' && req.method === 'POST') {
      // Lightweight call to prove the key works
      const stats = await service.readingStats({ mode: 'monthly' })
      sendJson(res, 200, {
        ok: true,
        mode: stats.mode,
        totalReadTime: stats.totalReadTime,
        readDays: stats.readDays,
      })
      return
    }
    if (path === '/api/tunnel/status' && req.method === 'GET') {
      sendJson(res, 200, service.tunnelKeyStatus())
      return
    }
    if (path === '/api/tunnel/key' && req.method === 'POST') {
      const body = await readJson(req)
      sendJson(res, 200, service.setTunnelKey(String(body.apiKey || body.key || '')))
      return
    }
    if (path === '/api/tunnel/key' && req.method === 'DELETE') {
      sendJson(res, 200, service.clearTunnelKey())
      return
    }
    if (path === '/api/auth/qr/start' && req.method === 'POST') {
      sendJson(res, 200, await service.startQr())
      return
    }
    if (path === '/api/auth/qr/wait' && req.method === 'POST') {
      const body = await readJson(req)
      sendJson(res, 200, await service.waitQr(body))
      return
    }
    if (path === '/api/auth/logout' && req.method === 'POST') {
      sendJson(res, 200, await service.logout())
      return
    }
    if (path === '/api/shelf' && req.method === 'GET') {
      const url = new URL(req.url || '/', `http://${HOST}`)
      const shelf = await service.shelf({ patient: url.searchParams.get('patient') === '1' })
      sendJson(res, 200, shelf)
      return
    }
    if (path === '/api/shelf/groups' && req.method === 'GET') {
      const url = new URL(req.url || '/', `http://${HOST}`)
      sendJson(res, 200, await service.shelfGroups({
        patient: url.searchParams.get('patient') === '1',
      }))
      return
    }
    if (path === '/api/shelf/group-books' && req.method === 'GET') {
      const url = new URL(req.url || '/', `http://${HOST}`)
      sendJson(res, 200, await service.shelfGroupBooks({
        groupId: url.searchParams.get('groupId') || '',
        name: url.searchParams.get('name') || '',
        patient: url.searchParams.get('patient') === '1',
      }))
      return
    }
    if (path === '/api/chapters' && req.method === 'GET') {
      const url = new URL(req.url || '/', `http://${HOST}`)
      const bookId = url.searchParams.get('bookId')
      sendJson(res, 200, await service.chapters(bookId))
      return
    }
    if (path === '/api/book/info' && req.method === 'GET') {
      const url = new URL(req.url || '/', `http://${HOST}`)
      sendJson(res, 200, await service.bookInfo(url.searchParams.get('bookId')))
      return
    }
    if (path === '/api/chapter' && req.method === 'GET') {
      const url = new URL(req.url || '/', `http://${HOST}`)
      // Reader UI needs ordered blocks (text/image/table). plain=1 keeps old text-only.
      if (url.searchParams.get('plain') === '1') {
        sendJson(res, 200, await service.chapter(
          url.searchParams.get('bookId'),
          url.searchParams.get('chapterUid'),
        ))
        return
      }
      sendJson(res, 200, await service.chapterRich(
        url.searchParams.get('bookId'),
        url.searchParams.get('chapterUid'),
        {
          includeHtml: url.searchParams.get('html') === '1',
          includeBlocks: true,
          // Browser loads figures via /api/chapter/image (cookie proxy); avoid huge base64 by default.
          includeImages: url.searchParams.get('images') === '1',
          imageOffset: url.searchParams.get('imageOffset'),
          imageLimit: url.searchParams.get('imageLimit'),
        },
      ))
      return
    }
    if (path === '/api/chapter/image' && req.method === 'GET') {
      const url = new URL(req.url || '/', `http://${HOST}`)
      const result = await service.proxyChapterImage(url.searchParams.get('src'))
      if (!result.ok) {
        sendJson(res, result.status || 502, { error: result.error || 'image fetch failed' })
        return
      }
      res.writeHead(200, {
        'content-type': result.mimeType,
        'content-length': result.buffer.length,
        'cache-control': 'private, max-age=86400',
        'access-control-allow-origin': '*',
      })
      res.end(result.buffer)
      return
    }
    if (path === '/api/chapters/export' && req.method === 'POST') {
      const body = await readJson(req)
      sendJson(res, 200, await service.exportChapters(body))
      return
    }
    if (path === '/api/book/download' && req.method === 'GET') {
      const url = new URL(req.url || '/', `http://${HOST}`)
      const bookId = url.searchParams.get('bookId')
      const save = url.searchParams.get('save') === '1'
      const exported = await service.downloadBook(bookId, { save })
      const filename = exported.filename || `book.${exported.extension || 'bin'}`
      res.writeHead(200, {
        'content-type': exported.mimeType || 'application/octet-stream',
        'content-length': exported.buffer.length,
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
        'x-weread-format': exported.format || '',
        'x-weread-shelf-format': exported.shelfFormat || '',
        'x-weread-note': encodeURIComponent(exported.note || ''),
      })
      res.end(exported.buffer)
      return
    }
    if (path === '/api/book/export/start' && req.method === 'POST') {
      const body = await readJson(req)
      const save = body?.save === true || body?.save === 1 || body?.save === '1'
      sendJson(res, 200, service.startBookExport(body?.bookId, { save }))
      return
    }
    if (path === '/api/book/export/status' && req.method === 'GET') {
      const url = new URL(req.url || '/', `http://${HOST}`)
      sendJson(res, 200, service.getExportJob(url.searchParams.get('jobId')))
      return
    }
    if (path === '/api/book/export/file' && req.method === 'GET') {
      const url = new URL(req.url || '/', `http://${HOST}`)
      try {
        const exported = service.takeExportJobFile(url.searchParams.get('jobId'))
        const filename = exported.filename || 'book.bin'
        res.writeHead(200, {
          'content-type': exported.mimeType || 'application/octet-stream',
          'content-length': exported.buffer.length,
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
          'cache-control': 'no-store',
          'access-control-allow-origin': '*',
          'x-weread-format': exported.format || '',
          'x-weread-note': encodeURIComponent(exported.note || ''),
        })
        res.end(exported.buffer)
      } catch (error) {
        const code = error?.code
        const status = code === 'NOT_FOUND' ? 404 : code === 'NOT_READY' ? 409 : 502
        sendJson(res, status, { error: error instanceof Error ? error.message : String(error) })
      }
      return
    }
    sendJson(res, 404, { error: 'not found' })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    let status = 502
    if (error?.code === 'UNAUTHORIZED' || /未登录|扫码/.test(message)) status = 401
    else if (error?.code === 'NOT_FOUND') status = 404
    else if (error?.code === 'NOT_READY') status = 409
    sendJson(res, status, { error: message })
  }
}

async function handleMcp(req, res) {
  if (req.method === 'GET') {
    sendJson(res, 200, {
      name: 'weread-reader',
      transport: 'json-rpc',
      endpoints: {
        rpc: '/mcp',
        health: '/health',
      },
      tools: mcp.tools.map(tool => tool.name),
    })
    return
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'POST JSON-RPC to /mcp' })
    return
  }
  try {
    const message = await readJson(req)
    if (Array.isArray(message)) {
      const replies = []
      for (const item of message) {
        const reply = await mcp.handleRpc(item)
        if (reply) replies.push(reply)
      }
      sendJson(res, 200, replies)
      return
    }
    const reply = await mcp.handleRpc(message)
    if (reply == null) {
      res.writeHead(202, {
        'access-control-allow-origin': '*',
      })
      res.end()
      return
    }
    sendJson(res, 200, reply)
  } catch (error) {
    sendJson(res, 400, {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: error instanceof Error ? error.message : String(error) },
    })
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${HOST}`)
  const path = url.pathname

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type, mcp-session-id',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
    })
    res.end()
    return
  }

  if (path === '/health') {
    sendJson(res, 200, {
      ok: true,
      ...service.status(),
      proxy: {
        source: proxyInfo.source,
        applied: proxyInfo.applied,
        configured: Boolean(proxyInfo.proxy),
        // never echo full proxy with credentials if any
        host: proxyInfo.proxy ? (() => {
          try { return new URL(proxyInfo.proxy).host } catch { return '(set)' }
        })() : '',
        useEnvProxy: String(process.execArgv || []).includes('--use-env-proxy')
          || String(process.env.NODE_OPTIONS || '').includes('--use-env-proxy'),
      },
    })
    return
  }
  if (path === '/mcp' || path.startsWith('/mcp/')) {
    await handleMcp(req, res)
    return
  }
  if (path.startsWith('/api/')) {
    await handleApi(req, res, path)
    return
  }

  const filePath = staticPath(path)
  if (!filePath || !existsSync(filePath)) {
    sendText(res, 404, 'Not found')
    return
  }
  const type = MIME[extname(filePath)] || 'application/octet-stream'
  sendText(res, 200, readFileSync(filePath), type)
})

server.listen(PORT, HOST, () => {
  const base = `http://${HOST}:${PORT}`
  console.log(`[weread-reader] UI     ${base}`)
  console.log(`[weread-reader] MCP    ${base}/mcp`)
  console.log(`[weread-reader] health ${base}/health`)
  console.log(`[weread-reader] data   ${dataDir()}`)
  if (proxyInfo.proxy) {
    try {
      console.log(`[weread-reader] proxy  ${new URL(proxyInfo.proxy).host} (${proxyInfo.source})`)
    } catch {
      console.log(`[weread-reader] proxy  set (${proxyInfo.source})`)
    }
  } else {
    console.log('[weread-reader] proxy  none (browser may still use system proxy; if QR login fails on corp net, set HTTPS_PROXY)')
  }
})
