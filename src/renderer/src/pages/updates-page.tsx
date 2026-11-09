import { useEffect, useState } from 'react'
import { ExternalLink, RefreshCw, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { desktop } from '@/lib/api'
import { cn } from '@/lib/utils'
import { checkUpdates, installUpdate, isBusy, useApp } from '@/store'

function Notes({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n')
  if (!text.trim()) return <p className="text-muted-foreground">Esta versión no incluye notas.</p>
  return (
    <div className="space-y-1.5 text-sm leading-relaxed selectable">
      {lines.map((raw, index) => {
        const line = raw.trim().replace(/\*\*/g, '').replace(/`/g, '')
        if (!line) return <div key={index} className="h-2" />
        if (line.startsWith('#')) {
          return (
            <p key={index} className="pt-2 font-semibold">
              {line.replace(/^#+\s*/, '')}
            </p>
          )
        }
        if (/^[-*] /.test(line)) {
          return (
            <p key={index} className="flex gap-2 pl-1">
              <span className="text-primary">•</span>
              <span>{line.slice(2)}</span>
            </p>
          )
        }
        return <p key={index}>{line}</p>
      })}
    </div>
  )
}

export function UpdatesPage() {
  const state = useApp()
  const { info, release, updateAvailable } = state
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selfUpdate, setSelfUpdate] = useState(false)

  useEffect(() => {
    void desktop.canSelfUpdate().then(setSelfUpdate)
  }, [])

  const check = async () => {
    setChecking(true)
    setError(null)
    setError(await checkUpdates(false))
    setChecking(false)
  }

  let status = 'Pulsa «Buscar actualizaciones» para ver si hay una versión nueva.'
  if (checking) status = 'Buscando actualizaciones…'
  else if (error) status = error
  else if (release && updateAvailable) {
    status = `Hay una versión nueva: ${release.version} (tienes ${info?.version}).`
    if (!selfUpdate) status += ' La actualización automática solo funciona con el .exe.'
  } else if (release) status = `Estás al día. Última versión publicada: ${release.version}.`

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-5 p-8">
      <header className="flex items-center gap-4">
        <div className="grid size-14 place-items-center rounded-2xl bg-primary/12 text-primary">
          <Sparkles className="size-7" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {info?.appName} {info?.version}
          </h1>
          <p className="text-sm text-muted-foreground">Versión instalada</p>
        </div>
      </header>

      <div
        className={cn(
          'rounded-xl border px-4 py-3 text-sm',
          error && 'border-destructive/30 bg-destructive/10 text-destructive',
          !error && updateAvailable && 'border-success/30 bg-success/10'
        )}
      >
        {status}
      </div>

      <div className="flex gap-2">
        <Button variant="outline" onClick={check} disabled={checking}>
          <RefreshCw className={cn(checking && 'animate-spin')} />
          Buscar actualizaciones
        </Button>
        <Button
          onClick={() => void installUpdate()}
          disabled={!updateAvailable || !selfUpdate || !release?.assetUrl || isBusy(state)}
        >
          Actualizar ahora
        </Button>
        <div className="flex-1" />
        <Button
          variant="ghost"
          onClick={() => desktop.openExternal(release?.pageUrl ?? `https://github.com/${info?.repo}/releases`)}
        >
          <ExternalLink />
          Ver en GitHub
        </Button>
      </div>

      {release && (
        <section className="flex min-h-0 flex-1 flex-col rounded-2xl border bg-card">
          <h2 className="border-b px-5 py-3 text-sm font-medium text-muted-foreground">
            Novedades de {release.version}
          </h2>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <Notes text={release.notes} />
          </div>
        </section>
      )}
    </div>
  )
}
