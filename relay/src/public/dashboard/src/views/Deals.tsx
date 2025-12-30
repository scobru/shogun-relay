import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'

interface DealStats {
  total: number
  active: number
  completed: number
  expired: number
  totalSizeMB: number
  totalRevenue: number
}

interface Deal {
  id: string
  cid: string
  clientAddress: string
  sizeMB: number
  tier: string
  status: string
  createdAt: number
  expiresAt: number
  pricing?: { totalPriceUSDC: number }
}

function Deals() {
  const { isAuthenticated, getAuthHeaders } = useAuth()
  const [stats, setStats] = useState<DealStats | null>(null)
  const [deals, setDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'stats' | 'active' | 'all'>('stats')

  useEffect(() => {
    if (isAuthenticated) { fetchStats(); fetchDeals() }
  }, [isAuthenticated])

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/v1/deals/stats', { headers: getAuthHeaders() })
      const data = await res.json()
      if (data.success) setStats(data.stats)
    } catch (error) { console.error('Failed to fetch deal stats:', error) }
  }

  const fetchDeals = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/v1/deals/relay/active', { headers: getAuthHeaders() })
      const data = await res.json()
      if (data.success) setDeals(data.activeDeals || [])
    } catch (error) { console.error('Failed to fetch deals:', error) }
    finally { setLoading(false) }
  }

  const formatDate = (ts: number) => new Date(ts).toLocaleDateString()
  const formatAddress = (addr: string) => `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`

  if (!isAuthenticated) {
    return <div className="alert alert-warning"><span>🔒</span><span>Authentication required to view storage deals.</span></div>
  }

  return (
    <div className="flex flex-col gap-6 max-w-6xl">
      {/* Header */}
      <div className="card bg-base-100 shadow-sm">
        <div className="card-body flex-row items-center justify-between">
          <div>
            <h2 className="card-title">💼 Storage Deals</h2>
            <p className="text-base-content/60">Manage and monitor decentralized storage agreements</p>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => { fetchStats(); fetchDeals() }}>
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="stats stats-vertical lg:stats-horizontal shadow w-full">
          <div className="stat">
            <div className="stat-figure text-primary text-2xl">📊</div>
            <div className="stat-title">Total Deals</div>
            <div className="stat-value text-primary">{stats.total}</div>
          </div>
          <div className="stat">
            <div className="stat-figure text-success text-2xl">✅</div>
            <div className="stat-title">Active</div>
            <div className="stat-value text-success">{stats.active}</div>
          </div>
          <div className="stat">
            <div className="stat-figure text-secondary text-2xl">💾</div>
            <div className="stat-title">Storage</div>
            <div className="stat-value">{stats.totalSizeMB.toFixed(1)}</div>
            <div className="stat-desc">MB</div>
          </div>
          <div className="stat">
            <div className="stat-figure text-warning text-2xl">💰</div>
            <div className="stat-title">Revenue</div>
            <div className="stat-value text-warning">{stats.totalRevenue.toFixed(2)}</div>
            <div className="stat-desc">USDC</div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div role="tablist" className="tabs tabs-boxed">
        <button className={`tab ${activeTab === 'stats' ? 'tab-active' : ''}`} onClick={() => setActiveTab('stats')}>📊 Statistics</button>
        <button className={`tab ${activeTab === 'active' ? 'tab-active' : ''}`} onClick={() => setActiveTab('active')}>✅ Active</button>
        <button className={`tab ${activeTab === 'all' ? 'tab-active' : ''}`} onClick={() => setActiveTab('all')}>📋 All</button>
      </div>

      {/* Content */}
      <div className="card bg-base-100 shadow-sm">
        <div className="card-body">
          {activeTab === 'stats' && stats && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-base-200 p-4 rounded-lg flex justify-between"><span>Completed Deals:</span><strong>{stats.completed}</strong></div>
              <div className="bg-base-200 p-4 rounded-lg flex justify-between"><span>Expired Deals:</span><strong>{stats.expired}</strong></div>
              <div className="bg-base-200 p-4 rounded-lg flex justify-between"><span>Avg Deal Size:</span><strong>{stats.total > 0 ? (stats.totalSizeMB / stats.total).toFixed(2) : 0} MB</strong></div>
              <div className="bg-base-200 p-4 rounded-lg flex justify-between"><span>Avg Revenue:</span><strong>{stats.total > 0 ? (stats.totalRevenue / stats.total).toFixed(2) : 0} USDC</strong></div>
            </div>
          )}

          {(activeTab === 'active' || activeTab === 'all') && (
            <div>
              {loading ? (
                <div className="flex justify-center p-8"><span className="loading loading-spinner loading-lg"></span></div>
              ) : deals.length === 0 ? (
                <div className="text-center py-8 text-base-content/50">
                  <span className="text-4xl block mb-2">📭</span>
                  <p>No deals found</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table table-zebra">
                    <thead>
                      <tr>
                        <th>Deal ID</th><th>Client</th><th>CID</th><th>Size</th><th>Tier</th><th>Status</th><th>Created</th><th>Expires</th><th>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deals.map((deal) => (
                        <tr key={deal.id}>
                          <td className="font-mono text-xs">{deal.id.substring(0, 8)}...</td>
                          <td className="font-mono text-xs">{formatAddress(deal.clientAddress)}</td>
                          <td className="font-mono text-xs" title={deal.cid}>{deal.cid.substring(0, 12)}...</td>
                          <td>{deal.sizeMB.toFixed(2)} MB</td>
                          <td><span className="badge badge-outline">{deal.tier}</span></td>
                          <td><span className={`badge ${deal.status === 'active' ? 'badge-success' : 'badge-ghost'}`}>{deal.status}</span></td>
                          <td>{formatDate(deal.createdAt)}</td>
                          <td>{formatDate(deal.expiresAt)}</td>
                          <td>{deal.pricing?.totalPriceUSDC?.toFixed(2) || '0'} USDC</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default Deals
