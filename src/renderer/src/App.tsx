import { useCallback, useEffect, useRef, useState } from 'react'
import { LoaderCircle, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ActivityBar } from '@/components/activity-bar'
import { ConfirmHost } from '@/components/confirm-host'
import { Sidebar } from '@/components/sidebar'
import { TitleBar } from '@/components/title-bar'
import { backend, desktop, errorText } from '@/lib/api'
import { DownloadPage } from '@/pages/download-page'
import { HistoryPage } from '@/pages/history-page'
import { QueuePage } from '@/pages/queue-page'
import { SettingsPage } from '@/pages/settings-page'
import { UpdatesPage } from '@/pages/updates-page'
import {
  actions,
  addedMessage,
  addUrls,
  downloadCurrent,
  goTo,
  handleEvent,
  initialize,
  isBusy,
  useApp
} from '@/store'

const DARK_THEMES = new Set(['Oscuro', 'Cyberpunk', 'Minimalista'])

function isEditable(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  return !!element && (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName))
}

async function receiveText(text: string, source: 'paste' | 'drop') {
  const found = await backend.classify(text)
  if (!found.length) {
    if (source === 'paste') toast.info('El portapapeles no contiene ningún enlace.')
    return
  }
  if (found.length > 1) {
    toast.success(addedMessage(await addUrls(text)))
    goTo('queue')
    return
  }
  actions.set((state) => ({ url: found[0].url, page: 'download', urlFocusTick: state.urlFocusTick + 1 }))
  toast.info(source === 'drop' ? 'Enlace recibido. Pulsa Buscar.' : 'Enlace pegado. Pulsa Enter para buscar.')
}

export default function App() {
  const info = useApp((s) => s.info)
  const page = useApp((s) => s.page)
  const theme = useApp((s) => s.settings?.theme ?? 'Oscuro')
  const [fatal, setFatal] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [clipboardUrl, setClipboardUrl] = useState<string | null>(null)
  const dismissed = useRef<string | null>(null)

  useEffect(() => {
    const unsubscribe = desktop.onEvent(handleEvent)
    initialize().catch((error) => setFatal(errorText(error)))
    return unsubscribe
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.classList.toggle('dark', DARK_THEMES.has(theme))
    void desktop.setTheme(theme)
  }, [theme])

  const checkClipboard = useCallback(async () => {
    const state = useApp.getState()
    if (!state.info || isBusy(state) || state.result || state.url.trim()) return
    try {
      const found = await backend.classify(await desktop.readClipboard())
      const url = found.find((item) => item.platform !== 'other')?.url ?? null
      setClipboardUrl(url && url !== dismissed.current ? url : null)
    } catch {
      setClipboardUrl(null)
    }
  }, [])

  useEffect(() => {
    if (!info) return
    const timer = setTimeout(checkClipboard, 700)
    const unsubscribe = desktop.onWindowFocus(() => setTimeout(checkClipboard, 150))
    return () => {
      clearTimeout(timer)
      unsubscribe()
    }
  }, [info, checkClipboard])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === 'v' && !isEditable(event.target)) {
        event.preventDefault()
        void desktop.readClipboard().then((text) => receiveText(text, 'paste'))
      } else if (key === 'l') {
        event.preventDefault()
        actions.set((state) => ({ page: 'download', urlFocusTick: state.urlFocusTick + 1 }))
      } else if (key === 'f') {
        event.preventDefault()
        goTo('history')
        actions.set((state) => ({ historyFocusTick: state.historyFocusTick + 1 }))
      } else if (key === 'enter') {
        const state = useApp.getState()
        if (state.page === 'download' && state.result && !isBusy(state)) {
          event.preventDefault()
          void downloadCurrent()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const dropHandlers = {
    onDragOver: (event: React.DragEvent) => {
      event.preventDefault()
      setDragging(true)
    },
    onDragLeave: (event: React.DragEvent) => {
      if (event.currentTarget === event.target) setDragging(false)
    },
    onDrop: (event: React.DragEvent) => {
      event.preventDefault()
      setDragging(false)
      const text = event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain')
      if (text) void receiveText(text, 'drop')
    }
  }

  if (fatal) {
    return (
      <Centered>
        <TriangleAlert className="size-10 text-destructive" />
        <p className="font-medium">No se pudo iniciar el motor de descargas</p>
        <p className="max-w-md text-sm text-muted-foreground selectable">{fatal}</p>
      </Centered>
    )
  }
  if (!info) {
    return (
      <Centered>
        <LoaderCircle className="size-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Iniciando…</p>
      </Centered>
    )
  }

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-full flex-col" {...dropHandlers}>
        <TitleBar />
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <main className="relative flex min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto">
              {page === 'download' && (
                <DownloadPage
                  clipboardUrl={clipboardUrl}
                  onDismissClipboard={() => {
                    dismissed.current = clipboardUrl
                    setClipboardUrl(null)
                  }}
                />
              )}
              {page === 'queue' && <QueuePage />}
              {page === 'history' && <HistoryPage />}
              {page === 'updates' && <UpdatesPage />}
              {page === 'settings' && <SettingsPage />}
            </div>
            <ActivityBar />
            {dragging && (
              <div className="pointer-events-none absolute inset-3 grid place-items-center rounded-2xl border-2 border-dashed border-primary bg-primary/10 backdrop-blur-sm">
                <p className="text-lg font-medium text-primary">Suelta los enlaces aquí</p>
              </div>
            )}
          </main>
        </div>
      </div>
      <ConfirmHost />
      <Toaster position="bottom-right" offset={{ bottom: 88, right: 20 }} richColors={false} closeButton />
    </TooltipProvider>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <div className="drag-region h-10 shrink-0" />
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">{children}</div>
    </div>
  )
}
