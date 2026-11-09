import { useState } from 'react'
import { FileText } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { desktop, errorText } from '@/lib/api'
import { findUrls } from '@/lib/format'
import { addedMessage, addUrls } from '@/store'

export function AddLinksDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [text, setText] = useState('')
  const count = findUrls(text).length

  const accept = async () => {
    if (!count) {
      toast.info('No se encontró ningún enlace válido.')
      return
    }
    try {
      toast.success(addedMessage(await addUrls(text)))
      setText('')
      onOpenChange(false)
    } catch (error) {
      toast.error(errorText(error))
    }
  }

  const loadFile = async () => {
    try {
      const content = await desktop.readTextFile('Elegir lista de enlaces')
      if (content) setText((current) => (current ? current.trimEnd() + '\n' : '') + content)
    } catch (error) {
      toast.error('No se pudo leer el archivo', { description: errorText(error) })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Añadir enlaces</DialogTitle>
          <DialogDescription>Pega uno o varios enlaces; pueden venir mezclados con otro texto.</DialogDescription>
        </DialogHeader>
        <Textarea
          autoFocus
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && event.ctrlKey) void accept()
          }}
          placeholder={'https://www.youtube.com/watch?v=…\nhttps://open.spotify.com/track/…'}
          className="h-52 resize-none font-mono text-xs"
          spellCheck={false}
          wrap="off"
        />
        <DialogFooter className="sm:justify-between">
          <Button variant="outline" onClick={loadFile}>
            <FileText />
            Cargar .txt
          </Button>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {count} {count === 1 ? 'enlace' : 'enlaces'}
            </span>
            <Button onClick={() => void accept()} disabled={!count}>
              Añadir
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
