import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import './Charts.css'

interface ChartData {
  connections?: number[]
  requests?: number[]
  storage?: number[]
  labels?: string[]
}

function Charts() {
  const { isAuthenticated, getAuthHeaders } = useAuth()
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<Record<string, any>>({})

  useEffect(() => {
    loadStats()
    const interval = setInterval(loadStats, 30000)
    return () => clearInterval(interval)
  }, [])

  const loadStats = async () => {
    try {
      // Load multiple stat sources
      const [healthRes, networkRes, ipfsRes] = await Promise.allSettled([
        fetch('/health'),
        fetch('/api/v1/network/stats'),
        fetch('/api/v1/ipfs/stats')
      ])

      const newStats: Record<string, any> = {}

      if (healthRes.status === 'fulfilled') {
        const data = await healthRes.value.json()
        newStats.health = data
      }

      if (networkRes.status === 'fulfilled') {
        const data = await networkRes.value.json()
        if (data.success) newStats.network = data.stats
      }

      if (ipfsRes.status === 'fulfilled') {
        const data = await ipfsRes.value.json()
        if (data.success) newStats.ipfs = data
      }

      setStats(newStats)
    } catch (error) {
      console.error('Failed to load stats:', error)
    } finally {
      setLoading(false)
    }
  }

  const formatBytes = (bytes: number) => {
    if (!bytes) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const formatUptime = (seconds: number) => {
    if (!seconds) return '-'
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    return `${days}d ${hours}h ${mins}m`
  }

  if (loading) {
    return <div className="charts-loading">Loading metrics...</div>
  }

  return (
    <div className="charts-page">
      <div className="charts-header card">
        <div>
          <h2>📊 Charts & Metrics</h2>
          <p>Performance visualization and system metrics</p>
        </div>
        <button className="btn btn-secondary" onClick={loadStats}>🔄 Refresh</button>
      </div>

      {/* Health Stats */}
      {stats.health && (
        <div className="charts-section">
          <h3>🏥 System Health</h3>
          <div className="charts-grid">
            <div className="chart-card card">
              <div className="chart-card-value">{stats.health.status || 'Unknown'}</div>
              <div className="chart-card-label">Status</div>
            </div>
            <div className="chart-card card">
              <div className="chart-card-value">{formatUptime(stats.health.uptime)}</div>
              <div className="chart-card-label">Uptime</div>
            </div>
            <div className="chart-card card">
              <div className="chart-card-value">{stats.health.connections?.gun || 0}</div>
              <div className="chart-card-label">Gun Connections</div>
            </div>
            <div className="chart-card card">
              <div className="chart-card-value">{stats.health.version || '-'}</div>
              <div className="chart-card-label">Version</div>
            </div>
          </div>
        </div>
      )}

      {/* Network Stats */}
      {stats.network && (
        <div className="charts-section">
          <h3>🌐 Network Stats</h3>
          <div className="charts-grid">
            <div className="chart-card card">
              <div className="chart-card-value">{stats.network.totalRelays || 0}</div>
              <div className="chart-card-label">Total Relays</div>
            </div>
            <div className="chart-card card">
              <div className="chart-card-value">{stats.network.activeRelays || 0}</div>
              <div className="chart-card-label">Active Relays</div>
            </div>
            <div className="chart-card card">
              <div className="chart-card-value">{stats.network.totalDeals || 0}</div>
              <div className="chart-card-label">Total Deals</div>
            </div>
            <div className="chart-card card">
              <div className="chart-card-value">{formatBytes(stats.network.totalStorage || 0)}</div>
              <div className="chart-card-label">Total Storage</div>
            </div>
          </div>
        </div>
      )}

      {/* IPFS Stats */}
      {stats.ipfs && (
        <div className="charts-section">
          <h3>📦 IPFS Stats</h3>
          <div className="charts-grid">
            <div className="chart-card card">
              <div className="chart-card-value">{stats.ipfs.numPins || 0}</div>
              <div className="chart-card-label">Pinned Objects</div>
            </div>
            <div className="chart-card card">
              <div className="chart-card-value">{formatBytes(stats.ipfs.repoSize || 0)}</div>
              <div className="chart-card-label">Repo Size</div>
            </div>
            <div className="chart-card card">
              <div className="chart-card-value">{stats.ipfs.peers || 0}</div>
              <div className="chart-card-label">Connected Peers</div>
            </div>
            <div className="chart-card card">
              <div className="chart-card-value">{stats.ipfs.id ? stats.ipfs.id.slice(0, 12) + '...' : '-'}</div>
              <div className="chart-card-label">Node ID</div>
            </div>
          </div>
        </div>
      )}

      {/* Memory Stats from health */}
      {stats.health?.memory && (
        <div className="charts-section">
          <h3>💾 Memory Usage</h3>
          <div className="charts-grid">
            <div className="chart-card card">
              <div className="chart-card-value">{formatBytes(stats.health.memory.heapUsed)}</div>
              <div className="chart-card-label">Heap Used</div>
            </div>
            <div className="chart-card card">
              <div className="chart-card-value">{formatBytes(stats.health.memory.heapTotal)}</div>
              <div className="chart-card-label">Heap Total</div>
            </div>
            <div className="chart-card card">
              <div className="chart-card-value">{formatBytes(stats.health.memory.rss)}</div>
              <div className="chart-card-label">RSS</div>
            </div>
            <div className="chart-card card">
              <div className="chart-card-value">{formatBytes(stats.health.memory.external)}</div>
              <div className="chart-card-label">External</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Charts
