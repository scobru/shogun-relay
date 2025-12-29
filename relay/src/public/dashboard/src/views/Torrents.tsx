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
      setStatusMsg('Creating and seeding torrent...')
      
      const formData = new FormData()
      Array.from(filesToSeed).forEach(file => {
          // @ts-ignore
          const path = file.webkitRelativePath || file.name
          formData.append('files', file, path)
      })

      try {
          const res = await fetch('/api/v1/torrent/create', {
              method: 'POST',
              headers: { 'Authorization': getAuthHeaders().Authorization },
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
          const endpoint = archiveMode ? '/api/v1/torrent/search/archive' : '/api/v1/torrent/search/dht'
          
          const res = await fetch(`${endpoint}?q=${encodeURIComponent(searchQuery)}`, {
              headers: getAuthHeaders()
          })
          const data = await res.json()
          
          if (data.results) {
              setSearchResults(data.results)
          } else {
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
      setSearchQuery('')
      setStatusMsg('Discovering network relays...')
      
      try {
          const res = await fetch('/api/v1/torrent/network', { headers: getAuthHeaders() })
          const data = await res.json()
          
          if (data.success && data.network) {
              const relayResults: SearchResult[] = data.network.flatMap((relay: any) => {
                  const torrents = relay.torrents || {}
                  return Object.entries(torrents).map(([hash, t]: [string, any]) => ({
                      title: `[${relay.id.substring(0, 6)}...] ${t.name || 'Unknown'}`,
                      magnet: t.magnetURI || `magnet:?xt=urn:btih:${hash}`,
                      size: t.size ? formatBytes(t.size) : 'Unknown',
                      source: 'dht' as const,
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

  if (!isAuthenticated) return (
    <div className="alert alert-warning">
      <span className="text-2xl">🔒</span>
      <span>Authentication required to access Torrents.</span>
    </div>
  )

  return (
    <div className="flex flex-col gap-6 max-w-6xl">
      {/* Header Card */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h2 className="card-title text-2xl">🧲 Torrent Manager</h2>
              <p className="text-base-content/70">Downloads, Seeding & Archive Discovery</p>
            </div>
            <div className="flex flex-col items-end gap-2">
              {catalogStats && (
                <div className="text-sm text-base-content/60">
                  📚 Catalog: {catalogStats.count} torrents | 📦 {catalogStats.totalPinnedFiles} pinned files
                </div>
              )}
              <button 
                className="btn btn-sm btn-ghost" 
                onClick={refreshCatalog} 
                disabled={refreshingCatalog}
              >
                {refreshingCatalog ? <span className="loading loading-spinner loading-xs"></span> : '🔄'} Refresh Catalog
              </button>
            </div>
          </div>
          
          {/* Tabs */}
          <div className="tabs tabs-boxed mt-4">
            <button className={`tab ${activeTab === 'list' ? 'tab-active' : ''}`} onClick={() => setActiveTab('list')}>
              Active Torrents
            </button>
            <button className={`tab ${activeTab === 'discovery' ? 'tab-active' : ''}`} onClick={() => setActiveTab('discovery')}>
              🔍 Discovery
            </button>
            <button className={`tab ${activeTab === 'create' ? 'tab-active' : ''}`} onClick={() => setActiveTab('create')}>
              ➕ Create/Add
            </button>
          </div>
        </div>
      </div>

      {statusMsg && (
        <div className="alert">
          <span>{statusMsg}</span>
        </div>
      )}

      {/* LIST TAB */}
      {activeTab === 'list' && (
        <div className="card bg-base-100 shadow">
          <div className="card-body p-0">
            {loading ? (
              <div className="flex justify-center p-8">
                <span className="loading loading-spinner loading-lg"></span>
              </div>
            ) : torrents.length === 0 ? (
              <div className="text-center p-8 text-base-content/50">
                <span className="text-4xl block mb-2">📭</span>
                <p>No active torrents</p>
              </div>
            ) : (
              <ul className="menu">
                {torrents.map(t => (
                  <li key={t.infoHash}>
                    <div className="flex flex-col w-full gap-2 p-4 hover:bg-base-200">
                      <div className="flex items-center justify-between w-full">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <span className={`badge ${t.state === 'seeding' ? 'badge-success' : t.state === 'downloading' ? 'badge-primary' : t.state === 'paused' ? 'badge-warning' : 'badge-ghost'}`}>
                            {t.state}
                          </span>
                          <span className="font-medium truncate">{t.name || 'Metadata download...'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-base-content/60">{formatBytes(t.size)}</span>
                          <span className="text-sm text-success">⇩ {formatBytes(t.downloadSpeed)}/s</span>
                          <span className="text-sm text-info">⇧ {formatBytes(t.uploadSpeed)}/s</span>
                          <span className="text-sm">👥 {t.numPeers}</span>
                        </div>
                      </div>
                      
                      {/* Progress bar */}
                      <progress className="progress progress-primary w-full" value={t.progress * 100} max="100"></progress>
                      
                      {/* Actions */}
                      <div className="flex gap-2 justify-end">
                        {t.state === 'paused' ? (
                          <button className="btn btn-xs btn-success" onClick={() => handleAction(t.infoHash, 'resume')}>▶ Resume</button>
                        ) : (
                          <button className="btn btn-xs btn-warning" onClick={() => handleAction(t.infoHash, 'pause')}>⏸ Pause</button>
                        )}
                        <button className="btn btn-xs btn-error" onClick={() => handleAction(t.infoHash, 'remove')}>🗑️ Remove</button>
                      </div>
                      
                      {/* Files (collapsible) */}
                      {t.files && t.files.length > 0 && (
                        <details className="collapse collapse-arrow bg-base-200">
                          <summary className="collapse-title text-sm">Files ({t.files.length})</summary>
                          <div className="collapse-content">
                            <ul className="text-xs">
                              {t.files.slice(0, 5).map((f, i) => (
                                <li key={i} className="flex justify-between items-center py-1">
                                  <span className="truncate">{f.name}</span>
                                  <div className="flex items-center gap-2">
                                    <span className="text-base-content/60">{formatBytes(f.length)}</span>
                                    <button className="btn btn-xs btn-ghost" onClick={() => handlePinFile(t.infoHash, f.path)}>📌 IPFS</button>
                                  </div>
                                </li>
                              ))}
                              {t.files.length > 5 && <li className="text-base-content/50">...and {t.files.length - 5} more</li>}
                            </ul>
                          </div>
                        </details>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* DISCOVERY TAB */}
      {activeTab === 'discovery' && (
        <div className="flex flex-col gap-6">
          <div className="card bg-base-100 shadow">
            <div className="card-body">
              <h3 className="card-title">🔍 Torrent Discovery</h3>
              <p className="text-base-content/60 mb-4">Search across multiple sources for torrents</p>
              
              <form onSubmit={handleSearch} className="flex flex-col gap-4">
                <input 
                  type="text" 
                  className="input input-bordered w-full" 
                  placeholder="Search for movies, books, software, etc..." 
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
                
                {/* Source Selection */}
                <div className="flex flex-wrap gap-4">
                  <label className="label cursor-pointer gap-2">
                    <input 
                      type="radio" 
                      className="radio radio-primary" 
                      checked={!archiveMode} 
                      onChange={() => setArchiveMode(false)} 
                    />
                    <span>🌐 PirateBay (DHT)</span>
                  </label>
                  <label className="label cursor-pointer gap-2">
                    <input 
                      type="radio" 
                      className="radio radio-primary" 
                      checked={archiveMode} 
                      onChange={() => setArchiveMode(true)} 
                    />
                    <span>📚 Internet Archive</span>
                  </label>
                </div>
                
                <div className="flex gap-2">
                  <button type="submit" className="btn btn-primary" disabled={searching}>
                    {searching ? <span className="loading loading-spinner loading-xs"></span> : '🔍'} Search
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={handleDiscoverNetwork} disabled={searching}>
                    📡 Discover Network Relays
                  </button>
                </div>
              </form>

              {/* Search Results */}
              <div className="mt-4 space-y-2">
                {searchResults.map((res, i) => (
                  <div key={i} className="flex justify-between items-center p-3 bg-base-200 rounded-lg">
                    <div>
                      <div className="font-medium">{res.title}</div>
                      <div className="text-sm text-base-content/60">
                        <span className={`badge badge-sm ${res.source === 'archive' ? 'badge-secondary' : 'badge-accent'}`}>{res.source}</span>
                        {res.size && <span className="ml-2">📦 {res.size}</span>}
                        {res.peers && <span className="ml-2">👥 {res.peers} peers</span>}
                      </div>
                    </div>
                    <button 
                      className="btn btn-sm btn-primary"
                      onClick={() => {
                        setMagnetInput(res.magnet)
                        setActiveTab('create')
                      }}
                    >
                      ⇩ Download
                    </button>
                  </div>
                ))}
                {searchResults.length === 0 && !searching && searchQuery && (
                  <div className="text-center p-8 text-base-content/50">
                    <span className="text-4xl block mb-2">🔍</span>
                    <p>No results found for "{searchQuery}"</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Bulk Fetch */}
          <div className="card bg-base-100 shadow">
            <div className="card-body">
              <h3 className="card-title">📥 Bulk Fetch Anna's Archive</h3>
              <p className="text-base-content/60 mb-4">Automatically fetch and seed torrents from Anna's Archive up to a storage limit.</p>
              
              <div className="flex flex-wrap items-end gap-4">
                <div className="form-control">
                  <label className="label"><span className="label-text">Max Storage (TB)</span></label>
                  <select 
                    className="select select-bordered" 
                    value={maxTb} 
                    onChange={e => setMaxTb(e.target.value)}
                  >
                    <option value="0.1">0.1 TB</option>
                    <option value="0.5">0.5 TB</option>
                    <option value="1">1 TB</option>
                    <option value="2">2 TB</option>
                    <option value="5">5 TB</option>
                    <option value="10">10 TB</option>
                    <option value="20">20 TB</option>
                  </select>
                </div>
                <button className="btn btn-primary" onClick={handleBulkFetch} disabled={fetchingBulk}>
                  {fetchingBulk ? <span className="loading loading-spinner loading-xs"></span> : '📥'} Start Fetch Sequence
                </button>
              </div>
              {bulkFetchStatus && (
                <div className={`mt-2 text-sm ${bulkFetchStatus.includes('✅') ? 'text-success' : 'text-error'}`}>
                  {bulkFetchStatus}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* CREATE / ADD TAB */}
      {activeTab === 'create' && (
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            {/* Add from Magnet */}
            <div className="mb-6">
              <h3 className="font-bold text-lg mb-2">Add from Magnet</h3>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  className="input input-bordered flex-1" 
                  placeholder="magnet:?xt=urn:btih:..." 
                  value={magnetInput}
                  onChange={e => setMagnetInput(e.target.value)}
                />
                <button className="btn btn-primary" onClick={handleAddMagnet}>Add Download</button>
              </div>
            </div>

            <div className="divider">OR</div>

            {/* Create & Seed */}
            <div>
              <h3 className="font-bold text-lg mb-2">Create & Seed Torrent</h3>
              <p className="text-base-content/60 mb-4">Select a file or directory to seed to the network.</p>
              
              <input 
                type="file" 
                className="file-input file-input-bordered w-full max-w-xs"
                // @ts-ignore
                webkitdirectory="" 
                directory="" 
                multiple
                onChange={(e) => setFilesToSeed(e.target.files)}
              />
              
              {filesToSeed && (
                <p className="mt-2 text-sm text-base-content/60">Selected {filesToSeed.length} files to seed.</p>
              )}
              
              <button 
                className="btn btn-success mt-4" 
                onClick={handleCreateTorrent}
                disabled={!filesToSeed}
              >
                Create Torrent
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Torrents
