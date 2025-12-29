import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import './Services.css'

interface ServiceStatus {
  name: string
  status: 'online' | 'offline' | 'warning'
  details?: string
}

function Services() {
  const { isAuthenticated, getAuthHeaders } = useAuth()
  const [services, setServices] = useState<ServiceStatus[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchServices() {
      try {
        // Fetch health to get basic status
        const [healthRes, ipfsRes] = await Promise.all([
          fetch('/api/v1/health'),
          fetch('/api/v1/ipfs/id', { headers: getAuthHeaders() }).catch(() => null)
        ])
        
        const healthData = await healthRes.json()
        
        const servicesList: ServiceStatus[] = [
          { 
            name: 'Gun Relay', 
            status: healthData.success ? 'online' : 'offline',
            details: healthData.data?.relayName || 'GunDB Relay Server'
          },
          { 
            name: 'IPFS Node', 
            status: ipfsRes?.ok ? 'online' : 'warning',
            details: 'InterPlanetary File System'
          },
          { 
            name: 'Deals Service', 
            status: healthData.data?.dealsEnabled ? 'online' : 'offline',
            details: 'Decentralized storage deals'
          },
          { 
            name: 'X402 Payments', 
            status: healthData.data?.x402Enabled ? 'online' : 'offline',
            details: 'HTTP 402 payment protocol'
          },
        ]
        
        setServices(servicesList)
      } catch (error) {
        console.error('Failed to fetch services:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchServices()
    const interval = setInterval(fetchServices, 30000)
    return () => clearInterval(interval)
  }, [getAuthHeaders])

  const getStatusClass = (status: string) => {
    switch (status) {
      case 'online': return 'online'
      case 'offline': return 'offline'
      default: return 'warning'
    }
  }

  if (loading) {
    return <div className="services-loading">Loading services...</div>
  }

  return (
    <div className="services-page">
      <div className="services-header">
        <h2>System Services</h2>
        <button className="btn btn-secondary" onClick={() => window.location.reload()}>
          🔄 Refresh
        </button>
      </div>

      <div className="services-grid grid grid-2">
        {services.map(service => (
          <div key={service.name} className="service-card card">
            <div className="service-header">
              <span className={`status-dot ${getStatusClass(service.status)}`}></span>
              <span className="service-name">{service.name}</span>
              <span className={`service-status ${getStatusClass(service.status)}`}>
                {service.status}
              </span>
            </div>
            {service.details && (
              <p className="service-details">{service.details}</p>
            )}
          </div>
        ))}
      </div>

      {!isAuthenticated && (
        <div className="services-warning card">
          <span>🔒</span>
          <p>Authenticate to access service controls and detailed monitoring.</p>
        </div>
      )}
    </div>
  )
}

export default Services
