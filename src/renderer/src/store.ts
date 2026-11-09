import { create } from 'zustand'
import { toast } from 'sonner'
import type {
  BackendEvent,
  DownloadJob,
  DownloadOptions,
  HistoryEntry,
  InitInfo,
  Release,
  SearchResult,
  Settings
} from '@shared/types'
import { backend, desktop, errorText } from '@/lib/api'
import { formatSize, shorten } from '@/lib/format'

export type Page = 'download' | 'queue' | 'history' | 'updates' | 'settings'

export type ItemStatus =
  | 'pending'
  | 'waiting'
  | 'running'
  | 'processing'
  | 'done'
  | 'error'
  | 'cancelled'
  | 'skipped'

export type JobExtra = Pick<DownloadJob, 'out_dir' | 'prefix' | 'duration' | 'spotify'>

export interface QueueItem {
  id: string
  url: string
  title: string | null
  status: ItemStatus
  detail: string
  fraction: number | null
  speed: number
  eta: number | null
  path?: string
  extra: JobExtra
}

export interface Failure {
  title: string
  message: string
}

interface Run {
  mode: 'single' | 'queue'
  ids: string[]
  cancelling: boolean
  trayActive: boolean
}

interface ConfirmRequest {
  title: string
  description: string
  confirmLabel: string
  destructive?: boolean
  resolve: (ok: boolean) => void
}

export const QUEUE_QUALITIES = ['best', '2160', '1440', '1080', '720', '480', '360']
export const FPS_PRESETS = [60, 30, 24]
export const FINISHED: ItemStatus[] = ['done', 'skipped']
const SPACE_MARGIN = 1.15
const MIN_FREE_BYTES = 500 * 1024 * 1024
const DEFAULT_ITEM_SECONDS = 300

let counter = 0
export const newId = () => `j${Date.now().toString(36)}${(counter++).toString(36)}`

export const qualityLabel = (value: string) => (value === 'best' ? 'Mejor disponible' : `${value}p`)
export const fpsLabel = (value: string) => (value === 'auto' ? 'Automático' : `${value} fps`)
const legacyQuality = (value: string | null) =>
  value === 'Mejor disponible' ? 'best' : value?.match(/^(\d+)p$/)?.[1] ?? null
const legacyFps = (value: string | null) => (value === 'Automático' ? 'auto' : value?.match(/^(\d+) fps$/)?.[1] ?? null)

interface State {
  info: InitInfo | null
  settings: Settings | null
  page: Page

  url: string
  searching: boolean
  result: SearchResult | null
  onlyVideo: boolean
  rangeFrom: string
  rangeTo: string
  audio: boolean
  quality: string
  fps: string
  container: string
  audioFormat: string
  subtitles: boolean
  outDir: string

  queue: QueueItem[]
  queueQuality: string
  queueFps: string

  run: Run | null
  single: QueueItem | null
  failures: Failure[]
  lastPath: string | null

  history: HistoryEntry[]
  release: Release | null
  updateAvailable: boolean
  updating: { done: number; total: number } | null

  confirmRequest: ConfirmRequest | null
  urlFocusTick: number
  historyFocusTick: number
}

type Setter = Partial<State> | ((state: State) => Partial<State>)

export const useApp = create<State>(() => ({
  info: null,
  settings: null,
  page: 'download',
  url: '',
  searching: false,
  result: null,
  onlyVideo: true,
  rangeFrom: '1',
  rangeTo: '1',
  audio: false,
  quality: 'best',
  fps: 'auto',
  container: 'mp4',
  audioFormat: 'mp3',
  subtitles: false,
  outDir: '',
  queue: [],
  queueQuality: 'best',
  queueFps: 'auto',
  run: null,
  single: null,
  failures: [],
  lastPath: null,
  history: [],
  release: null,
  updateAvailable: false,
  updating: null,
  confirmRequest: null,
  urlFocusTick: 0,
  historyFocusTick: 0
}))

const set = (partial: Setter) => useApp.setState(partial as never)
const get = () => useApp.getState()

export const actions = { set }

export function isBusy(state: State = get()): boolean {
  return state.searching || state.run !== null || state.updating !== null
}

