import { useSyncExternalStore } from 'react'
import { AppSettings, ConnectionConfig, ConnectionState, QueryResult, ServerInfo, UpdateStatus, defaultSettings } from '@shared/types'

export type ViewMode = 'tree' | 'table' | 'text'

export interface SessionState {
  state: ConnectionState
  serverInfo?: ServerInfo
  error?: string
}

export interface QueryTab {
  id: string
  connectionId: string
  db: string
  title: string
  script: string
  result?: QueryResult
  error?: string
  running: boolean
  viewMode: ViewMode
  /** paging bar state */
  skip: number
  limit: number
  /** fallback db name for the title when tab is a plain shell */
  dirty: boolean
}

export interface ModalRequest {
  id: number
  kind: string
  props: Record<string, unknown>
}

export interface AppState {
  connections: ConnectionConfig[]
  sessions: Record<string, SessionState>
  tabs: QueryTab[]
  activeTabId: string | null
  settings: AppSettings
  modals: ModalRequest[]
  explorerVisible: boolean
  /** bumping this forces the explorer to refetch the node with the given key */
  refreshToken: { key: string; n: number }
  log: { time: number; level: 'info' | 'error'; text: string }[]
  update: UpdateStatus
}

let state: AppState = {
  connections: [],
  sessions: {},
  tabs: [],
  activeTabId: null,
  settings: defaultSettings,
  modals: [],
  explorerVisible: true,
  refreshToken: { key: '', n: 0 },
  log: [],
  update: { state: 'idle', current: '' }
}

const listeners = new Set<() => void>()

export function getState(): AppState {
  return state
}

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
  const p = typeof patch === 'function' ? patch(state) : patch
  state = { ...state, ...p }
  listeners.forEach((l) => l())
}

export function useAppState<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => selector(state)
  )
}

let nextModalId = 1
let nextTabId = 1

export const actions = {
  log(text: string, level: 'info' | 'error' = 'info'): void {
    setState((s) => ({ log: [...s.log.slice(-500), { time: Date.now(), level, text }] }))
  },

  async loadConnections(): Promise<void> {
    setState({ connections: await window.api.connections.list() })
  },

  async loadSettings(): Promise<void> {
    setState({ settings: await window.api.settings.get() })
  },

  async saveSettings(patch: Partial<AppSettings>): Promise<void> {
    setState({ settings: await window.api.settings.set(patch) })
  },

  setSession(id: string, patch: Partial<SessionState>): void {
    setState((s) => ({ sessions: { ...s.sessions, [id]: { ...(s.sessions[id] ?? { state: 'disconnected' }), ...patch } } }))
  },

  async connect(id: string): Promise<void> {
    const cfg = state.connections.find((c) => c.id === id)
    actions.setSession(id, { state: 'connecting', error: undefined })
    try {
      const info = await window.api.session.connect(id)
      actions.setSession(id, { state: 'connected', serverInfo: info })
      actions.log(`Connected to ${cfg?.name ?? id} (MongoDB ${info.version}, ${info.topology})`)
    } catch (err) {
      const msg = (err as Error).message
      actions.setSession(id, { state: 'error', error: msg })
      actions.log(`Failed to connect to ${cfg?.name ?? id}: ${msg}`, 'error')
      throw err
    }
  },

  async disconnect(id: string): Promise<void> {
    await window.api.session.disconnect(id)
    actions.setSession(id, { state: 'disconnected', serverInfo: undefined })
    setState((s) => {
      const tabs = s.tabs.filter((t) => t.connectionId !== id)
      return { tabs, activeTabId: tabs.some((t) => t.id === s.activeTabId) ? s.activeTabId : (tabs[0]?.id ?? null) }
    })
  },

  openTab(connectionId: string, db: string, script = '', opts: { title?: string; run?: boolean } = {}): QueryTab {
    const tab: QueryTab = {
      id: `tab-${nextTabId++}`,
      connectionId,
      db,
      title: opts.title ?? db,
      script,
      running: false,
      viewMode: state.settings.defaultResultView,
      skip: 0,
      limit: state.settings.defaultPageSize,
      dirty: false
    }
    setState((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }))
    if (opts.run) void actions.runTab(tab.id)
    return tab
  },

  closeTab(id: string): void {
    setState((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id)
      const tabs = s.tabs.filter((t) => t.id !== id)
      let active = s.activeTabId
      if (active === id) active = tabs[Math.min(idx, tabs.length - 1)]?.id ?? null
      return { tabs, activeTabId: active }
    })
  },

  updateTab(id: string, patch: Partial<QueryTab> | ((t: QueryTab) => Partial<QueryTab>)): void {
    setState((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) } : t))
    }))
  },

  async runTab(id: string, paging?: { skip: number; limit: number }): Promise<void> {
    const tab = state.tabs.find((t) => t.id === id)
    if (!tab || tab.running) return
    const skip = paging?.skip ?? (paging ? tab.skip : 0)
    const limit = paging?.limit ?? tab.limit
    actions.updateTab(id, { running: true, error: undefined, skip, limit })
    const started = Date.now()
    try {
      const result = await window.api.query.execute(tab.connectionId, tab.db, tab.script, { skip, limit })
      actions.updateTab(id, { result, running: false, skip: result.pageable ? skip : 0 })
      const first = tab.script.trim().split('\n')[0]
      actions.log(`${tab.db}: ${first.slice(0, 120)} — ${result.count} result(s) in ${result.elapsedMs} ms`)
    } catch (err) {
      const msg = (err as Error).message
      actions.updateTab(id, { error: msg, running: false, result: undefined })
      actions.log(`${tab.db}: error after ${Date.now() - started} ms — ${msg}`, 'error')
    }
  },

  openModal(kind: string, props: Record<string, unknown> = {}): number {
    const id = nextModalId++
    setState((s) => ({ modals: [...s.modals, { id, kind, props }] }))
    return id
  },

  closeModal(id: number): void {
    setState((s) => ({ modals: s.modals.filter((m) => m.id !== id) }))
  },

  refreshExplorer(key: string): void {
    setState((s) => ({ refreshToken: { key, n: s.refreshToken.n + 1 } }))
  }
}

/** Robo3T quotes collection names via getCollection() when they aren't plain identifiers. */
export function collectionRef(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) && !RESERVED.has(name) ? `db.${name}` : `db.getCollection(${JSON.stringify(name)})`
}

const RESERVED = new Set([
  'getCollection',
  'getName',
  'stats',
  'version',
  'dropDatabase',
  'runCommand',
  'adminCommand',
  'getSiblingDB',
  'getUsers',
  'getCollectionNames',
  'createCollection',
  'auth',
  'hostInfo',
  'serverStatus'
])
