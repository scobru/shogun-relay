import { useState, useCallback } from 'react'
import './Explore.css'

interface GraphNode {
  [key: string]: any
}

function Explore() {
  const [path, setPath] = useState('')
  const [currentPath, setCurrentPath] = useState('')
  const [data, setData] = useState<GraphNode | null>(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')

  const explorePath = useCallback(async (pathToExplore: string) => {
    if (!pathToExplore.trim()) {
      setStatus('Enter a path to explore')
      return
    }
    
    setLoading(true)
    setStatus('Loading...')
    setCurrentPath(pathToExplore)
    
    try {
      // Use the admin API to explore Gun data
      const res = await fetch(`/api/v1/admin/graph/get?path=${encodeURIComponent(pathToExplore)}`)
      const result = await res.json()
      
      if (result.success && result.data) {
        setData(result.data)
        setStatus('')
      } else {
        // Try a simpler approach - just show that the path was set
        setData(null)
        setStatus('Path set. Use Gun client to explore live data.')
      }
    } catch (error) {
      console.error('Failed to explore path:', error)
      setStatus('Note: Graph API not available. Use the browser console with window.gun to explore.')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const navigateToKey = (key: string) => {
    const newPath = currentPath ? `${currentPath}.${key}` : key
    setPath(newPath)
    explorePath(newPath)
  }

  const goToRoot = () => {
    setPath('')
    setCurrentPath('')
    setData(null)
    setStatus('')
  }

  const renderValue = (key: string, value: any): JSX.Element => {
    if (value === null) {
      return <span className="explore-value null">null</span>
    }
    
    if (typeof value === 'object') {
      // Check for Gun reference
      if (value['#']) {
        return (
          <span 
            className="explore-value link" 
            onClick={() => navigateToKey(key)}
            title={`Follow link: ${value['#']}`}
          >
            🔗 {value['#'].slice(0, 20)}...
          </span>
        )
      }
      return (
        <span 
          className="explore-value object"
          onClick={() => navigateToKey(key)}
        >
          📁 {Object.keys(value).filter(k => k !== '_').length} properties
        </span>
      )
    }
    
    if (typeof value === 'string') {
      if (value.length > 50) {
        return <span className="explore-value string" title={value}>{value.slice(0, 50)}...</span>
      }
      return <span className="explore-value string">"{value}"</span>
    }
    
    if (typeof value === 'number') {
      return <span className="explore-value number">{value}</span>
    }
    
    if (typeof value === 'boolean') {
      return <span className="explore-value boolean">{value.toString()}</span>
    }
    
    return <span className="explore-value">{String(value)}</span>
  }

  const renderData = () => {
    if (!data) return null
    
    const keys = Object.keys(data).filter(k => k !== '_' && k !== '#')
    
    if (keys.length === 0) {
      return <div className="explore-empty">No properties found at this path</div>
    }
    
    return (
      <div className="explore-properties">
        {keys.sort().map(key => (
          <div key={key} className="explore-property">
            <div className="explore-key">{key}</div>
            <div className="explore-value-container">
              {renderValue(key, data[key])}
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="explore-page">
      {/* Header */}
      <div className="card explore-header">
        <h2>🌐 GunDB Graph Explorer</h2>
        <p>Inspect GunDB data and traverse linked nodes</p>
      </div>

      {/* Path Input */}
      <div className="card explore-section">
        <h3>Graph Console</h3>
        <p className="explore-hint">
          Enter a Gun path (e.g., <code>shogun-relay.logs</code> or <code>users.alice</code>)
        </p>
        <div className="explore-input-row">
          <input
            type="text"
            className="input"
            placeholder="Enter Gun path to explore..."
            value={path}
            onChange={e => setPath(e.target.value)}
            onKeyPress={e => e.key === 'Enter' && explorePath(path)}
          />
          <button className="btn btn-primary" onClick={() => explorePath(path)} disabled={loading}>
            {loading ? 'Loading...' : 'Explore'}
          </button>
        </div>
        {status && <p className="explore-status">{status}</p>}
      </div>

      {/* Current Path */}
      {currentPath && (
        <div className="card explore-section">
          <div className="explore-path-header">
            <button className="btn btn-secondary btn-sm" onClick={goToRoot}>
              ⬅️ Root
            </button>
            <span className="explore-current-path">
              <strong>Path:</strong> <code>{currentPath}</code>
            </span>
          </div>
        </div>
      )}

      {/* Data Display */}
      {(data || currentPath) && (
        <div className="card explore-section">
          <h3>Node Data</h3>
          {loading ? (
            <div className="explore-loading">Loading...</div>
          ) : data ? (
            renderData()
          ) : (
            <div className="explore-empty">
              <p>No data loaded. The Graph API may need authentication.</p>
              <p className="explore-hint">
                For direct exploration, open browser console and use:
                <code>gun.get('{currentPath}').once(console.log)</code>
              </p>
            </div>
          )}
        </div>
      )}

      {/* Quick Links */}
      <div className="card explore-section">
        <h3>Quick Explore</h3>
        <div className="explore-quick-links">
          <button className="btn btn-secondary" onClick={() => { setPath('shogun-relay'); explorePath('shogun-relay'); }}>
            shogun-relay
          </button>
          <button className="btn btn-secondary" onClick={() => { setPath('relays'); explorePath('relays'); }}>
            relays
          </button>
          <button className="btn btn-secondary" onClick={() => { setPath('users'); explorePath('users'); }}>
            users
          </button>
          <button className="btn btn-secondary" onClick={() => { setPath('deals'); explorePath('deals'); }}>
            deals
          </button>
        </div>
      </div>

      {/* Tools Links */}
      <div className="card explore-section">
        <h3>Advanced Tools</h3>
        <div className="explore-tools">
          <a href="/graph.html" target="_blank" className="explore-tool-link">
            <span>🔍</span>
            <div>
              <strong>Full Graph Explorer</strong>
              <p>Original graph explorer with auth and write support</p>
            </div>
          </a>
          <a href="/visualGraph.html" target="_blank" className="explore-tool-link">
            <span>🎨</span>
            <div>
              <strong>Visual Graph</strong>
              <p>Interactive visual graph representation</p>
            </div>
          </a>
        </div>
      </div>
    </div>
  )
}

export default Explore
