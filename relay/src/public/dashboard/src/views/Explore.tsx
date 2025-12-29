import { useState, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import './Explore.css'

interface ExploreResult {
  keys?: string[]
  stats?: Record<string, any>
  error?: string
}

function Explore() {
  const { isAuthenticated, getAuthHeaders } = useAuth()
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [exploreData, setExploreData] = useState<ExploreResult | null>(null)

  // Use available API endpoints instead of non-existent graph/get
  const fetchNetworkStats = useCallback(async () => {
    setLoading(true)
    setStatus('Loading network data...')
    try {
      const res = await fetch('/api/v1/network/stats')
      const data = await res.json()
      if (data.success) {
        setExploreData({ stats: data.stats })
        setStatus('')
      } else {
        setStatus('No data available')
      }
    } catch (error) {
      console.error('Failed:', error)
      setStatus('Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchSystemInfo = useCallback(async () => {
    setLoading(true)
    setStatus('Loading system info...')
    try {
      const res = await fetch('/health')
      const data = await res.json()
      setExploreData({ stats: data })
      setStatus('')
    } catch (error) {
      setStatus('Failed to load system info')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchIPFSPins = useCallback(async () => {
    if (!isAuthenticated) {
      setStatus('Authentication required')
      return
    }
    setLoading(true)
    setStatus('Loading IPFS pins...')
    try {
      const res = await fetch('/api/v1/ipfs/pin/ls', { headers: getAuthHeaders() })
      const data = await res.json()
      if (data.pins) {
        const keys = Object.keys(data.pins)
        setExploreData({ keys, stats: { totalPins: keys.length } })
        setStatus('')
      }
    } catch (error) {
      setStatus('Failed to load pins')
    } finally {
      setLoading(false)
    }
  }, [isAuthenticated, getAuthHeaders])

  const renderData = () => {
    if (!exploreData) return null

    return (
      <div className="explore-data">
        {exploreData.stats && (
          <div className="explore-stats">
            {Object.entries(exploreData.stats).map(([key, value]) => (
              <div key={key} className="explore-stat-item">
                <span className="explore-stat-key">{key}</span>
                <span className="explore-stat-value">
                  {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
                </span>
              </div>
            ))}
          </div>
        )}
        {exploreData.keys && exploreData.keys.length > 0 && (
          <div className="explore-keys">
            <h4>Keys ({exploreData.keys.length})</h4>
            <div className="explore-keys-list">
              {exploreData.keys.slice(0, 20).map(key => (
                <div key={key} className="explore-key-item">
                  <code>{key}</code>
                </div>
              ))}
              {exploreData.keys.length > 20 && (
                <p className="explore-more">...and {exploreData.keys.length - 20} more</p>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="explore-page">
      {/* Header */}
      <div className="card explore-header">
        <h2>🌐 System Explorer</h2>
        <p>Inspect relay data, network stats, and IPFS content</p>
      </div>

      {/* Quick Actions */}
      <div className="card explore-section">
        <h3>Quick Explore</h3>
        <p className="explore-hint">
          Select a data source to explore available information
        </p>
        <div className="explore-actions">
          <button className="btn btn-primary" onClick={fetchSystemInfo} disabled={loading}>
            🔍 Health Status
          </button>
          <button className="btn btn-primary" onClick={fetchNetworkStats} disabled={loading}>
            📊 Network Stats
          </button>
          <button className="btn btn-primary" onClick={fetchIPFSPins} disabled={loading}>
            📁 IPFS Pins
          </button>
        </div>
        {status && <p className="explore-status">{status}</p>}
      </div>

      {/* Results */}
      {exploreData && (
        <div className="card explore-section">
          <h3>Results</h3>
          {loading ? (
            <div className="explore-loading">Loading...</div>
          ) : (
            renderData()
          )}
        </div>
      )}

      {/* Info */}
      <div className="card explore-section explore-info">
        <h3>ℹ️ About</h3>
        <p>
          This explorer provides access to relay data through available API endpoints.
          For direct GunDB graph exploration, use the browser console with <code>window.gun</code>.
        </p>
      </div>
    </div>
  )
}

export default Explore
