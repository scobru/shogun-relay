import { useEffect, useState, useCallback } from 'react'

interface NetworkStats {
  totalRelays?: number; activeRelays?: number; totalConnections?: number
  totalPins?: number; totalStorageBytes?: number
  totalStorageMB?: number
}

interface ReputationEntry {
  host: string; calculatedScore?: { total: number }
  uptimePercent?: number; proofsSuccessful?: number; proofsTotal?: number
}

interface GunPeerEntry {
  pubKey: string
  alias?: string | null
  lastSeen?: number
  type?: string
  torrentsCount?: number
}

interface GunRelayEntry {
  host: string
  endpoint?: string | null
  lastSeen?: number
}



function Network() {
  const [stats, setStats] = useState<NetworkStats>({})
  const [leaderboard, setLeaderboard] = useState<ReputationEntry[]>([])
  const [gunPeers, setGunPeers] = useState<GunPeerEntry[]>([])
  const [gunRelays, setGunRelays] = useState<GunRelayEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const formatNumber = (n: number | undefined) => {
    if (n === undefined || n === null) return '-'
    if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M'
    if (n >= 1000) return (n / 1000).toFixed(2) + 'K'
    return n.toLocaleString()
  }

  const getTier = (score: number) => {
    if (score >= 90) return { name: 'Platinum', class: 'badge-warning' }
    if (score >= 75) return { name: 'Gold', class: 'badge-warning' }
    if (score >= 60) return { name: 'Silver', class: 'badge-ghost' }
    if (score >= 40) return { name: 'Bronze', class: 'badge-accent' }
    return { name: 'Basic', class: 'badge-ghost' }
  }

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      // Execute all API calls in parallel for faster loading
      const [statsResult, repResult, peersResult, relaysResult] = await Promise.allSettled([
        fetch('/api/v1/network/stats').then(r => r.json()),
        fetch('/api/v1/network/reputation?limit=20').then(r => r.json()),
        fetch('/api/v1/network/peers?maxAge=3600000').then(r => r.json()),
        fetch('/api/v1/network/relays?maxAge=300000').then(r => r.json())
      ])

      // Process results - each call can fail independently
      if (statsResult.status === 'fulfilled' && statsResult.value.success && statsResult.value.stats) {
        setStats(statsResult.value.stats)
      }
      if (repResult.status === 'fulfilled' && repResult.value.success && repResult.value.leaderboard) {
        setLeaderboard(repResult.value.leaderboard)
      }
      if (peersResult.status === 'fulfilled' && peersResult.value.success && Array.isArray(peersResult.value.peers)) {
        setGunPeers(peersResult.value.peers)
      } else {
        setGunPeers([])
      }
      if (relaysResult.status === 'fulfilled' && relaysResult.value.success && Array.isArray(relaysResult.value.relays)) {
        setGunRelays(relaysResult.value.relays)
      } else {
        setGunRelays([])
      }
      
      setLastUpdated(new Date())
    } catch (error) { console.error('Failed to fetch network data:', error) }
    finally { setLoading(false) }
  }, [])


  useEffect(() => { fetchAll(); const interval = setInterval(fetchAll, 30000); return () => clearInterval(interval) }, [fetchAll])

  const storageGB = (stats.totalStorageBytes || 0) / (1024 * 1024 * 1024)
  const storageMB = stats.totalStorageMB || (stats.totalStorageBytes || 0) / (1024 * 1024)

  const formatTimeAgo = (ts?: number) => {
    if (!ts) return '-'
    const deltaMs = Date.now() - ts
    if (deltaMs < 0) return 'now'
    const s = Math.floor(deltaMs / 1000)
    if (s < 60) return `${s}s ago`
    const m = Math.floor(s / 60)
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    const d = Math.floor(h / 24)
    return `${d}d ago`
  }

  const recentPeers = [...gunPeers]
    .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))
    .slice(0, 6)

  const recentRelays = [...gunRelays]
    .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))
    .slice(0, 6)

  return (
    <div className="flex flex-col gap-6 max-w-6xl">
      {/* Network Overview */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <div className="flex items-center justify-between mb-4">
            <h2 className="card-title">🌐 Network Overview</h2>
            <button className="btn btn-outline btn-sm" onClick={fetchAll}>🔄 Refresh</button>
          </div>
          <div className="stats stats-vertical lg:stats-horizontal w-full">
            <div className="stat"><div className="stat-title">Relays</div><div className="stat-value text-primary">{formatNumber(stats.totalRelays)}</div><div className="stat-desc">{formatNumber(stats.activeRelays)} active</div></div>
            <div className="stat"><div className="stat-title">Connections</div><div className="stat-value">{formatNumber(stats.totalConnections)}</div></div>
            <div className="stat"><div className="stat-title">Storage</div><div className="stat-value text-secondary">{storageGB >= 1 ? storageGB.toFixed(2) : Math.round(storageMB)}</div><div className="stat-desc">{storageGB >= 1 ? 'GB' : 'MB'}</div></div>
            <div className="stat"><div className="stat-title">Pins</div><div className="stat-value">{formatNumber(stats.totalPins)}</div></div>
          </div>
        </div>
      </div>

      {/* GunDB Info */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title">🧩 GunDB Info</h2>
          <div className="stats stats-vertical lg:stats-horizontal w-full">
            <div className="stat">
              <div className="stat-title">Peers (mules)</div>
              <div className="stat-value text-primary">{formatNumber(gunPeers.length)}</div>
              <div className="stat-desc">seen last 1h</div>
            </div>
            <div className="stat">
              <div className="stat-title">Relays (discovered)</div>
              <div className="stat-value text-secondary">{formatNumber(gunRelays.length)}</div>
              <div className="stat-desc">seen last 5m</div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
            <div className="bg-base-200 p-4 rounded-lg">
              <div className="font-semibold mb-2">Recent peers</div>
              {loading ? (
                <div className="flex justify-center p-2"><span className="loading loading-spinner"></span></div>
              ) : recentPeers.length === 0 ? (
                <div className="text-sm text-base-content/60">No peers found</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table table-xs">
                    <thead>
                      <tr><th>Alias</th><th>Type</th><th>Last seen</th></tr>
                    </thead>
                    <tbody>
                      {recentPeers.map((p) => (
                        <tr key={p.pubKey}>
                          <td className="font-mono text-xs">{p.alias || p.pubKey.slice(0, 10) + '…'}</td>
                          <td className="text-xs">{p.type || '-'}</td>
                          <td className="text-xs">{formatTimeAgo(p.lastSeen)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="bg-base-200 p-4 rounded-lg">
              <div className="font-semibold mb-2">Recent relays</div>
              {loading ? (
                <div className="flex justify-center p-2"><span className="loading loading-spinner"></span></div>
              ) : recentRelays.length === 0 ? (
                <div className="text-sm text-base-content/60">No relays found</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table table-xs">
                    <thead>
                      <tr><th>Host</th><th>Last seen</th></tr>
                    </thead>
                    <tbody>
                      {recentRelays.map((r) => (
                        <tr key={r.host}>
                          <td className="font-mono text-xs">{r.host}</td>
                          <td className="text-xs">{formatTimeAgo(r.lastSeen)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Reputation Leaderboard */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title">⭐ GunDB Reputation Leaderboard</h2>
          {loading ? (
            <div className="flex justify-center p-8"><span className="loading loading-spinner loading-lg"></span></div>
          ) : leaderboard.length === 0 ? (
            <div className="text-center py-8 text-base-content/50">No reputation data available</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table table-zebra">
                <thead><tr><th>Rank</th><th>Relay Host</th><th>Score</th><th>Tier</th><th>Uptime</th><th>Proofs</th></tr></thead>
                <tbody>
                  {leaderboard.map((relay: ReputationEntry, i: number) => {
                    const score = relay.calculatedScore?.total || 0
                    const tier = getTier(score)
                    return (
                      <tr key={relay.host || i}>
                        <td className="font-bold">#{i + 1}</td>
                        <td className="font-mono text-xs">{relay.host || 'Unknown'}</td>
                        <td>
                          <div className="flex items-center gap-2">
                            <span className="font-bold">{score.toFixed(1)}</span>
                            <progress className="progress progress-primary w-16" value={score} max="100"></progress>
                          </div>
                        </td>
                        <td><span className={`badge ${tier.class}`}>{tier.name}</span></td>
                        <td>{(relay.uptimePercent || 0).toFixed(1)}%</td>
                        <td>{relay.proofsSuccessful || 0}/{relay.proofsTotal || 0}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {lastUpdated && <p className="text-sm text-base-content/50 text-center">Last updated: {lastUpdated.toLocaleTimeString()}</p>}
    </div>
  )
}

export default Network
