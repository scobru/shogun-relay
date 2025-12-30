import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'


interface Torrent {
  infoHash: string
  name: string
  progress: number
  downloadSpeed: number
  uploadSpeed: number
  numPeers: number
  state?: 'downloading' | 'seeding' | 'paused' | 'queued' | 'checking' | 'error'
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
  source: 'archive' | 'dht' | 'index' | 'registry'
  addedBy?: string
  aacid?: string
  infoHash?: string
  files?: number
}

interface CatalogStats {
    count: number
    totalPinnedFiles: number
}

interface DashboardStats {
    activeTorrents: number
    downloadSpeed: number
    uploadSpeed: number
    ratio: number
    enabled: boolean
}

function Torrents() {
  const { isAuthenticated, getAuthHeaders } = useAuth()
  const [torrents, setTorrents] = useState<Torrent[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'list' | 'discovery' | 'create'>('list')
  const [statusMsg, setStatusMsg] = useState('')
  
  // Stats
  const [dashboardStats, setDashboardStats] = useState<DashboardStats>({
      activeTorrents: 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      ratio: 0,
      enabled: false
  })

  // Search / Discovery State
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [archiveMode, setArchiveMode] = useState(true) // Internet Archive Mode
  const [discoveryMode, setDiscoveryMode] = useState<'archive' | 'dht' | 'registry'>('archive')

  // Create State
  const [magnetInput, setMagnetInput] = useState('')
  const [filesToSeed, setFilesToSeed] = useState<FileList | null>(null)

  // Bulk Fetch State
  const [maxTb, setMaxTb] = useState('0.1')
  const [fetchingBulk, setFetchingBulk] = useState(false)
  const [bulkFetchStatus, setBulkFetchStatus] = useState('')

  // Catalog State
  const [catalogStats, setCatalogStats] = useState<CatalogStats | null>(null)
  const [refreshingCatalog, setRefreshingCatalog] = useState(false)

  // Remove Torrent Modal State
  const [removeModal, setRemoveModal] = useState<{ open: boolean; infoHash: string; name: string; deleteFiles: boolean }>({
    open: false,
    infoHash: '',
    name: '',
    deleteFiles: false
  })

  useEffect(() => {
    if (isAuthenticated) {
        fetchTorrents()
        fetchCatalogStats()
        fetchStatus()
        const interval = setInterval(() => {
            fetchTorrents()
            fetchStatus()
        }, 3000)
        return () => clearInterval(interval)
    }
  }, [isAuthenticated])

  const fetchStatus = async () => {
      try {
          const res = await fetch('/api/v1/torrent/status', { headers: getAuthHeaders() })
          const data = await res.json()
          if (data.success) {
              setDashboardStats(data.data)
          }
      } catch (e) { console.error(e) }
  }

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
              setStatusMsg('✅ Catalog refreshed successfully')
          } else {
              setStatusMsg('❌ Failed to refresh catalog')
          }
      } catch (e) {
          setStatusMsg('❌ Network error')
      } finally {
          setRefreshingCatalog(false)
          setTimeout(() => setStatusMsg(''), 3000)
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

  const handlePinAll = async (infoHash: string, name: string) => {
    if(!confirm(`Pin all files for "${name}" to IPFS? This may take a while.`)) return
    setStatusMsg(`Pinning files for ${name}...`)
    try {
        const res = await fetch('/api/v1/torrent/pin-all', {
             method: 'POST',
             headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
             body: JSON.stringify({ infoHash })
        })
        const data = await res.json()
        if (data.success) {
            setStatusMsg(`✅ ${data.message}`)
        } else {
            setStatusMsg(`⚠️ Finished with errors: ${data.errors?.join(', ') || 'Unknown error'}`)
        }
    } catch(e) {
        setStatusMsg('❌ Failed to start pin')
    }
    setTimeout(() => setStatusMsg(''), 5000)
  }

  const fetchTorrents = async () => {
    try {
      const res = await fetch('/api/v1/torrent/list', { headers: getAuthHeaders() })
      const data = await res.json()
      if (data.success && data.data?.torrents) {
        setTorrents(data.data.torrents)
      } else if (data.torrents) {
        setTorrents(data.torrents)
      }
      setLoading(false)
    } catch (e) {
      console.error(e)
    }
  }

  const handleAction = async (infoHash: string, action: string, deleteFiles: boolean = false) => {
      // action: pause, resume, remove
      try {
          await fetch('/api/v1/torrent/control', {
              method: 'POST',
              headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
              body: JSON.stringify({ infoHash, action, deleteFiles })
          })
          fetchTorrents()
          if (action === 'remove') {
              setStatusMsg(deleteFiles ? '✅ Torrent removed with files' : '✅ Torrent removed')
              setTimeout(() => setStatusMsg(''), 3000)
          }
      } catch (e) {
          console.error(e)
      }
  }

  const handleRemoveClick = (torrent: Torrent) => {
      setRemoveModal({
          open: true,
          infoHash: torrent.infoHash,
          name: torrent.name || torrent.infoHash.substring(0, 12) + '...',
          deleteFiles: false
      })
  }

  const confirmRemove = () => {
      handleAction(removeModal.infoHash, 'remove', removeModal.deleteFiles)
      setRemoveModal({ open: false, infoHash: '', name: '', deleteFiles: false })
  }

  const handleAddMagnet = async (magnet?: string) => {
      const magnetToAdd = magnet || magnetInput
      if (!magnetToAdd) return
      setStatusMsg('Adding torrent...')
      try {
          const res = await fetch('/api/v1/torrent/add', {
              method: 'POST',
              headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
              body: JSON.stringify({ magnet: magnetToAdd })
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
      setTimeout(() => setStatusMsg(''), 3000)
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

  const handleSearch = async (e?: React.FormEvent) => {
      if (e) e.preventDefault()
      if (!searchQuery && discoveryMode !== 'registry') return // Registry browse allows empty search
      setSearching(true)
      setSearchResults([])
      
      try {
          let endpoint = ''
          if (discoveryMode === 'archive') endpoint = '/api/v1/torrent/search/internet-archive'
          else if (discoveryMode === 'dht') endpoint = '/api/v1/torrent/search/piratebay'
          else endpoint = '/api/v1/torrent/registry/search' // Fallback for specific logic below
          
          // Special handling for registry browse vs search
          if (discoveryMode === 'registry') {
              if (searchQuery.length >= 3) {
                   const res = await fetch(`/api/v1/torrent/registry/search?q=${encodeURIComponent(searchQuery)}`, { headers: getAuthHeaders() })
                   const data = await res.json()
                   setSearchResults(data.results?.map((r: any) => ({ ...r, source: 'registry' })) || [])
              } else {
                  // Browse
                  const res = await fetch('/api/v1/torrent/registry/browse?limit=50', { headers: getAuthHeaders() })
                  const data = await res.json()
                  setSearchResults(data.results?.map((r: any) => ({ ...r, source: 'registry' })) || [])
              }
          } else {
              const res = await fetch(`${endpoint}?q=${encodeURIComponent(searchQuery)}`, {
                  headers: getAuthHeaders()
              })
              const data = await res.json()
              
              if (data.results) {
                  setSearchResults(data.results)
              } else {
                  // Mock fallback if API fails/missing
                  if (discoveryMode === 'archive') {
                      setSearchResults([
                          { title: `[Archive] ${searchQuery} - Full Backup`, magnet: 'magnet:?xt=urn:btih:mock1', size: '1.2 GB', source: 'archive' },
                      ])
                  }
              }
          }
      } catch (e) {
          console.error(e)
          setStatusMsg('❌ Search failed')
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
          setTimeout(() => setStatusMsg(''), 5000)
      }
  }

  const formatBytes = (bytes: number) => {
    if (!bytes) return '0 B'
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(1024))
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`
  }

  const formatSpeed = (bytes: number) => `${formatBytes(bytes)}/s`

  if (!isAuthenticated) return (
    <div className="alert alert-warning">
      <span className="text-2xl">🔒</span>
      <span>Authentication required to access Torrents.</span>
    </div>
  )

  return (
    <div className="flex flex-col gap-6 max-w-6xl">
      {/* Header & Stats Grid */}
      <div className="flex flex-col gap-4">
          <div className="card bg-base-100 shadow">
            <div className="card-body py-4">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div>
                        <h2 className="card-title text-2xl">🧲 Torrent Manager</h2>
                        <p className="text-base-content/70">Downloads, Seeding & Archive Discovery</p>
                    </div>
                     <div className={`badge badge-lg ${dashboardStats.enabled ? 'badge-primary' : 'badge-ghost'}`}>
                        {dashboardStats.enabled ? '● Contributing Active' : '○ Disabled'}
                    </div>
                </div>
            </div>
          </div>
          
          {/* Dashboard Stats */}
          <div className="stats stats-vertical lg:stats-horizontal shadow w-full bg-base-100">
            <div className="stat">
              <div className="stat-figure text-primary text-3xl">📥</div>
              <div className="stat-title">Active Torrents</div>
              <div className="stat-value text-primary">{dashboardStats.activeTorrents}</div>
            </div>
            <div className="stat">
               <div className="stat-figure text-success text-3xl">⬇️</div>
              <div className="stat-title">Download Speed</div>
              <div className="stat-value text-success text-2xl">{formatSpeed(dashboardStats.downloadSpeed)}</div>
            </div>
            <div className="stat">
               <div className="stat-figure text-info text-3xl">⬆️</div>
              <div className="stat-title">Upload Speed</div>
              <div className="stat-value text-info text-2xl">{formatSpeed(dashboardStats.uploadSpeed)}</div>
            </div>
            <div className="stat">
               <div className="stat-figure text-secondary text-3xl">⚖️</div>
              <div className="stat-title">Ratio</div>
              <div className="stat-value text-secondary">{dashboardStats.ratio.toFixed(2)}</div>
            </div>
          </div>
      </div>

      {statusMsg && (
        <div className="alert alert-info shadow-sm">
          <span>{statusMsg}</span>
        </div>
      )}

      {/* Main Tabs */}
      <div className="card bg-base-100 shadow">
          <div className="card-body p-2">
            <div className="tabs tabs-boxed bg-transparent">
                <button className={`tab tab-lg ${activeTab === 'list' ? 'tab-active' : ''}`} onClick={() => setActiveTab('list')}>Active Torrents</button>
                <button className={`tab tab-lg ${activeTab === 'discovery' ? 'tab-active' : ''}`} onClick={() => setActiveTab('discovery')}>🔍 Discovery</button>
                <button className={`tab tab-lg ${activeTab === 'create' ? 'tab-active' : ''}`} onClick={() => setActiveTab('create')}>➕ Create/Add</button>
            </div>
          </div>
      </div>

      {/* LIST TAB */}
      {activeTab === 'list' && (
        <div className="flex flex-col gap-6">
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
                    {torrents.map((t: Torrent) => (
                    <li key={t.infoHash}>
                        <div className="flex flex-col w-full gap-2 p-4 hover:bg-base-200 border-b border-base-200 last:border-0">
                        <div className="flex items-center justify-between w-full">
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                            <span className={`badge ${t.state === 'seeding' ? 'badge-success' : t.state === 'downloading' ? 'badge-primary' : t.state === 'paused' ? 'badge-warning' : 'badge-ghost'}`}>
                                {t.state}
                            </span>
                            <span className="font-medium truncate text-lg">{t.name || 'Metadata download...'}</span>
                            </div>
                            <div className="flex items-center gap-3">
                            <span className="text-sm font-mono bg-base-300 px-2 py-1 rounded">{formatBytes(t.size)}</span>
                            <div className="hidden md:flex gap-3">
                                <span className="text-sm text-success font-medium">⬇ {formatBytes(t.downloadSpeed)}/s</span>
                                <span className="text-sm text-info font-medium">⬆ {formatBytes(t.uploadSpeed)}/s</span>
                                <span className="text-sm">👥 {t.numPeers}</span>
                            </div>
                            </div>
                        </div>
                        
                        {/* Progress bar */}
                        <div className="w-full flex items-center gap-2">
                            <progress className="progress progress-primary flex-1" value={t.progress * 100} max="100"></progress>
                            <span className="text-xs font-bold w-12 text-right">{(t.progress * 100).toFixed(1)}%</span>
                        </div>
                        


                        {/* Actions */}
                        <div className="flex gap-2 justify-end mt-2">
                            <button className="btn btn-xs btn-outline" onClick={() => {navigator.clipboard.writeText(t.magnetURI || ''); setStatusMsg('Magnet copied!')}}>🧲 Magnet</button>
                            {t.state === 'paused' ? (
                            <button className="btn btn-xs btn-success" onClick={() => handleAction(t.infoHash, 'resume')}>▶ Resume</button>
                            ) : (
                            <button className="btn btn-xs btn-warning" onClick={() => handleAction(t.infoHash, 'pause')}>⏸ Pause</button>
                            )}
                            <button className="btn btn-xs btn-info" onClick={() => handlePinAll(t.infoHash, t.name)}>📌 Pin to IPFS</button>
                            <button className="btn btn-xs btn-error" onClick={() => handleRemoveClick(t)}>🗑️ Remove</button>
                        </div>
                        
                        {/* Files (collapsible) */}
                        {t.files && t.files.length > 0 && (
                            <details className="collapse collapse-arrow bg-base-200 mt-2">
                            <summary className="collapse-title text-sm min-h-0 py-2">Files ({t.files.length})</summary>
                            <div className="collapse-content">
                                <ul className="text-xs space-y-1">
                                {t.files.slice(0, 10).map((f: any, i: number) => (
                                    <li key={i} className="flex justify-between items-center py-1 hover:bg-base-300 px-2 rounded">
                                    <span className="truncate flex-1 pr-4">{f.name}</span>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <span className="text-base-content/60">{formatBytes(f.length)}</span>
                                        <button className="btn btn-xs btn-ghost btn-square" onClick={() => handlePinFile(t.infoHash, f.path)} title="Pin to IPFS">📌</button>
                                    </div>
                                    </li>
                                ))}
                                {t.files.length > 10 && <li className="text-base-content/50 text-center py-1">...and {t.files.length - 10} more</li>}
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

            {/* Catalog Stats Card */}
            <div className="card bg-base-100 shadow">
                <div className="card-body">
                    <div className="flex justify-between items-center">
                         <h3 className="card-title text-lg">📚 IPFS Catalog</h3>
                         <button 
                            className="btn btn-sm btn-ghost" 
                            onClick={refreshCatalog} 
                            disabled={refreshingCatalog}
                        >
                            {refreshingCatalog ? <span className="loading loading-spinner loading-xs"></span> : '🔄'} Refresh
                        </button>
                    </div>
                    {catalogStats ? (
                        <div className="stats shadow bg-base-200 mt-2">
                            <div className="stat">
                                <div className="stat-title">Cataloged Torrents</div>
                                <div className="stat-value text-2xl">{catalogStats.count}</div>
                            </div>
                            <div className="stat">
                                <div className="stat-title">Total Pinned Files</div>
                                <div className="stat-value text-2xl">{catalogStats.totalPinnedFiles}</div>
                            </div>
                            <div className="stat">
                                <div className="stat-actions">
                                    <a href="/api/v1/torrent/catalog" target="_blank" className="btn btn-sm btn-link">View JSON →</a>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex justify-center p-4"><span className="loading loading-spinner"></span></div>
                    )}
                </div>
            </div>
        </div>
      )}

      {/* DISCOVERY TAB */}
      {activeTab === 'discovery' && (
        <div className="flex flex-col gap-6">
          <div className="card bg-base-100 shadow">
            <div className="card-body">
              <h3 className="card-title">🔍 Torrent Discovery</h3>
              
              <div className="flex flex-col gap-4">
                {/* Source Selection Tabs */}
                <div className="tabs tabs-lifted">
                    <a className={`tab ${discoveryMode === 'registry' ? 'tab-active' : ''}`} onClick={() => setDiscoveryMode('registry')}>🌐 Global Registry</a>
                    <a className={`tab ${discoveryMode === 'archive' ? 'tab-active' : ''}`} onClick={() => setDiscoveryMode('archive')}>📚 Internet Archive</a>
                    <a className={`tab ${discoveryMode === 'dht' ? 'tab-active' : ''}`} onClick={() => setDiscoveryMode('dht')}>🏴‍☠️ PirateBay (DHT)</a>
                </div>

                <form onSubmit={handleSearch} className="flex gap-2">
                    <input 
                    type="text" 
                    className="input input-bordered flex-1" 
                    placeholder={discoveryMode === 'registry' ? "Search registry (min 3 chars) or leave empty to Browse All" : "Search query..."}
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    />
                    <button type="submit" className="btn btn-primary" disabled={searching}>
                        {searching ? <span className="loading loading-spinner loading-xs"></span> : '🔍'} Search
                    </button>
                    {discoveryMode === 'registry' && (
                        <button type="button" className="btn btn-secondary" onClick={() => { setSearchQuery(''); handleSearch(); }}>
                            📋 Browse All
                        </button>
                    )}
                </form>

                {discoveryMode === 'dht' && (
                     <button type="button" className="btn btn-outline w-full" onClick={handleDiscoverNetwork} disabled={searching}>
                        📡 Discover Network Relays (DHT)
                    </button>
                )}

                {/* Search Results */}
                <div className="mt-4 space-y-2 max-h-[600px] overflow-y-auto">
                    {searchResults.length === 0 && !searching && (
                        <div className="text-center p-8 text-base-content/50">
                            <span className="text-4xl block mb-2">🔍</span>
                            <p>Enter search term or click Browse</p>
                        </div>
                    )}
                    
                    {searchResults.map((res: SearchResult, i: number) => (
                    <div key={i} className="card card-compact bg-base-200 shadow-sm hover:shadow-md transition-shadow">
                        <div className="card-body flex-row justify-between items-start gap-4">
                            <div className="min-w-0 flex-1">
                                <h4 className="font-bold text-lg truncate" title={res.title}>{res.title}</h4>
                                <div className="flex flex-wrap gap-2 mt-1">
                                    <span className={`badge badge-sm ${res.source === 'archive' ? 'badge-secondary' : res.source === 'registry' ? 'badge-primary' : 'badge-accent'}`}>{res.source}</span>
                                    {res.size && <span className="badge badge-sm badge-ghost">📦 {res.size}</span>}
                                    {res.peers !== undefined && <span className="badge badge-sm badge-ghost">👥 {res.peers} peers</span>}
                                    {res.addedBy && <span className="badge badge-sm badge-ghost">User: {res.addedBy.substring(0,6)}...</span>}
                                    {res.files && <span className="badge badge-sm badge-ghost">📄 {res.files} files</span>}
                                </div>
                                {res.infoHash && <div className="text-xs font-mono text-base-content/50 mt-1 truncate">{res.infoHash}</div>}
                            </div>
                            <div className="flex flex-col gap-2 shrink-0">
                                <button 
                                    className="btn btn-sm btn-primary"
                                    onClick={() => handleAddMagnet(res.magnet)}
                                >
                                    ➕ Add
                                </button>
                                <button className="btn btn-xs btn-ghost" onClick={() => navigator.clipboard.writeText(res.magnet)}>📋 Copy</button>
                            </div>
                        </div>
                    </div>
                    ))}
                </div>
              </div>
            </div>
          </div>

          {/* Bulk Fetch (Only for Archive) */}
          {discoveryMode === 'archive' && (
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
          )}
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
                <button className="btn btn-primary" onClick={() => handleAddMagnet()}>Add Download</button>
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

      {/* Remove Torrent Confirmation Modal */}
      {removeModal.open && (
        <dialog className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">🗑️ Remove Torrent</h3>
            <p className="py-4">
              Are you sure you want to remove <strong>{removeModal.name}</strong>?
            </p>
            
            <div className="form-control">
              <label className="label cursor-pointer justify-start gap-3">
                <input 
                  type="checkbox" 
                  className="checkbox checkbox-error" 
                  checked={removeModal.deleteFiles}
                  onChange={(e) => setRemoveModal((prev: typeof removeModal) => ({ ...prev, deleteFiles: e.target.checked }))}
                />
                <span className="label-text">
                  <strong className="text-error">Also delete files from disk</strong>
                  <br />
                  <span className="text-xs text-base-content/60">This action cannot be undone</span>
                </span>
              </label>
            </div>

            <div className="modal-action">
              <button 
                className="btn btn-ghost" 
                onClick={() => setRemoveModal({ open: false, infoHash: '', name: '', deleteFiles: false })}
              >
                Cancel
              </button>
              <button 
                className={`btn ${removeModal.deleteFiles ? 'btn-error' : 'btn-warning'}`}
                onClick={confirmRemove}
              >
                {removeModal.deleteFiles ? '🗑️ Remove & Delete Files' : 'Remove Torrent'}
              </button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button onClick={() => setRemoveModal({ open: false, infoHash: '', name: '', deleteFiles: false })}>close</button>
          </form>
        </dialog>
      )}
    </div>
  )
}

export default Torrents