export function isSpotify(result: SearchResult | null): boolean {
  return !!result && (result.track !== null || result.playlist?.source === 'spotify')
}

export function listMode(state: Pick<State, 'result' | 'onlyVideo'>): boolean {
  const { result } = state
  return !!result?.playlist && (!result.video || !state.onlyVideo)
}

export function effectiveAudio(state: Pick<State, 'result' | 'audio'>): boolean {
  return state.audio || isSpotify(state.result)
}

export function fpsChoices(state: State): { values: number[]; locked: boolean } {
  if (!state.result || effectiveAudio(state)) return { values: [], locked: false }
  if (listMode(state)) return { values: FPS_PRESETS, locked: false }
  const video = state.result.video
  if (!video) return { values: [], locked: false }
  const values = state.quality === 'best' ? video.fpsOptions : (video.fpsByHeight[state.quality] ?? [])
  return { values, locked: values.length === 1 }
}

export function selectedFps(state: State): number | null {
  const { values, locked } = fpsChoices(state)
  if (locked) return values[0]
  return state.fps !== 'auto' && values.includes(Number(state.fps)) ? Number(state.fps) : null
}

export function rangeValues(state: State): [number, number] {
  const total = state.result?.playlist?.total ?? 1
  const start = Math.max(1, parseInt(state.rangeFrom, 10) || 1)
  const end = parseInt(state.rangeTo, 10) || total
  return [start, Math.max(start, end)]
}

export function overallFraction(state: State): number | null {
  const run = state.run
  if (!run) return null
  if (run.mode === 'single') return state.single?.fraction ?? null
  const items = state.queue.filter((item) => run.ids.includes(item.id))
  if (!items.length) return null
  const sum = items.reduce((acc, item) => {
    if (['done', 'error', 'cancelled', 'skipped'].includes(item.status)) return acc + 1
    return acc + (item.status === 'running' ? (item.fraction ?? 0) : item.status === 'processing' ? 1 : 0)
  }, 0)
  return Math.min(1, sum / items.length)
}

export function confirm(request: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => set({ confirmRequest: { ...request, resolve } }))
}

export function goTo(page: Page) {
  set({ page })
  if (page === 'history') void refreshHistory()
}

export async function refreshHistory() {
  try {
    set({ history: await backend.history() })
  } catch {}
}

let initializing: Promise<void> | null = null

export function initialize(): Promise<void> {
  initializing ??= loadInitialState()
  return initializing
}

async function loadInitialState() {
  const info = await backend.init()
  set({
    info,
    settings: info.settings,
    outDir: info.defaultDir,
    container: info.choices.containers[0],
    audioFormat: info.choices.audioFormats[0]
  })
  void refreshHistory()
  setTimeout(async () => {
    try {
      const removed = await backend.sweepOrphans()
      if (removed) toast.info(`Se limpiaron ${removed} restos de descargas interrumpidas.`)
    } catch {}
  }, 900)
  setTimeout(() => void checkUpdates(true), 1500)
}

export async function saveSettings(patch: Partial<Settings>): Promise<boolean> {
  const previous = get().settings
  if (!previous) return false
  set({ settings: { ...previous, ...patch } })
  try {
    set({ settings: await backend.saveSettings(patch) })
    return true
  } catch (error) {
    set({ settings: previous })
    toast.error(errorText(error))
    return false
  }
}

export async function search() {
  const url = get().url.trim()
  if (!url || isBusy()) return
  set({ searching: true, result: null, quality: 'best', fps: 'auto', lastPath: null })
  try {
    const result = await backend.search(url)
    set({
      result,
      onlyVideo: result.kind === 'video_in_list',
      rangeFrom: '1',
      rangeTo: String(result.playlist?.total ?? 1)
    })
  } catch (error) {
    toast.error('No se pudo obtener la información', { description: errorText(error) })
  } finally {
    set({ searching: false })
  }
}

function makeItem(url: string, title: string | null, extra: JobExtra = {}): QueueItem {
  return { id: newId(), url, title, status: 'pending', detail: '', fraction: null, speed: 0, eta: null, extra }
}

