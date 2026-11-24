/**
 * Parse chapter range text like "1-10", "1,3,5-8" into 0-based indexes.
 */
export function parseChapterRange(input, total) {
  const max = Math.max(0, Number(total) || 0)
  if (!max) return []
  const raw = String(input || '').trim()
  if (!raw) return []

  const picked = new Set()
  for (const part of raw.split(/[,，\s]+/).filter(Boolean)) {
    const range = part.match(/^(\d+)\s*[-~～到至]\s*(\d+)$/)
    if (range) {
      let start = Number(range[1])
      let end = Number(range[2])
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue
      if (start > end) [start, end] = [end, start]
      for (let n = start; n <= end; n += 1) {
        if (n >= 1 && n <= max) picked.add(n - 1)
      }
      continue
    }
    const single = Number(part)
    if (Number.isFinite(single) && single >= 1 && single <= max) {
      picked.add(single - 1)
    }
  }

  return [...picked].sort((a, b) => a - b)
}
