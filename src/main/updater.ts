import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, parse } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { app, net } from 'electron'

const TRUSTED_PREFIX = 'https://github.com/'

export function portableExe(): string | null {
  return process.env.PORTABLE_EXECUTABLE_FILE || null
}

export function canSelfUpdate(): boolean {
  return app.isPackaged && process.platform === 'win32' && portableExe() !== null
}

export async function installUpdate(assetUrl: string, onProgress: (done: number, total: number) => void) {
  const current = portableExe()
  if (!canSelfUpdate() || !current) {
    throw new Error('La actualización automática solo funciona con el ejecutable LLorostini.exe.')
  }
  if (!assetUrl.startsWith(TRUSTED_PREFIX)) throw new Error('La release no incluye un ejecutable descargable.')

  const { dir, name, ext } = parse(current)
  const destination = join(dir, `${name}.update${ext}`)
  const response = await net.fetch(assetUrl, { headers: { 'User-Agent': 'LLorostini-updater' } })
  if (!response.ok || !response.body) throw new Error(`GitHub respondió con el error ${response.status}.`)
  const total = Number(response.headers.get('content-length') || 0)
  let done = 0
  let lastReport = 0
  const body = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream)
  body.on('data', (chunk: Buffer) => {
    done += chunk.length
    const now = Date.now()
    if (now - lastReport > 150) {
      lastReport = now
      onProgress(done, total)
    }
  })
  try {
    await pipeline(body, createWriteStream(destination))
    if (total && done !== total) throw new Error('La descarga quedó incompleta. Inténtalo de nuevo.')
  } catch (error) {
    await rm(destination, { force: true })
    throw error
  }
  onProgress(done, total)

  const script = join(tmpdir(), 'llorostini_update.bat')
  await writeFile(
    script,
    [
      '@echo off',
      'chcp 65001 >nul',
      'set tries=0',
      ':retry',
      'set /a tries+=1',
      `move /y "${destination}" "${current}" >nul 2>&1`,
      'if not errorlevel 1 goto done',
      'if %tries% geq 60 goto fail',
      'ping 127.0.0.1 -n 2 >nul',
      'goto retry',
      ':done',
      `start "" "${current}"`,
      ':fail',
      'del "%~f0"',
      ''
    ].join('\r\n'),
    'utf8'
  )
  spawn('cmd', ['/c', script], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  app.quit()
}
