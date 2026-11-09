import { Download, History, ListVideo, RefreshCw, Settings, TriangleAlert } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FINISHED, goTo, useApp, type Page } from '@/store'

const ITEMS: { page: Page; label: string; icon: LucideIcon }[] = [
  { page: 'download', label: 'Descargar', icon: Download },
  { page: 'queue', label: 'Cola', icon: ListVideo },
  { page: 'history', label: 'Historial', icon: History },
  { page: 'updates', label: 'Actualizaciones', icon: RefreshCw },
  { page: 'settings', label: 'Ajustes', icon: Settings }
]

export function Sidebar() {
  const page = useApp((s) => s.page)
  const pending = useApp((s) => s.queue.filter((item) => !FINISHED.includes(item.status)).length)
  const updateAvailable = useApp((s) => s.updateAvailable)
  const info = useApp((s) => s.info)

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r bg-sidebar">
      <nav className="flex flex-1 flex-col gap-1 p-3">
        {ITEMS.map(({ page: target, label, icon: Icon }) => {
          const active = page === target
          return (
            <button
              key={target}
              onClick={() => goTo(target)}
              className={cn(
                'group relative flex h-10 items-center gap-3 rounded-lg px-3 text-left text-sm font-medium transition-colors',
                active
                  ? 'bg-primary/12 text-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
              )}
            >
              {active && <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-primary" />}
              <Icon className={cn('size-[18px]', active && 'text-primary')} />
              <span className="flex-1">{label}</span>
              {target === 'queue' && pending > 0 && (
                <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary tabular-nums">
                  {pending}
                </span>
              )}
              {target === 'updates' && updateAvailable && <span className="size-2 rounded-full bg-success" />}
            </button>
          )
        })}
      </nav>
      <div className="space-y-2 p-4 text-xs text-muted-foreground">
        {info && !info.hasFfmpeg && (
          <div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-destructive">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>ffmpeg no encontrado: calidad limitada y sin conversión de audio.</span>
          </div>
        )}
        {info && (
          <p>
            {info.appName} {info.version}
          </p>
        )}
      </div>
    </aside>
  )
}
