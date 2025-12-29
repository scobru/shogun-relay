import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'

interface ApiKey {
  keyId: string; name: string; createdAt: number; lastUsedAt?: number; expiresAt?: number
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
      if (data.success && data.keys) setKeys(data.keys)
    } catch (error) { console.error('Failed to load API keys:', error) }
    finally { setLoading(false) }
  }, [getAuthHeaders])

  useEffect(() => { if (isAuthenticated) loadKeys(); else setLoading(false) }, [isAuthenticated, loadKeys])

  const createKey = async () => {
    if (!newName.trim()) { setStatus('Name is required'); return }
    try {
      const body: { name: string; expiresInDays?: number } = { name: newName.trim() }
      if (newExpires) body.expiresInDays = parseInt(newExpires, 10)
      const res = await fetch('/api/v1/api-keys', {
        method: 'POST', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      })
      const data = await res.json()
      if (data.success && data.token) { setCreatedToken(data.token); setNewName(''); setNewExpires(''); setShowCreate(false); loadKeys() }
      else setStatus(data.error || 'Failed to create key')
    } catch { setStatus('Failed to create key') }
  }

  const revokeKey = async (keyId: string) => {
    if (!confirm('Revoke this API key?')) return
    try { const res = await fetch(`/api/v1/api-keys/${keyId}`, { method: 'DELETE', headers: getAuthHeaders() }); const data = await res.json(); if (data.success) loadKeys() }
    catch { console.error('Failed to revoke key') }
  }

  const formatDate = (ts: number) => new Date(ts).toLocaleDateString()
  const isExpired = (key: ApiKey) => key.expiresAt && Date.now() > key.expiresAt

  if (!isAuthenticated) {
    return <div className="alert alert-warning"><span className="text-2xl">🔒</span><div><h3 className="font-bold">Authentication Required</h3><p>Enter admin password in Settings to manage API keys.</p></div></div>
  }

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      {/* Header */}
      <div className="card bg-base-100 shadow">
        <div className="card-body flex-row items-center justify-between">
          <div>
            <h2 className="card-title">🔑 API Keys</h2>
            <p className="text-base-content/60">Manage API keys for programmatic access</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Create Key</button>
        </div>
      </div>

      {/* Create Modal */}
      {showCreate && (
        <dialog className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">Create API Key</h3>
            <div className="form-control mt-4">
              <label className="label"><span className="label-text">Key Name</span></label>
              <input type="text" className="input input-bordered" placeholder="e.g., My App Key" value={newName} onChange={e => setNewName(e.target.value)} />
            </div>
            <div className="form-control mt-4">
              <label className="label"><span className="label-text">Expires In Days (optional)</span></label>
              <input type="number" className="input input-bordered" placeholder="e.g., 30" value={newExpires} onChange={e => setNewExpires(e.target.value)} min="1" />
            </div>
            {status && <div className="alert alert-error mt-4"><span>{status}</span></div>}
            <div className="modal-action">
              <button className="btn" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={createKey}>Create</button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop"><button onClick={() => setShowCreate(false)}>close</button></form>
        </dialog>
      )}

      {/* Token Display */}
      {createdToken && (
        <div className="alert alert-success">
          <div className="flex-1">
            <h4 className="font-bold">🎉 Key Created!</h4>
            <p className="text-sm">Save this token - you won't see it again:</p>
            <code className="bg-base-300 p-2 rounded block mt-2 text-xs break-all">{createdToken}</code>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-sm" onClick={() => navigator.clipboard.writeText(createdToken)}>📋 Copy</button>
            <button className="btn btn-sm btn-primary" onClick={() => setCreatedToken('')}>Done</button>
          </div>
        </div>
      )}

      {/* Keys List */}
      {loading ? (
        <div className="flex justify-center p-8"><span className="loading loading-spinner loading-lg"></span></div>
      ) : keys.length === 0 ? (
        <div className="card bg-base-100 shadow">
          <div className="card-body items-center text-center">
            <span className="text-4xl">🔐</span>
            <h3 className="card-title">No API Keys</h3>
            <p className="text-base-content/60">Create your first API key to get started</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {keys.map(key => (
            <div key={key.keyId} className={`card bg-base-100 shadow ${isExpired(key) ? 'opacity-50' : ''}`}>
              <div className="card-body">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <strong>{key.name}</strong>
                    {isExpired(key) && <span className="badge badge-error">Expired</span>}
                  </div>
                  <button className="btn btn-error btn-sm btn-outline" onClick={() => revokeKey(key.keyId)}>Revoke</button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2 text-sm text-base-content/60">
                  <span>ID: <code>{key.keyId}</code></span>
                  <span>Created: {formatDate(key.createdAt)}</span>
                  <span>Last Used: {key.lastUsedAt ? formatDate(key.lastUsedAt) : 'Never'}</span>
                  <span>Expires: {key.expiresAt ? formatDate(key.expiresAt) : 'Never'}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default ApiKeys
