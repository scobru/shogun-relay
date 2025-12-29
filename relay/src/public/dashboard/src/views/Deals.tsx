import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import './Deals.css'

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
  pricing?: {
    totalPriceUSDC: number
  }
}

function Deals() {
  const { isAuthenticated, getAuthHeaders } = useAuth()
  const [stats, setStats] = useState<DealStats | null>(null)
  const [deals, setDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'stats' | 'active' | 'all'>('stats')

  useEffect(() => {
    if (isAuthenticated) {
      fetchStats()
      fetchDeals()
    }
  }, [isAuthenticated])

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/v1/deals/stats', { headers: getAuthHeaders() })
      const data = await res.json()
      if (data.success) {
        setStats(data.stats)
      }
    } catch (error) {
      console.error('Failed to fetch deal stats:', error)
    }
  }

  const fetchDeals = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/v1/deals/relay/active', { headers: getAuthHeaders() })
      const data = await res.json()
      if (data.success) {
        setDeals(data.deals || [])
      }
    } catch (error) {
      console.error('Failed to fetch deals:', error)
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString()
  }

  const formatAddress = (address: string) => {
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`
  }

  if (!isAuthenticated) {
    return (
      <div className="deals-page">
        <div className="card">
          <h3>Authentication Required</h3>
          <p>Please authenticate to view storage deals.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="deals-page">
      {/* Header */}
      <div className="deals-header card">
        <div>
          <h2>💼 Storage Deals</h2>
          <p>Manage and monitor decentralized storage agreements</p>
        </div>
        <button className="btn btn-primary" onClick={() => { fetchStats(); fetchDeals(); }}>
          🔄 Refresh
        </button>
      </div>

      {/* Stats Grid */}
      {stats && (
        <div className="deals-stats-grid">
          <div className="stat-card card">
            <div className="stat-icon">📊</div>
            <div className="stat-content">
              <div className="stat-value">{stats.total}</div>
              <div className="stat-label">Total Deals</div>
            </div>
          </div>
          <div className="stat-card card">
            <div className="stat-icon">✅</div>
            <div className="stat-content">
              <div className="stat-value">{stats.active}</div>
              <div className="stat-label">Active Deals</div>
            </div>
          </div>
          <div className="stat-card card">
            <div className="stat-icon">💾</div>
            <div className="stat-content">
              <div className="stat-value">{stats.totalSizeMB.toFixed(2)}</div>
              <div className="stat-label">Total Size (MB)</div>
            </div>
          </div>
          <div className="stat-card card">
            <div className="stat-icon">💰</div>
            <div className="stat-content">
              <div className="stat-value">{stats.totalRevenue.toFixed(2)}</div>
              <div className="stat-label">Revenue (USDC)</div>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="deals-tabs card">
        <button 
          className={`tab ${activeTab === 'stats' ? 'active' : ''}`}
          onClick={() => setActiveTab('stats')}
        >
          📊 Statistics
        </button>
        <button 
          className={`tab ${activeTab === 'active' ? 'active' : ''}`}
          onClick={() => setActiveTab('active')}
        >
          ✅ Active Deals
        </button>
        <button 
          className={`tab ${activeTab === 'all' ? 'active' : ''}`}
          onClick={() => setActiveTab('all')}
        >
          📋 All Deals
        </button>
      </div>

      {/* Content */}
      <div className="deals-content card">
        {activeTab === 'stats' && stats && (
          <div className="stats-details">
            <h3>Deal Statistics</h3>
            <div className="stats-list">
              <div className="stat-item">
                <span className="label">Completed Deals:</span>
                <span className="value">{stats.completed}</span>
              </div>
              <div className="stat-item">
                <span className="label">Expired Deals:</span>
                <span className="value">{stats.expired}</span>
              </div>
              <div className="stat-item">
                <span className="label">Average Deal Size:</span>
                <span className="value">{stats.total > 0 ? (stats.totalSizeMB / stats.total).toFixed(2) : 0} MB</span>
              </div>
              <div className="stat-item">
                <span className="label">Average Revenue per Deal:</span>
                <span className="value">{stats.total > 0 ? (stats.totalRevenue / stats.total).toFixed(2) : 0} USDC</span>
              </div>
            </div>
          </div>
        )}

        {(activeTab === 'active' || activeTab === 'all') && (
          <div className="deals-list">
            <h3>{activeTab === 'active' ? 'Active Deals' : 'All Deals'}</h3>
            {loading ? (
              <div className="loading">Loading deals...</div>
            ) : deals.length === 0 ? (
              <div className="empty-state">
                <span>📭</span>
                <p>No deals found</p>
              </div>
            ) : (
              <div className="deals-table-wrapper">
                <table className="deals-table">
                  <thead>
                    <tr>
                      <th>Deal ID</th>
                      <th>Client</th>
                      <th>CID</th>
                      <th>Size</th>
                      <th>Tier</th>
                      <th>Status</th>
                      <th>Created</th>
                      <th>Expires</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deals.map((deal: Deal) => (
                      <tr key={deal.id}>
                        <td className="mono">{deal.id.substring(0, 8)}...</td>
                        <td className="mono">{formatAddress(deal.clientAddress)}</td>
                        <td className="mono" title={deal.cid}>{deal.cid.substring(0, 12)}...</td>
                        <td>{deal.sizeMB.toFixed(2)} MB</td>
                        <td><span className="tier-badge">{deal.tier}</span></td>
                        <td><span className={`status-badge ${deal.status}`}>{deal.status}</span></td>
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
  )
}

export default Deals
