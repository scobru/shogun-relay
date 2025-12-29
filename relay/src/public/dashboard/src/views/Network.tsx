import { useEffect, useState, useCallback } from 'react'

interface NetworkStats {
  totalRelays?: number; activeRelays?: number; totalConnections?: number
  totalPins?: number; totalActiveDeals?: number; totalStorageBytes?: number
  totalStorageMB?: number; totalDealStorageMB?: number
}

interface ReputationEntry {
  host: string; calculatedScore?: { total: number }
  uptimePercent?: number; proofsSuccessful?: number; proofsTotal?: number
}

interface RegistryParams { chainId?: string; registryAddress?: string; minStake?: string }
interface DealStats { totalDeals?: number; activeDeals?: number; totalSizeMB?: number; totalRevenueUSDC?: number }

function Network() {
  const [stats, setStats] = useState<NetworkStats>({})
  const [leaderboard, setLeaderboard] = useState<ReputationEntry[]>([])
  const [registry, setRegistry] = useState<RegistryParams>({})
  const [registeredRelays, setRegisteredRelays] = useState<number>(0)
  const [dealStats, setDealStats] = useState<DealStats>({})
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
      const statsRes = await fetch('/api/v1/network/stats')
      const statsData = await statsRes.json()
      if (statsData.success && statsData.stats) setStats(statsData.stats)

      try { const repRes = await fetch('/api/v1/network/reputation?limit=20'); const repData = await repRes.json(); if (repData.success && repData.leaderboard) setLeaderboard(repData.leaderboard) } catch {}
      try { const regRes = await fetch('/api/v1/registry/params'); const regData = await regRes.json(); if (regData.success) setRegistry({ chainId: regData.chainId, registryAddress: regData.registryAddress, minStake: regData.params?.minStake }) } catch {}
      try { const relaysRes = await fetch('/api/v1/network/onchain/relays?chainId=84532'); const relaysData = await relaysRes.json(); if (relaysData.success) setRegisteredRelays(relaysData.relayCount || 0) } catch {}
      try { const dealsRes = await fetch('/api/v1/deals/stats'); const dealsData = await dealsRes.json(); if (dealsData.success && dealsData.stats) setDealStats(dealsData.stats) } catch {}
      setLastUpdated(new Date())
    } catch (error) { console.error('Failed to fetch network data:', error) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchAll(); const interval = setInterval(fetchAll, 30000); return () => clearInterval(interval) }, [fetchAll])

  const storageGB = (stats.totalStorageBytes || 0) / (1024 * 1024 * 1024)
  const storageMB = stats.totalStorageMB || (stats.totalStorageBytes || 0) / (1024 * 1024)

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
            <div className="stat"><div className="stat-title">Active Deals</div><div className="stat-value text-success">{formatNumber(stats.totalActiveDeals)}</div></div>
          </div>
        </div>
      </div>

      {/* Reputation Leaderboard */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title">⭐ Reputation Leaderboard</h2>
          {loading ? (
            <div className="flex justify-center p-8"><span className="loading loading-spinner loading-lg"></span></div>
          ) : leaderboard.length === 0 ? (
            <div className="text-center py-8 text-base-content/50">No reputation data available</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table table-zebra">
                <thead><tr><th>Rank</th><th>Relay Host</th><th>Score</th><th>Tier</th><th>Uptime</th><th>Proofs</th></tr></thead>
                <tbody>
                  {leaderboard.map((relay, i) => {
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

      {/* Registry Information */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title">📋 Registry Information</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
            <div className="bg-base-200 p-4 rounded-lg"><div className="text-sm text-base-content/60">Chain ID</div><div className="font-bold">{registry.chainId || '-'}</div></div>
            <div className="bg-base-200 p-4 rounded-lg"><div className="text-sm text-base-content/60">Registry</div><div className="font-mono text-xs">{registry.registryAddress ? `${registry.registryAddress.substring(0, 10)}...` : '-'}</div></div>
            <div className="bg-base-200 p-4 rounded-lg"><div className="text-sm text-base-content/60">Min Stake</div><div className="font-bold">{registry.minStake || '-'}</div></div>
            <div className="bg-base-200 p-4 rounded-lg"><div className="text-sm text-base-content/60">Registered Relays</div><div className="font-bold text-primary">{formatNumber(registeredRelays)}</div></div>
          </div>
        </div>
      </div>

      {lastUpdated && <p className="text-sm text-base-content/50 text-center">Last updated: {lastUpdated.toLocaleTimeString()}</p>}
    </div>
  )
}

export default Network
