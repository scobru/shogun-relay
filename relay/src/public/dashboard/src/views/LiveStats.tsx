import { useEffect, useState } from 'react'
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

function LiveStats() {
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  useEffect(() => {
    async function fetchStats() {
      try {
        const response = await fetch('/api/v1/system/stats.json')
        const data = await response.json()
        setStats(data)
        setLastUpdated(new Date())
      } catch (error) {
        console.error('Failed to fetch stats:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchStats()
    const interval = setInterval(fetchStats, 5000)
    return () => clearInterval(interval)
  }, [])

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
