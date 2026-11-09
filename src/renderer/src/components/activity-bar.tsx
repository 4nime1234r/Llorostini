import { LoaderCircle, TriangleAlert, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ProgressBar } from '@/components/progress-bar'
import { formatEta, formatSize, shorten } from '@/lib/format'
import { cancelRun, goTo, overallFraction, useApp } from '@/store'

export function ActivityBar() {
  const state = useApp()
  const { run, single, updating, failures } = state

  if (updating) {
    const fraction = updating.total ? updating.done / updating.total : null
    return (
      <Shell fraction={fraction}>
        <LoaderCircle className="size-4 animate-spin text-primary" />
        <span className="flex-1">
          Descargando actualización… {(updating.done / 1_048_576).toFixed(1)} MB
        </span>
      </Shell>
    )
  }
  if (!run) return null

  const fraction = overallFraction(state)
  let main: string
  let detail = ''
  if (run.mode === 'single' && single) {
    main = shorten(single.title ?? single.url, 70)
    const parts = [single.detail]
    if (single.status === 'running' && single.fraction !== null) parts.push(`${Math.floor(single.fraction * 100)}%`)
    if (single.speed) parts.push(`${formatSize(single.speed)}/s`)
    const eta = formatEta(single.eta)
    if (single.status === 'running' && eta) parts.push(`quedan ${eta}`)
    detail = parts.filter(Boolean).join(' · ')
  } else {
    const items = state.queue.filter((item) => run.ids.includes(item.id))
    const active = items.filter((item) => item.status === 'running' || item.status === 'processing')
    const finished = items.filter((item) => ['done', 'error', 'cancelled'].includes(item.status)).length
    const speed = active.reduce((acc, item) => acc + (item.speed || 0), 0)
    main =
      active.length > 1
        ? `Descargando ${active.length} a la vez`
        : active[0]
          ? shorten(active[0].title ?? active[0].url, 60)
          : 'Preparando…'
    detail = [`${finished}/${items.length} listos`, speed ? `${formatSize(speed)}/s` : '']
      .filter(Boolean)
      .join(' · ')
  }

  const indeterminate = run.mode === 'single' && single?.status === 'processing'
  return (
    <Shell fraction={indeterminate ? null : (fraction ?? 0)}>
      <LoaderCircle className="size-4 shrink-0 animate-spin text-primary" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{run.cancelling ? 'Cancelando…' : main}</p>
        <p className="truncate text-xs text-muted-foreground tabular-nums">{detail}</p>
      </div>
      {failures.length > 0 && (
        <button
          onClick={() => goTo('history')}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
        >
          <TriangleAlert className="size-3.5" />
          {failures.length} {failures.length === 1 ? 'omitido' : 'omitidos'}
        </button>
      )}
      {fraction !== null && !indeterminate && (
        <span className="w-10 text-right text-sm font-semibold tabular-nums">{Math.floor(fraction * 100)}%</span>
      )}
      <Button variant="outline" size="sm" onClick={cancelRun} disabled={run.cancelling}>
        <X />
        Cancelar
      </Button>
    </Shell>
  )
}

function Shell({ fraction, children }: { fraction: number | null; children: React.ReactNode }) {
  return (
    <div className="shrink-0 border-t bg-card/80 backdrop-blur">
      <ProgressBar value={fraction} className="h-1 rounded-none" />
      <div className="flex items-center gap-3 px-5 py-3 text-sm">{children}</div>
    </div>
  )
}
