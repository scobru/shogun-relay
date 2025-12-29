import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import './Torrents.css'

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

  useEffect(() => {
    if (isAuthenticated) {
        fetchTorrents()
        const interval = setInterval(fetchTorrents, 3000)
        return () => clearInterval(interval)
    }
  }, [isAuthenticated])

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
            <div className="discovery-view card">
                <h3>Global & Archive Search</h3>
                <form onSubmit={handleSearch} className="search-form">
                    <input 
                        type="text" 
                        className="input search-input" 
                        placeholder="Search for content..." 
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                    />
                    <div className="search-options">
                        <label>
                            <input 
                                type="checkbox" 
                                checked={archiveMode} 
                                onChange={e => setArchiveMode(e.target.checked)} 
                            />
                            Search Internet Archive (Anna's Archive)
                        </label>
                    </div>
                    <button type="submit" className="btn btn-primary" disabled={searching}>
                        {searching ? 'Searching...' : 'Search'}
                    </button>
                </form>

                <div className="search-results">
                    {searchResults.map((res, i) => (
                        <div key={i} className="search-result-item">
                            <div className="result-info">
                                <div className="result-title">{res.title}</div>
                                <div className="result-meta">
                                    <span className="source-tag">{res.source}</span>
                                    {res.size && <span>{res.size}</span>}
                                    {res.peers && <span>{res.peers} peers</span>}
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
                    {searchResults.length === 0 && !searching && (
                        <p className="no-results">No results found. Try a different query.</p>
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
