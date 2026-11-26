/** Minimal ZIP writer (store + deflate) for EPUB packaging. No npm deps. */
import { deflateRawSync } from 'node:zlib'

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function u16(n) {
  const b = Buffer.alloc(2)
  b.writeUInt16LE(n >>> 0, 0)
  return b
}

function u32(n) {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n >>> 0, 0)
  return b
}

/**
 * @param {Array<{ name: string, data: Buffer|string, store?: boolean }>} entries
 * @returns {Buffer}
 */
export function buildZip(entries) {
  const locals = []
  const centrals = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(String(entry.name), 'utf8')
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8')
    const store = Boolean(entry.store) || entry.name === 'mimetype'
    const compressed = store ? raw : deflateRawSync(raw)
    const method = store ? 0 : 8
    const crc = crc32(raw)

    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(method),
      u16(0),
      u16(0),
      u32(crc),
      u32(compressed.length),
      u32(raw.length),
      u16(name.length),
      u16(0),
      name,
      compressed,
    ])
    const central = Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(method),
      u16(0),
      u16(0),
      u32(crc),
      u32(compressed.length),
      u32(raw.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ])
    locals.push(local)
    centrals.push(central)
    offset += local.length
  }

  const centralDir = Buffer.concat(centrals)
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralDir.length),
    u32(offset),
    u16(0),
  ])
  return Buffer.concat([...locals, centralDir, end])
}
