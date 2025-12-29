import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area } from 'recharts';
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
  const [history, setHistory] = useState<any[]>([])

  useEffect(() => {
    loadStats()
    const interval = setInterval(loadStats, 5000) // Poll every 5 seconds for live charts
    return () => clearInterval(interval)
  }, [])

  const loadStats = async () => {
    try {
        // Use system/stats.json as the primary reliable source
        const response = await fetch('/api/v1/system/stats.json')
        if (response.ok) {
            const data = await response.json()
            setStats(data)
            
            // Update history for charts
            setHistory(prev => {
                const now = new Date().toLocaleTimeString()
                const newPoint = {
                    time: now,
                    memory: (data.memory?.heapUsed || 0) / 1024 / 1024, // MB
                    peers: data.peers?.count || 0,
                    damIn: data.dam?.in?.count || 0,
                    damOut: data.dam?.out?.count || 0
                }
                const newHistory = [...prev, newPoint]
                return newHistory.slice(-20) // Keep last 20 points
            })
        }
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

  if (loading && history.length === 0) {
    return <div className="charts-loading">Loading metrics...</div>
  }

  return (
    <div className="charts-page">
      <div className="charts-header card">
        <div>
          <h2>📊 Charts & Metrics</h2>
          <p>Real-time system performance monitoring</p>
        </div>
        <div className="header-stats">
            <span className="stat-badge">
                Ping: {new Date().toLocaleTimeString()}
            </span>
            <span className="stat-badge success">
                Status: Online
            </span>
        </div>
      </div>

      <div className="charts-grid-layout">
          {/* Memory Usage Chart */}
          <div className="chart-container card">
              <h3>🧠 Memory Usage (MB)</h3>
              <div className="chart-wrapper">
                  <ResponsiveContainer width="100%" height={300}>
                      <AreaChart data={history}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                          <XAxis dataKey="time" stroke="#888" />
                          <YAxis stroke="#888" />
                          <Tooltip 
                            contentStyle={{ backgroundColor: '#2a2a2a', border: 'none' }}
                            itemStyle={{ color: '#fff' }}
                          />
                          <Area type="monotone" dataKey="memory" stroke="#8884d8" fill="#8884d8" fillOpacity={0.3} />
                      </AreaChart>
                  </ResponsiveContainer>
              </div>
          </div>

          {/* Peers Chart */}
          <div className="chart-container card">
              <h3>👥 Connected Peers</h3>
              <div className="chart-wrapper">
                  <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={history}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                          <XAxis dataKey="time" stroke="#888" />
                          <YAxis allowDecimals={false} stroke="#888" />
                          <Tooltip 
                            contentStyle={{ backgroundColor: '#2a2a2a', border: 'none' }}
                            itemStyle={{ color: '#fff' }}
                          />
                          <Line type="step" dataKey="peers" stroke="#82ca9d" strokeWidth={2} />
                      </LineChart>
                  </ResponsiveContainer>
              </div>
          </div>

          {/* Request Metrics */}
           <div className="chart-container card full-width">
              <h3>📡 DAM Request Traffic</h3>
              <div className="chart-wrapper">
                  <ResponsiveContainer width="100%" height={300}>
                      <AreaChart data={history}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                          <XAxis dataKey="time" stroke="#888" />
                          <YAxis stroke="#888" />
                          <Tooltip 
                            contentStyle={{ backgroundColor: '#2a2a2a', border: 'none' }}
                            itemStyle={{ color: '#fff' }}
                          />
                          <Legend />
                          <Area type="monotone" dataKey="damIn" name="Incoming (In)" stroke="#ffc658" fill="#ffc658" stackId="1" />
                          <Area type="monotone" dataKey="damOut" name="Outgoing (Out)" stroke="#ff7300" fill="#ff7300" stackId="1" />
                      </AreaChart>
                  </ResponsiveContainer>
              </div>
          </div>
      </div>

      {/* Raw Stats Grid */}
      <div className="stats-cards-grid">
           <div className="stat-card card">
               <div className="value">{formatUptime(stats.up?.time / 1000)}</div>
               <div className="label">Uptime</div>
           </div>
           <div className="stat-card card">
               <div className="value">{formatBytes(stats.memory?.heapUsed)}</div>
               <div className="label">Heap Used</div>
           </div>
            <div className="stat-card card">
               <div className="value">{stats.cpu?.user ? (stats.cpu.user / 1000000).toFixed(2) + 's' : '-'}</div>
               <div className="label">CPU User</div>
           </div>
           <div className="stat-card card">
               <div className="value">{stats.version || '1.0.0'}</div>
               <div className="label">Version</div>
           </div>
      </div>
    </div>
  )
}

export default Charts
