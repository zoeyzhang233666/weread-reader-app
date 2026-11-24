/** Minimal MCP JSON-RPC helpers (no SDK dependency). */

export const SERVER_INFO = {
  name: 'weread-reader',
  version: '0.1.0',
}

export const TOOLS = [
  {
    name: 'weread_status',
    description: 'Check whether WeChat Reading (微信读书) is logged in on this machine.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'weread_list_bookshelf',
    description: 'List books on the logged-in WeChat Reading bookshelf.',
    inputSchema: {
      type: 'object',
      properties: {
        patient: {
          type: 'boolean',
          description: 'Retry longer right after login when shelf may still be syncing.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'weread_list_chapters',
    description: 'List chapters for a book on the bookshelf.',
    inputSchema: {
      type: 'object',
      properties: {
        bookId: { type: 'string', description: 'Weread bookId' },
      },
      required: ['bookId'],
      additionalProperties: false,
    },
  },
  {
    name: 'weread_get_chapter',
    description: 'Fetch plain text for one chapter.',
    inputSchema: {
      type: 'object',
      properties: {
        bookId: { type: 'string' },
        chapterUid: { type: 'string' },
      },
      required: ['bookId', 'chapterUid'],
      additionalProperties: false,
    },
  },
  {
    name: 'weread_export_chapters',
    description:
      'Export one or more chapters as Markdown for AI analysis. Prefer range like "1-10" or pass chapterUids.',
    inputSchema: {
      type: 'object',
      properties: {
        bookId: { type: 'string' },
        bookTitle: { type: 'string' },
        author: { type: 'string' },
        range: {
          type: 'string',
          description: '1-based chapter range, e.g. "1-10" or "1,3,5-8"',
        },
        chapterUids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Explicit chapterUid list (optional if range is set)',
        },
      },
      required: ['bookId'],
      additionalProperties: false,
    },
  },
]

function textResult(payload) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)
  return { content: [{ type: 'text', text }] }
}

function errorResult(error) {
  const message = error instanceof Error ? error.message : String(error)
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  }
}

export function createMcpHandler(service) {
  async function callTool(name, args = {}) {
    try {
      switch (name) {
        case 'weread_status':
          return textResult(service.status())
        case 'weread_list_bookshelf': {
          const shelf = await service.shelf({ patient: Boolean(args.patient) })
          return textResult({
            bookCount: shelf.bookCount ?? shelf.books?.length ?? 0,
            books: (shelf.books || []).map(book => ({
              bookId: book.bookId,
              title: book.title,
              author: book.author,
              progress: book.progress,
            })),
          })
        }
        case 'weread_list_chapters': {
          const body = await service.chapters(String(args.bookId || ''))
          return textResult({
            chapters: (body.chapters || []).map((chapter, index) => ({
              index: index + 1,
              chapterUid: chapter.chapterUid,
              title: chapter.title,
            })),
          })
        }
        case 'weread_get_chapter': {
          const body = await service.chapter(String(args.bookId || ''), String(args.chapterUid || ''))
          return textResult({
            text: body.text,
            format: body.format,
          })
        }
        case 'weread_export_chapters': {
          const body = await service.exportChapters({
            bookId: String(args.bookId || ''),
            bookTitle: String(args.bookTitle || ''),
            author: String(args.author || ''),
            range: String(args.range || ''),
            chapterUids: Array.isArray(args.chapterUids) ? args.chapterUids : [],
          })
          return textResult(body.markdown)
        }
        default:
          return errorResult(new Error(`Unknown tool: ${name}`))
      }
    } catch (error) {
      return errorResult(error)
    }
  }

  async function handleRpc(message) {
    if (!message || typeof message !== 'object') {
      return {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Invalid Request' },
      }
    }

    const { id, method, params } = message
    const reply = (result) => ({ jsonrpc: '2.0', id: id ?? null, result })
    const fail = (code, errMessage) => ({
      jsonrpc: '2.0',
      id: id ?? null,
      error: { code, message: errMessage },
    })

    try {
      if (method === 'initialize') {
        return reply({
          protocolVersion: params?.protocolVersion || '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        })
      }
      if (method === 'notifications/initialized' || method === 'initialized') {
        return null
      }
      if (method === 'ping') {
        return reply({})
      }
      if (method === 'tools/list') {
        return reply({ tools: TOOLS })
      }
      if (method === 'tools/call') {
        const name = String(params?.name || '')
        const args = params?.arguments && typeof params.arguments === 'object'
          ? params.arguments
          : {}
        const result = await callTool(name, args)
        return reply(result)
      }
      return fail(-32601, `Method not found: ${method}`)
    } catch (error) {
      return fail(-32000, error instanceof Error ? error.message : String(error))
    }
  }

  return { handleRpc, callTool, tools: TOOLS }
}
