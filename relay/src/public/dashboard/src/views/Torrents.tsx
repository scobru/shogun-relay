import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import './Torrents.css'

interface TorrentData {
  infoHash: string
  name: string
  progress: number
  downloadSpeed: number
  uploadSpeed: number
  peers: number
  files: number
  paused: boolean
  magnetURI: string
}

interface TorrentStatus {
  enabled: boolean
  activeTorrents: number
  downloadSpeed: number
  uploadSpeed: number
  ratio: number
  torrents: TorrentData[]
}

function Torrents() {
  const { isAuthenticated, getAuthHeaders } = useAuth()
  const [status, setStatus] = useState<TorrentStatus | null>(null)
  const [catalogCount, setCatalogCount] = useState(0)
  const [catalogFiles, setCatalogFiles] = useState(0)
  const [loading, setLoading] = useState(true)
  const [magnetInput, setMagnetInput] = useState('')
  const [addStatus, setAddStatus] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [searching, setSearching] = useState(false)

  const formatBytes = (bytes: number, decimals = 2) => {
    if (!bytes) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i]
  }

  const formatSpeed = (bytes: number) => `${formatBytes(bytes)}/s`

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/torrent/status')
      const data = await res.json()
      if (data.success) {
        setStatus(data.data)
      }
    } catch (error) {
      console.error('Failed to fetch torrent status:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchCatalog = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/torrent/catalog')
      const data = await res.json()
      if (data.success) {
        setCatalogCount(data.count || 0)
        setCatalogFiles(data.totalPinnedFiles || 0)
      }
    } catch (error) {
      console.error('Failed to fetch catalog:', error)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    fetchCatalog()
    const interval = setInterval(fetchStatus, 5000)
    return () => clearInterval(interval)
  }, [fetchStatus, fetchCatalog])

  const addTorrent = async () => {
    if (!magnetInput.trim()) return
    setAddStatus('Adding...')
    try {
      const res = await fetch('/api/v1/torrent/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ magnet: magnetInput })
      })
      const data = await res.json()
      if (data.success) {
        setAddStatus('✅ ' + data.message)
        setMagnetInput('')
        fetchStatus()
      } else {
        setAddStatus('❌ ' + (data.error || 'Failed'))
      }
    } catch {
      setAddStatus('❌ Network error')
    }
  }

  const removeTorrent = async (infoHash: string) => {
    if (!confirm('Remove this torrent?')) return
    try {
      await fetch(`/api/v1/torrent/remove/${infoHash}?deleteFiles=true`, { method: 'DELETE' })
      fetchStatus()
    } catch (error) {
      console.error('Failed to remove:', error)
    }
  }

  const pauseTorrent = async (infoHash: string) => {
    await fetch(`/api/v1/torrent/pause/${infoHash}`, { method: 'POST' })
    fetchStatus()
  }

  const resumeTorrent = async (infoHash: string) => {
    await fetch(`/api/v1/torrent/resume/${infoHash}`, { method: 'POST' })
    fetchStatus()
  }

  const searchRegistry = async () => {
    if (searchQuery.length < 3) return
    setSearching(true)
    try {
      const res = await fetch(`/api/v1/torrent/registry/search?q=${encodeURIComponent(searchQuery)}`)
      const data = await res.json()
      if (data.success) {
        setSearchResults(data.results || [])
      }
    } catch (error) {
      console.error('Search failed:', error)
    } finally {
      setSearching(false)
    }
  }

  const copyMagnet = (magnetURI: string) => {
    navigator.clipboard.writeText(magnetURI)
  }

  if (!isAuthenticated) {
    return (
      <div className="torrents-auth card">
        <span className="torrents-auth-icon">🔒</span>
        <h3>Authentication Required</h3>
        <p>Please enter admin password in Settings to manage torrents.</p>
      </div>
    )
  }

  return (
    <div className="torrents-page">
      {/* Header with Status */}
      <div className="torrents-header card">
        <div>
          <h2>🔥 Torrent Manager</h2>
          <p>Manage torrents and contribute to open knowledge preservation</p>
        </div>
        <span className={`torrents-badge ${status?.enabled ? 'active' : 'inactive'}`}>
          {status?.enabled ? '● Active' : '○ Disabled'}
        </span>
      </div>

      {/* Stats Grid */}
      <div className="torrents-stats">
        <div className="torrents-stat-card">
          <div className="torrents-stat-value">{status?.activeTorrents ?? '-'}</div>
          <div className="torrents-stat-label">Active Torrents</div>
        </div>
        <div className="torrents-stat-card">
          <div className="torrents-stat-value">{formatSpeed(status?.downloadSpeed || 0)}</div>
          <div className="torrents-stat-label">Download</div>
        </div>
        <div className="torrents-stat-card">
          <div className="torrents-stat-value">{formatSpeed(status?.uploadSpeed || 0)}</div>
          <div className="torrents-stat-label">Upload</div>
        </div>
        <div className="torrents-stat-card">
          <div className="torrents-stat-value">{status?.ratio?.toFixed(2) ?? '-'}</div>
          <div className="torrents-stat-label">Ratio</div>
        </div>
      </div>

      {/* Add Torrent */}
      <div className="card torrents-section">
        <h3>Add Custom Torrent</h3>
        <div className="torrents-add-row">
          <input
            type="text"
            className="input"
            placeholder="Magnet Link or URL"
            value={magnetInput}
            onChange={e => setMagnetInput(e.target.value)}
            onKeyPress={e => e.key === 'Enter' && addTorrent()}
          />
          <button className="btn btn-primary" onClick={addTorrent}>Add</button>
        </div>
        {addStatus && <p className="torrents-add-status">{addStatus}</p>}
      </div>

      {/* Catalog Stats */}
      <div className="card torrents-section">
        <h3>📚 IPFS Catalog</h3>
        <div className="torrents-catalog-stats">
          <div>
            <strong>{catalogCount}</strong>
            <span>Cataloged Torrents</span>
          </div>
          <div>
            <strong>{catalogFiles}</strong>
            <span>Files on IPFS</span>
          </div>
          <a href="/api/v1/torrent/catalog" target="_blank" className="btn btn-secondary">View JSON →</a>
        </div>
      </div>

      {/* Registry Search */}
      <div className="card torrents-section">
        <h3>🔎 Global Registry Search</h3>
        <div className="torrents-add-row">
          <input
            type="text"
            className="input"
            placeholder="Search torrents (min 3 chars)..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyPress={e => e.key === 'Enter' && searchRegistry()}
          />
          <button className="btn btn-primary" onClick={searchRegistry} disabled={searching}>
            {searching ? 'Searching...' : '🔍 Search'}
          </button>
        </div>
        {searchResults.length > 0 && (
          <div className="torrents-search-results">
            {searchResults.map((t, i) => (
              <div key={i} className="torrents-search-item">
                <div className="torrents-search-name">{t.name || 'Unknown'}</div>
                <div className="torrents-search-hash">{t.infoHash}</div>
                <div className="torrents-search-actions">
                  <button className="btn btn-primary btn-sm" onClick={() => {
                    setMagnetInput(t.magnetURI)
                    addTorrent()
                  }}>➕ Add</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => copyMagnet(t.magnetURI)}>🧲 Copy</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Active Torrents List */}
      <div className="card torrents-section">
        <h3>Active Torrents</h3>
        {loading ? (
          <div className="torrents-loading">Loading...</div>
        ) : !status?.torrents?.length ? (
          <div className="torrents-empty">No active torrents</div>
        ) : (
          <div className="torrents-list">
            {status.torrents.map(t => (
              <div key={t.infoHash} className={`torrents-item ${t.paused ? 'paused' : ''}`}>
                <div className="torrents-item-header">
                  <div className="torrents-item-name">
                    {t.paused && '⏸️ '}{t.name || 'Unknown Torrent'}
                  </div>
                  <div className="torrents-item-progress">
                    <div className="torrents-progress-bar">
                      <div className="torrents-progress-fill" style={{ width: `${(t.progress * 100)}%` }} />
                    </div>
                    <span>{(t.progress * 100).toFixed(1)}%</span>
                  </div>
                </div>
                <div className="torrents-item-stats">
                  <span>↓ {formatSpeed(t.downloadSpeed)}</span>
                  <span>↑ {formatSpeed(t.uploadSpeed)}</span>
                  <span>{t.peers} peers</span>
                  <span>{t.files} files</span>
                </div>
                <div className="torrents-item-actions">
                  <button className="btn-icon" onClick={() => t.paused ? resumeTorrent(t.infoHash) : pauseTorrent(t.infoHash)}>
                    {t.paused ? '▶️' : '⏸️'}
                  </button>
                  <button className="btn-icon" onClick={() => copyMagnet(t.magnetURI)} title="Copy Magnet">🧲</button>
                  <button className="btn-icon btn-danger" onClick={() => removeTorrent(t.infoHash)} title="Remove">🗑️</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default Torrents