export async function addUrls(text: string): Promise<{ added: number; repeated: number; playlists: number }> {
  const classified = await backend.classify(text)
  const known = new Set(get().queue.map((item) => item.url))
  const fresh: QueueItem[] = []
  let repeated = 0
  let playlists = 0
  for (const { url, kind } of classified) {
    if (known.has(url)) repeated++
    else if (kind === 'playlist') playlists++
    else {
      known.add(url)
      fresh.push(makeItem(url, null))
    }
  }
  set((state) => ({ queue: [...state.queue, ...fresh] }))
  return { added: fresh.length, repeated, playlists }
}

export function addedMessage({ added, playlists }: { added: number; playlists: number }): string {
  let text =
    added === 0
      ? 'Esos enlaces ya estaban en la cola.'
      : added === 1
        ? '1 enlace añadido a la cola.'
        : `${added} enlaces añadidos a la cola.`
  if (playlists === 1) text += ' 1 es una lista de reproducción: pégala en Descargar.'
  else if (playlists) text += ` ${playlists} son listas de reproducción: pégalas en Descargar.`
  return text
}

export function removeItems(ids: string[]) {
  if (get().run) return
  set((state) => ({ queue: state.queue.filter((item) => !ids.includes(item.id)) }))
}

export function clearFinished() {
  if (get().run) return
  set((state) => ({ queue: state.queue.filter((item) => !FINISHED.includes(item.status)) }))
}

const QUEUE_FILTERS = [
  { name: 'Cola de LLorostini (JSON)', extensions: ['json'] },
  { name: 'Lista de enlaces (TXT)', extensions: ['txt'] }
]

export async function saveQueue() {
  const state = get()
  const items = state.queue
    .filter((item) => !FINISHED.includes(item.status))
    .map((item) => ({ url: item.url, title: item.title ?? item.url, ...item.extra }))
  if (!items.length) {
    toast.info('No hay enlaces pendientes que guardar.')
    return
  }
  const path = await desktop.pickSaveFile('Guardar cola', 'cola_llorostini.json', QUEUE_FILTERS)
  if (!path) return
  try {
    await backend.writeQueue(path, items, qualityLabel(state.queueQuality), fpsLabel(state.queueFps))
    toast.success(`Cola guardada: ${items.length} enlaces.`)
  } catch (error) {
    toast.error('No se pudo guardar la cola', { description: errorText(error) })
  }
}

export async function loadQueue() {
  if (get().run) return
  const path = await desktop.pickFile('Cargar cola', [
    { name: 'Cola o lista de enlaces', extensions: ['json', 'txt'] },
    { name: 'Todos los archivos', extensions: ['*'] }
  ])
  if (!path) return
  try {
    const file = await backend.readQueue(path)
    if (!file.items.length) {
      toast.info('No se encontró ningún enlace válido en el archivo.')
      return
    }
    const known = new Set(get().queue.map((item) => item.url))
    const fresh: QueueItem[] = []
    let repeated = 0
    let playlists = 0
    for (const { url, title, kind, out_dir, prefix, duration, spotify } of file.items) {
      if (known.has(url)) repeated++
      else if (kind === 'playlist') playlists++
      else {
        known.add(url)
        fresh.push(makeItem(url, title ?? null, { out_dir, prefix, duration, spotify }))
      }
    }
    const quality = legacyQuality(file.quality)
    const fps = legacyFps(file.fps)
    set((state) => ({
      queue: [...state.queue, ...fresh],
      queueQuality: quality && QUEUE_QUALITIES.includes(quality) ? quality : state.queueQuality,
      queueFps: fps && (fps === 'auto' || FPS_PRESETS.includes(Number(fps))) ? fps : state.queueFps
    }))
    let message = `Cola cargada: ${fresh.length} enlaces`
    if (repeated) message += ` (${repeated} ya estaban)`
    if (playlists) message += ` · ${playlists} listas omitidas (pégalas en Descargar)`
    toast.success(message + '.')
  } catch (error) {
    toast.error('No se pudo leer el archivo', { description: errorText(error) })
  }
}

