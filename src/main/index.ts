import { app, BrowserWindow, shell, Menu, MenuItemConstructorOptions } from 'electron'
import { join } from 'path'
import { ClientManager } from './mongo/ClientManager'
import { registerIpc } from './ipc'
import { initUpdater } from './updater'

const clients = new ClientManager()
let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'MongoBrowser',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    backgroundColor: '#f5f5f5',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => (mainWindow = null))
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function send(channel: string): void {
  mainWindow?.webContents.send(channel)
}

function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { label: 'Check for Updates…', click: () => send('menu:checkUpdates') },
        { type: 'separator' },
        { label: 'Preferences…', accelerator: 'Cmd+,', click: () => send('menu:preferences') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        { label: 'Connect…', accelerator: 'Cmd+N', click: () => send('menu:connect') },
        { type: 'separator' },
        { label: 'Open Shell Tab', accelerator: 'Cmd+T', click: () => send('menu:newTab') },
        { label: 'Close Tab', accelerator: 'Cmd+W', click: () => send('menu:closeTab') },
        { type: 'separator' },
        { label: 'Load Script…', accelerator: 'Cmd+O', click: () => send('menu:loadScript') },
        { label: 'Save Script…', accelerator: 'Cmd+S', click: () => send('menu:saveScript') },
        { type: 'separator' },
        { label: 'Import Robo3T Connections…', click: () => send('menu:importRobo3T') }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'Query',
      submenu: [
        { label: 'Execute', accelerator: 'Cmd+Enter', click: () => send('menu:execute') },
        { label: 'Execute (F5)', accelerator: 'F5', click: () => send('menu:execute'), visible: false },
        { type: 'separator' },
        { label: 'Previous Page', accelerator: 'Cmd+Left', click: () => send('menu:prevPage') },
        { label: 'Next Page', accelerator: 'Cmd+Right', click: () => send('menu:nextPage') }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Text Mode', accelerator: 'Cmd+1', click: () => send('menu:viewText') },
        { label: 'Tree Mode', accelerator: 'Cmd+2', click: () => send('menu:viewTree') },
        { label: 'Table Mode', accelerator: 'Cmd+3', click: () => send('menu:viewTable') },
        { type: 'separator' },
        { label: 'Toggle Explorer', accelerator: 'Cmd+B', click: () => send('menu:toggleExplorer') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }] }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  // packaged builds take the icon from the bundle; in dev the Dock would show Electron's icon
  if (!app.isPackaged) app.dock?.setIcon(join(__dirname, '../../build/icon.png'))
  registerIpc(clients, () => mainWindow)
  initUpdater(() => mainWindow)
  buildMenu()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('before-quit', () => {
  void clients.disconnectAll()
})
