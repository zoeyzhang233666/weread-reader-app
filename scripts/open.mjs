#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { platform } from 'node:os'

const port = Number(process.env.WEREAD_PORT || 17831)
const url = `http://127.0.0.1:${port}`

const opener = platform() === 'darwin'
  ? ['open', url]
  : platform() === 'win32'
    ? ['cmd', '/c', 'start', '', url]
    : ['xdg-open', url]

spawn(opener[0], opener.slice(1), { stdio: 'ignore', detached: true }).unref()
console.log(`opening ${url}`)
