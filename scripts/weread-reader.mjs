#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const server = join(root, 'src/server/index.js')
const child = spawn(process.execPath, [server], {
  stdio: 'inherit',
  env: process.env,
})
child.on('exit', (code) => process.exit(code ?? 0))
