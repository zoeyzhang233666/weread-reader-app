/** Minimal MCP JSON-RPC helpers (no SDK dependency). */

export const SERVER_INFO = {
  name: 'weread-reader',
  version: '0.2.1',
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
    name: 'weread_get_book_info',
    description:
      'Get book metadata: title, author, publisher, ISBN, totalWords, chapterCount, intro, format, etc.',
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
    description:
      'Fetch one chapter WITH figures/tables. Chem handbooks store property tables as images — this tool returns ordered text + MCP ImageContent (JPEG/PNG) by default so you can read those tables. If imagesHasMore=true, call again with a higher imageOffset (or use weread_get_chapter_images). Set plain=true only when you want text with no images.',
    inputSchema: {
      type: 'object',
      properties: {
        bookId: { type: 'string' },
        chapterUid: { type: 'string' },
        plain: {
          type: 'boolean',
          description: 'If true, return only stripped plain text (no images/blocks). Default false.',
        },
        includeHtml: {
          type: 'boolean',
          description: 'Include raw chapter HTML when available (epub/pdf). Default false.',
        },
        includeImages: {
          type: 'boolean',
          description: 'Attach image bytes as MCP ImageContent. Default true (set false to skip bytes but still keep image URLs in markdown/blocks).',
        },
        imageOffset: {
          type: 'integer',
          description: '0-based offset into chapter images. Default 0.',
        },
        imageLimit: {
          type: 'integer',
          description: 'Max images as ImageContent this call (1-10, default 4). Page with imageOffset.',
        },
      },
      required: ['bookId', 'chapterUid'],
      additionalProperties: false,
    },
  },
  {
    name: 'weread_get_chapter_images',
    description:
      'REQUIRED for chem books when tables/structures are pictures: batch-fetch chapter images as MCP ImageContent. Page with imageOffset/imageLimit until imagesHasMore=false. Prefer this after weread_get_chapter if more figures remain. Does not OCR.',
    inputSchema: {
      type: 'object',
      properties: {
        bookId: { type: 'string' },
        chapterUid: { type: 'string' },
        imageOffset: { type: 'integer', description: 'Default 0' },
        imageLimit: { type: 'integer', description: '1-10, default 4' },
      },
      required: ['bookId', 'chapterUid'],
      additionalProperties: false,
    },
  },
  {
    name: 'weread_export_chapters',
    description:
      'Export chapters as Markdown WITH image markdown links and native HTML tables by default (chem tables often are images — follow up with weread_get_chapter_images to actually see table pixels). Set plain=true for text-only. Set includeImages=true to also attach a first batch of ImageContent.',
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
        plain: {
          type: 'boolean',
          description: 'Text-only markdown (strip figures). Default false.',
        },
        includeImages: {
          type: 'boolean',
          description: 'Also return ImageContent batch for figures. Default false (use weread_get_chapter_images for paging).',
        },
        imageOffset: { type: 'integer' },
        imageLimit: { type: 'integer', description: '1-10, default 4' },
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

/** Strip base64 from JSON text payload; images go as separate ImageContent parts. */
function richResult(payload) {
  const images = Array.isArray(payload.images) ? payload.images : []
  const jsonPayload = {
    ...payload,
    images: images.map(({ base64, ...meta }) => ({
      ...meta,
      hasImageContent: Boolean(base64),
    })),
  }
  const content = [{ type: 'text', text: JSON.stringify(jsonPayload, null, 2) }]
  for (const img of images) {
    if (!img?.base64 || !img?.mimeType) continue
    content.push({
      type: 'image',
      data: img.base64,
      mimeType: img.mimeType,
    })
    content.push({
      type: 'text',
      text: JSON.stringify({
        note: 'image above',
        index: img.index,
        src: img.src,
        alt: img.alt || '',
        chapterUid: img.chapterUid,
        chapterTitle: img.chapterTitle,
      }),
    })
  }
  return { content }
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
        case 'weread_get_book_info':
          return textResult(await service.bookInfo(String(args.bookId || '')))
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
          // Default = rich + images. ChatGPT rarely passes optional flags.
          if (args.plain === true) {
            const body = await service.chapter(String(args.bookId || ''), String(args.chapterUid || ''))
            return textResult({
              text: body.text,
              format: body.format,
            })
          }
          const includeImages = args.includeImages !== false
          const body = await service.chapterRich(
            String(args.bookId || ''),
            String(args.chapterUid || ''),
            {
              includeHtml: Boolean(args.includeHtml),
              includeBlocks: true,
              includeImages,
              imageOffset: args.imageOffset,
              imageLimit: args.imageLimit,
            },
          )
          return includeImages ? richResult(body) : textResult(body)
        }
        case 'weread_get_chapter_images': {
          const body = await service.chapterImages(
            String(args.bookId || ''),
            String(args.chapterUid || ''),
            {
              imageOffset: args.imageOffset,
              imageLimit: args.imageLimit,
            },
          )
          const focused = {
            bookId: body.bookId,
            chapterUid: body.chapterUid,
            format: body.format,
            imageCount: body.imageCount,
            tableCount: body.tableCount,
            imageOffset: body.imageOffset,
            imageLimit: body.imageLimit,
            imagesReturned: body.imagesReturned,
            imagesHasMore: body.imagesHasMore,
            imageErrors: body.imageErrors,
            hint: body.imagesHasMore
              ? `Call again with imageOffset=${body.imageOffset + body.imagesReturned} to fetch the next batch.`
              : 'All images in this page window returned (or none left).',
            blocks: (body.blocks || []).filter(b => b.type === 'image' || b.type === 'table'),
            nearbyText: (body.blocks || [])
              .filter(b => b.type === 'text')
              .map(b => b.text)
              .join('\n\n')
              .slice(0, 4000),
            images: body.images,
          }
          return richResult(focused)
        }
        case 'weread_export_chapters': {
          const plain = args.plain === true
          const includeImages = Boolean(args.includeImages)
          const body = await service.exportChapters({
            bookId: String(args.bookId || ''),
            bookTitle: String(args.bookTitle || ''),
            author: String(args.author || ''),
            range: String(args.range || ''),
            chapterUids: Array.isArray(args.chapterUids) ? args.chapterUids : [],
            rich: !plain,
            includeImages,
            imageOffset: args.imageOffset,
            imageLimit: args.imageLimit,
          })
          if (includeImages) {
            return richResult({
              count: body.count,
              imageCount: body.imageCount,
              imagesHasMore: body.imagesHasMore,
              imageErrors: body.imageErrors,
              markdown: body.markdown,
              images: body.images,
              hint: body.imagesHasMore
                ? 'More figures remain — call weread_get_chapter_images with higher imageOffset.'
                : undefined,
            })
          }
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
