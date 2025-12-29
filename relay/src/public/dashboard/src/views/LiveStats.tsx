import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import './LiveStats.css'

interface SystemStats {
  version?: string
  uptime?: number
  timestamp?: number
  memory?: {
    heapUsed: number
    heapTotal: number
    external: number
    rss: number
  }
  cpu?: {
    user: number
    system: number
  }
  peers?: {
    count: number
    time: number
  }
  dam?: {
    in?: { rate: number }
  }
}

// Added Relay Info Interface
interface RelayInfo {
    host: string
    endpoint: string | null
    lastSeen: number
    uptime: number
    connections: { active: number }
    ipfs?: { repoSize: number, numPins: number }
}

function LiveStats() {
  const { isAuthenticated, getAuthHeaders } = useAuth()
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [relays, setRelays] = useState<RelayInfo[]>([]) // Added relays state
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  
  // Add Peer State
  const [newPeerUrl, setNewPeerUrl] = useState('')
  const [addingPeer, setAddingPeer] = useState(false)

  useEffect(() => {
    async function fetchData() {
      try {
        // Fetch System Stats
        const response = await fetch('/api/v1/system/stats.json')
        const data = await response.json()
        setStats(data)
        setLastUpdated(new Date())

        // Fetch Network Relays (if auth)
        if (isAuthenticated) {
            const relaysRes = await fetch('/api/v1/network/relays', { headers: getAuthHeaders() })
            const relaysData = await relaysRes.json()
            if (relaysData.success && relaysData.relays) {
                setRelays(relaysData.relays)
            }
        }

      } catch (error) {
        console.error('Failed to fetch data:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
    const interval = setInterval(fetchData, 5000)
    return () => clearInterval(interval)
  }, [isAuthenticated, getAuthHeaders])

  const handleAddPeer = async (e: React.FormEvent) => {
      e.preventDefault()
      if (!newPeerUrl) return
      setAddingPeer(true)
      try {
          // Use the system endpoint to add Gun peer
          const res = await fetch('/api/v1/system/peers/add', {
              method: 'POST',
              headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
              body: JSON.stringify({ peer: newPeerUrl })
          })
          if (res.ok) {
              alert('Peer added successfully!')
              setNewPeerUrl('')
          } else {
              alert('Failed to add peer')
          }
      } catch (e) {
          alert('Network error')
      } finally {
          setAddingPeer(false)
      }
  }

  const formatBytes = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`
  const formatUptime = (ms: number) => {
    const hours = Math.floor(ms / 1000 / 60 / 60)
    const minutes = Math.floor((ms / 1000 / 60) % 60)
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
  }

  if (loading) {
    return <div className="stats-loading">Loading stats...</div>
  }

  return (
    <div className="stats-page">
      {/* Quick Stats */}
      <div className="stats-grid grid grid-4">
        <div className="stats-card card">
          <div className="stats-card-title">Connected Peers</div>
          <div className="stats-card-value">{stats?.peers?.count || 0}</div>
          <div className="stats-card-unit">peers</div>
        </div>
        <div className="stats-card card">
          <div className="stats-card-title">Memory Usage</div>
          <div className="stats-card-value">{stats?.memory?.heapUsed ? Math.round(stats.memory.heapUsed / 1024 / 1024) : 0}</div>
          <div className="stats-card-unit">MB</div>
        </div>
        <div className="stats-card card">
          <div className="stats-card-title">Request Rate</div>
          <div className="stats-card-value">{stats?.dam?.in?.rate || 0}</div>
          <div className="stats-card-unit">req/s</div>
        </div>
        <div className="stats-card card">
          <div className="stats-card-title">Uptime</div>
          <div className="stats-card-value">{stats?.uptime ? formatUptime(stats.uptime * 1000) : '--'}</div>
          <div className="stats-card-unit">time</div>
        </div>
      </div>

      {/* NEW: Relay Network Section */}
      {isAuthenticated && (
          <div className="stats-section card">
              <div className="flex justify-between items-center mb-4">
                  <h3 className="stats-section-title mb-0">🌐 Network Relays</h3>
                  <form onSubmit={handleAddPeer} className="flex gap-2">
                      <input 
                          type="text" 
                          className="input input-sm" 
                          placeholder="Add Relay URL (http://.../gun)" 
                          value={newPeerUrl}
                          onChange={e => setNewPeerUrl(e.target.value)}
                          style={{ minWidth: '250px' }}
                      />
                      <button className="btn btn-sm btn-primary" disabled={addingPeer}>
                          {addingPeer ? 'Adding...' : '➕ Add Peer'}
                      </button>
                  </form>
              </div>
              
              <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm" style={{ borderCollapse: 'collapse' }}>
                      <thead>
                          <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
                              <th className="p-2">Host / Key</th>
                              <th className="p-2">Endpoint</th>
                              <th className="p-2">Last Seen</th>
                              <th className="p-2">Connections</th>
                              <th className="p-2">Storage</th>
                          </tr>
                      </thead>
                      <tbody>
                          {relays.length === 0 && (
                              <tr><td colSpan={5} className="p-4 text-center text-muted">No other relays discovered yet.</td></tr>
                          )}
                          {relays.map((relay: RelayInfo, i: number) => (
                              <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                  <td className="p-2 font-mono" title={relay.host}>{relay.host.substring(0, 16)}...</td>
                                  <td className="p-2">{relay.endpoint || '-'}</td>
                                  <td className="p-2">{new Date(relay.lastSeen).toLocaleTimeString()}</td>
                                  <td className="p-2">{relay.connections?.active || 0}</td>
                                  <td className="p-2">
                                      {relay.ipfs ? `${formatBytes(relay.ipfs.repoSize)}` : '-'}
                                  </td>
                              </tr>
                          ))}
                      </tbody>
                  </table>
              </div>
          </div>
      )}

      {/* System Info */}
      <div className="stats-section card">
        <h3 className="stats-section-title">🖥️ System Information</h3>
        <div className="stats-details grid grid-3">
          <div className="stats-detail">
            <span className="stats-detail-label">Version</span>
            <span className="stats-detail-value">{stats?.version || '--'}</span>
          </div>
          <div className="stats-detail">
            <span className="stats-detail-label">Uptime</span>
            <span className="stats-detail-value">{stats?.uptime ? formatUptime(stats.uptime * 1000) : '--'}</span>
          </div>
          <div className="stats-detail">
            <span className="stats-detail-label">Timestamp</span>
            <span className="stats-detail-value">{stats?.timestamp ? new Date(stats.timestamp).toLocaleString() : '--'}</span>
          </div>
        </div>
      </div>

      {/* Memory Stats */}
      <div className="stats-section card">
        <h3 className="stats-section-title">💾 Memory Statistics</h3>
        <div className="stats-details grid grid-4">
          <div className="stats-detail">
            <span className="stats-detail-label">Heap Used</span>
            <span className="stats-detail-value">{stats?.memory?.heapUsed ? formatBytes(stats.memory.heapUsed) : '--'}</span>
          </div>
          <div className="stats-detail">
            <span className="stats-detail-label">Heap Total</span>
            <span className="stats-detail-value">{stats?.memory?.heapTotal ? formatBytes(stats.memory.heapTotal) : '--'}</span>
          </div>
          <div className="stats-detail">
            <span className="stats-detail-label">External</span>
            <span className="stats-detail-value">{stats?.memory?.external ? formatBytes(stats.memory.external) : '--'}</span>
          </div>
          <div className="stats-detail">
            <span className="stats-detail-label">RSS</span>
            <span className="stats-detail-value">{stats?.memory?.rss ? formatBytes(stats.memory.rss) : '--'}</span>
          </div>
        </div>
      </div>

      {/* CPU Stats */}
      <div className="stats-section card">
        <h3 className="stats-section-title">⚡ CPU Statistics</h3>
        <div className="stats-details grid grid-2">
          <div className="stats-detail">
            <span className="stats-detail-label">User (μs)</span>
            <span className="stats-detail-value">{stats?.cpu?.user ?? '--'}</span>
          </div>
          <div className="stats-detail">
            <span className="stats-detail-label">System (μs)</span>
            <span className="stats-detail-value">{stats?.cpu?.system ?? '--'}</span>
          </div>
        </div>
      </div>

      {/* Raw JSON */}
      <div className="stats-section card">
        <h3 className="stats-section-title">📄 Raw JSON Data</h3>
        <pre className="stats-raw">{JSON.stringify(stats, null, 2)}</pre>
      </div>

      {lastUpdated && (
        <p className="stats-updated">Last updated: {lastUpdated.toLocaleTimeString()}</p>
      )}
    </div>
  )
}

export default LiveStats
