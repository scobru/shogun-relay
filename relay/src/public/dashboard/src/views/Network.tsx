import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import './Network.css'

interface NetworkStats {
  totalRelays?: number
  activeRelays?: number
  totalConnections?: number
  totalPins?: number
  totalActiveDeals?: number
  totalStorageBytes?: number
  totalStorageMB?: number
  totalDealStorageMB?: number
  totalSubscriptionStorageMB?: number
}

interface ReputationEntry {
  host: string
  calculatedScore?: { total: number }
  uptimePercent?: number
  proofsSuccessful?: number
  proofsTotal?: number
}

interface RegistryParams {
  chainId?: string
  registryAddress?: string
  minStake?: string
}

interface DealStats {
  totalDeals?: number
  activeDeals?: number
  totalSizeMB?: number
  totalRevenueUSDC?: number
}

function Network() {
  const { isAuthenticated, getAuthHeaders } = useAuth()
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
    if (score >= 90) return { name: 'Platinum', class: 'tier-platinum' }
    if (score >= 75) return { name: 'Gold', class: 'tier-gold' }
    if (score >= 60) return { name: 'Silver', class: 'tier-silver' }
    if (score >= 40) return { name: 'Bronze', class: 'tier-bronze' }
    return { name: 'Basic', class: 'tier-basic' }
  }

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      // Fetch network stats
      const statsRes = await fetch('/api/v1/network/stats')
      const statsData = await statsRes.json()
      if (statsData.success && statsData.stats) {
        setStats(statsData.stats)
      }

      // Fetch reputation leaderboard
      try {
        const repRes = await fetch('/api/v1/network/reputation?limit=20')
        const repData = await repRes.json()
        if (repData.success && repData.leaderboard) {
          setLeaderboard(repData.leaderboard)
        }
      } catch {}

      // Fetch registry params
      try {
        const regRes = await fetch('/api/v1/registry/params')
        const regData = await regRes.json()
        if (regData.success) {
          setRegistry({
            chainId: regData.chainId,
            registryAddress: regData.registryAddress,
            minStake: regData.params?.minStake
          })
        }
      } catch {}

      // Fetch registered relays count
      try {
        const relaysRes = await fetch('/api/v1/network/onchain/relays?chainId=84532')
        const relaysData = await relaysRes.json()
        if (relaysData.success) {
          setRegisteredRelays(relaysData.relayCount || 0)
        }
      } catch {}

      // Fetch deals stats
      try {
        const dealsRes = await fetch('/api/v1/deals/stats')
        const dealsData = await dealsRes.json()
        if (dealsData.success && dealsData.stats) {
          setDealStats(dealsData.stats)
        }
      } catch {}

      setLastUpdated(new Date())
    } catch (error) {
      console.error('Failed to fetch network data:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAll()
    const interval = setInterval(fetchAll, 30000)
    return () => clearInterval(interval)
  }, [fetchAll])

  const storageGB = (stats.totalStorageBytes || 0) / (1024 * 1024 * 1024)
  const storageMB = stats.totalStorageMB || (stats.totalStorageBytes || 0) / (1024 * 1024)

  return (
    <div className="network-page">
      {/* Network Overview */}
      <div className="network-section card">
        <h2>🌐 Network Overview</h2>
        <div className="network-stats-grid">
          <div className="network-stat-card">
            <div className="network-stat-title">Total Relays</div>
            <div className="network-stat-value">{formatNumber(stats.totalRelays)}</div>
          </div>
          <div className="network-stat-card">
            <div className="network-stat-title">Active Relays</div>
            <div className="network-stat-value">{formatNumber(stats.activeRelays)}</div>
          </div>
          <div className="network-stat-card">
            <div className="network-stat-title">Connections</div>
            <div className="network-stat-value">{formatNumber(stats.totalConnections)}</div>
          </div>
          <div className="network-stat-card">
            <div className="network-stat-title">Total Storage</div>
            <div className="network-stat-value">
              {storageGB >= 1 ? storageGB.toFixed(2) : Math.round(storageMB)}
            </div>
            <div className="network-stat-unit">{storageGB >= 1 ? 'GB' : 'MB'}</div>
          </div>
          <div className="network-stat-card">
            <div className="network-stat-title">Total Pins</div>
            <div className="network-stat-value">{formatNumber(stats.totalPins)}</div>
          </div>
          <div className="network-stat-card">
            <div className="network-stat-title">Active Deals</div>
            <div className="network-stat-value">{formatNumber(stats.totalActiveDeals)}</div>
          </div>
        </div>
      </div>

      {/* Reputation Leaderboard */}
      <div className="network-section card">
        <h2>⭐ Reputation Leaderboard</h2>
        {loading ? (
          <div className="network-loading">Loading...</div>
        ) : leaderboard.length === 0 ? (
          <div className="network-empty">No reputation data available</div>
        ) : (
          <div className="network-table-wrapper">
            <table className="network-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Relay Host</th>
                  <th>Score</th>
                  <th>Tier</th>
                  <th>Uptime</th>
                  <th>Proofs</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((relay, i) => {
                  const score = relay.calculatedScore?.total || 0
                  const tier = getTier(score)
                  return (
                    <tr key={relay.host || i}>
                      <td>#{i + 1}</td>
                      <td className="network-host">{relay.host || 'Unknown'}</td>
                      <td>
                        <div>{score.toFixed(2)}</div>
                        <div className="network-score-bar">
                          <div className="network-score-fill" style={{ width: `${score}%` }} />
                        </div>
                      </td>
                      <td><span className={`network-tier ${tier.class}`}>{tier.name}</span></td>
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

      {/* Deals Statistics */}
      <div className="network-section card">
        <h2>💼 Storage Deals</h2>
        <div className="network-stats-grid small">
          <div className="network-stat-card">
            <div className="network-stat-title">Total Deals</div>
            <div className="network-stat-value">{formatNumber(dealStats.totalDeals)}</div>
          </div>
          <div className="network-stat-card">
            <div className="network-stat-title">Active Deals</div>
            <div className="network-stat-value">{formatNumber(dealStats.activeDeals || stats.totalActiveDeals)}</div>
          </div>
          <div className="network-stat-card">
            <div className="network-stat-title">Total Size</div>
            <div className="network-stat-value">{formatNumber(dealStats.totalSizeMB || stats.totalDealStorageMB)}</div>
            <div className="network-stat-unit">MB</div>
          </div>
          <div className="network-stat-card">
            <div className="network-stat-title">Revenue</div>
            <div className="network-stat-value">{formatNumber(dealStats.totalRevenueUSDC)}</div>
            <div className="network-stat-unit">USDC</div>
          </div>
        </div>
      </div>

      {/* Registry Information */}
      <div className="network-section card">
        <h2>📋 Registry Information</h2>
        <div className="network-info-list">
          <div className="network-info-item">
            <span className="network-info-label">Chain ID:</span>
            <span className="network-info-value">{registry.chainId || '-'}</span>
          </div>
          <div className="network-info-item">
            <span className="network-info-label">Registry Address:</span>
            <span className="network-info-value">
              {registry.registryAddress ? `${registry.registryAddress.substring(0, 10)}...` : '-'}
            </span>
          </div>
          <div className="network-info-item">
            <span className="network-info-label">Min Stake:</span>
            <span className="network-info-value">{registry.minStake || '-'}</span>
          </div>
          <div className="network-info-item">
            <span className="network-info-label">Registered Relays:</span>
            <span className="network-info-value">{formatNumber(registeredRelays)}</span>
          </div>
        </div>
      </div>

      {lastUpdated && (
        <div className="network-footer">
          Last updated: {lastUpdated.toLocaleTimeString()}
          <button className="btn btn-secondary btn-sm" onClick={fetchAll}>🔄 Refresh</button>
        </div>
      )}
    </div>
  )
}

export default Network
