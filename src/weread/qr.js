import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const qrcode = require(join(dirname(fileURLToPath(import.meta.url)), '../vendor/qrcode-generator.cjs'))

/**
 * Build a PNG data-URL QR for Weread web-confirm links.
 * Avoids third-party hosts (api.qrserver.com) that often fail on CN / corp networks.
 */
export function makeQrDataUrl(text, { cellSize = 6, margin = 8 } = {}) {
  const value = String(text || '').trim()
  if (!value) throw new Error('QR content is empty')
  const qr = qrcode(0, 'M')
  qr.addData(value)
  qr.make()
  return qr.createDataURL(cellSize, margin)
}
