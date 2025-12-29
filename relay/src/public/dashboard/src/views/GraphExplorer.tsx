import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import './GraphExplorer.css'

interface NodeData {
  [key: string]: any
}

function GraphExplorer() {
  const { isAuthenticated, getAuthHeaders, token: adminToken } = useAuth()
  const [currentPath, setCurrentPath] = useState('shogun')
  const [data, setData] = useState<NodeData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [writing, setWriting] = useState(false)
  
  // New features
  const [newPeer, setNewPeer] = useState('')
  const [peerStatus, setPeerStatus] = useState('')

  useEffect(() => {
    fetchNodeData(currentPath)
  }, [currentPath])

  const fetchNodeData = async (path: string) => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/v1/system/node/${path}`, {
        headers: getAuthHeaders()
      })
      
      const result = await response.json()
      
      if (result.success) {
        setData(result.data)
      } else {
        setError(result.error || 'Failed to fetch node data')
        setData(null)
      }
    } catch (err: any) {
      setError(err.message || 'Network error')
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  const handleNavigate = (key: string) => {
    const nextPath = currentPath ? `${currentPath}/${key}` : key
    setCurrentPath(nextPath)
  }

  const handleJumpToRoot = () => {
    setCurrentPath('shogun')
  }

  const handleBack = () => {
    if (!currentPath || currentPath === 'shogun') return
    const parts = currentPath.split('/')
    parts.pop()
    setCurrentPath(parts.join('/') || 'shogun')
  }

  const handleWrite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newKey || !newValue) return

    setWriting(true)
    try {
      const payload = {
        data: {
          [newKey]: parseValue(newValue)
        }
      }

      const response = await fetch(`/api/v1/system/node/${currentPath}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify(payload)
      })

      const result = await response.json()
      
      if (result.success) {
        setNewKey('')
        setNewValue('')
        fetchNodeData(currentPath) // Refresh
      } else {
        alert('Error: ' + result.error)
      }
    } catch (err) {
      console.error(err)
      alert('Failed to write data')
    } finally {
      setWriting(false)
    }
  }

  const handleAddPeer = async () => {
      if (!newPeer) return
      setPeerStatus('Adding peer...')
      try {
          await fetch('/api/v1/system/peers/add', {
             method: 'POST',
             headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
             body: JSON.stringify({ peerUrl: newPeer })
          }).catch(e => console.warn('API add peer failed, might not be implemented'))

          setPeerStatus(`✅ Added peer request sent: ${newPeer}`)
          setNewPeer('')
      } catch (e) {
          setPeerStatus('❌ Failed to add peer')
      }
  }

  const handleSnapshot = () => {
      const element = document.createElement("a");
      const file = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
      element.href = URL.createObjectURL(file);
      element.download = `shogun-relay-snapshot-${Date.now()}.json`;
      document.body.appendChild(element); 
      element.click();
      document.body.removeChild(element);
  }

  const parseValue = (val: string) => {
    try {
      return JSON.parse(val)
    } catch {
      return val
    }
  }

  const renderValue = (value: any) => {
    if (value === null) return <span className="value-null">null</span>
    if (typeof value === 'object') {
        if (value && '#' in value) {
             return <span className="value-link">Link to: {value['#']}</span>
        }
        return <span className="value-object">{'{Object}'}</span>
    }
    return <span className="value-primitive">{String(value)}</span>
  }

  return (
    <div className="graph-explorer-page">
      <div className="explorer-header card">
        <div className="header-content">
            <div>
                <h2>🔍 Graph Explorer</h2>
                <p>Inspect GunDB nodes and properties</p>
            </div>
            <div className="path-controls">
                <button className="btn btn-neutral btn-sm" onClick={handleBack} disabled={currentPath === 'shogun'}>
                    ⬅ Back
                </button>
                 <button className="btn btn-neutral btn-sm" onClick={handleJumpToRoot}>
                    🏠 Root
                </button>
            </div>
        </div>
        
        <div className="current-path-bar">
            <span className="label">Path:</span>
            <form 
                className="path-form"
                onSubmit={(e) => {
                    e.preventDefault();
                    fetchNodeData(currentPath);
                }}
            >
                <input 
                    type="text" 
                    className="input path-input" 
                    value={currentPath} 
                    onChange={(e) => setCurrentPath(e.target.value)} 
                />
                <button type="submit" className="btn btn-primary btn-sm">Go</button>
            </form>
        </div>
      </div>
      
      {/* Controls Row */}
      <div className="card controls-row">
          <div className="control-group">
              <input 
                 type="text" 
                 className="input input-sm" 
                 placeholder="Add Gun Relay Peer (wss://...)" 
                 value={newPeer} 
                 onChange={e => setNewPeer(e.target.value)}
              />
              <button className="btn btn-sm btn-secondary" onClick={handleAddPeer}>Add Peer</button>
          </div>
          <div className="control-group">
               <button className="btn btn-sm btn-secondary" onClick={handleSnapshot}>⬇ Export Snapshot</button>
          </div>
      </div>
      {peerStatus && <div className="status-text">{peerStatus}</div>}

      <div className="explorer-content card">
        {loading ? (
            <div className="loading-state">Loading...</div>
        ) : error ? (
            <div className="error-state">{error}</div>
        ) : !data || Object.keys(data).length === 0 ? (
            <div className="empty-state">This node is empty or not found.</div>
        ) : (
            <ul className="property-list">
                {Object.entries(data)
                    .filter(([key]) => key !== '_')
                    .sort()
                    .map(([key, value]) => {
                        const isObject = typeof value === 'object' && value !== null
                        return (
                            <li key={key} className="property-item">
                                <div className="property-key">
                                    {key}
                                </div>
                                <div className="property-value">
                                    {renderValue(value)}
                                </div>
                                <div className="property-actions">
                                    {isObject && !value['#'] && (
                                        <button 
                                            className="btn btn-xs btn-primary"
                                            onClick={() => handleNavigate(key)}
                                        >
                                            Explore ➡
                                        </button>
                                    )}
                                </div>
                            </li>
                        )
                    })}
            </ul>
        )}
      </div>

      <div className="write-panel card">
        <h3>✏ Write Operations</h3>
        <form onSubmit={handleWrite} className="write-form">
            <div className="form-group">
                <input 
                    type="text" 
                    placeholder="Key"
                    value={newKey}
                    onChange={e => setNewKey(e.target.value)}
                    className="input input-sm"
                />
            </div>
            <div className="form-group">
                <input 
                    type="text" 
                    placeholder="Value (JSON or string)"
                    value={newValue}
                    onChange={e => setNewValue(e.target.value)}
                    className="input input-sm"
                />
            </div>
            <button 
                type="submit" 
                className="btn btn-primary btn-sm"
                disabled={writing || !isAuthenticated}
            >
                {writing ? 'Writing...' : 'Update Node'}
            </button>
        </form>
        {!isAuthenticated && <p className="auth-warning">Authentication required to write.</p>}
      </div>
    </div>
  )
}

export default GraphExplorer
