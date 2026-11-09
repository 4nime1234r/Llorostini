export type ThemeName = 'Oscuro' | 'Claro' | 'Cyberpunk' | 'Minimalista'

export interface Settings {
  speed_limit: string
  minimize_to_tray: boolean
  subtitle_lang: string
  save_thumbnail: boolean
  thumbnail_format: string
  embed_lyrics: boolean
  by_channel: boolean
  proxy: string
  theme: ThemeName
  parallel_downloads: number
}

export interface InitInfo {
  appName: string
  version: string
  repo: string
  hasFfmpeg: boolean
  defaultDir: string
  settings: Settings
  choices: {
    containers: string[]
    audioFormats: string[]
    subtitles: Record<string, string>
    thumbnailFormats: string[]
    speeds: string[]
  }
}

export interface VideoInfo {
  title: string
  uploader: string
  duration: number | null
  heights: number[]
  fpsByHeight: Record<string, number[]>
  fpsOptions: number[]
  source: string
  thumbnail: string | null
}

export interface PlaylistInfo {
  title: string
  uploader: string
  total: number
  skipped: number
  source: string
  thumbnail: string | null
}

export type SearchKind = 'video' | 'playlist' | 'video_in_list' | 'spotify_track' | 'spotify_list'

export interface SearchResult {
  kind: SearchKind
  video: VideoInfo | null
  playlist: PlaylistInfo | null
  track: Record<string, unknown> | null
}

export interface ClassifiedUrl {
  url: string
  kind: 'video' | 'playlist' | 'video_in_list'
  platform: string
}

export interface DownloadJob {
  id: string
  url: string
  title?: string | null
  height?: number | null
  fps?: number | null
  out_dir?: string
  prefix?: string
  duration?: number | null
  spotify?: Record<string, unknown>
}

export interface DownloadOptions {
  outDir: string
  audio: boolean
  container: string
  audioFormat: string
  subtitles: string | null
}

export interface PlaylistPlan {
  folder: string
  jobs: Omit<DownloadJob, 'id'>[]
  unavailable: { url: string; title: string; reason: string }[]
}

export interface HistoryEntry {
  title: string
  path: string
  kind: 'audio' | 'video' | 'error'
  date: string
  url?: string
  reason?: string
  exists: boolean
}

export interface QueueFile {
  items: (Omit<DownloadJob, 'id'> & { kind: ClassifiedUrl['kind'] })[]
  quality: string | null
  fps: string | null
}

export interface Release {
  version: string
  notes: string
  pageUrl: string
  assetUrl: string | null
  newer: boolean
}

export interface SpaceInfo {
  free: number | null
  estimate: number | null
}

export type EstimateRequest =
  | { mode: 'video'; height: number | null; audio: boolean; audioFormat: string }
  | { mode: 'list'; height: number | null; audio: boolean; audioFormat: string; start: number; end: number }
  | { mode: 'seconds'; height: number | null; audio: boolean; audioFormat: string; seconds: number }

export type BackendEvent =
  | { event: 'ready'; data: { version: string } }
  | { event: 'job_start'; data: { id: string } }
  | { event: 'job_status'; data: { id: string; text: string } }
  | { event: 'job_retry'; data: { id: string; attempt: number; total: number } }
  | {
      event: 'progress'
      data:
        | { id: string; state: 'downloading'; fraction: number | null; speed: number; eta: number | null }
        | { id: string; state: 'processing' }
    }
  | { event: 'job_done'; data: { id: string; path: string; name: string; kind: 'audio' | 'video' } }
  | { event: 'job_error'; data: { id: string; message: string } }
  | { event: 'job_cancelled'; data: { id: string } }
  | { event: 'jobs_finished'; data: { ok: number; fail: number; cancelled: boolean; mode: string } }
  | { event: 'backend_exit'; data: { code: number | null; stderr: string } }

export interface FileFilter {
  name: string
  extensions: string[]
}

export interface DesktopApi {
  call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>
  onEvent(listener: (event: BackendEvent) => void): () => void
  pickFolder(initial: string): Promise<string | null>
  pickFile(title: string, filters: FileFilter[]): Promise<string | null>
  pickSaveFile(title: string, defaultName: string, filters: FileFilter[]): Promise<string | null>
  readTextFile(title: string): Promise<string | null>
  openPath(path: string): Promise<string>
  showItem(path: string): Promise<void>
  openExternal(url: string): Promise<void>
  readClipboard(): Promise<string>
  setTheme(theme: ThemeName): Promise<void>
  setProgress(fraction: number | null): Promise<void>
  hideToTray(tooltip: string): Promise<boolean>
  setTrayTooltip(text: string): Promise<void>
  finishTray(title: string, body: string): Promise<void>
  notify(title: string, body: string): Promise<void>
  canSelfUpdate(): Promise<boolean>
  installUpdate(assetUrl: string): Promise<void>
  onUpdateProgress(listener: (done: number, total: number) => void): () => void
  onWindowFocus(listener: () => void): () => void
}
