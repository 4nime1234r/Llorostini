const URL_PATTERN = /https?:\/\/[^\s{}"'<>]+/g

export function findUrls(text: string): string[] {
  const seen = new Set<string>()
  for (const match of text.matchAll(URL_PATTERN)) seen.add(match[0].replace(/[.,;)]+$/, ''))
  return [...seen]
}

export function formatSize(size: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = size
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index++
  }
  const text = index < 2 ? value.toFixed(0) : value.toFixed(1).replace('.', ',')
  return `${text} ${units[index]}`
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return ''
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

export function formatEta(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return ''
  if (seconds < 60) return `${Math.round(seconds)} s`
  return `${Math.round(seconds / 60)} min`
}

export function fold(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase()
}

export function shorten(text: string, limit = 80): string {
  const clean = text.split(/\s+/).join(' ').trim()
  return clean.length <= limit ? clean : clean.slice(0, limit - 1).trimEnd() + '…'
}

export const SOURCE_LABELS: Record<string, string> = {
  youtube: 'YouTube',
  twitch: 'Twitch',
  spotify: 'Spotify'
}
