import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import './Files.css'

interface Pin {
  cid: string
  type: string
  name?: string
}

function Files() {
  const { isAuthenticated, getAuthHeaders } = useAuth()
  const [pins, setPins] = useState<Pin[]>([])
  const [loading, setLoading] = useState(true)
  const [newCid, setNewCid] = useState('')

  useEffect(() => {
    if (isAuthenticated) {
      loadPins()
    } else {
      setLoading(false)
    }
  }, [isAuthenticated])

  async function loadPins() {
    try {
      const res = await fetch('/api/v1/ipfs/pin/ls', { headers: getAuthHeaders() })
      const data = await res.json()
      if (data.pins) {
        const pinList = Object.entries(data.pins).map(([cid, info]: [string, any]) => ({
          cid,
          type: info.Type || 'recursive',
          name: info.Name || ''
        }))
        setPins(pinList)
      }
    } catch (error) {
      console.error('Failed to load pins:', error)
    } finally {
      setLoading(false)
    }
  }

  async function addPin() {
    if (!newCid.trim()) return
    try {
      const res = await fetch('/api/v1/ipfs/pin/add', {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ cid: newCid.trim() })
      })
      if (res.ok) {
        setNewCid('')
        loadPins()
      }
    } catch (error) {
      console.error('Failed to add pin:', error)
    }
  }

  async function removePin(cid: string) {
    if (!confirm(`Remove pin ${cid.slice(0, 16)}...?`)) return
    try {
      await fetch('/api/v1/ipfs/pin/rm', {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ cid })
      })
      loadPins()
    } catch (error) {
      console.error('Failed to remove pin:', error)
    }
  }

  if (!isAuthenticated) {
    return (
      <div className="files-auth card">
        <span className="files-auth-icon">🔒</span>
        <h3>Authentication Required</h3>
        <p>Please enter admin password in Settings to access file management.</p>
      </div>
    )
  }

  if (loading) {
    return <div className="files-loading">Loading pins...</div>
  }

  return (
    <div className="files-page">
      {/* Quick Add */}
      <div className="files-add card">
        <h3>📌 Quick Add Pin</h3>
        <div className="files-add-row">
          <input
            type="text"
            className="input"
            placeholder="Enter IPFS CID (Qm... or ba...)"
            value={newCid}
            onChange={(e) => setNewCid(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && addPin()}
          />
          <button className="btn btn-primary" onClick={addPin}>Add Pin</button>
        </div>
      </div>

      {/* Stats */}
      <div className="files-stats">
        <span>Total Pins: <strong>{pins.length}</strong></span>
        <button className="btn btn-secondary" onClick={loadPins}>🔄 Refresh</button>
      </div>

      {/* Pins Grid */}
      {pins.length === 0 ? (
        <div className="files-empty card">
          <span>📁</span>
          <h3>No pins found</h3>
          <p>Add your first IPFS pin to get started</p>
        </div>
      ) : (
        <div className="files-grid">
          {pins.map(pin => (
            <div key={pin.cid} className="file-card card">
              <div className="file-cid">{pin.cid}</div>
              <div className="file-meta">
                <span className="file-type">{pin.type}</span>
                {pin.name && <span className="file-name">{pin.name}</span>}
              </div>
              <div className="file-actions">
                <button 
                  className="btn btn-secondary" 
                  onClick={() => navigator.clipboard.writeText(pin.cid)}
                >
                  📋 Copy
                </button>
                <button 
                  className="btn btn-secondary"
                  onClick={() => window.open(`/ipfs/${pin.cid}`, '_blank')}
                >
                  🌐 Open
                </button>
                <button 
                  className="btn btn-secondary"
                  onClick={() => removePin(pin.cid)}
                  style={{ color: 'var(--color-error)' }}
                >
                  🗑️
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default Files
