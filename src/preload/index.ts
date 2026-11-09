import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { BackendEvent, DesktopApi } from '@shared/types'

function subscribe<T extends unknown[]>(channel: string, listener: (...args: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, ...args: unknown[]) => listener(...(args as T))
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: DesktopApi = {
  call: (method, params) => ipcRenderer.invoke('backend:call', method, params),
  onEvent: (listener) => subscribe<[BackendEvent]>('backend:event', listener),
  pickFolder: (initial) => ipcRenderer.invoke('dialog:folder', initial),
  pickFile: (title, filters) => ipcRenderer.invoke('dialog:file', title, filters),
  pickSaveFile: (title, defaultName, filters) => ipcRenderer.invoke('dialog:save', title, defaultName, filters),
  readTextFile: (title) => ipcRenderer.invoke('dialog:readText', title),
  openPath: (path) => ipcRenderer.invoke('shell:openPath', path),
  showItem: (path) => ipcRenderer.invoke('shell:showItem', path),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  setTheme: (theme) => ipcRenderer.invoke('window:theme', theme),
  setProgress: (fraction) => ipcRenderer.invoke('window:progress', fraction),
  hideToTray: (tooltip) => ipcRenderer.invoke('tray:hide', tooltip),
  setTrayTooltip: (text) => ipcRenderer.invoke('tray:tooltip', text),
  finishTray: (title, body) => ipcRenderer.invoke('tray:finish', title, body),
  notify: (title, body) => ipcRenderer.invoke('app:notify', title, body),
  canSelfUpdate: () => ipcRenderer.invoke('update:can'),
  installUpdate: (assetUrl) => ipcRenderer.invoke('update:install', assetUrl),
  onUpdateProgress: (listener) => subscribe<[number, number]>('update:progress', listener),
  onWindowFocus: (listener) => subscribe<[]>('window:focus', listener)
}

contextBridge.exposeInMainWorld('api', api)
