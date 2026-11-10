import { useEffect, useState } from 'react'
import { ConnectionConfig, newConnectionConfig } from '@shared/types'
import { actions, useAppState } from '../store'
import Modal from './Modal'

// ---------------------------------------------------------------------------------------------
// Connection manager — the list Robo3T shows on startup / File > Connect
// ---------------------------------------------------------------------------------------------
export function ConnectionManager({ onClose }: { onClose: () => void }): JSX.Element {
  const connections = useAppState((s) => s.connections)
  const sessions = useAppState((s) => s.sessions)
  const [selected, setSelected] = useState<string | null>(connections[0]?.id ?? null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (selected && !connections.some((c) => c.id === selected)) setSelected(connections[0]?.id ?? null)
  }, [connections, selected])

  const current = connections.find((c) => c.id === selected)

  const connect = async (id: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await actions.connect(id)
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const describe = (c: ConnectionConfig): string => {
    if (c.type === 'uri') return c.uri.replace(/\/\/([^@]+)@/, '//***@')
    if (c.type === 'replicaSet') return c.members.map((m) => `${m.host}:${m.port}`).join(',')
    return `${c.host}:${c.port}${c.ssh.enabled ? ' (via SSH)' : ''}`
  }

  return (
    <Modal
      title="MongoDB Connections"
      onClose={onClose}
      width={640}
      footer={
        <>
          {error && <span className="error">{error}</span>}
          <button className="tbtn" onClick={onClose}>
            Cancel
          </button>
          <button className="tbtn primary" disabled={!current || busy} onClick={() => current && void connect(current.id)}>
            {busy ? 'Connecting…' : 'Connect'}
          </button>
        </>
      }
    >
      <div className="row" style={{ display: 'flex', gap: 6 }}>
        <button className="tbtn" onClick={() => actions.openModal('connectionDialog', {})}>
          Create
        </button>
        <button className="tbtn" disabled={!current} onClick={() => current && actions.openModal('connectionDialog', { connectionId: current.id })}>
          Edit
        </button>
        <button
          className="tbtn"
          disabled={!current}
          onClick={() =>
            current &&
            actions.openModal('connectionDialog', {
              clone: { ...current, id: '', name: `${current.name} (copy)` }
            })
          }
        >
          Clone
        </button>
        <button className="tbtn" style={{ marginLeft: 'auto' }} onClick={() => actions.openModal('importRobo3T')} title="Import connections from a Robo3T config file">
          Import Robo3T…
        </button>
        <button
          className="tbtn danger"
          disabled={!current}
          onClick={async () => {
            if (!current) return
            if (await window.api.ui.confirm('Remove', `Remove connection "${current.name}"?`)) {
              await window.api.connections.remove(current.id)
              await actions.loadConnections()
            }
          }}
        >
          Remove
        </button>
      </div>
      <div className="list">
        {connections.length === 0 && <div className="item hint">No saved connections. Click Create to add one.</div>}
        {connections.map((c) => (
          <div
            key={c.id}
            className={`item${c.id === selected ? ' selected' : ''}`}
            onClick={() => setSelected(c.id)}
            onDoubleClick={() => void connect(c.id)}
          >
            <span style={{ color: sessions[c.id]?.state === 'connected' ? 'var(--ok)' : '#aaa' }}>●</span>
            <span>{c.name}</span>
            <span className="sub">{describe(c)}</span>
          </div>
        ))}
      </div>
      <div className="hint">Double-click a connection to connect. Connections are stored encrypted in your user data folder.</div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------------
// Connection editor
// ---------------------------------------------------------------------------------------------
type TabName = 'Connection' | 'Authentication' | 'SSH' | 'TLS' | 'Advanced'

export function ConnectionDialog({
  connectionId,
  clone,
  onClose
}: {
  connectionId?: string
  clone?: ConnectionConfig
  onClose: () => void
}): JSX.Element {
  const connections = useAppState((s) => s.connections)
  const existing = connectionId ? connections.find((c) => c.id === connectionId) : undefined
  const [cfg, setCfg] = useState<ConnectionConfig>(() => clone ?? existing ?? newConnectionConfig())
  const [tab, setTab] = useState<TabName>('Connection')
  const [status, setStatus] = useState<{ ok?: string; error?: string }>({})
  const [busy, setBusy] = useState(false)

  const patch = (p: Partial<ConnectionConfig>): void => setCfg((c) => ({ ...c, ...p }))
  const patchAuth = (p: Partial<ConnectionConfig['auth']>): void => setCfg((c) => ({ ...c, auth: { ...c.auth, ...p } }))
  const patchSsh = (p: Partial<ConnectionConfig['ssh']>): void => setCfg((c) => ({ ...c, ssh: { ...c.ssh, ...p } }))
  const patchTls = (p: Partial<ConnectionConfig['tls']>): void => setCfg((c) => ({ ...c, tls: { ...c.tls, ...p } }))
  const patchAdv = (p: Partial<ConnectionConfig['advanced']>): void => setCfg((c) => ({ ...c, advanced: { ...c.advanced, ...p } }))

  const test = async (): Promise<void> => {
    setBusy(true)
    setStatus({})
    try {
      const info = await window.api.connections.test(cfg)
      setStatus({ ok: `Connected: MongoDB ${info.version} (${info.topology}${info.replicaSet ? ` ${info.replicaSet}` : ''})` })
    } catch (err) {
      setStatus({ error: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.api.connections.save(cfg)
      await actions.loadConnections()
      onClose()
    } catch (err) {
      setStatus({ error: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const pickFile = async (set: (p: string) => void): Promise<void> => {
    const p = await window.api.ui.openFile()
    if (p) set(p)
  }

  const tabs: TabName[] = ['Connection', 'Authentication', 'SSH', 'TLS', 'Advanced']

  return (
    <Modal
      title={existing ? 'Edit Connection' : 'Create Connection'}
      onClose={onClose}
      width={620}
      footer={
        <>
          <div className="left">
            <button className="tbtn" onClick={() => void test()} disabled={busy}>
              Test
            </button>
            {status.ok && <span className="ok">{status.ok}</span>}
            {status.error && <span className="error">{status.error}</span>}
          </div>
          <button className="tbtn" onClick={onClose}>
            Cancel
          </button>
          <button className="tbtn primary" onClick={() => void save()} disabled={busy || !cfg.name.trim()}>
            Save
          </button>
        </>
      }
    >
      <div className="dialog-tabs">
        {tabs.map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t}
            {t === 'Authentication' && cfg.auth.enabled ? ' ●' : ''}
            {t === 'SSH' && cfg.ssh.enabled ? ' ●' : ''}
            {t === 'TLS' && cfg.tls.enabled ? ' ●' : ''}
          </button>
        ))}
      </div>

      {tab === 'Connection' && (
        <div className="form">
          <label>Name</label>
          <input type="text" value={cfg.name} onChange={(e) => patch({ name: e.target.value })} autoFocus />
          <label>Type</label>
          <select value={cfg.type} onChange={(e) => patch({ type: e.target.value as ConnectionConfig['type'] })}>
            <option value="direct">Direct Connection</option>
            <option value="replicaSet">Replica Set</option>
            <option value="uri">Connection String (URI)</option>
          </select>
          {cfg.type === 'direct' && (
            <>
              <label>Address</label>
              <div className="row">
                <input type="text" value={cfg.host} onChange={(e) => patch({ host: e.target.value })} placeholder="localhost" />
                <span>:</span>
                <input type="number" style={{ width: 90 }} value={cfg.port} onChange={(e) => patch({ port: Number(e.target.value) || 27017 })} />
              </div>
            </>
          )}
          {cfg.type === 'replicaSet' && (
            <>
              <label>Members</label>
              <div>
                {cfg.members.map((m, i) => (
                  <div className="row" key={i} style={{ marginBottom: 4 }}>
                    <input
                      type="text"
                      value={m.host}
                      onChange={(e) => patch({ members: cfg.members.map((x, j) => (j === i ? { ...x, host: e.target.value } : x)) })}
                    />
                    <span>:</span>
                    <input
                      type="number"
                      style={{ width: 90 }}
                      value={m.port}
                      onChange={(e) => patch({ members: cfg.members.map((x, j) => (j === i ? { ...x, port: Number(e.target.value) || 27017 } : x)) })}
                    />
                    <button className="tbtn small" onClick={() => patch({ members: cfg.members.filter((_, j) => j !== i) })}>
                      −
                    </button>
                  </div>
                ))}
                <button className="tbtn small" onClick={() => patch({ members: [...cfg.members, { host: 'localhost', port: 27017 }] })}>
                  + Add member
                </button>
              </div>
              <label>Set name</label>
              <input type="text" value={cfg.replicaSetName} onChange={(e) => patch({ replicaSetName: e.target.value })} placeholder="optional" />
            </>
          )}
          {cfg.type === 'uri' && (
            <>
              <label>URI</label>
              <input
                type="text"
                value={cfg.uri}
                onChange={(e) => patch({ uri: e.target.value })}
                placeholder="mongodb://user:pass@host:27017/?authSource=admin  or  mongodb+srv://…"
              />
              <span />
              <span className="hint">Authentication, TLS and SSH tabs are ignored for URI connections; put everything in the URI.</span>
            </>
          )}
        </div>
      )}

      {tab === 'Authentication' && (
        <div className="form">
          <span />
          <label className="check" style={{ textAlign: 'left' }}>
            <input type="checkbox" checked={cfg.auth.enabled} onChange={(e) => patchAuth({ enabled: e.target.checked })} /> Perform authentication
          </label>
          <label>Database</label>
          <input type="text" disabled={!cfg.auth.enabled} value={cfg.auth.database} onChange={(e) => patchAuth({ database: e.target.value })} placeholder="admin" />
          <label>User name</label>
          <input type="text" disabled={!cfg.auth.enabled} value={cfg.auth.username} onChange={(e) => patchAuth({ username: e.target.value })} />
          <label>Password</label>
          <input type="password" disabled={!cfg.auth.enabled} value={cfg.auth.password} onChange={(e) => patchAuth({ password: e.target.value })} />
          <label>Mechanism</label>
          <select disabled={!cfg.auth.enabled} value={cfg.auth.mechanism} onChange={(e) => patchAuth({ mechanism: e.target.value as ConnectionConfig['auth']['mechanism'] })}>
            <option value="">Default (SCRAM)</option>
            <option value="SCRAM-SHA-256">SCRAM-SHA-256</option>
            <option value="SCRAM-SHA-1">SCRAM-SHA-1</option>
            <option value="MONGODB-X509">MONGODB-X509</option>
            <option value="PLAIN">PLAIN (LDAP)</option>
            <option value="MONGODB-AWS">MONGODB-AWS</option>
          </select>
        </div>
      )}

      {tab === 'SSH' && (
        <div className="form">
          <span />
          <label className="check" style={{ textAlign: 'left' }}>
            <input type="checkbox" checked={cfg.ssh.enabled} onChange={(e) => patchSsh({ enabled: e.target.checked })} /> Use SSH tunnel
          </label>
          <label>SSH Address</label>
          <div className="row">
            <input type="text" disabled={!cfg.ssh.enabled} value={cfg.ssh.host} onChange={(e) => patchSsh({ host: e.target.value })} />
            <span>:</span>
            <input type="number" style={{ width: 90 }} disabled={!cfg.ssh.enabled} value={cfg.ssh.port} onChange={(e) => patchSsh({ port: Number(e.target.value) || 22 })} />
          </div>
          <label>SSH User name</label>
          <input type="text" disabled={!cfg.ssh.enabled} value={cfg.ssh.username} onChange={(e) => patchSsh({ username: e.target.value })} />
          <label>Auth method</label>
          <select disabled={!cfg.ssh.enabled} value={cfg.ssh.method} onChange={(e) => patchSsh({ method: e.target.value as 'password' | 'privateKey' })}>
            <option value="password">Password</option>
            <option value="privateKey">Private Key</option>
          </select>
          {cfg.ssh.method === 'password' ? (
            <>
              <label>Password</label>
              <input type="password" disabled={!cfg.ssh.enabled} value={cfg.ssh.password} onChange={(e) => patchSsh({ password: e.target.value })} />
            </>
          ) : (
            <>
              <label>Private key</label>
              <div className="row">
                <input type="text" disabled={!cfg.ssh.enabled} value={cfg.ssh.privateKeyPath} onChange={(e) => patchSsh({ privateKeyPath: e.target.value })} placeholder="~/.ssh/id_ed25519" />
                <button className="tbtn small" disabled={!cfg.ssh.enabled} onClick={() => void pickFile((p) => patchSsh({ privateKeyPath: p }))}>
                  …
                </button>
              </div>
              <label>Passphrase</label>
              <input type="password" disabled={!cfg.ssh.enabled} value={cfg.ssh.passphrase} onChange={(e) => patchSsh({ passphrase: e.target.value })} />
            </>
          )}
          <span />
          <span className="hint">The MongoDB address on the Connection tab is resolved from the SSH server's point of view (e.g. localhost:27017).</span>
        </div>
      )}

      {tab === 'TLS' && (
        <div className="form">
          <span />
          <label className="check" style={{ textAlign: 'left' }}>
            <input type="checkbox" checked={cfg.tls.enabled} onChange={(e) => patchTls({ enabled: e.target.checked })} /> Use TLS / SSL
          </label>
          <label>CA file</label>
          <div className="row">
            <input type="text" disabled={!cfg.tls.enabled} value={cfg.tls.caFile} onChange={(e) => patchTls({ caFile: e.target.value })} placeholder="optional" />
            <button className="tbtn small" disabled={!cfg.tls.enabled} onClick={() => void pickFile((p) => patchTls({ caFile: p }))}>
              …
            </button>
          </div>
          <label>Client cert (PEM)</label>
          <div className="row">
            <input type="text" disabled={!cfg.tls.enabled} value={cfg.tls.certFile} onChange={(e) => patchTls({ certFile: e.target.value })} placeholder="optional" />
            <button className="tbtn small" disabled={!cfg.tls.enabled} onClick={() => void pickFile((p) => patchTls({ certFile: p }))}>
              …
            </button>
          </div>
          <label>Client key (PEM)</label>
          <div className="row">
            <input type="text" disabled={!cfg.tls.enabled} value={cfg.tls.keyFile} onChange={(e) => patchTls({ keyFile: e.target.value })} placeholder="optional, if separate from cert" />
            <button className="tbtn small" disabled={!cfg.tls.enabled} onClick={() => void pickFile((p) => patchTls({ keyFile: p }))}>
              …
            </button>
          </div>
          <label>Key password</label>
          <input type="password" disabled={!cfg.tls.enabled} value={cfg.tls.keyPassword} onChange={(e) => patchTls({ keyPassword: e.target.value })} />
          <span />
          <label className="check" style={{ textAlign: 'left' }}>
            <input type="checkbox" disabled={!cfg.tls.enabled} checked={cfg.tls.allowInvalidCertificates} onChange={(e) => patchTls({ allowInvalidCertificates: e.target.checked })} />
            Allow invalid certificates
          </label>
          <span />
          <label className="check" style={{ textAlign: 'left' }}>
            <input type="checkbox" disabled={!cfg.tls.enabled} checked={cfg.tls.allowInvalidHostnames} onChange={(e) => patchTls({ allowInvalidHostnames: e.target.checked })} />
            Allow invalid hostnames
          </label>
        </div>
      )}

      {tab === 'Advanced' && (
        <div className="form">
          <label>Default database</label>
          <input type="text" value={cfg.advanced.defaultDatabase} onChange={(e) => patchAdv({ defaultDatabase: e.target.value })} placeholder="used for new shell tabs" />
          <label>Connect timeout (ms)</label>
          <input type="number" value={cfg.advanced.connectTimeoutMs} onChange={(e) => patchAdv({ connectTimeoutMs: Number(e.target.value) || 10000 })} />
          <label>Read preference</label>
          <select value={cfg.advanced.readPreference} onChange={(e) => patchAdv({ readPreference: e.target.value as ConnectionConfig['advanced']['readPreference'] })}>
            <option value="">Default</option>
            <option value="primary">primary</option>
            <option value="primaryPreferred">primaryPreferred</option>
            <option value="secondary">secondary</option>
            <option value="secondaryPreferred">secondaryPreferred</option>
            <option value="nearest">nearest</option>
          </select>
        </div>
      )}
    </Modal>
  )
}
