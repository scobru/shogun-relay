import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'

interface StorageStats {
  total: { formatted: string; mb: number; gb: number }
  data: { formatted: string; files: number }
  radata: { formatted: string; files: number; description: string }
  breakdown: {
    torrents: { formatted: string; files: number }
    ipfs: { formatted: string; files: number }
    gundb: { formatted: string; files: number }
    deals: { formatted: string; files: number }
  }
}

interface RelayKeys {
  pub: string
  priv: string
  epub: string
  epriv: string
}

function Settings() {
  const { isAuthenticated, login, logout, getAuthHeaders } = useAuth()
  const { theme, setTheme } = useTheme()
  const [newPassword, setNewPassword] = useState('')

  // Relay Keys State
  const [relayKeys, setRelayKeys] = useState<RelayKeys | null>(null)
  const [loadingKeys, setLoadingKeys] = useState(false)
  const [showKeys, setShowKeys] = useState(false)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  // Storage Stats State
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null)
  const [loadingStorage, setLoadingStorage] = useState(false)

  useEffect(() => {
    if (isAuthenticated) {
      fetchRelayKeys()
      fetchStorageStats()
    }
  }, [isAuthenticated])

  const fetchRelayKeys = async () => {
    setLoadingKeys(true)
    try {
      const res = await fetch('/api/v1/admin/relay-keys', { headers: getAuthHeaders() })
      const data = await res.json()
      if (data.success) setRelayKeys(data.keys)
    } catch (e) { console.error('Failed to fetch relay keys:', e) }
    finally { setLoadingKeys(false) }
  }

  const fetchStorageStats = async () => {
    setLoadingStorage(true)
    try {
      const res = await fetch('/api/v1/admin/storage-stats', { headers: getAuthHeaders() })
      const data = await res.json()
      if (data.success) setStorageStats(data.storage)
    } catch (e) { console.error('Failed to fetch storage stats:', e) }
    finally { setLoadingStorage(false) }
  }

  const copyToClipboard = async (text: string, keyName: string) => {
    await navigator.clipboard.writeText(text)
    setCopiedKey(keyName)
    setTimeout(() => setCopiedKey(null), 2000)
  }

  const maskKey = (key: string) => {
    if (showKeys) return key
    return key.substring(0, 8) + '••••••••••••••••' + key.substring(key.length - 8)
  }

  const handleLogin = () => {
    if (newPassword.trim()) {
      login(newPassword.trim())
      setNewPassword('')
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      {/* Authentication */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h3 className="card-title">🔐 Authentication</h3>
          {isAuthenticated ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <div className="badge badge-success gap-2">
                  <span className="w-2 h-2 rounded-full bg-success animate-pulse"></span>
                  Authenticated
                </div>
              </div>
              <p className="text-base-content/70">You have full access to all dashboard features.</p>
              <button className="btn btn-outline btn-error w-fit" onClick={logout}>
                🔓 Logout
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-base-content/70">Enter admin password to unlock all features:</p>
              <div className="join w-full">
                <input
                  type="password"
                  className="input input-bordered join-item flex-1"
                  placeholder="Admin password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                />
                <button className="btn btn-primary join-item" onClick={handleLogin}>
                  🔑 Authenticate
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Relay Keys (Only when authenticated) */}
      {isAuthenticated && (
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <div className="flex items-center justify-between">
              <h3 className="card-title">🔑 Relay Keys</h3>
              <div className="flex items-center gap-2">
                <label className="label cursor-pointer gap-2">
                  <span className="label-text text-sm">Show Keys</span>
                  <input
                    type="checkbox"
                    className="toggle toggle-sm"
                    checked={showKeys}
                    onChange={(e) => setShowKeys(e.target.checked)}
                  />
                </label>
                <button className="btn btn-ghost btn-sm" onClick={fetchRelayKeys} disabled={loadingKeys}>
                  {loadingKeys ? <span className="loading loading-spinner loading-xs"></span> : '🔄'}
                </button>
              </div>
            </div>

            {loadingKeys ? (
              <div className="flex justify-center p-4"><span className="loading loading-spinner"></span></div>
            ) : relayKeys ? (
              <div className="flex flex-col gap-3 mt-2">
                {(['pub', 'priv', 'epub', 'epriv'] as const).map((keyType) => (
                  <div key={keyType} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-base-content/60 uppercase">{keyType}</span>
                      <button
                        className="btn btn-ghost btn-xs"
                        onClick={() => copyToClipboard(relayKeys[keyType], keyType)}
                      >
                        {copiedKey === keyType ? '✅ Copied!' : '📋 Copy'}
                      </button>
                    </div>
                    <code className="bg-base-200 px-3 py-2 rounded text-xs break-all font-mono">
                      {maskKey(relayKeys[keyType])}
                    </code>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-base-content/50 text-sm">Failed to load keys</p>
            )}
          </div>
        </div>
      )}

      {/* Storage Overview (Only when authenticated) */}
      {isAuthenticated && (
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <div className="flex items-center justify-between">
              <h3 className="card-title">💾 Storage Overview</h3>
              <button className="btn btn-ghost btn-sm" onClick={fetchStorageStats} disabled={loadingStorage}>
                {loadingStorage ? <span className="loading loading-spinner loading-xs"></span> : '🔄'}
              </button>
            </div>

            {loadingStorage ? (
              <div className="flex justify-center p-4"><span className="loading loading-spinner"></span></div>
            ) : storageStats ? (
              <div className="flex flex-col gap-4 mt-2">
                {/* Total Storage */}
                <div className="stats shadow bg-base-200">
                  <div className="stat">
                    <div className="stat-title">Total Storage Used</div>
                    <div className="stat-value text-primary">{storageStats.total.formatted}</div>
                    <div className="stat-desc">{storageStats.total.mb.toFixed(0)} MB across all volumes</div>
                  </div>
                </div>

                {/* Breakdown */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-base-200 p-3 rounded-lg">
                    <div className="text-sm font-medium">📁 Data</div>
                    <div className="text-lg font-bold">{storageStats.data.formatted}</div>
                    <div className="text-xs text-base-content/60">{storageStats.data.files} files</div>
                  </div>
                  <div className="bg-base-200 p-3 rounded-lg">
                    <div className="text-sm font-medium">🔷 GunDB (radata)</div>
                    <div className="text-lg font-bold">{storageStats.radata.formatted}</div>
                    <div className="text-xs text-base-content/60">{storageStats.radata.files} files</div>
                  </div>
                  <div className="bg-base-200 p-3 rounded-lg">
                    <div className="text-sm font-medium">🧲 Torrents</div>
                    <div className="text-lg font-bold">{storageStats.breakdown.torrents.formatted}</div>
                    <div className="text-xs text-base-content/60">{storageStats.breakdown.torrents.files} files</div>
                  </div>
                  <div className="bg-base-200 p-3 rounded-lg">
                    <div className="text-sm font-medium">📌 IPFS</div>
                    <div className="text-lg font-bold">{storageStats.breakdown.ipfs.formatted}</div>
                    <div className="text-xs text-base-content/60">{storageStats.breakdown.ipfs.files} files</div>
                  </div>
                  <div className="bg-base-200 p-3 rounded-lg">
                    <div className="text-sm font-medium">💼 Deals</div>
                    <div className="text-lg font-bold">{storageStats.breakdown.deals.formatted}</div>
                    <div className="text-xs text-base-content/60">{storageStats.breakdown.deals.files} files</div>
                  </div>
                  <div className="bg-base-200 p-3 rounded-lg">
                    <div className="text-sm font-medium">🔫 GunDB (local)</div>
                    <div className="text-lg font-bold">{storageStats.breakdown.gundb.formatted}</div>
                    <div className="text-xs text-base-content/60">{storageStats.breakdown.gundb.files} files</div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-base-content/50 text-sm">Failed to load storage stats</p>
            )}
          </div>
        </div>
      )}

      {/* Theme */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h3 className="card-title">🎨 Appearance</h3>
          <div className="form-control">
            <label className="label">
              <span className="label-text">Theme</span>
            </label>
            <div className="join">
              <button
                className={`btn join-item ${theme === 'light' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setTheme('light')}
              >
                ☀️ Light
              </button>
              <button
                className={`btn join-item ${theme === 'dark' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setTheme('dark')}
              >
                🌙 Dark
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* About */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h3 className="card-title">ℹ️ About</h3>
          <p className="text-base-content/70">
            Shogun Relay Dashboard — Part of the{' '}
            <a href="https://github.com/scobru/shogun" target="_blank" rel="noopener noreferrer" className="link link-primary">
              Shogun Project
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}

export default Settings
