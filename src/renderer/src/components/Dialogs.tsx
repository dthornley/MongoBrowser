import { useEffect, useState } from 'react'
import { AppSettings } from '@shared/types'
import { actions, useAppState } from '../store'
import Modal from './Modal'
import CodeEditor from './CodeEditor'
import { parseDocuments } from '../bson'
import { formatShell } from '@shared/shellFormat'

// ---------------------------------------------------------------------------------------------
export function AlertDialog({ title, message, onClose }: { title: string; message: string; onClose: () => void }): JSX.Element {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <button className="tbtn primary" onClick={onClose} autoFocus>
          OK
        </button>
      }
    >
      <div style={{ whiteSpace: 'pre-wrap', userSelect: 'text', fontFamily: 'var(--mono)', fontSize: 12 }}>{message}</div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------------
export function InputDialog({
  title,
  label,
  value = '',
  onSubmit,
  onClose
}: {
  title: string
  label: string
  value?: string
  onSubmit: (v: string) => Promise<void> | void
  onClose: () => void
}): JSX.Element {
  const [v, setV] = useState(value)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (): Promise<void> => {
    if (!v.trim()) return
    setBusy(true)
    try {
      await onSubmit(v.trim())
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          {error && <span className="error">{error}</span>}
          <button className="tbtn" onClick={onClose}>
            Cancel
          </button>
          <button className="tbtn primary" onClick={() => void submit()} disabled={busy || !v.trim()}>
            OK
          </button>
        </>
      }
    >
      <div className="form">
        <label>{label}</label>
        <input type="text" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void submit()} autoFocus />
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------------
// Document editor: edit / insert / view in shell syntax, exactly like Robo3T's document window
// ---------------------------------------------------------------------------------------------
export function DocumentDialog({
  mode,
  connectionId,
  db,
  collection,
  text,
  onSaved,
  onClose
}: {
  mode: 'edit' | 'insert' | 'view'
  connectionId?: string
  db?: string
  collection?: string
  text: string
  onSaved?: () => void
  onClose: () => void
}): JSX.Element {
  const [value, setValue] = useState(text)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const validate = async (): Promise<string | null> => {
    try {
      const ejson = await window.api.query.evalDocument(value)
      const docs = parseDocuments(ejson)
      if (docs.length !== 1 || Array.isArray(parseDocuments(ejson)[0])) throw new Error('Expected a single document')
      setError(null)
      return ejson
    } catch (err) {
      setError((err as Error).message)
      return null
    }
  }

  const save = async (): Promise<void> => {
    if (mode === 'view' || !connectionId || !db || !collection) return
    setBusy(true)
    try {
      const ejson = await validate()
      if (!ejson) return
      if (mode === 'edit') {
        await window.api.query.replaceDocument(connectionId, db, collection, ejson)
        actions.log(`Saved document in ${db}.${collection}`)
      } else {
        const id = await window.api.query.insertDocument(connectionId, db, collection, ejson)
        actions.log(`Inserted document ${formatShell(parseDocuments(`[${id}]`)[0])} into ${db}.${collection}`)
      }
      onSaved?.()
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const title = mode === 'edit' ? `Edit Document — ${db}.${collection}` : mode === 'insert' ? `Insert Document — ${db}.${collection}` : 'View Document'

  return (
    <Modal
      title={title}
      onClose={onClose}
      wide
      tall
      footer={
        <>
          {error && <span className="error">{error}</span>}
          {mode !== 'view' && (
            <button className="tbtn" onClick={() => void validate()}>
              Validate
            </button>
          )}
          <button className="tbtn" onClick={onClose}>
            {mode === 'view' ? 'Close' : 'Cancel'}
          </button>
          {mode !== 'view' && (
            <button className="tbtn primary" onClick={() => void save()} disabled={busy}>
              Save
            </button>
          )}
        </>
      }
    >
      <div className="doc-editor">
        <CodeEditor value={value} onChange={setValue} readOnly={mode === 'view'} autoFocus onRun={() => void save()} />
      </div>
      {mode !== 'view' && (
        <div className="hint">
          Shell syntax is supported: ObjectId("…"), ISODate("…"), NumberLong(…), NumberDecimal("…"), UUID("…"). ⌘↩ saves.
        </div>
      )}
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------------
export function CreateCollectionDialog({
  onSubmit,
  onClose
}: {
  onSubmit: (req: { name: string; capped?: boolean; size?: number; max?: number }) => Promise<void>
  onClose: () => void
}): JSX.Element {
  const [name, setName] = useState('')
  const [capped, setCapped] = useState(false)
  const [size, setSize] = useState(1048576)
  const [max, setMax] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const submit = async (): Promise<void> => {
    try {
      await onSubmit({ name: name.trim(), capped, size: capped ? size : undefined, max: capped && max > 0 ? max : undefined })
      onClose()
    } catch (err) {
      setError((err as Error).message)
    }
  }
  return (
    <Modal
      title="Create Collection"
      onClose={onClose}
      footer={
        <>
          {error && <span className="error">{error}</span>}
          <button className="tbtn" onClick={onClose}>
            Cancel
          </button>
          <button className="tbtn primary" onClick={() => void submit()} disabled={!name.trim()}>
            Create
          </button>
        </>
      }
    >
      <div className="form">
        <label>Name</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void submit()} autoFocus />
        <span />
        <label className="check" style={{ textAlign: 'left' }}>
          <input type="checkbox" checked={capped} onChange={(e) => setCapped(e.target.checked)} /> Capped collection
        </label>
        <label>Max size (bytes)</label>
        <input type="number" disabled={!capped} value={size} onChange={(e) => setSize(Number(e.target.value))} />
        <label>Max documents</label>
        <input type="number" disabled={!capped} value={max} onChange={(e) => setMax(Number(e.target.value))} placeholder="0 = unlimited" />
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------------
export function CreateIndexDialog({
  collection,
  onSubmit,
  onClose
}: {
  collection: string
  onSubmit: (req: { keysEjson: string; name?: string; unique?: boolean; sparse?: boolean; expireAfterSeconds?: number; partialFilterEjson?: string }) => Promise<void>
  onClose: () => void
}): JSX.Element {
  const [keys, setKeys] = useState('{ field: 1 }')
  const [name, setName] = useState('')
  const [unique, setUnique] = useState(false)
  const [sparse, setSparse] = useState(false)
  const [ttl, setTtl] = useState('')
  const [partial, setPartial] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    setBusy(true)
    try {
      const keysEjson = await window.api.query.evalDocument(keys)
      const partialFilterEjson = partial.trim() ? await window.api.query.evalDocument(partial) : undefined
      await onSubmit({
        keysEjson,
        name: name.trim() || undefined,
        unique,
        sparse,
        expireAfterSeconds: ttl.trim() ? Number(ttl) : undefined,
        partialFilterEjson
      })
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={`Add Index — ${collection}`}
      onClose={onClose}
      width={560}
      footer={
        <>
          {error && <span className="error">{error}</span>}
          <button className="tbtn" onClick={onClose}>
            Cancel
          </button>
          <button className="tbtn primary" onClick={() => void submit()} disabled={busy}>
            Create
          </button>
        </>
      }
    >
      <div className="form">
        <label>Keys</label>
        <textarea rows={3} value={keys} onChange={(e) => setKeys(e.target.value)} autoFocus />
        <span />
        <span className="hint">e.g. {'{ email: 1 }'}, {'{ a: 1, b: -1 }'}, {'{ location: "2dsphere" }'}, {'{ "$**": "text" }'}</span>
        <label>Name</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="auto" />
        <span />
        <label className="check" style={{ textAlign: 'left' }}>
          <input type="checkbox" checked={unique} onChange={(e) => setUnique(e.target.checked)} /> Unique
        </label>
        <span />
        <label className="check" style={{ textAlign: 'left' }}>
          <input type="checkbox" checked={sparse} onChange={(e) => setSparse(e.target.checked)} /> Sparse
        </label>
        <label>TTL (seconds)</label>
        <input type="number" value={ttl} onChange={(e) => setTtl(e.target.value)} placeholder="optional, expireAfterSeconds" />
        <label>Partial filter</label>
        <textarea rows={2} value={partial} onChange={(e) => setPartial(e.target.value)} placeholder="optional, e.g. { active: true }" />
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------------
const COMMON_ROLES = [
  'read',
  'readWrite',
  'dbAdmin',
  'dbOwner',
  'userAdmin',
  'clusterAdmin',
  'clusterManager',
  'clusterMonitor',
  'hostManager',
  'backup',
  'restore',
  'readAnyDatabase',
  'readWriteAnyDatabase',
  'userAdminAnyDatabase',
  'dbAdminAnyDatabase',
  'root'
]

export function CreateUserDialog({
  db,
  onSubmit,
  onClose
}: {
  db: string
  onSubmit: (req: { user: string; pwd: string; roles: { role: string; db: string }[] }) => Promise<void>
  onClose: () => void
}): JSX.Element {
  const [user, setUser] = useState('')
  const [pwd, setPwd] = useState('')
  const [roles, setRoles] = useState<{ role: string; db: string }[]>([{ role: 'readWrite', db }])
  const [error, setError] = useState<string | null>(null)
  const submit = async (): Promise<void> => {
    try {
      await onSubmit({ user: user.trim(), pwd, roles: roles.filter((r) => r.role && r.db) })
      onClose()
    } catch (err) {
      setError((err as Error).message)
    }
  }
  return (
    <Modal
      title={`Add User — ${db}`}
      onClose={onClose}
      width={520}
      footer={
        <>
          {error && <span className="error">{error}</span>}
          <button className="tbtn" onClick={onClose}>
            Cancel
          </button>
          <button className="tbtn primary" onClick={() => void submit()} disabled={!user.trim() || !pwd}>
            Create
          </button>
        </>
      }
    >
      <div className="form">
        <label>User name</label>
        <input type="text" value={user} onChange={(e) => setUser(e.target.value)} autoFocus />
        <label>Password</label>
        <input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} />
        <label>Roles</label>
        <div>
          {roles.map((r, i) => (
            <div className="row" key={i} style={{ marginBottom: 4 }}>
              <input
                type="text"
                list="role-names"
                value={r.role}
                placeholder="role"
                onChange={(e) => setRoles(roles.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))}
              />
              <span>@</span>
              <input type="text" value={r.db} placeholder="db" onChange={(e) => setRoles(roles.map((x, j) => (j === i ? { ...x, db: e.target.value } : x)))} />
              <button className="tbtn small" onClick={() => setRoles(roles.filter((_, j) => j !== i))}>
                −
              </button>
            </div>
          ))}
          <button className="tbtn small" onClick={() => setRoles([...roles, { role: 'read', db }])}>
            + Add role
          </button>
          <datalist id="role-names">
            {COMMON_ROLES.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------------
export function CopyCollectionDialog({
  connectionId,
  db,
  collection,
  onDone,
  onClose
}: {
  connectionId: string
  db: string
  collection: string
  onDone: (targetDb: string) => void
  onClose: () => void
}): JSX.Element {
  const connections = useAppState((s) => s.connections)
  const sessions = useAppState((s) => s.sessions)
  const [targetConn, setTargetConn] = useState(connectionId)
  const [targetDb, setTargetDb] = useState(db)
  const [targetColl, setTargetColl] = useState(collection)
  const [dbs, setDbs] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.api.server
      .databases(targetConn)
      .then((list) => setDbs(list.map((d) => d.name)))
      .catch(() => setDbs([]))
  }, [targetConn])

  const submit = async (): Promise<void> => {
    setBusy(true)
    try {
      const n = await window.api.server.copyCollection(connectionId, db, collection, targetConn, targetDb.trim(), targetColl.trim())
      actions.log(`Copied ${n} documents from ${db}.${collection} to ${targetDb}.${targetColl}`)
      onDone(targetDb.trim())
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Copy Collection — ${db}.${collection}`}
      onClose={onClose}
      width={520}
      footer={
        <>
          {error && <span className="error">{error}</span>}
          <button className="tbtn" onClick={onClose}>
            Cancel
          </button>
          <button className="tbtn primary" onClick={() => void submit()} disabled={busy || !targetDb.trim() || !targetColl.trim()}>
            {busy ? 'Copying…' : 'Copy'}
          </button>
        </>
      }
    >
      <div className="form">
        <label>Target connection</label>
        <select value={targetConn} onChange={(e) => setTargetConn(e.target.value)}>
          {connections
            .filter((c) => sessions[c.id]?.state === 'connected')
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
        <label>Target database</label>
        <input type="text" list="copy-dbs" value={targetDb} onChange={(e) => setTargetDb(e.target.value)} />
        <datalist id="copy-dbs">
          {dbs.map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>
        <label>Target collection</label>
        <input type="text" value={targetColl} onChange={(e) => setTargetColl(e.target.value)} />
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------------
export function ExportCollectionDialog({
  connectionId,
  db,
  collection,
  onClose
}: {
  connectionId: string
  db: string
  collection: string
  onClose: () => void
}): JSX.Element {
  const [limit, setLimit] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (): Promise<void> => {
    setBusy(true)
    try {
      const script = `db.getCollection(${JSON.stringify(collection)}).find({})${limit > 0 ? `.limit(${limit})` : ''}.toArray()`
      const r = await window.api.query.execute(connectionId, db, script, { skip: 0, limit: 0 })
      const ok = await window.api.ui.saveFile(`${collection}.json`, r.ejson)
      if (ok) actions.log(`Exported ${r.count} documents from ${db}.${collection}`)
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={`Export — ${db}.${collection}`}
      onClose={onClose}
      footer={
        <>
          {error && <span className="error">{error}</span>}
          <button className="tbtn" onClick={onClose}>
            Cancel
          </button>
          <button className="tbtn primary" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Exporting…' : 'Export…'}
          </button>
        </>
      }
    >
      <div className="form">
        <label>Limit</label>
        <input type="number" value={limit} onChange={(e) => setLimit(Number(e.target.value) || 0)} placeholder="0 = all" />
        <span />
        <span className="hint">Writes an Extended JSON (canonical) array, loadable with mongoimport --jsonArray.</span>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------------
export function PreferencesDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const settings = useAppState((s) => s.settings)
  const [s, setS] = useState<AppSettings>(settings)
  const save = async (): Promise<void> => {
    await actions.saveSettings(s)
    onClose()
  }
  return (
    <Modal
      title="Preferences"
      onClose={onClose}
      footer={
        <>
          <button className="tbtn" onClick={onClose}>
            Cancel
          </button>
          <button className="tbtn primary" onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      <div className="form">
        <label>Default page size</label>
        <input type="number" value={s.defaultPageSize} onChange={(e) => setS({ ...s, defaultPageSize: Math.max(1, Number(e.target.value) || 50) })} />
        <label>Default result view</label>
        <select value={s.defaultResultView} onChange={(e) => setS({ ...s, defaultResultView: e.target.value as AppSettings['defaultResultView'] })}>
          <option value="tree">Tree</option>
          <option value="table">Table</option>
          <option value="text">Text</option>
        </select>
        <span />
        <label className="check" style={{ textAlign: 'left' }}>
          <input type="checkbox" checked={s.autoExpandFirst} onChange={(e) => setS({ ...s, autoExpandFirst: e.target.checked })} /> Auto-expand first document in tree view
        </label>
        <label>Font size</label>
        <input type="number" value={s.fontSize} onChange={(e) => setS({ ...s, fontSize: Math.max(9, Number(e.target.value) || 13) })} />
        <span className="full" style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
        <span />
        <label className="check" style={{ textAlign: 'left' }}>
          <input type="checkbox" checked={s.checkUpdatesOnLaunch} onChange={(e) => setS({ ...s, checkUpdatesOnLaunch: e.target.checked })} /> Check for updates on launch
        </label>
      </div>
    </Modal>
  )
}