async function confirmSpace(folder: string, estimate: number | null): Promise<boolean> {
  let free: number | null = null
  try {
    free = (await backend.space(folder)).free
  } catch {
    return true
  }
  if (free === null) return true
  if (estimate && estimate * SPACE_MARGIN > free) {
    return confirm({
      title: 'Espacio en disco',
      description: `Se necesitan unos ${formatSize(estimate)} y solo hay ${formatSize(free)} libres en ${folder}. La descarga podría fallar a mitad. ¿Continuar de todos modos?`,
      confirmLabel: 'Continuar'
    })
  }
  if (free < MIN_FREE_BYTES) {
    return confirm({
      title: 'Espacio en disco',
      description: `Quedan solo ${formatSize(free)} libres en ${folder}. ¿Continuar de todos modos?`,
      confirmLabel: 'Continuar'
    })
  }
  return true
}

function downloadOptions(): DownloadOptions {
  const state = get()
  const audio = effectiveAudio(state)
  return {
    outDir: state.outDir,
    audio,
    container: state.container,
    audioFormat: state.audioFormat,
    subtitles: state.subtitles && !audio ? (state.settings?.subtitle_lang ?? 'es') : null
  }
}

async function startJobs(jobs: DownloadJob[], mode: 'single' | 'queue'): Promise<boolean> {
  const settings = get().settings
  set({
    run: { mode, ids: jobs.map((job) => job.id), cancelling: false, trayActive: false },
    failures: [],
    lastPath: null
  })
  try {
    await backend.startDownloads(jobs, downloadOptions(), mode)
  } catch (error) {
    set({ run: null, single: null })
    toast.error('No se pudo iniciar la descarga', { description: errorText(error) })
    return false
  }
  void desktop.setProgress(0)
  if (settings?.minimize_to_tray) {
    const hidden = await desktop.hideToTray('LLorostini - descargando')
    set((state) => (state.run ? { run: { ...state.run, trayActive: hidden } } : {}))
  }
  return true
}

export async function downloadCurrent() {
  const state = get()
  if (!state.result || isBusy()) return
  const height = state.quality === 'best' ? null : Number(state.quality)
  if (listMode(state)) {
    await downloadPlaylist(height)
    return
  }
  const audio = effectiveAudio(state)
  let estimate: number | null = null
  try {
    estimate = (
      await backend.space(state.outDir, { mode: 'video', height, audio, audioFormat: state.audioFormat })
    ).estimate
  } catch {}
  if (!(await confirmSpace(state.outDir, estimate))) return
  const track = state.result.track
  const job: DownloadJob = {
    id: newId(),
    url: track ? String(track.url) : state.url.trim(),
    title: state.result.video?.title ?? state.url,
    height,
    fps: selectedFps(state),
    ...(track ? { spotify: track } : {})
  }
  set({ single: { ...makeItem(job.url, job.title ?? null), id: job.id, status: 'waiting' } })
  await startJobs([job], 'single')
}

async function downloadPlaylist(height: number | null) {
  const state = get()
  const playlist = state.result?.playlist
  if (!playlist) return
  const start = parseInt(state.rangeFrom, 10)
  const end = parseInt(state.rangeTo, 10)
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
    toast.error('Rango no válido', {
      description: 'El primer número debe ser 1 o más y el segundo no puede ser menor que el primero.'
    })
    return
  }
  let plan
  try {
    plan = await backend.planPlaylist(start, end, state.outDir, !!state.settings?.by_channel)
  } catch (error) {
    toast.error(errorText(error))
    return
  }
  if (!plan.jobs.length) {
    toast.info('No hay videos disponibles en ese rango.')
    return
  }
  if (
    plan.jobs.length > 20 &&
    !(await confirm({
      title: 'Lista de reproducción',
      description: `Se descargarán ${plan.jobs.length} elementos en ${plan.folder}. ¿Continuar?`,
      confirmLabel: 'Descargar'
    }))
  ) {
    return
  }
  const audio = effectiveAudio(state)
  let estimate: number | null = null
  try {
    estimate = (
      await backend.space(state.outDir, { mode: 'list', height, audio, audioFormat: state.audioFormat, start, end })
    ).estimate
  } catch {}
  if (!(await confirmSpace(plan.folder, estimate))) return

  const fps = selectedFps(state)
  const items = plan.jobs.map((job) => ({
    ...makeItem(job.url, job.title ?? null, {
      out_dir: job.out_dir,
      prefix: job.prefix,
      duration: job.duration,
      spotify: job.spotify
    }),
    status: 'waiting' as ItemStatus,
    detail: 'En espera'
  }))
  const jobs: DownloadJob[] = items.map((item, index) => ({ ...plan.jobs[index], id: item.id, height, fps }))
  const skipped = plan.unavailable.map((entry) => ({
    ...makeItem(entry.url, entry.title),
    status: 'skipped' as ItemStatus,
    detail: entry.reason
  }))
  set((current) => ({ queue: [...current.queue, ...items], page: 'queue' }))
  if (!(await startJobs(jobs, 'queue'))) return
  if (skipped.length) {
    set((current) => ({
      queue: [...current.queue, ...skipped],
      failures: [...current.failures, ...plan.unavailable.map((u) => ({ title: u.title, message: u.reason }))]
    }))
    await backend.addFailures(plan.unavailable)
    void refreshHistory()
  }
}

