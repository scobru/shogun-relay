import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'

interface SystemStats {
  version?: string
  uptime?: number
  timestamp?: number
  memory?: { heapUsed: number; heapTotal: number; external: number; rss: number }
  cpu?: { user: number; system: number }
  peers?: { count: number; time: number }
  dam?: { in?: { rate: number } }
}

interface RelayInfo {
  host: string
  endpoint: string | null
  lastSeen: number
  uptime: number
  connections: { active: number }
  ipfs?: { repoSize: number; numPins: number }
}

function LiveStats() {
  const { isAuthenticated, getAuthHeaders } = useAuth()
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [relays, setRelays] = useState<RelayInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [newPeerUrl, setNewPeerUrl] = useState('')
  const [addingPeer, setAddingPeer] = useState(false)

  useEffect(() => {
    async function fetchData() {
      try {
        const response = await fetch('/api/v1/system/stats.json')
        const data = await response.json()
        setStats(data)
        setLastUpdated(new Date())

        if (isAuthenticated) {
          try {
            // Use /api/v1/system/peers - same endpoint as legacy stats.html
            const peersRes = await fetch('/api/v1/system/peers', { headers: getAuthHeaders() })
            const peersData = await peersRes.json()
            if (peersData.success && peersData.peers && peersData.peers.length > 0) {
              const peerRelays: RelayInfo[] = peersData.peers.map((peer: string) => ({
                host: peer,
                endpoint: peer,
                lastSeen: Date.now(),
                uptime: 0,
                connections: { active: 0 },
                ipfs: undefined
              }))
              setRelays(peerRelays)
            }
            
            // Also try to get discovered relays from network
            try {
              const relaysRes = await fetch('/api/v1/network/relays', { headers: getAuthHeaders() })
              const relaysData = await relaysRes.json()
              if (relaysData.success && relaysData.relays && relaysData.relays.length > 0) {
                setRelays((prev: RelayInfo[]) => {
                  const existingHosts = new Set(prev.map((r: RelayInfo) => r.host))
                  const newRelays = relaysData.relays.filter((r: RelayInfo) => !existingHosts.has(r.host))
                  return [...prev, ...newRelays]
                })
              }
            } catch { /* ignore network relay discovery errors */ }
          } catch (error) { console.error('Failed to fetch peers:', error) }
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
      const res = await fetch('/api/v1/system/peers/add', {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ peer: newPeerUrl })
      })
      if (res.ok) { alert('Peer added!'); setNewPeerUrl('') }
      else alert('Failed to add peer')
    } catch { alert('Network error') }
    finally { setAddingPeer(false) }
  }

  const formatBytes = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`
  const formatUptime = (ms: number) => {
    const hours = Math.floor(ms / 1000 / 60 / 60)
    const minutes = Math.floor((ms / 1000 / 60) % 60)
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-64"><span className="loading loading-spinner loading-lg"></span></div>
  }

  return (
    <div className="flex flex-col gap-6 max-w-6xl">
      {/* Stats Cards */}
      <div className="stats stats-vertical lg:stats-horizontal shadow w-full">
        <div className="stat">
          <div className="stat-figure text-primary text-2xl">🌐</div>
          <div className="stat-title">Peers</div>
          <div className="stat-value text-primary">{stats?.peers?.count || 0}</div>
        </div>
        <div className="stat">
          <div className="stat-figure text-secondary text-2xl">💾</div>
          <div className="stat-title">Memory</div>
          <div className="stat-value text-secondary">{stats?.memory?.heapUsed ? Math.round(stats.memory.heapUsed / 1024 / 1024) : 0}</div>
          <div className="stat-desc">MB</div>
        </div>
        <div className="stat">
          <div className="stat-figure text-accent text-2xl">📊</div>
          <div className="stat-title">Request Rate</div>
          <div className="stat-value">{stats?.dam?.in?.rate || 0}</div>
          <div className="stat-desc">req/s</div>
        </div>
        <div className="stat">
          <div className="stat-figure text-info text-2xl">⏱️</div>
          <div className="stat-title">Uptime</div>
          <div className="stat-value text-info">{stats?.uptime ? formatUptime(stats.uptime * 1000) : '--'}</div>
        </div>
      </div>

      {/* Network Relays */}
      {isAuthenticated && (
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h3 className="card-title">🌐 Network Relays</h3>
              <form onSubmit={handleAddPeer} className="join">
                <input 
                  type="text" 
                  className="input input-bordered join-item w-64"
                  placeholder="Add Relay URL (http://.../gun)" 
                  value={newPeerUrl}
                  onChange={e => setNewPeerUrl(e.target.value)}
                />
                <button className="btn btn-primary join-item" disabled={addingPeer}>
                  {addingPeer ? <span className="loading loading-spinner loading-xs"></span> : '➕'} Add
                </button>
              </form>
            </div>
            <div className="overflow-x-auto mt-4">
              <table className="table table-zebra">
                <thead>
                  <tr>
                    <th>Host / Key</th>
                    <th>Endpoint</th>
                    <th>Last Seen</th>
                    <th>Connections</th>
                    <th>Storage</th>
                  </tr>
                </thead>
                <tbody>
                  {relays.length === 0 && (
                    <tr><td colSpan={5} className="text-center text-base-content/50">No relays discovered yet.</td></tr>
                  )}
                  {relays.map((relay: RelayInfo, i: number) => (
                    <tr key={i}>
                      <td className="font-mono text-xs" title={relay.host}>{relay.host.substring(0, 30)}...</td>
                      <td>{relay.endpoint || '-'}</td>
                      <td>{new Date(relay.lastSeen).toLocaleTimeString()}</td>
                      <td>{relay.connections?.active || 0}</td>
                      <td>{relay.ipfs ? formatBytes(relay.ipfs.repoSize) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* System Info */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h3 className="card-title">🖥️ System Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
            <div className="bg-base-200 p-4 rounded-lg">
              <div className="text-sm text-base-content/60">Version</div>
              <div className="font-bold">{stats?.version || '--'}</div>
            </div>
            <div className="bg-base-200 p-4 rounded-lg">
              <div className="text-sm text-base-content/60">Uptime</div>
              <div className="font-bold">{stats?.uptime ? formatUptime(stats.uptime * 1000) : '--'}</div>
            </div>
            <div className="bg-base-200 p-4 rounded-lg">
              <div className="text-sm text-base-content/60">Timestamp</div>
              <div className="font-bold">{stats?.timestamp ? new Date(stats.timestamp).toLocaleString() : '--'}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Memory Stats */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h3 className="card-title">💾 Memory Statistics</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
            <div className="bg-base-200 p-4 rounded-lg text-center">
              <div className="text-2xl font-bold text-primary">{stats?.memory?.heapUsed ? formatBytes(stats.memory.heapUsed) : '--'}</div>
              <div className="text-sm text-base-content/60">Heap Used</div>
            </div>
            <div className="bg-base-200 p-4 rounded-lg text-center">
              <div className="text-2xl font-bold">{stats?.memory?.heapTotal ? formatBytes(stats.memory.heapTotal) : '--'}</div>
              <div className="text-sm text-base-content/60">Heap Total</div>
            </div>
            <div className="bg-base-200 p-4 rounded-lg text-center">
              <div className="text-2xl font-bold">{stats?.memory?.external ? formatBytes(stats.memory.external) : '--'}</div>
              <div className="text-sm text-base-content/60">External</div>
            </div>
            <div className="bg-base-200 p-4 rounded-lg text-center">
              <div className="text-2xl font-bold">{stats?.memory?.rss ? formatBytes(stats.memory.rss) : '--'}</div>
              <div className="text-sm text-base-content/60">RSS</div>
            </div>
          </div>
        </div>
      </div>

      {lastUpdated && (
        <p className="text-sm text-base-content/50 text-center">Last updated: {lastUpdated.toLocaleTimeString()}</p>
      )}
    </div>
  )
}

export default LiveStats
