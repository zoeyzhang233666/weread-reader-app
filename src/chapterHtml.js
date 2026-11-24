/** Parse Weread EPUB/XHTML chapter HTML into ordered blocks (text / image / table). */

function decodeEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

export function extractBodyHtml(html) {
  const raw = String(html || '')
  const match = raw.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)
  return match ? match[1] : raw
}

export function stripHtml(html) {
  return decodeEntities(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/h[1-6]>/gi, '\n')
      .replace(/<\/tr>/gi, '\n')
      .replace(/<\/(td|th)>/gi, '\t')
      .replace(/<[^>]+>/g, '')
      .replace(/\r/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  )
}

function attr(tag, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
  const m = String(tag || '').match(re)
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : ''
}

function parseTable(tableHtml) {
  const rows = []
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
  let rowMatch
  while ((rowMatch = rowRe.exec(tableHtml))) {
    const cells = []
    const cellRe = /<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi
    let cellMatch
    while ((cellMatch = cellRe.exec(rowMatch[1]))) {
      cells.push(stripHtml(cellMatch[2]).replace(/\s+/g, ' ').trim())
    }
    if (cells.length) rows.push(cells)
  }
  return {
    type: 'table',
    rows,
    markdown: tableToMarkdown(rows),
    html: tableHtml,
  }
}

export function tableToMarkdown(rows) {
  if (!rows?.length) return ''
  const width = Math.max(...rows.map(r => r.length))
  const norm = rows.map(r => {
    const copy = r.slice()
    while (copy.length < width) copy.push('')
    return copy
  })
  const header = norm[0]
  const sep = header.map(() => '---')
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...norm.slice(1).map(r => `| ${r.join(' | ')} |`),
  ]
  return lines.join('\n')
}

function parseImage(imgTag, index) {
  const src = attr(imgTag, 'src') || attr(imgTag, 'data-src')
  return {
    type: 'image',
    index,
    src,
    alt: decodeEntities(attr(imgTag, 'alt') || ''),
    width: attr(imgTag, 'data-w') || attr(imgTag, 'width') || '',
    ratio: attr(imgTag, 'data-ratio') || '',
    className: attr(imgTag, 'class') || '',
  }
}

/**
 * Walk body HTML in document order → text / image / table blocks.
 * Tables rendered as images in EPUB (common for chem handbooks) appear as image blocks.
 */
export function parseChapterBlocks(html) {
  const body = extractBodyHtml(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')

  const blocks = []
  let imageIndex = 0
  const tokenRe =
    /<table\b[\s\S]*?<\/table>|<img\b[^>]*\/?>|<(h[1-6]|p|div|li|blockquote)\b[^>]*>[\s\S]*?<\/\1>/gi

  let match
  let last = 0
  while ((match = tokenRe.exec(body))) {
    const gap = body.slice(last, match.index)
    const gapText = stripHtml(gap)
    if (gapText) blocks.push({ type: 'text', text: gapText })

    const token = match[0]
    if (/^<table\b/i.test(token)) {
      blocks.push(parseTable(token))
    } else if (/^<img\b/i.test(token)) {
      const image = parseImage(token, imageIndex++)
      if (image.src) blocks.push(image)
    } else {
      // Container may wrap an image (e.g. p.bodyPic / div.qrbodyPic)
      const innerImgs = [...token.matchAll(/<img\b[^>]*\/?>/gi)].map(m => m[0])
      const innerTables = [...token.matchAll(/<table\b[\s\S]*?<\/table>/gi)].map(m => m[0])
      if (innerImgs.length || innerTables.length) {
        const caption = stripHtml(token.replace(/<img\b[^>]*\/?>/gi, ' ').replace(/<table\b[\s\S]*?<\/table>/gi, ' '))
        if (caption) blocks.push({ type: 'text', text: caption })
        for (const t of innerTables) blocks.push(parseTable(t))
        for (const img of innerImgs) {
          const image = parseImage(img, imageIndex++)
          if (image.src) blocks.push(image)
        }
      } else {
        const text = stripHtml(token)
        if (text) {
          const tag = String(match[1] || '').toLowerCase()
          blocks.push({
            type: 'text',
            text,
            role: /^h[1-6]$/.test(tag) ? 'heading' : 'paragraph',
            level: /^h[1-6]$/.test(tag) ? Number(tag.slice(1)) : undefined,
          })
        }
      }
    }
    last = match.index + token.length
  }

  const tail = stripHtml(body.slice(last))
  if (tail) blocks.push({ type: 'text', text: tail })

  const images = blocks.filter(b => b.type === 'image')
  const tables = blocks.filter(b => b.type === 'table')
  return {
    blocks,
    images,
    tables,
    imageCount: images.length,
    tableCount: tables.length,
  }
}

/** Markdown with image refs + native tables; preserves reading order. */
export function blocksToMarkdown(blocks, { imageMode = 'url' } = {}) {
  const lines = []
  let imgNo = 0
  for (const block of blocks) {
    if (block.type === 'text') {
      if (block.role === 'heading') {
        const level = Math.min(6, Math.max(1, block.level || 2))
        lines.push(`${'#'.repeat(level)} ${block.text}`, '')
      } else {
        lines.push(block.text, '')
      }
    } else if (block.type === 'table') {
      lines.push(block.markdown || tableToMarkdown(block.rows), '')
    } else if (block.type === 'image') {
      imgNo += 1
      const alt = block.alt || `图片${imgNo}`
      if (imageMode === 'placeholder') {
        lines.push(`[图片 ${imgNo}${block.alt ? `: ${block.alt}` : ''}]`, '')
      } else {
        lines.push(`![${alt}](${block.src})`, '')
      }
    }
  }
  return lines.join('\n').trim() + '\n'
}

export function summarizeBlocksForMcp(parsed, { includeHtml = false, html = '' } = {}) {
  return {
    imageCount: parsed.imageCount,
    tableCount: parsed.tableCount,
    blocks: parsed.blocks.map((block) => {
      if (block.type === 'text') {
        return {
          type: 'text',
          role: block.role || 'paragraph',
          level: block.level,
          text: block.text,
        }
      }
      if (block.type === 'table') {
        return {
          type: 'table',
          rows: block.rows,
          markdown: block.markdown,
        }
      }
      return {
        type: 'image',
        index: block.index,
        src: block.src,
        alt: block.alt,
        width: block.width,
        ratio: block.ratio,
      }
    }),
    ...(includeHtml ? { html } : {}),
  }
}
