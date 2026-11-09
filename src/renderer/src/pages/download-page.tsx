import { useEffect, useRef, useState } from 'react'
import {
  AudioLines,
  CircleCheck,
  ClipboardPaste,
  Clock,
  Download,
  Film,
  FolderOpen,
  HardDrive,
  Link2,
  ListMusic,
  Play,
  Search,
  User,
  X
} from 'lucide-react'
import type { SpaceInfo } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ProgressBar } from '@/components/progress-bar'
import { backend, desktop } from '@/lib/api'
import { findUrls, formatDuration, formatSize, SOURCE_LABELS } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  actions,
  downloadCurrent,
  effectiveAudio,
  fpsChoices,
  isBusy,
  isSpotify,
  listMode,
  QUEUE_QUALITIES,
  qualityLabel,
  rangeValues,
  saveSettings,
  search,
  useApp
} from '@/store'

const SPACE_MARGIN = 1.15

export function DownloadPage({ clipboardUrl, onDismissClipboard }: ClipboardProps) {
  const state = useApp()
  const { result, searching, url } = state
  const inputRef = useRef<HTMLInputElement>(null)
  const busy = isBusy(state)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [state.urlFocusTick])

  const pasteFromClipboard = async () => {
    const text = await desktop.readClipboard()
    const found = findUrls(text)
    if (found.length) actions.set({ url: found[0] })
    inputRef.current?.focus()
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Descargar</h1>
        <p className="text-sm text-muted-foreground">Videos y listas de YouTube y Twitch, canciones y álbumes de Spotify.</p>
      </header>

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void search()
        }}
      >
        <div className="relative flex-1">
          <Link2 className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={url}
            onChange={(event) => actions.set({ url: event.target.value })}
            placeholder="Pega un enlace de YouTube, Twitch o Spotify"
            className="h-11 pr-11 pl-10 text-[15px]"
            spellCheck={false}
          />
          {url ? (
            <button
              type="button"
              onClick={() => actions.set({ url: '' })}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Borrar"
            >
              <X className="size-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={pasteFromClipboard}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Pegar"
            >
              <ClipboardPaste className="size-4" />
            </button>
          )}
        </div>
        <Button type="submit" size="lg" className="h-11 px-5" disabled={busy || !url.trim()}>
          <Search />
          {searching ? 'Buscando…' : 'Buscar'}
        </Button>
      </form>

      {clipboardUrl && !result && !searching && !url && (
        <div className="flex items-center gap-3 rounded-xl border border-primary/25 bg-primary/8 px-4 py-2.5 text-sm">
          <ClipboardPaste className="size-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate">
            <span className="text-muted-foreground">Enlace copiado: </span>
            {clipboardUrl}
          </span>
          <Button
            size="sm"
            onClick={() => {
              onDismissClipboard()
              actions.set({ url: clipboardUrl })
              void search()
            }}
          >
            Usar
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={onDismissClipboard} title="Descartar">
            <X />
          </Button>
        </div>
      )}

      {searching && <ResultSkeleton />}
      {!searching && !result && <EmptyState />}
      {!searching && result && (
        <>
          <MediaCard />
          <OptionsCard />
          <DownloadFooter />
        </>
      )}
    </div>
  )
}

interface ClipboardProps {
  clipboardUrl: string | null
  onDismissClipboard: () => void
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed bg-card/40 px-6 py-16 text-center">
      <div className="grid size-14 place-items-center rounded-2xl bg-primary/12 text-primary">
        <Download className="size-7" />
      </div>
      <div>
        <p className="font-medium">Pega o arrastra un enlace aquí</p>
        <p className="mt-1 text-sm text-muted-foreground">
          <Kbd>Ctrl</Kbd> + <Kbd>V</Kbd> en cualquier parte para pegar · varios enlaces van directo a la Cola
        </p>
      </div>
    </div>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border bg-muted px-1.5 py-0.5 font-sans text-[11px] font-medium text-foreground">
      {children}
    </kbd>
  )
}

function ResultSkeleton() {
  return (
    <div className="flex animate-pulse gap-5 rounded-2xl border bg-card p-4">
      <div className="aspect-video w-56 rounded-xl bg-muted" />
      <div className="flex-1 space-y-3 py-2">
        <div className="h-5 w-3/4 rounded bg-muted" />
        <div className="h-4 w-1/3 rounded bg-muted" />
        <div className="h-4 w-1/4 rounded bg-muted" />
      </div>
    </div>
  )
}

