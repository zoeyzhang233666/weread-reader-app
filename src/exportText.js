/** Split chapter plain text into selectable paragraphs. */
export function paragraphsFromText(text) {
  const raw = String(text || '').replace(/\r\n?/g, '\n').trim()
  if (!raw) return []
  const blocks = raw.split(/\n{2,}/).map(block => block.trim()).filter(Boolean)
  if (blocks.length > 1) {
    return blocks.map((paragraph, index) => ({
      id: `p${index + 1}`,
      text: paragraph,
    }))
  }
  return raw.split('\n').map(line => line.trim()).filter(Boolean).map((paragraph, index) => ({
    id: `p${index + 1}`,
    text: paragraph,
  }))
}

export function sanitizeFilename(name) {
  const cleaned = String(name ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
  return cleaned || 'weread'
}

export function buildChaptersMarkdown({ bookTitle, author = '', chapters = [] }) {
  const lines = [
    `# ${bookTitle || 'Untitled'}`,
    '',
  ]
  if (author) lines.push(`- 作者：${author}`)
  lines.push(`- 导出时间：${new Date().toISOString().slice(0, 19).replace('T', ' ')}`)
  lines.push(`- 章节数：${chapters.length}`)
  lines.push('')

  for (const chapter of chapters) {
    lines.push(`## ${chapter.title || '未命名章节'}`)
    lines.push('')
    const body = String(chapter.text || '').trim()
    lines.push(body || '_（本章无正文）_')
    lines.push('')
  }

  return lines.join('\n')
}
