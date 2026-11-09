import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  shell,
  Tray
} from 'electron'
import type { FileFilter, ThemeName } from '@shared/types'
import icon from '../../resources/icon.png?asset'
import { Backend } from './backend'
import { canSelfUpdate, installUpdate } from './updater'

const APP_ID = 'io.github.anime1234rr.llorostini'
const TITLEBAR_HEIGHT = 40

const THEME_COLORS: Record<ThemeName, { bg: string; bar: string; fg: string; dark: boolean }> = {
  Oscuro: { bg: '#14161b', bar: '#111318', fg: '#e8eaf0', dark: true },
  Claro: { bg: '#f5f6f9', bar: '#eceef3', fg: '#1b1e27', dark: false },
  Cyberpunk: { bg: '#0a0512', bar: '#07030d', fg: '#f0eaff', dark: true },
  Minimalista: { bg: '#111111', bar: '#0c0c0c', fg: '#f0f0f0', dark: true }
}

let win: BrowserWindow | null = null
let tray: Tray | null = null
let trayTimer: NodeJS.Timeout | null = null

const backend = new Backend((event) => win?.webContents.send('backend:event', event))

function createWindow(): void {
  const colors = THEME_COLORS.Oscuro
  win = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 820,
    minHeight: 600,
    show: false,
    title: 'LLorostini',
    icon,
    backgroundColor: colors.bg,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: colors.bar, symbolColor: colors.fg, height: TITLEBAR_HEIGHT },
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  win.once('ready-to-show', () => win?.show())
  win.on('focus', () => win?.webContents.send('window:focus'))
  win.on('closed', () => {
    win = null
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win?.webContents.getURL()) event.preventDefault()
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function showWindow(): void {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function stopTray(): void {
  if (trayTimer) clearTimeout(trayTimer)
  trayTimer = null
  tray?.destroy()
  tray = null
}

function notify(title: string, body: string): void {
  if (!Notification.isSupported()) return
  const notification = new Notification({ title, body, icon })
  notification.on('click', showWindow)
  notification.show()
}

function registerIpc(): void {
  ipcMain.handle('backend:call', (_e, method: string, params?: Record<string, unknown>) =>
    backend.call(method, params)
  )

  ipcMain.handle('dialog:folder', async (_e, initial: string) => {
    const result = await dialog.showOpenDialog(win!, {
      defaultPath: initial || undefined,
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('dialog:file', async (_e, title: string, filters: FileFilter[]) => {
    const result = await dialog.showOpenDialog(win!, { title, filters, properties: ['openFile'] })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('dialog:save', async (_e, title: string, defaultPath: string, filters: FileFilter[]) => {
    const result = await dialog.showSaveDialog(win!, { title, defaultPath, filters })
    return result.canceled ? null : (result.filePath ?? null)
  })
  ipcMain.handle('dialog:readText', async (_e, title: string) => {
    const result = await dialog.showOpenDialog(win!, {
      title,
      filters: [
        { name: 'Texto', extensions: ['txt'] },
        { name: 'Todos', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    if (result.canceled) return null
    return readFile(result.filePaths[0], 'utf8')
  })

  ipcMain.handle('shell:openPath', (_e, path: string) => shell.openPath(path))
  ipcMain.handle('shell:showItem', (_e, path: string) => shell.showItemInFolder(path))
  ipcMain.handle('shell:openExternal', async (_e, url: string) => {
    if (url.startsWith('https://')) await shell.openExternal(url)
  })
  ipcMain.handle('clipboard:read', () => clipboard.readText())

  ipcMain.handle('window:theme', (_e, theme: ThemeName) => {
    const colors = THEME_COLORS[theme] ?? THEME_COLORS.Oscuro
    nativeTheme.themeSource = colors.dark ? 'dark' : 'light'
    win?.setBackgroundColor(colors.bg)
    win?.setTitleBarOverlay({ color: colors.bar, symbolColor: colors.fg, height: TITLEBAR_HEIGHT })
  })
  ipcMain.handle('window:progress', (_e, fraction: number | null) => {
    if (fraction === null) win?.setProgressBar(-1)
    else if (fraction < 0) win?.setProgressBar(2, { mode: 'indeterminate' })
    else win?.setProgressBar(Math.min(1, fraction))
  })

  ipcMain.handle('tray:hide', (_e, tooltip: string) => {
    stopTray()
    tray = new Tray(nativeImage.createFromPath(icon).resize({ width: 16, height: 16 }))
    tray.setToolTip(tooltip)
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Mostrar LLorostini', click: showWindow },
        { type: 'separator' },
        { label: 'Salir', click: () => app.quit() }
      ])
    )
    tray.on('click', showWindow)
    win?.hide()
    return true
  })
  ipcMain.handle('tray:tooltip', (_e, text: string) => tray?.setToolTip(text))
  ipcMain.handle('tray:finish', (_e, title: string, body: string) => {
    if (!tray) return
    notify(title, body)
    showWindow()
    trayTimer = setTimeout(stopTray, 7000)
  })
  ipcMain.handle('app:notify', (_e, title: string, body: string) => {
    if (!win?.isFocused()) notify(title, body)
  })

  ipcMain.handle('update:can', () => canSelfUpdate())
  ipcMain.handle('update:install', (_e, assetUrl: string) =>
    installUpdate(assetUrl, (done, total) => win?.webContents.send('update:progress', done, total))
  )
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showWindow)
  app.whenReady().then(() => {
    app.setAppUserModelId(APP_ID)
    Menu.setApplicationMenu(null)
    registerIpc()
    backend.start()
    createWindow()
  })
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', () => {
    stopTray()
    backend.stop()
  })
}
