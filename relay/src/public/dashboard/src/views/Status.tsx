import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import './Status.css'

interface HealthData {
  status: string
  relayName: string
  version?: string
  uptime?: number
}

interface StatsData {
  peers?: { count: number }
  memory?: { heapUsed: number }
}

function Status() {
  const { isAuthenticated } = useAuth()
  const [health, setHealth] = useState<HealthData | null>(null)
  const [stats, setStats] = useState<StatsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchData() {
      try {
        const [healthRes, statsRes] = await Promise.all([
          fetch('/api/v1/health'),
          fetch('/api/v1/system/stats.json')
        ])
        
        const healthData = await healthRes.json()
        const statsData = await statsRes.json()
        
        setHealth(healthData.data || healthData)
        setStats(statsData)
      } catch (error) {
        console.error('Failed to fetch status:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
    const interval = setInterval(fetchData, 10000)
    return () => clearInterval(interval)
  }, [])

  const formatUptime = (ms: number) => {
    const hours = Math.floor(ms / 1000 / 60 / 60)
    const minutes = Math.floor((ms / 1000 / 60) % 60)
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
  }

  if (loading) {
    return <div className="status-loading">Loading...</div>
  }

  return (
    <div className="status-page">
      {/* Welcome Card */}
      <div className="status-welcome card">
        <div className="status-welcome-header">
          <div className="status-welcome-icon">⚡</div>
          <div>
            <h2 className="status-welcome-title">{health?.relayName || 'Shogun Relay'}</h2>
            <p className="status-welcome-subtitle">Decentralized infrastructure powered by GunDB & IPFS</p>
          </div>
        </div>
        <div className="status-welcome-badge">
          <span className="status-dot online"></span>
          <span>Relay Online</span>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="status-stats grid grid-4">
        <div className="status-stat card">
          <div className="status-stat-icon">🌐</div>
          <div className="status-stat-value">{stats?.peers?.count || 0}</div>
          <div className="status-stat-label">Connected Peers</div>
        </div>
        <div className="status-stat card">
          <div className="status-stat-icon">💾</div>
          <div className="status-stat-value">
            {stats?.memory?.heapUsed ? Math.round(stats.memory.heapUsed / 1024 / 1024) : 0}
          </div>
          <div className="status-stat-label">Memory (MB)</div>
        </div>
        <div className="status-stat card">
          <div className="status-stat-icon">⏱️</div>
          <div className="status-stat-value">{health?.uptime ? formatUptime(health.uptime * 1000) : '--'}</div>
          <div className="status-stat-label">Uptime</div>
        </div>
        <div className="status-stat card">
          <div className="status-stat-icon">📦</div>
          <div className="status-stat-value">{health?.version || '--'}</div>
          <div className="status-stat-label">Version</div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="status-actions">
        <h3 className="status-section-title">Quick Actions</h3>
        <div className="status-actions-grid grid grid-3">
          <a href="/dashboard/files" className="status-action card">
            <span className="status-action-icon">📁</span>
            <span className="status-action-title">Upload Files</span>
            <span className="status-action-desc">Pin files to IPFS</span>
          </a>
          <a href="/dashboard/services" className="status-action card">
            <span className="status-action-icon">⚡</span>
            <span className="status-action-title">Services</span>
            <span className="status-action-desc">Manage services</span>
          </a>
          <a href="/dashboard/explore" className="status-action card">
            <span className="status-action-icon">🔍</span>
            <span className="status-action-title">Explore</span>
            <span className="status-action-desc">Browse GunDB</span>
          </a>
        </div>
      </div>

      {/* Auth Status */}
      {!isAuthenticated && (
        <div className="status-auth-warning card">
          <span className="status-auth-icon">🔒</span>
          <div>
            <strong>Limited Access Mode</strong>
            <p>Enter admin password in Settings to unlock all features.</p>
          </div>
        </div>
      )}
    </div>
  )
}

export default Status
