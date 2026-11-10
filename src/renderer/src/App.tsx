import { useEffect, useRef, useState } from 'react'
import { actions, getState, setState, useAppState } from './store'
import Explorer from './components/Explorer'
import QueryTab from './components/QueryTab'
import { ConnectionManager, ConnectionDialog } from './components/ConnectionDialogs'
import {
  AlertDialog,
  CopyCollectionDialog,
  CreateCollectionDialog,
  CreateIndexDialog,
  CreateUserDialog,
  DocumentDialog,
  ExportCollectionDialog,
  InputDialog,
  PreferencesDialog
} from './components/Dialogs'
import { UpdateDialog } from './components/UpdateDialog'
import { ImportRobo3TDialog } from './components/ImportRobo3TDialog'
import { ConnectionConfig } from '@shared/types'

export default function App(): JSX.Element {
  const tabs = useAppState((s) => s.tabs)
  const activeTabId = useAppState((s) => s.activeTabId)
  const modals = useAppState((s) => s.modals)
  const explorerVisible = useAppState((s) => s.explorerVisible)
  const settings = useAppState((s) => s.settings)
  const connections = useAppState((s) => s.connections)
  const sessions = useAppState((s) => s.sessions)
  const log = useAppState((s) => s.log)
  const update = useAppState((s) => s.update)
  const [showLog, setShowLog] = useState(false)
  const [explorerWidth, setExplorerWidth] = useState(280)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void actions.loadSettings()
    // Robo3T opens the connection manager on launch (guarded: StrictMode runs effects twice in dev)
    void actions.loadConnections().then(() => {
      if (!getState().modals.some((m) => m.kind === 'connectionManager')) actions.openModal('connectionManager')
    })
    void window.api.updates.status().then((u) => setState({ update: u }))
    const offUpdates = window.api.updates.onStatus((u) => {
      setState({ update: u })
      if (u.state === 'available') actions.log(`MongoBrowser ${u.latest} is available (you have ${u.current})`)
      if (u.state === 'error') actions.log(`Update check: ${u.error}`, 'error')
    })
    const offStatus = window.api.session.onStatus((ev) => {
      if (ev.state === 'disconnected' && getState().sessions[ev.connectionId]?.state === 'connected') {
        actions.setSession(ev.connectionId, { state: 'disconnected', serverInfo: undefined })
        actions.log(`Connection ${ev.connectionId} closed`, 'error')
      }
    })
    const offMenu = window.menuEvents.on((name) => {
      const s = getState()
      const tab = s.tabs.find((t) => t.id === s.activeTabId)
      switch (name) {
        case 'connect':
          actions.openModal('connectionManager')
          break
        case 'preferences':
          actions.openModal('preferences')
          break
        case 'checkUpdates':
          if (!getState().modals.some((m) => m.kind === 'update')) actions.openModal('update')
          break
        case 'importRobo3T':
          actions.openModal('importRobo3T')
          break
        case 'newTab': {
          const cid = tab?.connectionId ?? Object.keys(s.sessions).find((id) => s.sessions[id].state === 'connected')
          if (!cid) {
            actions.openModal('connectionManager')
            return
          }
          const cfg = s.connections.find((c) => c.id === cid)
          actions.openTab(cid, tab?.db ?? cfg?.advanced.defaultDatabase ?? 'test', '')
          break
        }
        case 'closeTab':
          if (tab) actions.closeTab(tab.id)
          break
        case 'execute':
          if (tab) void actions.runTab(tab.id)
          break
        case 'prevPage':
          if (tab?.result?.pageable && tab.skip > 0) void actions.runTab(tab.id, { skip: Math.max(0, tab.skip - (tab.result.limit || tab.limit)), limit: tab.limit })
          break
        case 'nextPage':
          if (tab?.result?.pageable) void actions.runTab(tab.id, { skip: tab.skip + (tab.result.limit || tab.limit), limit: tab.limit })
          break
        case 'viewText':
          if (tab) actions.updateTab(tab.id, { viewMode: 'text' })
          break
        case 'viewTree':
          if (tab) actions.updateTab(tab.id, { viewMode: 'tree' })
          break
        case 'viewTable':
          if (tab) actions.updateTab(tab.id, { viewMode: 'table' })
          break
        case 'toggleExplorer':
          setState({ explorerVisible: !s.explorerVisible })
          break
        case 'loadScript':
          if (tab) {
            void window.api.ui.openFile([{ name: 'JavaScript', extensions: ['js', 'txt'] }]).then(async (p) => {
              if (!p) return
              const script = await window.api.ui.readFile(p)
              actions.updateTab(tab.id, { script, title: p.split('/').pop() ?? tab.title })
            })
          }
          break
        case 'saveScript':
          if (tab) void window.api.ui.saveFile(`${tab.title}.js`, tab.script)
          break
      }
    })
    return () => {
      offStatus()
      offMenu()
      offUpdates()
    }
  }, [])

  useEffect(() => {
    document.documentElement.style.setProperty('--font-size', `${settings.fontSize}px`)
  }, [settings.fontSize])

  useEffect(() => {
    if (showLog && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [log, showLog])

  const onSplitterDown = (e: React.MouseEvent): void => {
    const startX = e.clientX
    const startW = explorerWidth
    const move = (ev: MouseEvent): void => setExplorerWidth(Math.min(600, Math.max(160, startW + ev.clientX - startX)))
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const connectedCount = Object.values(sessions).filter((s) => s.state === 'connected').length
  const lastLog = log[log.length - 1]

  return (
    <div className="app">
      <div className="toolbar">
        <button className="tbtn" onClick={() => actions.openModal('connectionManager')} title="Connect (⌘N)">
          ⚡ Connect
        </button>
        <button
          className="tbtn"
          title="Open Shell (⌘T)"
          disabled={connectedCount === 0}
          onClick={() => {
            const s = getState()
            const tab = s.tabs.find((t) => t.id === s.activeTabId)
            const cid = tab?.connectionId ?? Object.keys(s.sessions).find((id) => s.sessions[id].state === 'connected')
            if (!cid) return
            const cfg = s.connections.find((c) => c.id === cid)
            actions.openTab(cid, tab?.db ?? cfg?.advanced.defaultDatabase ?? 'test', '')
          }}
        >
          ▣ Open Shell
        </button>
        <button className={`tbtn${explorerVisible ? ' active' : ''}`} onClick={() => setState({ explorerVisible: !explorerVisible })} title="Toggle Explorer (⌘B)">
          ☰
        </button>
        <span className="spacer" />
        <span className="title">MongoBrowser</span>
        <span className="spacer" />
        <button className="tbtn" onClick={() => actions.openModal('preferences')} title="Preferences (⌘,)">
          ⚙
        </button>
      </div>

      <div className="main">
        <div className={`explorer${explorerVisible ? '' : ' hidden'}`} style={{ width: explorerWidth }}>
          <Explorer />
        </div>
        {explorerVisible && <div className="splitter" onMouseDown={onSplitterDown} />}
        <div className="workspace">
          {tabs.length > 0 && (
            <div className="tabbar">
              {tabs.map((t) => (
                <div
                  key={t.id}
                  className={`tab${t.id === activeTabId ? ' active' : ''}`}
                  onClick={() => setState({ activeTabId: t.id })}
                  onMouseDown={(e) => e.button === 1 && actions.closeTab(t.id)}
                  title={`${connections.find((c) => c.id === t.connectionId)?.name ?? ''} › ${t.db}`}
                >
                  {t.running && <span className="spinner" />}
                  <span className="tab-title">{t.title}</span>
                  <span className="close" onClick={(e) => (e.stopPropagation(), actions.closeTab(t.id))}>
                    ✕
                  </span>
                </div>
              ))}
            </div>
          )}
          {tabs.length === 0 && (
            <div className="empty-workspace">
              <h2>MongoBrowser</h2>
              <div>Connect to a server, then double-click a collection to view its documents.</div>
              <div className="hint">
                <kbd>⌘N</kbd> Connect · <kbd>⌘T</kbd> New shell · <kbd>⌘↩</kbd> Run · <kbd>⌘1/2/3</kbd> Text / Tree / Table
              </div>
            </div>
          )}
          {tabs.map((t) => (
            <QueryTab key={t.id} tab={t} active={t.id === activeTabId} />
          ))}
        </div>
      </div>

      {showLog && (
        <div className="logpanel" ref={logRef}>
          {log.map((l, i) => (
            <div key={i} className={`line ${l.level}`}>
              <span className="time">{new Date(l.time).toLocaleTimeString()}</span>
              {l.text}
            </div>
          ))}
        </div>
      )}
      <div className="statusbar">
        <span>
          {connectedCount} connection{connectedCount === 1 ? '' : 's'}
        </span>
        <span className={`msg ${lastLog?.level === 'error' ? 'error' : ''}`}>{lastLog?.text ?? ''}</span>
        {(update.state === 'available' || update.state === 'downloading' || update.state === 'downloaded') && (
          <button className="update-pill" onClick={() => actions.openModal('update')}>
            {update.state === 'available' && `⬆ Update to ${update.latest}`}
            {update.state === 'downloading' && `Downloading ${update.latest}… ${update.percent ?? 0}%`}
            {update.state === 'downloaded' && `⬆ Restart to install ${update.latest}`}
          </button>
        )}
        <button onClick={() => setShowLog((v) => !v)}>{showLog ? 'Hide log' : 'Show log'}</button>
      </div>

      {modals.map((m) => {
        const close = (): void => actions.closeModal(m.id)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const p = m.props as any
        switch (m.kind) {
          case 'connectionManager':
            return <ConnectionManager key={m.id} onClose={close} />
          case 'connectionDialog':
            return <ConnectionDialog key={m.id} onClose={close} connectionId={p.connectionId} clone={p.clone as ConnectionConfig | undefined} />
          case 'document':
            return <DocumentDialog key={m.id} onClose={close} {...p} />
          case 'input':
            return <InputDialog key={m.id} onClose={close} {...p} />
          case 'alert':
            return <AlertDialog key={m.id} onClose={close} {...p} />
          case 'createCollection':
            return <CreateCollectionDialog key={m.id} onClose={close} {...p} />
          case 'createIndex':
            return <CreateIndexDialog key={m.id} onClose={close} {...p} />
          case 'createUser':
            return <CreateUserDialog key={m.id} onClose={close} {...p} />
          case 'copyCollection':
            return <CopyCollectionDialog key={m.id} onClose={close} {...p} />
          case 'exportCollection':
            return <ExportCollectionDialog key={m.id} onClose={close} {...p} />
          case 'preferences':
            return <PreferencesDialog key={m.id} onClose={close} />
          case 'update':
            return <UpdateDialog key={m.id} onClose={close} />
          case 'importRobo3T':
            return <ImportRobo3TDialog key={m.id} onClose={close} />
          default:
            return null
        }
      })}
    </div>
  )
}
