import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import './ApiKeys.css'

interface ApiKey {
  keyId: string
  name: string
  createdAt: number
  lastUsedAt?: number
  expiresAt?: number
}

function ApiKeys() {
  const { isAuthenticated, getAuthHeaders } = useAuth()
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newExpires, setNewExpires] = useState('')
  const [createdToken, setCreatedToken] = useState('')
  const [status, setStatus] = useState('')

  const loadKeys = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/api-keys', { headers: getAuthHeaders() })
      const data = await res.json()
      if (data.success && data.keys) {
        setKeys(data.keys)
      }
    } catch (error) {
      console.error('Failed to load API keys:', error)
    } finally {
      setLoading(false)
    }
  }, [getAuthHeaders])

  useEffect(() => {
    if (isAuthenticated) {
      loadKeys()
    } else {
      setLoading(false)
    }
  }, [isAuthenticated, loadKeys])

  const createKey = async () => {
    if (!newName.trim()) {
      setStatus('Name is required')
      return
    }
    try {
      const body: { name: string; expiresInDays?: number } = { name: newName.trim() }
      if (newExpires) {
        body.expiresInDays = parseInt(newExpires, 10)
      }
      const res = await fetch('/api/v1/api-keys', {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await res.json()
      if (data.success && data.token) {
        setCreatedToken(data.token)
        setNewName('')
        setNewExpires('')
        setShowCreate(false)
        loadKeys()
      } else {
        setStatus(data.error || 'Failed to create key')
      }
    } catch {
      setStatus('Failed to create key')
    }
  }

  const revokeKey = async (keyId: string) => {
    if (!confirm('Revoke this API key? This cannot be undone.')) return
    try {
      const res = await fetch(`/api/v1/api-keys/${keyId}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      })
      const data = await res.json()
      if (data.success) {
        loadKeys()
      }
    } catch {
      console.error('Failed to revoke key')
    }
  }

  const formatDate = (ts: number) => new Date(ts).toLocaleDateString()
  const isExpired = (key: ApiKey) => key.expiresAt && Date.now() > key.expiresAt

  if (!isAuthenticated) {
    return (
      <div className="apikeys-auth card">
        <span>🔒</span>
        <h3>Authentication Required</h3>
        <p>Enter admin password in Settings to manage API keys.</p>
      </div>
    )
  }

  return (
    <div className="apikeys-page">
      <div className="apikeys-header card">
        <div>
          <h2>🔑 API Keys</h2>
          <p>Manage API keys for programmatic access</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          + Create Key
        </button>
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="apikeys-modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="apikeys-modal card" onClick={e => e.stopPropagation()}>
            <h3>Create API Key</h3>
            <div className="apikeys-form">
              <label>Key Name</label>
              <input
                type="text"
                className="input"
                placeholder="e.g., My App Key"
                value={newName}
                onChange={e => setNewName(e.target.value)}
              />
              <label>Expires In Days (optional)</label>
              <input
                type="number"
                className="input"
                placeholder="e.g., 30"
                value={newExpires}
                onChange={e => setNewExpires(e.target.value)}
                min="1"
              />
              {status && <p className="apikeys-status error">{status}</p>}
              <div className="apikeys-modal-actions">
                <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={createKey}>Create</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Token Display */}
      {createdToken && (
        <div className="card apikeys-token-display">
          <h4>🎉 Key Created!</h4>
          <p>Save this token - you won't see it again:</p>
          <code>{createdToken}</code>
          <div className="apikeys-modal-actions">
            <button className="btn btn-secondary" onClick={() => navigator.clipboard.writeText(createdToken)}>
              📋 Copy
            </button>
            <button className="btn btn-primary" onClick={() => setCreatedToken('')}>Done</button>
          </div>
        </div>
      )}

      {/* Keys List */}
      {loading ? (
        <div className="apikeys-loading">Loading...</div>
      ) : keys.length === 0 ? (
        <div className="apikeys-empty card">
          <span>🔐</span>
          <h3>No API Keys</h3>
          <p>Create your first API key to get started</p>
        </div>
      ) : (
        <div className="apikeys-list">
          {keys.map(key => (
            <div key={key.keyId} className={`apikeys-card card ${isExpired(key) ? 'expired' : ''}`}>
              <div className="apikeys-card-header">
                <div>
                  <strong>{key.name}</strong>
                  {isExpired(key) && <span className="apikeys-badge error">Expired</span>}
                </div>
                <button className="btn btn-secondary" style={{ color: 'var(--color-error)' }} onClick={() => revokeKey(key.keyId)}>
                  Revoke
                </button>
              </div>
              <div className="apikeys-card-meta">
                <span>ID: <code>{key.keyId}</code></span>
                <span>Created: {formatDate(key.createdAt)}</span>
                <span>Last Used: {key.lastUsedAt ? formatDate(key.lastUsedAt) : 'Never'}</span>
                <span>Expires: {key.expiresAt ? formatDate(key.expiresAt) : 'Never'}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default ApiKeys
