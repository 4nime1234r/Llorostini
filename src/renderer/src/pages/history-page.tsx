import { useEffect, useMemo, useRef, useState } from 'react'
import { AudioLines, CircleX, Film, FolderOpen, History, Play, Search, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import type { HistoryEntry } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { backend, desktop, errorText } from '@/lib/api'
import { fold } from '@/lib/format'
import { cn } from '@/lib/utils'
import { actions, confirm, useApp } from '@/store'

function searchText(entry: HistoryEntry): string {
  const kind = entry.kind === 'error' ? 'error' : entry.kind === 'audio' ? 'audio' : 'video'
  return [entry.title, entry.reason, entry.path, entry.url, entry.date, kind].filter(Boolean).join(' ')
}

export function HistoryPage() {
  const history = useApp((s) => s.history)
  const focusTick = useApp((s) => s.historyFocusTick)
  const [filter, setFilter] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (focusTick) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [focusTick])

  const shown = useMemo(() => {
    const needle = fold(filter.trim())
    return needle ? history.filter((entry) => fold(searchText(entry)).includes(needle)) : history
  }, [history, filter])

  const remove = async (entry: HistoryEntry) => {
    try {
      actions.set({ history: await backend.removeHistory(entry) })
    } catch (error) {
      toast.error(errorText(error))
    }
  }

  const clearAll = async () => {
    const ok = await confirm({
      title: '¿Borrar todo el historial?',
      description: 'Los archivos descargados no se eliminan.',
      confirmLabel: 'Borrar historial',
      destructive: true
    })
    if (ok) actions.set({ history: await backend.clearHistory() })
  }

  const open = async (entry: HistoryEntry) => {
    if (!entry.exists) return
    const error = await desktop.openPath(entry.path)
    if (error) toast.error('No se pudo reproducir el archivo', { description: error })
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-5 p-8">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Historial</h1>
          <p className="text-sm text-muted-foreground">
            {filter.trim()
              ? shown.length
                ? `${shown.length} de ${history.length}`
                : 'Sin resultados'
              : history.length
                ? `${history.length} en total`
                : 'Aún no hay descargas.'}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={clearAll} disabled={!history.length}>
          <Trash2 />
          Limpiar historial
        </Button>
      </header>

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          onKeyDown={(event) => event.key === 'Escape' && setFilter('')}
          placeholder="Buscar por nombre, fecha, tipo o error  (Ctrl+F)"
          className="h-10 pr-10 pl-9"
        />
        {filter && (
          <button
            onClick={() => setFilter('')}
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-accent"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border bg-card">
        {shown.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-muted-foreground">
            <History className="size-10 opacity-40" />
            <p className="text-sm">{history.length ? 'Nada coincide con la búsqueda.' : 'Aquí aparecerá lo que descargues.'}</p>
          </div>
        ) : (
          shown.map((entry, index) => (
            <Row
              key={`${entry.path || entry.url}|${entry.date}|${index}`}
              entry={entry}
              onOpen={() => void open(entry)}
              onRemove={() => void remove(entry)}
            />
          ))
        )}
      </div>
    </div>
  )
}

function Row({ entry, onOpen, onRemove }: { entry: HistoryEntry; onOpen: () => void; onRemove: () => void }) {
  const error = entry.kind === 'error'
  const Icon = error ? CircleX : entry.kind === 'audio' ? AudioLines : Film
  return (
    <div
      onDoubleClick={onOpen}
      className="group flex items-center gap-3 border-b border-border/60 px-4 py-3 last:border-b-0 hover:bg-accent/40"
    >
      <div
        className={cn(
          'grid size-9 shrink-0 place-items-center rounded-lg',
          error ? 'bg-destructive/12 text-destructive' : 'bg-primary/12 text-primary'
        )}
      >
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn('truncate text-sm font-medium selectable', !error && !entry.exists && 'text-muted-foreground')}>
          {entry.title}
        </p>
        <p className="truncate text-xs text-muted-foreground selectable">
          {error ? <span className="text-destructive">{entry.reason}</span> : entry.exists ? entry.path : 'Archivo no encontrado'}
        </p>
      </div>
      {error ? (
        <Badge variant="outline" className="border-destructive/40 text-destructive">
          Error
        </Badge>
      ) : (
        <Badge variant="secondary">{entry.kind === 'audio' ? 'Audio' : 'Video'}</Badge>
      )}
      <span className="w-28 text-right text-xs text-muted-foreground tabular-nums">{entry.date}</span>
      <div className="flex w-[100px] justify-end gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
        {!error && (
          <>
            <Button variant="ghost" size="icon-sm" disabled={!entry.exists} onClick={onOpen} title="Reproducir">
              <Play />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={!entry.exists}
              onClick={() => desktop.showItem(entry.path)}
              title="Abrir carpeta"
            >
              <FolderOpen />
            </Button>
          </>
        )}
        <Button variant="ghost" size="icon-sm" onClick={onRemove} title="Quitar del historial">
          <Trash2 />
        </Button>
      </div>
    </div>
  )
}
