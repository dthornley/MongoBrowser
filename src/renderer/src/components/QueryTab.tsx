import { useCallback, useMemo, useRef, useState } from 'react'
import { Document } from 'bson'
import { QueryTab as Tab, actions, useAppState, ViewMode } from '../store'
import CodeEditor from './CodeEditor'
import { parseDocuments, parseEjson, toEjson } from '../bson'
import { TreeView, TableView, TextView, ValueView, DocActions } from '../views/ResultViews'
import { formatShell } from '@shared/shellFormat'

interface Props {
  tab: Tab
  active: boolean
}

export default function QueryTab({ tab, active }: Props): JSX.Element {
  const settings = useAppState((s) => s.settings)
  const connections = useAppState((s) => s.connections)
  const connection = connections.find((c) => c.id === tab.connectionId)
  const [editorHeight, setEditorHeight] = useState(110)
  const dragging = useRef<{ startY: number; startH: number } | null>(null)

  const run = useCallback(() => void actions.runTab(tab.id), [tab.id])

  const docs = useMemo(() => {
    if (!tab.result || tab.result.kind !== 'documents') return []
    try {
      return parseDocuments(tab.result.ejson)
    } catch {
      return []
    }
  }, [tab.result])

  const value = useMemo(() => {
    if (!tab.result || tab.result.kind !== 'value') return undefined
    try {
      return parseEjson<unknown>(tab.result.ejson)
    } catch {
      return tab.result.ejson
    }
  }, [tab.result])

  const ns = tab.result?.namespace
  const docActions: DocActions = useMemo(
    () => ({
      editable: !!ns,
      edit(doc) {
        actions.openModal('document', {
          mode: 'edit',
          connectionId: tab.connectionId,
          db: ns?.db,
          collection: ns?.collection,
          text: formatShell(doc),
          onSaved: () => void actions.runTab(tab.id, { skip: tab.skip, limit: tab.limit })
        })
      },
      view(doc) {
        actions.openModal('document', { mode: 'view', text: formatShell(doc) })
      },
      insert() {
        actions.openModal('document', {
          mode: 'insert',
          connectionId: tab.connectionId,
          db: ns?.db,
          collection: ns?.collection,
          text: '{\n    \n}',
          onSaved: () => void actions.runTab(tab.id, { skip: tab.skip, limit: tab.limit })
        })
      },
      async remove(doc: Document) {
        if (!ns) return
        const id = doc._id
        const ok = await window.api.ui.confirm('Delete', 'Delete this document?', `_id: ${formatShell(id)}`)
        if (!ok) return
        try {
          await window.api.query.deleteDocument(tab.connectionId, ns.db, ns.collection, toEjson(id))
          actions.log(`Deleted document ${formatShell(id)} from ${ns.db}.${ns.collection}`)
          void actions.runTab(tab.id, { skip: tab.skip, limit: tab.limit })
        } catch (err) {
          actions.openModal('alert', { title: 'Delete failed', message: (err as Error).message })
        }
      },
      copyText(text) {
        void navigator.clipboard.writeText(text)
      }
    }),
    [ns, tab.connectionId, tab.id, tab.skip, tab.limit]
  )

  const setView = (viewMode: ViewMode): void => actions.updateTab(tab.id, { viewMode })

  const page = (dir: -1 | 1): void => {
    const r = tab.result
    if (!r || !r.pageable) return
    const step = r.limit || tab.limit
    const skip = Math.max(0, tab.skip + dir * step)
    if (dir === -1 && tab.skip === 0) return
    void actions.runTab(tab.id, { skip, limit: tab.limit })
  }

  const onDragStart = (e: React.MouseEvent): void => {
    dragging.current = { startY: e.clientY, startH: editorHeight }
    const move = (ev: MouseEvent): void => {
      if (!dragging.current) return
      setEditorHeight(Math.max(40, dragging.current.startH + ev.clientY - dragging.current.startY))
    }
    const up = (): void => {
      dragging.current = null
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const result = tab.result
  const canPrev = !!result?.pageable && tab.skip > 0
  const canNext = !!result?.pageable && (result.total !== undefined ? result.skip + result.count < result.total : result.count >= result.limit && result.limit > 0)

  return (
    <div className={`query-tab${active ? '' : ' hidden'}`}>
      <div className="query-head">
        <button className="tbtn primary" onClick={run} disabled={tab.running} title="Execute (⌘↩ / F5)">
          ▶ Run
        </button>
        <span className="ns">
          <b>{connection?.name ?? '?'}</b> › {tab.db}
        </span>
        <span className="spacer" style={{ flex: 1 }} />
        <button
          className="tbtn small"
          onClick={() =>
            actions.openModal('input', {
              title: 'Change Database',
              label: 'Database',
              value: tab.db,
              onSubmit: (db: string) => actions.updateTab(tab.id, { db, title: tab.title === tab.db ? db : tab.title })
            })
          }
        >
          Change DB
        </button>
      </div>
      <div className="editor" style={{ height: editorHeight }}>
        <CodeEditor
          value={tab.script}
          onChange={(script) => actions.updateTab(tab.id, { script, dirty: true })}
          onRun={run}
          autoFocus={active}
        />
      </div>
      <div className="hsplitter" onMouseDown={onDragStart} />
      <div className="result-head">
        <div className="seg">
          <button className={tab.viewMode === 'tree' ? 'active' : ''} onClick={() => setView('tree')} title="Tree mode (⌘2)">
            Tree
          </button>
          <button className={tab.viewMode === 'table' ? 'active' : ''} onClick={() => setView('table')} title="Table mode (⌘3)">
            Table
          </button>
          <button className={tab.viewMode === 'text' ? 'active' : ''} onClick={() => setView('text')} title="Text mode (⌘1)">
            Text
          </button>
        </div>
        <span className="info">
          {tab.running
            ? 'Running…'
            : result
              ? result.kind === 'documents'
                ? `${result.count} document${result.count === 1 ? '' : 's'}${result.pageable ? ` (${result.skip + 1}–${result.skip + result.count}${result.total !== undefined ? ` of ${result.total}` : ''})` : ''} · ${result.elapsedMs} ms`
                : `${result.elapsedMs} ms`
              : ''}
        </span>
        <div className="paging">
          <button className="tbtn small" onClick={() => page(-1)} disabled={!canPrev} title="Previous page (⌘←)">
            ◀
          </button>
          <label className="hint">skip</label>
          <input
            type="number"
            min={0}
            value={tab.skip}
            onChange={(e) => actions.updateTab(tab.id, { skip: Math.max(0, Number(e.target.value) || 0) })}
            onKeyDown={(e) => e.key === 'Enter' && void actions.runTab(tab.id, { skip: tab.skip, limit: tab.limit })}
          />
          <label className="hint">limit</label>
          <input
            type="number"
            min={1}
            value={tab.limit}
            onChange={(e) => actions.updateTab(tab.id, { limit: Math.max(1, Number(e.target.value) || settings.defaultPageSize) })}
            onKeyDown={(e) => e.key === 'Enter' && void actions.runTab(tab.id, { skip: tab.skip, limit: tab.limit })}
          />
          <button className="tbtn small" onClick={() => page(1)} disabled={!canNext} title="Next page (⌘→)">
            ▶
          </button>
        </div>
      </div>
      <div className="result-body">
        {tab.error && <div className="result-error">{tab.error}</div>}
        {!tab.error && !result && !tab.running && (
          <div className="result-placeholder">
            Press <kbd>⌘↩</kbd> or click Run to execute the script.
          </div>
        )}
        {!tab.error && result?.kind === 'documents' && docs.length === 0 && <div className="result-placeholder">No documents</div>}
        {!tab.error && result?.kind === 'documents' && docs.length > 0 && tab.viewMode === 'tree' && (
          <TreeView docs={docs} offset={result.skip} actions={docActions} autoExpandFirst={settings.autoExpandFirst} />
        )}
        {!tab.error && result?.kind === 'documents' && docs.length > 0 && tab.viewMode === 'table' && (
          <TableView docs={docs} offset={result.skip} actions={docActions} autoExpandFirst={false} />
        )}
        {!tab.error && result?.kind === 'documents' && docs.length > 0 && tab.viewMode === 'text' && (
          <TextView docs={docs} offset={result.skip} actions={docActions} autoExpandFirst={false} />
        )}
        {!tab.error && result?.kind === 'value' && <ValueView value={value} />}
        {!tab.error && result?.kind === 'empty' && (result.output.length === 0 ? <div className="result-placeholder">Script finished (no result)</div> : null)}
      </div>
      {result && result.output.length > 0 && <div className="result-output">{result.output.join('\n')}</div>}
    </div>
  )
}
