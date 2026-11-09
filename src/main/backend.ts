import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { BackendEvent } from '@shared/types'

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void }

const STDERR_TAIL = 4000

export class Backend {
  private child: ChildProcessWithoutNullStreams | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private buffer = ''
  private stderr = ''
  private stopping = false

  constructor(private readonly onEvent: (event: BackendEvent) => void) {}

  start(): void {
    const { command, args, cwd } = this.command()
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONUNBUFFERED: '1' }
    })
    this.child = child
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.onStdout(chunk))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      if (!app.isPackaged) process.stderr.write(chunk)
      this.stderr = (this.stderr + chunk).slice(-STDERR_TAIL)
    })
    child.on('error', (error) => this.onExit(null, error.message))
    child.on('exit', (code) => this.onExit(code))
  }

  call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const child = this.child
    if (!child || child.exitCode !== null) {
      return Promise.reject(new Error('El proceso de descargas no está en marcha. Reinicia la aplicación.'))
    }
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      child.stdin.write(JSON.stringify({ id, method, params }) + '\n')
    })
  }

  stop(): void {
    this.stopping = true
    this.child?.stdin.end()
    const child = this.child
    setTimeout(() => {
      if (child && child.exitCode === null) child.kill()
    }, 2000)
  }

  private command(): { command: string; args: string[]; cwd: string } {
    if (app.isPackaged) {
      const dir = join(process.resourcesPath, 'backend')
      return { command: join(dir, 'llorostini-backend.exe'), args: [], cwd: dir }
    }
    const dir = join(app.getAppPath(), 'python')
    const script = join(dir, 'backend.py')
    const python = process.env.LLOROSTINI_PYTHON || 'python'
    if (!existsSync(script)) throw new Error(`No se encontró ${script}`)
    return { command: python, args: ['-X', 'utf8', script], cwd: dir }
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk
    let newline: number
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (line) this.onLine(line)
    }
  }

  private onLine(line: string): void {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    if (typeof message.event === 'string') {
      this.onEvent(message as unknown as BackendEvent)
      return
    }
    const pending = this.pending.get(message.id as number)
    if (!pending) return
    this.pending.delete(message.id as number)
    if (message.ok) pending.resolve(message.result)
    else pending.reject(new Error(String(message.error || 'Error desconocido')))
  }

  private onExit(code: number | null, reason?: string): void {
    for (const pending of this.pending.values()) {
      pending.reject(new Error('El proceso de descargas se cerró inesperadamente.'))
    }
    this.pending.clear()
    this.child = null
    if (!this.stopping) {
      this.onEvent({ event: 'backend_exit', data: { code, stderr: reason ?? this.stderr } })
    }
  }
}
