import { app, BrowserWindow, shell } from 'electron'
import { autoUpdater, UpdateInfo } from 'electron-updater'
import { UpdateStatus } from '@shared/types'
import * as store from './store'

const OWNER = 'dthornley'
const REPO = 'MongoBrowser'
const RELEASES_URL = `https://github.com/${OWNER}/${REPO}/releases`

// Wraps electron-updater (GitHub Releases provider). The repo is public, so no credentials are needed.

let status: UpdateStatus = { state: 'idle', current: app.getVersion() }
let getWindow: () => BrowserWindow | null = () => null
let configured = false

function set(patch: Partial<UpdateStatus>): void {
  status = { ...status, ...patch, current: app.getVersion() }
  getWindow()?.webContents.send('updates:status', status)
}

function releaseNotes(info: UpdateInfo): string {
  const n = info.releaseNotes
  if (!n) return ''
  if (typeof n === 'string') return n
  return n.map((x) => x.note ?? '').join('\n')
}

function configure(): void {
  autoUpdater.setFeedURL({ provider: 'github', owner: OWNER, repo: REPO })
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  if (!configured) {
    configured = true
    autoUpdater.logger = null
    autoUpdater.on('checking-for-update', () => set({ state: 'checking', error: undefined }))
    autoUpdater.on('update-available', (info) => {
      set({ state: 'available', latest: info.version, notes: releaseNotes(info), url: `${RELEASES_URL}/tag/v${info.version}` })
      if (!releaseNotes(info)) void fetchReleaseBody(info.version).then((notes) => notes && status.latest === info.version && set({ notes }))
    })
    autoUpdater.on('update-not-available', (info) => set({ state: 'none', latest: info.version }))
    autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent) }))
    autoUpdater.on('update-downloaded', (info) => set({ state: 'downloaded', latest: info.version, percent: 100 }))
    autoUpdater.on('error', (err) => set({ state: 'error', error: friendly(err) }))
  }
}

/** electron-updater doesn't always surface the release body; fetch it from the API. */
async function fetchReleaseBody(version: string): Promise<string> {
  try {
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'MongoBrowser' }
    const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/v${version}`, { headers })
    if (!res.ok) return ''
    const json = (await res.json()) as { body?: string }
    return (json.body ?? '').trim()
  } catch {
    return ''
  }
}

function friendly(err: Error): string {
  const m = err.message ?? String(err)
  if (/404|Not Found/i.test(m)) return 'Could not read releases from GitHub.'
  if (/401|403|rate limit/i.test(m)) return 'GitHub refused the request. Try again later.'
  if (/ENOTFOUND|ECONN|ETIMEDOUT|net::/i.test(m)) return 'Could not reach GitHub.'
  if (/dev-app-update|not packaged|app-update\.yml/i.test(m)) return 'Updates only work in the packaged app.'
  return m.split('\n')[0].slice(0, 300)
}

export function initUpdater(windowGetter: () => BrowserWindow | null): void {
  getWindow = windowGetter
  // silent check shortly after launch; the UI shows a banner if something is available
  if (app.isPackaged) {
    setTimeout(() => {
      void store.getSettings().then((s) => (s.checkUpdatesOnLaunch ? checkForUpdates() : undefined)).catch(() => undefined)
    }, 4000)
  }
}

export function getUpdateStatus(): UpdateStatus {
  return status
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!app.isPackaged) {
    set({ state: 'error', error: 'Updates only work in the packaged app.' })
    return status
  }
  configure()
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    set({ state: 'error', error: friendly(err as Error) })
  }
  return status
}

export async function downloadUpdate(): Promise<UpdateStatus> {
  if (status.state !== 'available') await checkForUpdates()
  if (status.state !== 'available') return status
  set({ state: 'downloading', percent: 0 })
  try {
    await autoUpdater.downloadUpdate()
  } catch (err) {
    set({ state: 'error', error: friendly(err as Error) })
  }
  return status
}

export function installUpdate(): void {
  if (status.state !== 'downloaded') return
  setImmediate(() => autoUpdater.quitAndInstall(false, true))
}

export function openReleasesPage(): void {
  void shell.openExternal(status.url ?? RELEASES_URL)
}
