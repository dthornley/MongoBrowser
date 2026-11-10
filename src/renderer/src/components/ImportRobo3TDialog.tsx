import { useEffect, useState } from 'react'
import { ConnectionConfig, Robo3TImportPreview } from '@shared/types'
import { actions, useAppState } from '../store'
import Modal from './Modal'

function describe(c: ConnectionConfig): string {
  const parts: string[] = []
  parts.push(c.type === 'replicaSet' ? `${c.replicaSetName || 'replica set'}: ${c.members.map((m) => `${m.host}:${m.port}`).join(', ')}` : `${c.host}:${c.port}`)
  if (c.auth.enabled) parts.push(`auth ${c.auth.username}@${c.auth.database}`)
  if (c.ssh.enabled) parts.push(`ssh ${c.ssh.username}@${c.ssh.host}`)
  if (c.tls.enabled) parts.push('tls')
  return parts.join(' · ')
}

export function ImportRobo3TDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const existing = useAppState((s) => s.connections)
  const [candidates, setCandidates] = useState<string[]>([])
  const [preview, setPreview] = useState<Robo3TImportPreview | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<number | null>(null)

  const load = async (path: string, keyPath?: string): Promise<void> => {
    setError(null)
    setDone(null)
    try {
      const p = await window.api.connections.previewRobo3T(path, keyPath)
      setPreview(p)
      setSelected(new Set(p.connections.map((_, i) => i)))
    } catch (err) {
      setPreview(null)
      setError((err as Error).message)
    }
  }

  useEffect(() => {
    void window.api.connections.findRobo3T().then((list) => {
      setCandidates(list)
      if (list[0]) void load(list[0])
    })
  }, [])

  const browse = async (): Promise<void> => {
    const p = await window.api.ui.openFile([{ name: 'Robo3T config', extensions: ['json'] }])
    if (p) await load(p)
  }
  const browseKey = async (): Promise<void> => {
    if (!preview) return
    const p = await window.api.ui.openFile([{ name: 'Robo3T key', extensions: ['key'] }])
    if (p) await load(preview.path, p)
  }

  const toggle = (i: number): void =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(i)) n.delete(i)
      else n.add(i)
      return n
    })

  const duplicate = (c: ConnectionConfig): boolean => existing.some((e) => e.name === c.name)

  const doImport = async (): Promise<void> => {
    if (!preview) return
    setBusy(true)
    try {
      let n = 0
      for (const [i, c] of preview.connections.entries()) {
        if (!selected.has(i)) continue
        await window.api.connections.save({ ...c, id: '' })
        n++
      }
      await actions.loadConnections()
      actions.log(`Imported ${n} connection${n === 1 ? '' : 's'} from ${preview.path}`)
      setDone(n)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Import Robo3T Connections"
      onClose={onClose}
      width={640}
      footer={
        <>
          {error && <span className="error">{error}</span>}
          {done !== null && <span className="ok">Imported {done} connection{done === 1 ? '' : 's'}.</span>}
          <button className="tbtn" onClick={onClose}>
            {done !== null ? 'Close' : 'Cancel'}
          </button>
          {done === null && (
            <button className="tbtn primary" disabled={!preview || selected.size === 0 || busy} onClick={() => void doImport()}>
              Import {selected.size > 0 ? `(${selected.size})` : ''}
            </button>
          )}
        </>
      }
    >
      <div className="form">
        <label>Config file</label>
        <div className="row">
          <input type="text" value={preview?.path ?? ''} readOnly placeholder="No Robo3T config found — click … to choose one" />
          <button className="tbtn small" onClick={() => void browse()}>
            …
          </button>
        </div>
        {candidates.length > 1 && (
          <>
            <label>Found</label>
            <select value={preview?.path ?? ''} onChange={(e) => void load(e.target.value)}>
              {candidates.map((c) => (
                <option key={c} value={c}>
                  {c.replace(/^\/Users\/[^/]+/, '~')}
                </option>
              ))}
            </select>
          </>
        )}
        <label>Key file</label>
        <div className="row">
          <input type="text" value={preview?.keyPath ?? ''} readOnly placeholder="robo3t.key (needed to decrypt saved passwords)" />
          <button className="tbtn small" disabled={!preview} onClick={() => void browseKey()}>
            …
          </button>
        </div>
      </div>
      <div className="hint">
        Robo3T keeps its connections in <code>~/.3T/robo-3t/&lt;version&gt;/robo3t.json</code> and the password key in{' '}
        <code>~/.3T/robo-3t/robo3t.key</code>. Copy both from your old Mac, or pick them with …
      </div>
      {preview && preview.missingSecrets.length > 0 && (
        <div className="result-error" style={{ margin: 0 }}>
          {preview.needsKey
            ? `No robo3t.key found, so saved passwords can't be decrypted. Choose the key file above, or import now and enter passwords by hand for: ${preview.missingSecrets.join(', ')}`
            : `Passwords for ${preview.missingSecrets.join(', ')} could not be decrypted with this key (wrong robo3t.key?). They will be imported without a password.`}
        </div>
      )}
      <div className="list">
        {!preview && <div className="item hint">Nothing loaded.</div>}
        {preview?.connections.length === 0 && <div className="item hint">The file has no connections.</div>}
        {preview?.connections.map((c, i) => (
          <label key={i} className={`item${selected.has(i) ? ' selected' : ''}`} style={{ cursor: 'default' }}>
            <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} disabled={done !== null} />
            <span>
              {c.name}
              {duplicate(c) && (
                <span className="hint" style={{ marginLeft: 6 }}>
                  (a connection with this name already exists)
                </span>
              )}
            </span>
            <span className="sub">{describe(c)}</span>
          </label>
        ))}
      </div>
    </Modal>
  )
}
