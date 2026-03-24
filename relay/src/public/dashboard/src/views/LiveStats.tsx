import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'

interface PeerStats {
  id: string
  addr: string
  connectedAt: number
  msgCount: number
  bytesSent: number
  uptime: number
}

interface SystemStats {
  version?: string
  uptime?: number
  timestamp?: number
  memory?: { heapUsed: number; heapTotal: number; external: number; rss: number }
  cpu?: { user: number; system: number }
  peers?: PeerStats[] | any
  connectedPeers?: number
  peakPeers?: number
  totalMessages?: number
  totalBytes?: number
  putCount?: number
  getCount?: number
  ackCount?: number
  errorCount?: number
  dam?: { in?: { rate: number }, out?: { rate: number } }
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
    const interval = setInterval(fetchData, 1000)
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

  const formatBytes = (bytes: number) => {
    if (!bytes && bytes !== 0) return '--'
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / 1048576).toFixed(2) + ' MB'
  }
  
  const formatUptime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-64"><span className="loading loading-spinner loading-lg"></span></div>
  }

  return (
    <div className="flex flex-col gap-6 max-w-6xl">
      {/* Metric Cards - Telemetry Style */}
      <div className="stats stats-vertical lg:stats-horizontal shadow w-full">
        <div className="stat">
          <div className="stat-figure text-primary text-2xl">🌐</div>
          <div className="stat-title">Connected Peers</div>
          <div className="stat-value text-primary">{stats?.connectedPeers || 0}</div>
          <div className="stat-desc">Peak: {stats?.peakPeers || 0}</div>
        </div>
        <div className="stat">
          <div className="stat-figure text-secondary text-2xl">📈</div>
          <div className="stat-title">Msg Rate</div>
          <div className="stat-value text-secondary">{stats?.dam?.in?.rate || 0}</div>
          <div className="stat-desc">messages per second</div>
        </div>
        <div className="stat">
          <div className="stat-figure text-accent text-2xl">📦</div>
          <div className="stat-title">Total Messages</div>
          <div className="stat-value text-accent">{stats?.totalMessages?.toLocaleString() || 0}</div>
          <div className="stat-desc">{formatBytes(stats?.totalBytes || 0)} transferred</div>
        </div>
        <div className="stat">
          <div className="stat-figure text-info text-2xl">⏱️</div>
          <div className="stat-title">Uptime</div>
          <div className="stat-value text-info">{stats?.uptime ? formatUptime(stats.uptime) : '--'}</div>
          <div className="stat-desc">Server session</div>
        </div>
      </div>

      {/* Operation Metrics */}
      <div className="stats stats-vertical lg:stats-horizontal shadow w-full">
        <div className="stat">
          <div className="stat-title">PUT ops</div>
          <div className="stat-value">{stats?.putCount?.toLocaleString() || 0}</div>
          <div className="stat-desc">write operations</div>
        </div>
        <div className="stat">
          <div className="stat-title">GET ops</div>
          <div className="stat-value">{stats?.getCount?.toLocaleString() || 0}</div>
          <div className="stat-desc">read operations</div>
        </div>
        <div className="stat">
          <div className="stat-title">ACKs</div>
          <div className="stat-value">{stats?.ackCount?.toLocaleString() || 0}</div>
          <div className="stat-desc">acknowledgements</div>
        </div>
        <div className={`stat ${stats?.errorCount && stats.errorCount > 0 ? 'text-error' : ''}`}>
          <div className="stat-title">Errors</div>
          <div className="stat-value">{stats?.errorCount?.toLocaleString() || 0}</div>
          <div className="stat-desc">protocol errors</div>
        </div>
      </div>

      {/* Active Peer Wire Stats */}
      {isAuthenticated && stats?.peers && Array.isArray(stats.peers) && (
         <div className="card bg-base-100 shadow">
         <div className="card-body">
           <h3 className="card-title">🔌 Active Wire Peers</h3>
           <div className="overflow-x-auto mt-4">
             <table className="table table-zebra table-sm">
               <thead>
                 <tr>
                   <th>#</th>
                   <th>Address / ID</th>
                   <th>Status</th>
                   <th>Messages</th>
                   <th>Bytes Sent</th>
                   <th>Uptime</th>
                 </tr>
               </thead>
               <tbody>
                 {stats.peers.length === 0 && (
                   <tr><td colSpan={6} className="text-center text-base-content/50">No peers connected over wire.</td></tr>
                 )}
                 {stats.peers.map((p: PeerStats, i: number) => (
                   <tr key={i}>
                     <td className="text-base-content/50">{i + 1}</td>
                     <td className="font-mono text-xs">{p.addr || p.id}</td>
                     <td><span className="badge badge-success badge-sm p-2">LIVE</span></td>
                     <td>{(p.msgCount || 0).toLocaleString()}</td>
                     <td>{formatBytes(p.bytesSent || 0)}</td>
                     <td>{formatUptime(p.uptime || 0)}</td>
                   </tr>
                 ))}
               </tbody>
             </table>
           </div>
         </div>
       </div>
      )}

      {/* Network Relays Map (Legacy) */}
      {isAuthenticated && (
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h3 className="card-title">🌐 Configured Network Relays</h3>
              <form onSubmit={handleAddPeer} className="join">
                <input 
                  type="text" 
                  className="input input-bordered input-sm join-item w-64"
                  placeholder="Add Relay URL (http://.../gun)" 
                  value={newPeerUrl}
                  onChange={e => setNewPeerUrl(e.target.value)}
                />
                <button className="btn btn-primary btn-sm join-item" disabled={addingPeer}>
                  {addingPeer ? <span className="loading loading-spinner loading-xs"></span> : '➕'} Add
                </button>
              </form>
            </div>
            <div className="overflow-x-auto mt-4">
              <table className="table table-zebra table-sm">
                <thead>
                  <tr>
                    <th>Host / Key</th>
                    <th>Endpoint</th>
                    <th>Last Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {relays.length === 0 && (
                    <tr><td colSpan={3} className="text-center text-base-content/50">No relays configured.</td></tr>
                  )}
                  {relays.map((relay: RelayInfo, i: number) => (
                    <tr key={i}>
                      <td className="font-mono text-xs" title={relay.host}>{relay.host.substring(0, 30)}...</td>
                      <td>{relay.endpoint || '-'}</td>
                      <td>{new Date(relay.lastSeen).toLocaleTimeString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {lastUpdated && (
        <p className="text-sm text-base-content/50 text-center">Last updated: {lastUpdated.toLocaleTimeString()}</p>
      )}
    </div>
  )
}

export default LiveStats

