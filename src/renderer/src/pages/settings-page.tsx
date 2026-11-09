import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import type { ThemeName } from '@shared/types'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { saveSettings, useApp } from '@/store'

const THEMES: { name: ThemeName; bg: string; card: string; accent: string; fg: string }[] = [
  { name: 'Oscuro', bg: '#14161b', card: '#1e2128', accent: '#5b8cff', fg: '#e8eaf0' },
  { name: 'Claro', bg: '#f5f6f9', card: '#ffffff', accent: '#2f63e0', fg: '#1b1e27' },
  { name: 'Cyberpunk', bg: '#0a0512', card: '#170a2b', accent: '#e01fbd', fg: '#f0eaff' },
  { name: 'Minimalista', bg: '#111111', card: '#1f1f1f', accent: '#e6e6e6', fg: '#f0f0f0' }
]

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">{title}</h2>
      <div className="divide-y rounded-2xl border bg-card">{children}</div>
    </section>
  )
}

function Row({
  title,
  description,
  children
}: {
  title: string
  description?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-6 px-5 py-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  )
}

export function SettingsPage() {
  const settings = useApp((s) => s.settings)
  const info = useApp((s) => s.info)
  const [proxy, setProxy] = useState(settings?.proxy ?? '')
  const [proxyError, setProxyError] = useState(false)

  useEffect(() => setProxy(settings?.proxy ?? ''), [settings?.proxy])

  if (!settings || !info) return null

  const commitProxy = async () => {
    if (proxy.trim() === settings.proxy) return
    setProxyError(!(await saveSettings({ proxy: proxy.trim() })))
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-7 p-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Ajustes</h1>
        <p className="text-sm text-muted-foreground">Se guardan automáticamente.</p>
      </header>

      <Section title="Apariencia">
        <div className="grid grid-cols-4 gap-3 p-4">
          {THEMES.map((theme) => {
            const active = settings.theme === theme.name
            return (
              <button
                key={theme.name}
                onClick={() => void saveSettings({ theme: theme.name })}
                className={cn(
                  'group overflow-hidden rounded-xl border-2 text-left transition-all',
                  active ? 'border-primary' : 'border-transparent hover:border-border'
                )}
              >
                <div className="flex h-20 gap-1.5 p-2" style={{ background: theme.bg }}>
                  <div className="w-5 rounded" style={{ background: theme.card }} />
                  <div className="flex flex-1 flex-col gap-1.5 rounded p-1.5" style={{ background: theme.card }}>
                    <div className="h-1.5 w-3/4 rounded-full opacity-70" style={{ background: theme.fg }} />
                    <div className="h-1.5 w-1/2 rounded-full opacity-40" style={{ background: theme.fg }} />
                    <div className="mt-auto h-3 w-2/3 rounded" style={{ background: theme.accent }} />
                  </div>
                </div>
                <div className="flex items-center justify-between px-3 py-2 text-sm">
                  {theme.name}
                  {active && <Check className="size-4 text-primary" />}
                </div>
              </button>
            )
          })}
        </div>
      </Section>

      <Section title="Descargas">
        <Row title="Límite de velocidad" description="Se reparte entre las descargas simultáneas.">
          <Select value={settings.speed_limit} onValueChange={(value) => void saveSettings({ speed_limit: value })}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {info.choices.speeds.map((speed) => (
                <SelectItem key={speed} value={speed}>
                  {speed}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row
          title="Descargas simultáneas"
          description="Con 1 se descarga un elemento a la vez (recomendado). Con 2 o 3 las colas y listas terminan antes si tu conexión lo permite."
        >
          <ToggleGroup
            type="single"
            variant="outline"
            value={String(settings.parallel_downloads)}
            onValueChange={(value) => value && void saveSettings({ parallel_downloads: Number(value) })}
          >
            {['1', '2', '3'].map((value) => (
              <ToggleGroupItem key={value} value={value} className="w-11">
                {value}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Row>
        <Row title="Minimizar a la bandeja" description="Oculta la ventana mientras descarga y avisa al terminar.">
          <Switch
            checked={settings.minimize_to_tray}
            onCheckedChange={(checked) => void saveSettings({ minimize_to_tray: checked })}
          />
        </Row>
        <Row title="Organizar las listas en carpetas por canal">
          <Switch checked={settings.by_channel} onCheckedChange={(checked) => void saveSettings({ by_channel: checked })} />
        </Row>
      </Section>

      <Section title="Contenido">
        <Row title="Guardar la miniatura junto al archivo">
          <div className="flex items-center gap-3">
            <Select
              value={settings.thumbnail_format}
              onValueChange={(value) => void saveSettings({ thumbnail_format: value })}
              disabled={!settings.save_thumbnail}
            >
              <SelectTrigger size="sm" className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {info.choices.thumbnailFormats.map((format) => (
                  <SelectItem key={format} value={format}>
                    {format.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Switch
              checked={settings.save_thumbnail}
              onCheckedChange={(checked) => void saveSettings({ save_thumbnail: checked })}
            />
          </div>
        </Row>
        <Row title="Incrustar letras en el audio" description="MP3, M4A y FLAC. Siempre se intenta con Spotify.">
          <Switch
            checked={settings.embed_lyrics}
            onCheckedChange={(checked) => void saveSettings({ embed_lyrics: checked })}
          />
        </Row>
      </Section>

      <Section title="Red">
        <div className="space-y-2 px-5 py-4">
          <p className="text-sm font-medium">Proxy</p>
          <Input
            value={proxy}
            onChange={(event) => {
              setProxy(event.target.value)
              setProxyError(false)
            }}
            onBlur={commitProxy}
            onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
            placeholder="Vacío: sin proxy"
            aria-invalid={proxyError}
            className="font-mono text-xs"
            spellCheck={false}
          />
          <p className="text-xs text-muted-foreground">
            Ejemplos: http://127.0.0.1:8080 o socks5://127.0.0.1:1080.
          </p>
        </div>
      </Section>
    </div>
  )
}