export async function runQueue() {
  const state = get()
  if (isBusy()) return
  const height = state.queueQuality === 'best' ? null : Number(state.queueQuality)
  const fps = state.queueFps === 'auto' ? null : Number(state.queueFps)
  const pending = state.queue.filter((item) => !FINISHED.includes(item.status))
  if (!pending.length) return
  const seconds = pending.reduce((acc, item) => acc + (item.extra.duration || DEFAULT_ITEM_SECONDS), 0)
  let estimate: number | null = null
  try {
    estimate = (
      await backend.space(state.outDir, {
        mode: 'seconds',
        height,
        audio: effectiveAudio(state),
        audioFormat: state.audioFormat,
        seconds
      })
    ).estimate
  } catch {}
  if (!(await confirmSpace(pending[0].extra.out_dir || state.outDir, estimate))) return
  const ids = new Set(pending.map((item) => item.id))
  set((current) => ({
    queue: current.queue.map((item) =>
      ids.has(item.id) ? { ...item, status: 'waiting', detail: 'En espera', fraction: null } : item
    )
  }))
  const jobs: DownloadJob[] = pending.map((item) => ({
    id: item.id,
    url: item.url,
    title: item.title,
    height,
    fps,
    ...item.extra
  }))
  await startJobs(jobs, 'queue')
}

export async function cancelRun() {
  const run = get().run
  if (!run || run.cancelling) return
  set({ run: { ...run, cancelling: true } })
  try {
    await backend.cancel()
  } catch (error) {
    toast.error(errorText(error))
  }
}

function patchItem(id: string, patch: Partial<QueueItem>) {
  set((state) => {
    if (state.single?.id === id) return { single: { ...state.single, ...patch } }
    return { queue: state.queue.map((item) => (item.id === id ? { ...item, ...patch } : item)) }
  })
}

function findItem(id: string): QueueItem | undefined {
  const state = get()
  return state.single?.id === id ? state.single : state.queue.find((item) => item.id === id)
}

let lastPercent = -1

function reportProgress() {
  const state = get()
  const fraction = overallFraction(state)
  const percent = fraction === null ? -1 : Math.floor(fraction * 100)
  if (percent === lastPercent) return
  lastPercent = percent
  void desktop.setProgress(fraction === null ? -1 : fraction)
  if (state.run?.trayActive) void desktop.setTrayTooltip(`LLorostini - ${Math.max(0, percent)}%`)
}

