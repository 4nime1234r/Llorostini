import type {
  ClassifiedUrl,
  DownloadJob,
  DownloadOptions,
  EstimateRequest,
  HistoryEntry,
  InitInfo,
  PlaylistPlan,
  QueueFile,
  Release,
  SearchResult,
  Settings,
  SpaceInfo
} from '@shared/types'

export const desktop = window.api

const call = <T,>(method: string, params?: Record<string, unknown>) => desktop.call<T>(method, params)

export const backend = {
  init: () => call<InitInfo>('init'),
  saveSettings: (settings: Partial<Settings>) => call<Settings>('settings.save', { settings }),
  sweepOrphans: () => call<number>('orphans.sweep'),
  classify: (text: string) => call<ClassifiedUrl[]>('urls.classify', { text }),
  search: (url: string) => call<SearchResult>('search', { url }),
  space: (folder: string, estimate?: EstimateRequest) => call<SpaceInfo>('space', { folder, estimate }),
  planPlaylist: (start: number, end: number, outDir: string, byChannel: boolean) =>
    call<PlaylistPlan>('playlist.plan', { start, end, outDir, byChannel }),
  startDownloads: (jobs: DownloadJob[], options: DownloadOptions, mode: 'single' | 'queue') =>
    call<boolean>('download.start', { jobs, options, mode }),
  cancel: () => call<boolean>('download.cancel'),
  history: () => call<HistoryEntry[]>('history.list'),
  removeHistory: (entry: HistoryEntry) => call<HistoryEntry[]>('history.remove', { entry }),
  clearHistory: () => call<HistoryEntry[]>('history.clear'),
  addFailures: (items: { url: string; title: string; reason: string }[]) =>
    call<boolean>('history.addFailures', { items }),
  readQueue: (path: string) => call<QueueFile>('queue.read', { path }),
  writeQueue: (path: string, items: Omit<DownloadJob, 'id'>[], quality: string, fps: string) =>
    call<number>('queue.write', { path, items, quality, fps }),
  checkUpdate: () => call<Release>('update.check')
}

export function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}
