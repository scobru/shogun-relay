import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area } from 'recharts';


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
    const interval = setInterval(loadStats, 5000)
    return () => clearInterval(interval)
  }, [])

  const loadStats = async () => {
    try {
        const response = await fetch('/api/v1/system/stats.json')
        if (response.ok) {
            const data = await response.json()
            setStats(data)
            
            setHistory(prev => {
                const now = new Date().toLocaleTimeString()
                const newPoint = {
                    time: now,
                    memory: (data.memory?.heapUsed || 0) / 1024 / 1024,
                    peers: data.peers?.count || 0,
                    damIn: data.dam?.in?.count || 0,
                    damOut: data.dam?.out?.count || 0
                }
                const newHistory = [...prev, newPoint]
                return newHistory.slice(-20)
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
    return (
      <div className="flex justify-center p-8">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 max-w-6xl">
      {/* Header */}
      <div className="card bg-base-100 shadow">
        <div className="card-body flex-row items-center justify-between flex-wrap gap-4">
          <div>
            <h2 className="card-title text-2xl">📊 Charts & Metrics</h2>
            <p className="text-base-content/70">Real-time system performance monitoring</p>
          </div>
          <div className="flex gap-2">
            <span className="badge badge-ghost">{new Date().toLocaleTimeString()}</span>
            <span className="badge badge-success">Status: Online</span>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="stats stats-vertical lg:stats-horizontal shadow w-full">
        <div className="stat">
          <div className="stat-title">Uptime</div>
          <div className="stat-value text-lg">{formatUptime(stats.up?.time / 1000)}</div>
        </div>
        <div className="stat">
          <div className="stat-title">Heap Used</div>
          <div className="stat-value text-lg">{formatBytes(stats.memory?.heapUsed)}</div>
        </div>
        <div className="stat">
          <div className="stat-title">CPU User</div>
          <div className="stat-value text-lg">{stats.cpu?.user ? (stats.cpu.user / 1000000).toFixed(2) + 's' : '-'}</div>
        </div>
        <div className="stat">
          <div className="stat-title">Version</div>
          <div className="stat-value text-lg">{stats.version || '1.0.0'}</div>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Memory Usage Chart */}
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h3 className="card-title text-lg">🧠 Memory Usage (MB)</h3>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={history}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                  <XAxis dataKey="time" stroke="#888" fontSize={12} />
                  <YAxis stroke="#888" fontSize={12} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#2a2a2a', border: 'none', borderRadius: '8px' }}
                    itemStyle={{ color: '#fff' }}
                  />
                  <Area type="monotone" dataKey="memory" stroke="#8884d8" fill="#8884d8" fillOpacity={0.3} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Peers Chart */}
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h3 className="card-title text-lg">👥 Connected Peers</h3>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                  <XAxis dataKey="time" stroke="#888" fontSize={12} />
                  <YAxis allowDecimals={false} stroke="#888" fontSize={12} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#2a2a2a', border: 'none', borderRadius: '8px' }}
                    itemStyle={{ color: '#fff' }}
                  />
                  <Line type="step" dataKey="peers" stroke="#82ca9d" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      {/* Full Width Chart */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h3 className="card-title text-lg">📡 DAM Request Traffic</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history}>
                <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                <XAxis dataKey="time" stroke="#888" fontSize={12} />
                <YAxis stroke="#888" fontSize={12} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#2a2a2a', border: 'none', borderRadius: '8px' }}
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
    </div>
  )
}

export default Charts
