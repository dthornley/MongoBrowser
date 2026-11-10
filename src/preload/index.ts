import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type { MongoBrowserApi, ConnectionStatusEvent, UpdateStatus } from '@shared/types'

const invoke = (channel: string) => (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)

const api: MongoBrowserApi = {
  connections: {
    list: invoke('connections:list'),
    save: invoke('connections:save'),
    remove: invoke('connections:remove'),
    test: invoke('connections:test'),
    findRobo3T: invoke('connections:findRobo3T'),
    previewRobo3T: invoke('connections:previewRobo3T')
  },
  session: {
    connect: invoke('session:connect'),
    disconnect: invoke('session:disconnect'),
    onStatus(cb: (ev: ConnectionStatusEvent) => void) {
      const listener = (_e: IpcRendererEvent, ev: ConnectionStatusEvent): void => cb(ev)
      ipcRenderer.on('session:status', listener)
      return () => ipcRenderer.removeListener('session:status', listener)
    }
  },
  server: {
    databases: invoke('server:databases'),
    collections: invoke('server:collections'),
    dbStats: invoke('server:dbStats'),
    collectionStats: invoke('server:collectionStats'),
    serverStatus: invoke('server:serverStatus'),
    hostInfo: invoke('server:hostInfo'),
    createDatabase: invoke('server:createDatabase'),
    dropDatabase: invoke('server:dropDatabase'),
    createCollection: invoke('server:createCollection'),
    dropCollection: invoke('server:dropCollection'),
    renameCollection: invoke('server:renameCollection'),
    copyCollection: invoke('server:copyCollection'),
    indexes: invoke('server:indexes'),
    createIndex: invoke('server:createIndex'),
    dropIndex: invoke('server:dropIndex'),
    users: invoke('server:users'),
    createUser: invoke('server:createUser'),
    dropUser: invoke('server:dropUser'),
    functions: invoke('server:functions')
  },
  query: {
    execute: invoke('query:execute'),
    evalDocument: invoke('query:evalDocument'),
    insertDocument: invoke('query:insertDocument'),
    replaceDocument: invoke('query:replaceDocument'),
    deleteDocument: invoke('query:deleteDocument')
  },
  ui: {
    contextMenu: invoke('ui:contextMenu'),
    openFile: invoke('ui:openFile'),
    readFile: invoke('ui:readFile'),
    saveFile: invoke('ui:saveFile'),
    confirm: invoke('ui:confirm'),
    platform: process.platform
  },
  settings: {
    get: invoke('settings:get'),
    set: invoke('settings:set')
  },
  updates: {
    status: invoke('updates:status'),
    check: invoke('updates:check'),
    download: invoke('updates:download'),
    install: invoke('updates:install'),
    openReleases: invoke('updates:openReleases'),
    onStatus(cb: (s: UpdateStatus) => void) {
      const listener = (_e: IpcRendererEvent, s: UpdateStatus): void => cb(s)
      ipcRenderer.on('updates:status', listener)
      return () => ipcRenderer.removeListener('updates:status', listener)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)

// application-menu commands (Cmd+Enter, Cmd+T, ...) are forwarded as DOM events for the React app
contextBridge.exposeInMainWorld('menuEvents', {
  on(cb: (name: string) => void): () => void {
    const channels = [
      'menu:connect',
      'menu:newTab',
      'menu:closeTab',
      'menu:loadScript',
      'menu:saveScript',
      'menu:execute',
      'menu:prevPage',
      'menu:nextPage',
      'menu:viewText',
      'menu:viewTree',
      'menu:viewTable',
      'menu:toggleExplorer',
      'menu:preferences',
      'menu:checkUpdates',
      'menu:importRobo3T'
    ]
    const listeners = channels.map((ch) => {
      const l = (): void => cb(ch.slice('menu:'.length))
      ipcRenderer.on(ch, l)
      return () => ipcRenderer.removeListener(ch, l)
    })
    return () => listeners.forEach((off) => off())
  }
})
