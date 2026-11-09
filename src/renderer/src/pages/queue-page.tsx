import { useState } from 'react'
import {
  CircleCheck,
  CircleSlash,
  CircleX,
  Clock,
  Download,
  FileDown,
  FileUp,
  FolderOpen,
  ListPlus,
  ListVideo,
  LoaderCircle,
  Trash2,
  Eraser
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ProgressBar } from '@/components/progress-bar'
import { AddLinksDialog } from '@/components/add-links-dialog'
import { desktop } from '@/lib/api'
import { formatSize } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  actions,
  clearFinished,
  FINISHED,
  FPS_PRESETS,
  fpsLabel,
  isBusy,
  loadQueue,
  QUEUE_QUALITIES,
  qualityLabel,
  removeItems,
  runQueue,
  saveQueue,
  useApp,
  type QueueItem
} from '@/store'

export function QueuePage() {
  const state = useApp()
  const { queue } = state
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)
  const busy = isBusy(state)
  const running = state.run !== null
  const pending = queue.filter((item) => !FINISHED.includes(item.status)).length
  const selectedIds = queue.filter((item) => selected.has(item.id)).map((item) => item.id)
  const allSelected = queue.length > 0 && selectedIds.length === queue.length

  const toggle = (id: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-5 p-8">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cola</h1>
          <p className="text-sm text-muted-foreground">
            Usa el formato, los subtítulos y la carpeta de la pestaña Descargar.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={loadQueue} disabled={running}>
            <FileUp />
            Cargar
          </Button>
          <Button variant="outline" size="sm" onClick={saveQueue}>
            <FileDown />
            Guardar
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-end gap-4 rounded-2xl border bg-card p-4">
        <div className="flex flex-col gap-2">
          <Label className="text-xs text-muted-foreground uppercase">Calidad máxima</Label>
          <Select value={state.queueQuality} onValueChange={(value) => actions.set({ queueQuality: value })}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {QUEUE_QUALITIES.map((value) => (
                <SelectItem key={value} value={value}>
                  {qualityLabel(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label className="text-xs text-muted-foreground uppercase">Fotogramas</Label>
          <Select value={state.queueFps} onValueChange={(value) => actions.set({ queueFps: value })}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {['auto', ...FPS_PRESETS.map(String)].map((value) => (
                <SelectItem key={value} value={value}>
                  {fpsLabel(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1" />
        <Button variant="outline" onClick={() => setAdding(true)}>
          <ListPlus />
          Añadir enlaces
        </Button>
        <Button onClick={() => void runQueue()} disabled={busy || pending === 0}>
          <Download />
          Descargar cola{pending ? ` (${pending})` : ''}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-card">
        <div className="flex items-center gap-3 border-b px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase">
          <Checkbox
            checked={allSelected ? true : selectedIds.length ? 'indeterminate' : false}
            onCheckedChange={(checked) => setSelected(checked ? new Set(queue.map((item) => item.id)) : new Set())}
            disabled={!queue.length}
          />
          <span className="flex-1">Video o enlace</span>
          <span className="w-56">Estado</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {queue.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center text-muted-foreground">
              <ListVideo className="size-10 opacity-40" />
              <p className="text-sm">
                La cola está vacía. Añade enlaces, arrastra varios a la ventana o carga una cola guardada.
              </p>
            </div>
          ) : (
            queue.map((item) => (
              <Row key={item.id} item={item} checked={selected.has(item.id)} onCheck={toggle} />
            ))
          )}
        </div>
        <div className="flex items-center gap-2 border-t px-4 py-2.5">
          <span className="flex-1 text-xs text-muted-foreground">
            {queue.length} {queue.length === 1 ? 'elemento' : 'elementos'} · {pending} pendientes
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={running || !selectedIds.length}
            onClick={() => {
              removeItems(selectedIds)
              setSelected(new Set())
            }}
          >
            <Trash2 />
            Quitar seleccionados
          </Button>
          <Button variant="ghost" size="sm" disabled={running} onClick={clearFinished}>
            <Eraser />
            Limpiar terminados
          </Button>
        </div>
      </div>

      <AddLinksDialog open={adding} onOpenChange={setAdding} />
    </div>
  )
}

const STATUS_STYLES: Record<QueueItem['status'], { icon: typeof Clock; className: string; label: string }> = {
  pending: { icon: Clock, className: 'text-muted-foreground', label: 'Pendiente' },
  waiting: { icon: Clock, className: 'text-muted-foreground', label: 'En espera' },
  running: { icon: LoaderCircle, className: 'text-primary', label: 'Descargando' },
  processing: { icon: LoaderCircle, className: 'text-primary', label: 'Procesando' },
  done: { icon: CircleCheck, className: 'text-success', label: 'Listo' },
  error: { icon: CircleX, className: 'text-destructive', label: 'Error' },
  cancelled: { icon: CircleSlash, className: 'text-muted-foreground', label: 'Cancelado' },
  skipped: { icon: CircleSlash, className: 'text-destructive', label: 'Omitido' }
}

function Row({
  item,
  checked,
  onCheck
}: {
  item: QueueItem
  checked: boolean
  onCheck: (id: string, checked: boolean) => void
}) {
  const style = STATUS_STYLES[item.status]
  const Icon = style.icon
  const spinning = item.status === 'running' || item.status === 'processing'
  const detail = item.status === 'running' || item.status === 'error' || item.status === 'skipped' ? item.detail : ''

  return (
    <div
      className={cn(
        'flex items-center gap-3 border-b border-border/60 px-4 py-2.5 last:border-b-0',
        checked && 'bg-primary/6'
      )}
    >
      <Checkbox checked={checked} onCheckedChange={(value) => onCheck(item.id, value === true)} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium selectable">{item.title ?? item.url}</p>
        {item.title && <p className="truncate text-xs text-muted-foreground selectable">{item.url}</p>}
      </div>
      <div className="flex w-56 items-center gap-2">
        <Icon className={cn('size-4 shrink-0', style.className, spinning && 'animate-spin')} />
        <div className="min-w-0 flex-1">
          {spinning ? (
            <>
              <div className="flex justify-between text-xs">
                <span className="truncate">{item.detail || style.label}</span>
                {item.status === 'running' && item.fraction !== null && (
                  <span className="text-muted-foreground tabular-nums">
                    {Math.floor(item.fraction * 100)}%{item.speed ? ` · ${formatSize(item.speed)}/s` : ''}
                  </span>
                )}
              </div>
              <ProgressBar
                value={item.status === 'processing' ? null : (item.fraction ?? 0)}
                className="mt-1 h-1"
              />
            </>
          ) : detail ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <p className={cn('truncate text-xs', style.className)}>{detail}</p>
              </TooltipTrigger>
              <TooltipContent className="max-w-sm">{detail}</TooltipContent>
            </Tooltip>
          ) : (
            <p className={cn('text-xs', style.className)}>{style.label}</p>
          )}
        </div>
        {item.status === 'done' && item.path && (
          <Button variant="ghost" size="icon-xs" onClick={() => desktop.showItem(item.path!)} title="Abrir carpeta">
            <FolderOpen />
          </Button>
        )}
      </div>
    </div>
  )
}
