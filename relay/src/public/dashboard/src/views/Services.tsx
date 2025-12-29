import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import './Services.css'

interface ServiceStatus {
  name: string
  status: 'online' | 'offline' | 'error' | 'maintenance'
  uptime?: string
  lastCheck?: number
  pid?: number
  logs?: string[]
}

function Services() {
  const { isAuthenticated, getAuthHeaders } = useAuth()
  const [services, setServices] = useState<ServiceStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingAction, setLoadingAction] = useState<string | null>(null)
  
  // Selected Service for logs/details
  const [selectedService, setSelectedService] = useState<string | null>(null)
  const [serviceLogs, setServiceLogs] = useState<string[]>([])

  const fetchServices = async () => {
    try {
      const res = await fetch('/api/v1/system/services', { headers: getAuthHeaders() })
      const data = await res.json()
      if (data.services) {
        setServices(data.services)
      } else {
        // Fallback mock for development if API not fully ready
        setServices([
           { name: 'Gun Relay', status: 'online', uptime: '2d 4h', pid: 1234 },
           { name: 'IPFS Node', status: 'online', uptime: '5d 1h', pid: 5678 },
           { name: 'Holster', status: 'online', uptime: '2d 4h', pid: 9101 },
           { name: 'RPC Server', status: 'offline', pid: 0 },
           { name: 'Torrent Client', status: 'online', uptime: '12h', pid: 1122 }
        ])
      }
    } catch (e) {
      console.error('Failed to fetch services', e)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    if (isAuthenticated) fetchServices()
  }, [isAuthenticated])

  const handleServiceAction = async (serviceName: string, action: 'restart' | 'stop' | 'start') => {
    if (!confirm(`${action.toUpperCase()} service: ${serviceName}?`)) return
    
    setLoadingAction(serviceName)
    try {
      await fetch('/api/v1/system/services/control', {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ service: serviceName, action })
      })
      // Wait a bit then refresh
      setTimeout(() => {
        fetchServices()
        setLoadingAction(null)
      }, 2000)
    } catch (e) {
      console.error(e)
      setLoadingAction(null)
    }
  }

  const handleGlobalAction = async (action: 'health' | 'restart-all') => {
      if (action === 'restart-all' && !confirm('Are you sure you want to RESTART ALL services? This will disrupt the relay.')) return

      setRefreshing(true)
      try {
          if (action === 'health') {
              const res = await fetch('/health')
              const data = await res.json()
              alert(`Health Check: ${data.status}\nUptime: ${data.uptime?.seconds}s\nMemory: ${data.memory?.heapUsedMB} MB`)
          } else if (action === 'restart-all') {
             await fetch('/api/v1/system/services/restart-all', { 
                 method: 'POST',
                 headers: getAuthHeaders() 
             })
             alert('Restart command sent. Services will reboot.')
             setTimeout(fetchServices, 5000)
          }
      } catch(e) {
          alert('Action failed: ' + e)
      } finally {
          setRefreshing(false)
      }
  }

  const fetchLogs = async (serviceName: string) => {
    setSelectedService(serviceName)
    setServiceLogs(['Loading logs...'])
    try {
      const res = await fetch(`/api/v1/system/services/${serviceName}/logs`, { headers: getAuthHeaders() })
      const data = await res.json()
      if (data.logs) {
        setServiceLogs(data.logs)
      } else {
        setServiceLogs(['No logs available or failed to fetch.'])
      }
    } catch (e) {
      setServiceLogs(['Error fetching logs.'])
    }
  }

  if (!isAuthenticated) return <div className="card"><h3>Authentication Required</h3></div>

  return (
    <div className="services-page">
      <div className="services-header card">
        <div>
          <h2>🛠️ System Services</h2>
          <p>Monitor and control relay subsystems</p>
        </div>
        <div className="flex gap-2">
            <button 
              className="btn btn-secondary" 
              onClick={() => { setRefreshing(true); fetchServices() }}
              disabled={refreshing}
            >
              {refreshing ? 'Refreshing...' : '🔄 Refresh'}
            </button>
            <button 
              className="btn btn-primary" 
              onClick={() => handleGlobalAction('health')}
              disabled={refreshing}
            >
              ❤️ Health Check
            </button>
            <button 
              className="btn btn-warning" 
              onClick={() => handleGlobalAction('restart-all')}
              disabled={refreshing}
            >
              ⚡ Restart All
            </button>
        </div>
      </div>

      <div className="services-layout">
        <div className="services-list">
          {loading ? <div className="loading">Loading services...</div> : (
            services.map(svc => (
              <div key={svc.name} className={`service-card card ${svc.status}`}>
                <div className="service-info">
                  <div className="service-name-row">
                    <h3>{svc.name}</h3>
                    <span className={`status-badge ${svc.status}`}>{svc.status}</span>
                  </div>
                  <div className="service-metrics">
                    <p>Uptime: {svc.uptime || 'N/A'}</p>
                    <p>PID: {svc.pid || '-'}</p>
                  </div>
                </div>
                <div className="service-actions">
                  <button 
                    className="btn btn-sm btn-secondary"
                    onClick={() => fetchLogs(svc.name)}
                  >
                    📃 Logs
                  </button>
                  <button 
                    className="btn btn-sm btn-warning"
                    disabled={loadingAction === svc.name}
                    onClick={() => handleServiceAction(svc.name, 'restart')}
                  >
                    {loadingAction === svc.name ? '...' : '⚡ Restart'}
                  </button>
                  {svc.status === 'online' ? (
                     <button 
                       className="btn btn-sm btn-danger"
                       disabled={loadingAction === svc.name}
                       onClick={() => handleServiceAction(svc.name, 'stop')}
                     >
                       🛑 Stop
                     </button>
                  ) : (
                     <button 
                       className="btn btn-sm btn-success"
                       disabled={loadingAction === svc.name}
                       onClick={() => handleServiceAction(svc.name, 'start')}
                     >
                       ▶ Start
                     </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Logs Panel */}
        {selectedService && (
          <div className="logs-panel card">
            <div className="logs-header">
              <h3>Term: {selectedService}</h3>
              <button className="btn-close" onClick={() => setSelectedService(null)}>×</button>
            </div>
            <div className="logs-content">
              {serviceLogs.map((log, i) => (
                <div key={i} className="log-line">{log}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default Services
