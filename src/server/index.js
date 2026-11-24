#!/usr/bin/env node
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { extname, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createService } from '../service.js'
import { dataDir } from '../store.js'
import { createMcpHandler } from './mcp.js'

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
      sendJson(res, 200, { ...service.status(), dataDir: dataDir(), port: PORT })
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
    if (path === '/api/chapters' && req.method === 'GET') {
      const url = new URL(req.url || '/', `http://${HOST}`)
      const bookId = url.searchParams.get('bookId')
      sendJson(res, 200, await service.chapters(bookId))
      return
    }
    if (path === '/api/chapter' && req.method === 'GET') {
      const url = new URL(req.url || '/', `http://${HOST}`)
      sendJson(res, 200, await service.chapter(
        url.searchParams.get('bookId'),
        url.searchParams.get('chapterUid'),
      ))
      return
    }
    if (path === '/api/chapters/export' && req.method === 'POST') {
      const body = await readJson(req)
      sendJson(res, 200, await service.exportChapters(body))
      return
    }
    sendJson(res, 404, { error: 'not found' })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = error?.code === 'UNAUTHORIZED' || /未登录|扫码/.test(message) ? 401 : 502
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
    sendJson(res, 200, { ok: true, ...service.status() })
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
})