function finishRun(data: { ok: number; fail: number; cancelled: boolean; mode: string }) {
  const state = get()
  const run = state.run
  lastPercent = -1
  void desktop.setProgress(null)
  set({ run: null })
  void refreshHistory()

  const finishTray = (title: string, body: string) => {
    if (run?.trayActive) void desktop.finishTray(title, body)
    else void desktop.notify(title, body)
  }

  if (data.mode === 'single') {
    const single = state.single
    if (data.ok && single?.path) {
      toast.success('Descarga completada', { description: single.title ?? undefined })
      finishTray('Descarga completada', single.title ?? '')
    } else if (data.cancelled) {
      toast.info('Descarga cancelada.')
      finishTray('Descarga cancelada', 'Puedes reanudarla más tarde.')
    } else {
      const message = single?.detail || 'No se pudo completar la descarga.'
      toast.error('Error en la descarga', { description: message, duration: 10000 })
      finishTray('Error en la descarga', message)
    }
    return
  }

  let summary = `Cola terminada: ${data.ok} descargados`
  if (data.fail) summary += `, ${data.fail} con error`
  if (data.cancelled) summary += ', cancelada'
  summary += '.'
  if (data.fail) toast.warning(summary, { description: 'Los errores también quedan en el Historial.' })
  else toast.success(summary)
  finishTray('Cola terminada', summary)
}

export function handleEvent(event: BackendEvent) {
  switch (event.event) {
    case 'job_start':
      patchItem(event.data.id, { status: 'running', detail: 'Iniciando descarga…', fraction: null })
      break
    case 'job_status':
      patchItem(event.data.id, { status: 'running', detail: event.data.text })
      break
    case 'job_retry':
      patchItem(event.data.id, {
        status: 'running',
        detail: `Error de red. Reintentando (${event.data.attempt}/${event.data.total})…`
      })
      break
    case 'progress': {
      const data = event.data
      if (data.state === 'processing') {
        patchItem(data.id, { status: 'processing', detail: 'Procesando archivo…', fraction: 1, speed: 0 })
      } else {
        const current = findItem(data.id)
        const fraction =
          data.fraction === null ? null : Math.max(current?.fraction ?? 0, Math.min(1, data.fraction))
        patchItem(data.id, { status: 'running', detail: 'Descargando', fraction, speed: data.speed, eta: data.eta })
      }
      reportProgress()
      break
    }
    case 'job_done':
      patchItem(event.data.id, {
        status: 'done',
        detail: 'Listo',
        title: event.data.name,
        path: event.data.path,
        fraction: 1,
        speed: 0
      })
      set({ lastPath: event.data.path })
      reportProgress()
      break
    case 'job_error': {
      const item = findItem(event.data.id)
      patchItem(event.data.id, { status: 'error', detail: event.data.message, speed: 0 })
      if (get().run?.mode === 'queue') {
        const title = item?.title ?? item?.url ?? ''
        set((state) => ({ failures: [...state.failures, { title, message: event.data.message }] }))
        toast.error(`Omitido: ${shorten(title, 60)}`, { description: event.data.message })
      }
      reportProgress()
      break
    }
    case 'job_cancelled':
      patchItem(event.data.id, { status: 'cancelled', detail: 'Cancelado', speed: 0 })
      break
    case 'jobs_finished':
      finishRun(event.data)
      break
    case 'backend_exit':
      set({ run: null, searching: false })
      toast.error('El proceso de descargas se cerró', {
        description: event.data.stderr.split('\n').filter(Boolean).slice(-3).join('\n') || 'Reinicia la aplicación.',
        duration: Infinity
      })
      break
  }
}

export async function checkUpdates(silent: boolean): Promise<string | null> {
  try {
    const release = await backend.checkUpdate()
    set({ release, updateAvailable: release.newer })
    if (release.newer && silent) {
      toast.info(`Hay una versión nueva (${release.version})`, {
        action: { label: 'Ver', onClick: () => goTo('updates') }
      })
    }
    return null
  } catch (error) {
    return errorText(error)
  }
}

export async function installUpdate() {
  const release = get().release
  if (!release?.assetUrl || isBusy()) return
  const ok = await confirm({
    title: 'Actualización disponible',
    description: `Se descargará la versión ${release.version} y la aplicación se reiniciará. ¿Deseas actualizar ahora?`,
    confirmLabel: 'Actualizar'
  })
  if (!ok) return
  set({ updating: { done: 0, total: 0 } })
  const unsubscribe = desktop.onUpdateProgress((done, total) => set({ updating: { done, total } }))
  try {
    await desktop.installUpdate(release.assetUrl)
  } catch (error) {
    set({ updating: null })
    toast.error('Actualización', { description: errorText(error) })
  } finally {
    unsubscribe()
  }
}