function MediaCard() {
  const state = useApp()
  const result = state.result!
  const list = listMode(state)
  const video = result.video
  const playlist = result.playlist
  const thumbnail = list ? playlist?.thumbnail : video?.thumbnail
  const source = (list ? playlist?.source : video?.source) ?? 'youtube'
  const spotify = source === 'spotify'

  return (
    <section className="flex gap-5 rounded-2xl border bg-card p-4">
      <div className="relative aspect-video w-56 shrink-0 overflow-hidden rounded-xl bg-muted">
        {thumbnail ? (
          <img src={thumbnail} alt="" className={cn('size-full', spotify ? 'object-contain' : 'object-cover')} />
        ) : (
          <div className="grid size-full place-items-center text-muted-foreground">
            {list ? <ListMusic className="size-8" /> : <Film className="size-8" />}
          </div>
        )}
        {!list && video?.duration ? (
          <span className="absolute right-1.5 bottom-1.5 rounded-md bg-black/75 px-1.5 py-0.5 text-xs font-medium text-white tabular-nums">
            {formatDuration(video.duration)}
          </span>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 py-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{SOURCE_LABELS[source] ?? source}</Badge>
          {list && <Badge variant="outline">{spotify ? 'Álbum / lista' : 'Lista de reproducción'}</Badge>}
          {spotify && !list && <Badge variant="outline">Se busca en YouTube</Badge>}
        </div>
        <h2 className="line-clamp-2 text-lg leading-snug font-semibold selectable">
          {list ? playlist?.title : video?.title}
        </h2>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <User className="size-3.5" />
            {list ? playlist?.uploader : video?.uploader}
          </span>
          {list && playlist && (
            <span className="flex items-center gap-1.5">
              <ListMusic className="size-3.5" />
              {playlist.total} {spotify ? 'canciones' : 'videos'}
              {playlist.skipped ? ` · ${playlist.skipped} no disponibles` : ''}
            </span>
          )}
          {!list && video?.duration ? (
            <span className="flex items-center gap-1.5">
              <Clock className="size-3.5" />
              {formatDuration(video.duration)}
            </span>
          ) : null}
        </div>

        {(list || (playlist && video)) && (
          <div className="mt-auto flex flex-wrap items-center gap-x-6 gap-y-3 pt-2">
            {list && playlist && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Del</span>
                <Input
                  type="number"
                  min={1}
                  max={playlist.total}
                  value={state.rangeFrom}
                  onChange={(event) => actions.set({ rangeFrom: event.target.value })}
                  className="h-8 w-20"
                />
                <span className="text-muted-foreground">al</span>
                <Input
                  type="number"
                  min={1}
                  max={playlist.total}
                  value={state.rangeTo}
                  onChange={(event) => actions.set({ rangeTo: event.target.value })}
                  className="h-8 w-20"
                />
                <span className="text-muted-foreground">de {playlist.total}</span>
              </div>
            )}
            {playlist && video && (
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Switch
                  checked={state.onlyVideo}
                  onCheckedChange={(checked) => actions.set({ onlyVideo: checked, quality: 'best', fps: 'auto' })}
                />
                Solo este video (ignorar la lista)
              </label>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</Label>
      {children}
    </div>
  )
}

function OptionsCard() {
  const state = useApp()
  const { info, settings } = state
  const audio = effectiveAudio(state)
  const spotify = isSpotify(state.result)
  const list = listMode(state)
  const qualities = list ? QUEUE_QUALITIES : ['best', ...(state.result?.video?.heights ?? []).map(String)]
  const fps = fpsChoices(state)
  const fpsValue = fps.locked ? String(fps.values[0]) : fps.values.includes(Number(state.fps)) ? state.fps : 'auto'

  if (!info || !settings) return null
  return (
    <section className="grid grid-cols-2 gap-x-6 gap-y-5 rounded-2xl border bg-card p-5">
      <Field label="Tipo">
        <ToggleGroup
          type="single"
          variant="outline"
          value={audio ? 'audio' : 'video'}
          onValueChange={(value) => value && actions.set({ audio: value === 'audio' })}
          disabled={spotify}
          className="w-full"
        >
          <ToggleGroupItem value="video" className="flex-1">
            <Film />
            Video
          </ToggleGroupItem>
          <ToggleGroupItem value="audio" className="flex-1">
            <AudioLines />
            Solo audio
          </ToggleGroupItem>
        </ToggleGroup>
      </Field>

      <Field label="Formato">
        <Select
          value={audio ? state.audioFormat : state.container}
          onValueChange={(value) => actions.set(audio ? { audioFormat: value } : { container: value })}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(audio ? info.choices.audioFormats : info.choices.containers).map((value) => (
              <SelectItem key={value} value={value}>
                {value.toUpperCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label={list ? 'Calidad máxima' : 'Calidad'}>
        <Select
          value={state.quality}
          onValueChange={(value) => actions.set({ quality: value })}
          disabled={audio}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {qualities.map((value) => (
              <SelectItem key={value} value={value}>
                {qualityLabel(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Fotogramas">
        <Select
          value={fpsValue}
          onValueChange={(value) => actions.set({ fps: value })}
          disabled={audio || fps.values.length === 0 || fps.locked}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {!fps.locked && <SelectItem value="auto">Automático</SelectItem>}
            {fps.values.map((value) => (
              <SelectItem key={value} value={String(value)}>
                {value} fps
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {!audio && (
        <Field label="Subtítulos">
          <div className="flex h-9 items-center gap-3">
            <Switch checked={state.subtitles} onCheckedChange={(checked) => actions.set({ subtitles: checked })} />
            {state.subtitles ? (
              <Select
                value={settings.subtitle_lang}
                onValueChange={(value) => void saveSettings({ subtitle_lang: value })}
              >
                <SelectTrigger size="sm" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(info.choices.subtitles).map(([code, label]) => (
                    <SelectItem key={code} value={code}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="text-sm text-muted-foreground">Descargar archivo .srt</span>
            )}
          </div>
        </Field>
      )}

      <Field label="Carpeta de destino" className={audio ? 'col-span-2' : ''}>
        <div className="flex gap-2">
          <Input
            value={state.outDir}
            onChange={(event) => actions.set({ outDir: event.target.value })}
            className="flex-1 font-mono text-xs"
            spellCheck={false}
          />
          <Button
            variant="outline"
            onClick={async () => {
              const folder = await desktop.pickFolder(state.outDir)
              if (folder) actions.set({ outDir: folder })
            }}
          >
            <FolderOpen />
            Elegir
          </Button>
        </div>
      </Field>
    </section>
  )
}

function DownloadFooter() {
  const state = useApp()
  const [space, setSpace] = useState<SpaceInfo | null>(null)
  const list = listMode(state)
  const audio = effectiveAudio(state)
  const busy = isBusy(state)
  const [start, end] = rangeValues(state)
  const height = state.quality === 'best' ? null : Number(state.quality)
  const single = state.single

  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const estimate = list
          ? { mode: 'list' as const, height, audio, audioFormat: state.audioFormat, start, end }
          : { mode: 'video' as const, height, audio, audioFormat: state.audioFormat }
        setSpace(await backend.space(state.outDir, estimate))
      } catch {
        setSpace(null)
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [state.outDir, state.result, list, height, audio, state.audioFormat, start, end, state.run])

  const tight = !!space?.free && !!space.estimate && space.estimate * SPACE_MARGIN > space.free
  const showSingle = single && state.run?.mode === 'single'
  const finished = !state.run && single?.status === 'done' && single.path

  return (
    <div className="flex flex-col gap-3">
      {showSingle && (
        <div className="rounded-2xl border bg-card p-4">
          <div className="mb-2 flex justify-between text-sm">
            <span className="text-muted-foreground">{single.detail || 'Preparando…'}</span>
            {single.fraction !== null && single.status === 'running' && (
              <span className="font-medium tabular-nums">{Math.floor(single.fraction * 100)}%</span>
            )}
          </div>
          <ProgressBar value={single.status === 'processing' ? null : (single.fraction ?? 0)} className="h-2" />
        </div>
      )}
      {finished && (
        <div className="flex items-center gap-3 rounded-2xl border border-success/30 bg-success/10 p-4">
          <CircleCheck className="size-5 shrink-0 text-success" />
          <p className="min-w-0 flex-1 truncate text-sm">
            <span className="font-medium">Listo:</span> {single.title}
          </p>
          <Button size="sm" variant="outline" onClick={() => desktop.openPath(single.path!)}>
            <Play />
            Reproducir
          </Button>
          <Button size="sm" variant="outline" onClick={() => desktop.showItem(single.path!)}>
            <FolderOpen />
            Abrir carpeta
          </Button>
        </div>
      )}
      <div className="flex items-center gap-4">
        <p className={cn('flex flex-1 items-center gap-2 text-sm text-muted-foreground', tight && 'text-destructive')}>
          <HardDrive className="size-4" />
          {space?.free != null ? `Espacio libre: ${formatSize(space.free)}` : ''}
          {space?.estimate ? ` · Descarga estimada: ${formatSize(space.estimate)}` : ''}
          {tight ? ' · espacio insuficiente' : ''}
        </p>
        <Button size="lg" className="h-11 min-w-48 text-[15px]" disabled={busy} onClick={() => void downloadCurrent()}>
          <Download />
          {list ? 'Descargar lista' : 'Descargar'}
        </Button>
      </div>
    </div>
  )
}
