#!/usr/bin/env node
import { createInterface } from 'node:readline'
import { createService } from '../service.js'
import { createMcpHandler } from './mcp.js'

const service = createService()
const mcp = createMcpHandler(service)
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })

function writeMessage(message) {
  if (message == null) return
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

rl.on('line', async (line) => {
  const raw = String(line || '').trim()
  if (!raw) return
  let message
  try {
    message = JSON.parse(raw)
  } catch {
    writeMessage({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    })
    return
  }
  const response = await mcp.handleRpc(message)
  writeMessage(response)
})

rl.on('close', () => process.exit(0))
