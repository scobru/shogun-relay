import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'


interface Torrent {
  infoHash: string
  name: string
  progress: number
  downloadSpeed: number
  uploadSpeed: number
  numPeers: number
  state: 'downloading' | 'seeding' | 'paused' | 'queued' | 'checking' | 'error'
  size: number
  magnetURI?: string
  files?: { name: string, path: string, length: number }[]
}

interface SearchResult {
  title: string
  magnet: string
  size?: string
  seeds?: number
  peers?: number
  source: 'archive' | 'dht' | 'index'
}

function Torrents() {
  const { isAuthenticated, getAuthHeaders } = useAuth()
  const [torrents, setTorrents] = useState<Torrent[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'list' | 'discovery' | 'create'>('list')
  const [statusMsg, setStatusMsg] = useState('')
  
  // Search / Discovery State
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [archiveMode, setArchiveMode] = useState(true) // Internet Archive Mode

  // Create State
  const [magnetInput, setMagnetInput] = useState('')
  const [filesToSeed, setFilesToSeed] = useState<FileList | null>(null)

  // Bulk Fetch State
  const [maxTb, setMaxTb] = useState('0.1')
  const [fetchingBulk, setFetchingBulk] = useState(false)
  const [bulkFetchStatus, setBulkFetchStatus] = useState('')

  // Catalog State
  const [catalogStats, setCatalogStats] = useState<{ count: number, totalPinnedFiles: number } | null>(null)
  const [refreshingCatalog, setRefreshingCatalog] = useState(false)

  useEffect(() => {
    if (isAuthenticated) {
        fetchTorrents()
        fetchCatalogStats()
        const interval = setInterval(fetchTorrents, 3000)
        return () => clearInterval(interval)
    }
  }, [isAuthenticated])

  const fetchCatalogStats = async () => {
      try {
          const res = await fetch('/api/v1/torrent/catalog', { headers: getAuthHeaders() })
          const data = await res.json()
          if (data.success) {
              setCatalogStats({ count: data.count || 0, totalPinnedFiles: data.totalPinnedFiles || 0 })
          }
      } catch (e) { console.error(e) }
  }

  const refreshCatalog = async () => {
      setRefreshingCatalog(true)
      try {
          const res = await fetch('/api/v1/torrent/refresh-catalog', { 
              method: 'POST',
              headers: getAuthHeaders() 
          })
          if (res.ok) {
              await fetchCatalogStats()
              alert('Catalog refreshed successfully')
          } else {
              alert('Failed to refresh catalog')
          }
      } catch (e) {
          alert('Network error')
      } finally {
          setRefreshingCatalog(false)
      }
  }

  const handleBulkFetch = async () => {
      setFetchingBulk(true)
      setBulkFetchStatus('Starting fetch sequence (this may take a while)...')
      try {
          const res = await fetch('/api/v1/torrent/refetch', {
              method: 'POST',
              headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
              body: JSON.stringify({ maxTb: parseFloat(maxTb) })
          })
          const data = await res.json()
          
          if (data.success) {
              setBulkFetchStatus(`✅ ${data.message} (${data.skipped || 0} skipped)`)
              setTimeout(fetchTorrents, 3000)
          } else {
              setBulkFetchStatus(`❌ Failed: ${data.error}`)
          }
      } catch (e) {
          setBulkFetchStatus('❌ Network error')
      } finally {
          setFetchingBulk(false)
      }
  }

  const fetchTorrents = async () => {
    try {
      const res = await fetch('/api/v1/torrent/list', { headers: getAuthHeaders() })
      const data = await res.json()
      if (data.torrents) {
        setTorrents(data.torrents)
      }
      setLoading(false)
    } catch (e) {
      console.error(e)
    }
  }

  const handleAction = async (infoHash: string, action: string) => {
      // action: pause, resume, remove
      try {
          await fetch('/api/v1/torrent/control', {
              method: 'POST',
              headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
              body: JSON.stringify({ infoHash, action })
          })
          fetchTorrents()
      } catch (e) {
          console.error(e)
      }
  }

  const handleAddMagnet = async () => {
      if (!magnetInput) return
      setStatusMsg('Adding torrent...')
      try {
          const res = await fetch('/api/v1/torrent/add', {
              method: 'POST',
              headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
              body: JSON.stringify({ magnet: magnetInput })
          })
          if (res.ok) {
              setStatusMsg('✅ Torrent added!')
              setMagnetInput('')
              setActiveTab('list')
              fetchTorrents()
          } else {
              setStatusMsg('❌ Failed to add torrent')
          }
      } catch (e) {
          setStatusMsg('❌ Network error')
      }
  }

  const handleCreateTorrent = async () => {
      if (!filesToSeed || filesToSeed.length === 0) return
      setStatusMsg('Creating and sceding torrent...')
      
      const formData = new FormData()
      Array.from(filesToSeed).forEach(file => {
          // @ts-ignore
          const path = file.webkitRelativePath || file.name
          formData.append('files', file, path)
      })

      try {
          const res = await fetch('/api/v1/torrent/create', {
              method: 'POST',
              headers: { 'Authorization': getAuthHeaders().Authorization }, // FormData sets its own Content-Type
              body: formData
          })
          
          if (res.ok) {
              setStatusMsg('✅ Torrent created and seeding!')
              setFilesToSeed(null)
              setActiveTab('list')
              fetchTorrents()
          } else {
              setStatusMsg('❌ Creation failed')
          }
      } catch (e) {
          setStatusMsg('❌ Error creating torrent')
      }
  }

  const handleSearch = async (e: React.FormEvent) => {
      e.preventDefault()
      if (!searchQuery) return
      setSearching(true)
      setSearchResults([])
      
      try {
          // Implement "Anna's Archive" / Internet Archive Search
          // In the real app, this might call a proxy endpoint or external service
          // For now, we'll hit our own API which should handle the logic
          const endpoint = archiveMode ? '/api/v1/torrent/search/archive' : '/api/v1/torrent/search/dht'
          
          const res = await fetch(`${endpoint}?q=${encodeURIComponent(searchQuery)}`, {
              headers: getAuthHeaders()
          })
          const data = await res.json()
          
          if (data.results) {
              setSearchResults(data.results)
          } else {
              // Mock results for demo if backend not ready
              if (archiveMode) {
                  setSearchResults([
                      { title: `[Archive] ${searchQuery} - Full Backup`, magnet: 'magnet:?xt=urn:btih:mock1', size: '1.2 GB', source: 'archive' },
                      { title: `[Archive] ${searchQuery} - Document Set`, magnet: 'magnet:?xt=urn:btih:mock2', size: '450 MB', source: 'archive' }
                  ])
              } else {
                  setSearchResults([
                      { title: `${searchQuery} 1080p`, magnet: 'magnet:?xt=urn:btih:mock3', size: '2.5 GB', peers: 42, source: 'dht' }
                  ])
              }
          }
      } catch (e) {
          console.error(e)
      } finally {
          setSearching(false)
      }
  }
  
  const handlePinFile = async (infoHash: string, filePath: string) => {
        if(!confirm(`Pin file "${filePath}" to IPFS?`)) return
        // Call backend to extract file from torrent and pin to IPFS
        try {
            await fetch('/api/v1/torrent/pin-file', {
                 method: 'POST',
                 headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                 body: JSON.stringify({ infoHash, filePath })
            })
            alert('Pinning started for ' + filePath)
        } catch(e) {
            alert('Failed to start pin')
        }
  }

  const handleDiscoverNetwork = async () => {
      setSearching(true)
      setSearchResults([])
      setSearchQuery('') // Clear search query to indicate network discovery
      setStatusMsg('Discovering network relays...')
      
      try {
          const res = await fetch('/api/v1/torrent/network', { headers: getAuthHeaders() })
          const data = await res.json()
          
          if (data.success && data.network) {
              // Transform network relay data into "search results" for display
              const relayResults: SearchResult[] = data.network.flatMap((relay: any) => {
                  const torrents = relay.torrents || {}
                  return Object.entries(torrents).map(([hash, t]: [string, any]) => ({
                      title: `[${relay.id.substring(0, 6)}...] ${t.name || 'Unknown'}`,
                      magnet: t.magnetURI || `magnet:?xt=urn:btih:${hash}`,
                      size: t.size ? formatBytes(t.size) : 'Unknown',
                      source: 'dht', // Effectively DHT/P2P
                      peers: 1
                  }))
              })
              setSearchResults(relayResults)
              setStatusMsg(`✅ Found ${data.relays} relays with ${data.totalTorrents} torrents`)
          } else {
              setStatusMsg('❌ No relays found or network error')
          }
      } catch (e) {
          console.error(e)
          setStatusMsg('❌ Network error')
      } finally {
          setSearching(false)
      }
  }

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(1024))
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`
  }

  if (!isAuthenticated) return <div className="card"><h3>Authentication Required</h3></div>

  return (
    <div className="torrents-page">
      <div className="torrents-header card">
        <div>
           <h2>🧲 Torrent Manager</h2>
           <p>Downloads, Seeding & Archive Discovery</p>
        </div>
        <div className="torrents-actions">
             <div className="catalog-stats" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                {catalogStats && (
                    <span>📚 Catalog: {catalogStats.count} torrents | 📦 {catalogStats.totalPinnedFiles} pinned files</span>
                )}
             </div>
             <div className="btn-group">
                <button className="btn btn-sm btn-secondary" onClick={refreshCatalog} disabled={refreshingCatalog}>
                    {refreshingCatalog ? '🔄 ...' : '🔄 Refresh Catalog'}
                </button>
             </div>
        </div>
        <div className="torrents-tabs">
            <button className={`btn-tab ${activeTab==='list'?'active':''}`} onClick={()=>setActiveTab('list')}>Active Torrents</button>
            <button className={`btn-tab ${activeTab==='discovery'?'active':''}`} onClick={()=>setActiveTab('discovery')}>🔍 Discovery</button>
            <button className={`btn-tab ${activeTab==='create'?'active':''}`} onClick={()=>setActiveTab('create')}>➕ Create/Add</button>
        </div>
      </div>

      {statusMsg && <div className="status-banner">{statusMsg}</div>}

      <div className="torrents-content">
        {/* LIST TAB */}
        {activeTab === 'list' && (
            <div className="torrent-list">
                {loading && <div className="loading">Loading torrents...</div>}
                {!loading && torrents.length === 0 && <div className="empty-state">No active torrents.</div>}
                {torrents.map(t => (
                    <div key={t.infoHash} className={`torrent-card card state-${t.state}`}>
                        <div className="torrent-info">
                            <div className="torrent-name">{t.name || 'Metadata download...'}</div>
                            <div className="torrent-meta">
                                <span className={`badge ${t.state}`}>{t.state}</span>
                                <span>{formatBytes(t.size)}</span>
                                <span>⇩ {formatBytes(t.downloadSpeed)}/s</span>
                                <span>⇧ {formatBytes(t.uploadSpeed)}/s</span>
                                <span>👥 {t.numPeers}</span>
                            </div>
                            <div className="progress-bar">
                                <div className="fill" style={{ width: `${t.progress * 100}%` }}></div>
                            </div>
                        </div>
                        <div className="torrent-actions">
                            {t.state === 'paused' ? (
                                <button className="btn btn-sm btn-success" onClick={()=>handleAction(t.infoHash, 'resume')}>▶</button>
                            ) : (
                                <button className="btn btn-sm btn-warning" onClick={()=>handleAction(t.infoHash, 'pause')}>⏸</button>
                            )}
                            <button className="btn btn-sm btn-danger" onClick={()=>handleAction(t.infoHash, 'remove')}>🗑</button>
                        </div>
                        {/* File Inspector (Expandable) - simplified for now */}
                        {t.files && t.files.length > 0 && (
                            <details className="file-list">
                                <summary>Files ({t.files.length})</summary>
                                <ul>
                                    {t.files.slice(0, 5).map((f, i) => (
                                        <li key={i}>
                                            <span className="file-name">{f.name}</span>
                                            <span className="file-size">{formatBytes(f.length)}</span>
                                            <button className="btn-xs btn-secondary" onClick={()=>handlePinFile(t.infoHash, f.path)}>📌 IPFS</button>
                                        </li>
                                    ))}
                                    {t.files.length > 5 && <li>...and {t.files.length - 5} more</li>}
                                </ul>
                            </details>
                        )}
                    </div>
                ))}
            </div>
        )}

        {/* DISCOVERY TAB */}
        {activeTab === 'discovery' && (
            <div className="discovery-view">
                <div className="card">
                    <h3>🔍 Torrent Discovery</h3>
                    <p className="text-secondary mb-4">Search across multiple sources for torrents</p>
                    
                    <form onSubmit={handleSearch} className="search-form">
                        <input 
                            type="text" 
                            className="input search-input" 
                            placeholder="Search for movies, books, software, etc..." 
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                        />
                        
                        <div className="search-sources">
                            <div className="source-label">Search in:</div>
                            <div className="source-options">
                                <label className="source-option">
                                    <input 
                                        type="radio" 
                                        name="searchSource"
                                        checked={!archiveMode} 
                                        onChange={() => setArchiveMode(false)} 
                                    />
                                    <span className="source-icon">🌐</span>
                                    <div>
                                        <div className="source-name">PirateBay (DHT)</div>
                                        <div className="source-desc">General torrents, movies, software</div>
                                    </div>
                                </label>
                                <label className="source-option">
                                    <input 
                                        type="radio" 
                                        name="searchSource"
                                        checked={archiveMode} 
                                        onChange={() => setArchiveMode(true)} 
                                    />
                                    <span className="source-icon">📚</span>
                                    <div>
                                        <div className="source-name">Internet Archive</div>
                                        <div className="source-desc">Books, documents, archives</div>
                                    </div>
                                </label>
                            </div>
                        </div>
                        
                        <div className="search-actions">
                            <button type="submit" className="btn btn-primary" disabled={searching}>
                                {searching ? '🔄 Searching...' : '🔍 Search'}
                            </button>
                            <button 
                                type="button" 
                                className="btn btn-secondary"
                                onClick={handleDiscoverNetwork}
                                disabled={searching}
                            >
                                📡 Discover Network Relays
                            </button>
                        </div>
                    </form>

                    {statusMsg && <div className="status-message">{statusMsg}</div>}

                    <div className="search-results">
                        {searchResults.map((res, i) => (
                            <div key={i} className="search-result-item">
                                <div className="result-info">
                                    <div className="result-title">{res.title}</div>
                                    <div className="result-meta">
                                        <span className={`source-tag ${res.source}`}>{res.source}</span>
                                        {res.size && <span>📦 {res.size}</span>}
                                        {res.peers && <span>👥 {res.peers} peers</span>}
                                    </div>
                                </div>
                                <button 
                                    className="btn btn-sm btn-primary"
                                    onClick={() => {
                                        setMagnetInput(res.magnet)
                                        setActiveTab('create') // Switch to create/add tab to confirm
                                    }}
                                >
                                    ⇩ Download
                                </button>
                            </div>
                        ))}
                        {searchResults.length === 0 && !searching && searchQuery && (
                            <div className="no-results">
                                <span>🔍</span>
                                <p>No results found for "{searchQuery}"</p>
                                <p className="hint">Try a different search term or switch sources</p>
                            </div>
                        )}
                        {searchResults.length === 0 && !searching && !searchQuery && (
                            <div className="no-results">
                                <span>💡</span>
                                <p>Enter a search term to find torrents</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Bulk Fetch from Anna's Archive */}
                <div className="card mt-4">
                    <h3>📥 Bulk Fetch Anna's Archive</h3>
                    <p className="text-secondary mb-2">Automatically fetch and seed torrents from Anna's Archive up to a storage limit.</p>
                    
                    <div className="bulk-fetch-controls">
                        <div className="input-group">
                            <label>Max Storage (TB)</label>
                            <select 
                                className="input" 
                                value={maxTb} 
                                onChange={e => setMaxTb(e.target.value)}
                                style={{ width: '100px' }}
                            >
                                <option value="0.1">0.1 TB</option>
                                <option value="0.5">0.5 TB</option>
                                <option value="1">1 TB</option>
                                <option value="2">2 TB</option>
                                <option value="5">5 TB</option>
                                <option value="10">10 TB</option>
                                <option value="20">20 TB</option>
                            </select>
                            <button 
                                className="btn btn-primary" 
                                onClick={handleBulkFetch}
                                disabled={fetchingBulk}
                            >
                                {fetchingBulk ? 'Fetching...' : '📥 Start Fetch Sequence'}
                            </button>
                        </div>
                    </div>
                    {bulkFetchStatus && (
                        <div className={`status-msg mt-2 ${bulkFetchStatus.includes('✅') ? 'text-success' : 'text-error'}`}>
                            {bulkFetchStatus}
                        </div>
                    )}
                </div>
            </div>
        )}

        {/* CREATE / ADD TAB */}
        {activeTab === 'create' && (
            <div className="create-view card">
                <div className="section">
                    <h3>Add from Magnet</h3>
                    <div className="input-group">
                        <input 
                            type="text" 
                            className="input" 
                            placeholder="magnet:?xt=urn:btih:..." 
                            value={magnetInput}
                            onChange={e => setMagnetInput(e.target.value)}
                        />
                        <button className="btn btn-primary" onClick={handleAddMagnet}>Add Download</button>
                    </div>
                </div>

                <div className="divider">OR</div>

                <div className="section">
                    <h3>Create & Seed Torrent</h3>
                    <p>Select a file or directory to seed to the network.</p>
                    {/* @ts-ignore */}
                    <input 
                        type="file" 
                        className="file-input"
                        webkitdirectory="" 
                        directory="" 
                        multiple
                        onChange={(e) => setFilesToSeed(e.target.files)}
                    />
                    <div className="file-preview">
                        {filesToSeed && (
                            <p>Selected {filesToSeed.length} files to seed.</p>
                        )}
                    </div>
                    <button 
                        className="btn btn-success" 
                        onClick={handleCreateTorrent}
                        disabled={!filesToSeed}
                    >
                        Create Torrent
                    </button>
                </div>
            </div>
        )}
      </div>
    </div>
  )
}

export default Torrents
