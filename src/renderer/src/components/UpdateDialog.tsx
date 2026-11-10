import { useEffect, useState } from 'react'
import { UpdateStatus } from '@shared/types'
import { actions, useAppState } from '../store'
import Modal from './Modal'

export function UpdateDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const status = useAppState((s) => s.update)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    if (!checked) {
      setChecked(true)
      // don't re-check when opened from the "Update available" pill; the answer is already known
      if (status.state === 'idle' || status.state === 'none' || status.state === 'error') void window.api.updates.check()
    }
  }, [checked, status.state])

  const body = (s: UpdateStatus): JSX.Element => {
    switch (s.state) {
      case 'checking':
        return <div>Checking for updates…</div>
      case 'none':
        return (
          <div>
            You're up to date. <b>MongoBrowser {s.current}</b> is the latest version.
          </div>
        )
      case 'available':
        return (
          <>
            <div>
              <b>MongoBrowser {s.latest}</b> is available (you have {s.current}).
            </div>
            {s.notes && <pre className="notes">{s.notes}</pre>}
          </>
        )
      case 'downloading':
        return (
          <div>
            Downloading {s.latest}… {s.percent ?? 0}%
            <div className="progress">
              <div style={{ width: `${s.percent ?? 0}%` }} />
            </div>
          </div>
        )
      case 'downloaded':
        return (
          <div>
            <b>MongoBrowser {s.latest}</b> has been downloaded. Restart to install it.
          </div>
        )
      case 'error':
        return (
          <div className="error-text">{s.error}</div>
        )
      default:
        return <div>Current version: {s.current}</div>
    }
  }

  return (
    <Modal
      title="Software Update"
      onClose={onClose}
      width={520}
      footer={
        <>
          <div className="left">
            <button className="tbtn" onClick={() => void window.api.updates.openReleases()}>
              Release notes…
            </button>
            {status.state === 'error' && (
              <button className="tbtn" onClick={() => (onClose(), actions.openModal('preferences'))}>
                Preferences…
              </button>
            )}
          </div>
          {status.state === 'available' && (
            <button className="tbtn primary" onClick={() => void window.api.updates.download()}>
              Update
            </button>
          )}
          {status.state === 'downloaded' && (
            <button className="tbtn primary" onClick={() => void window.api.updates.install()}>
              Restart &amp; Install
            </button>
          )}
          {(status.state === 'none' || status.state === 'error') && (
            <button className="tbtn" onClick={() => void window.api.updates.check()}>
              Check again
            </button>
          )}
          <button className="tbtn" onClick={onClose}>
            {status.state === 'downloaded' ? 'Later' : 'Close'}
          </button>
        </>
      }
    >
      <div className="update-body">{body(status)}</div>
    </Modal>
  )
}
