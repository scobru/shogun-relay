
import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'

interface BlobRecord {
  txHash: string
  magnetURI?: string
  blobHash?: string
  timestamp?: number
  size?: number
}

function BlobArchiver() {
  const { getAuthHeaders } = useAuth()
  const [activeTab, setActiveTab] = useState<'archive' | 'create'>('archive')
  const [txHash, setTxHash] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null)
  const [blobs, setBlobs] = useState<BlobRecord[]>([])
  
  // Format bytes to human readable string
  const formatBytes = (bytes?: number) => {
    if (bytes === undefined) return '-'
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  // Fetch list of blobs
  const fetchBlobs = useCallback(async () => {
    try {
      const response = await fetch('/api/blobs/list', {
        headers: getAuthHeaders()
      })
      if (response.status === 401) {
          console.error('Unauthorized')
          return
      }
      const data = await response.json()
      if (data.success) {
        setBlobs(data.data)
      }
    } catch (error) {
      console.error('Failed to fetch blobs', error)
    }
  }, [getAuthHeaders])

  useEffect(() => {
    fetchBlobs()
    const interval = setInterval(fetchBlobs, 10000) // Poll every 10s
    return () => clearInterval(interval)
  }, [fetchBlobs])

  const handleArchive = async () => {
    if (!txHash) return
    if (!txHash.startsWith('0x')) {
      setStatus({ type: 'error', message: 'Transaction hash must start with 0x' })
      return
    }

    setLoading(true)
    setStatus({ type: 'info', message: 'Fetching blob from Ethereum and creating torrent...' })

    try {
      const response = await fetch('/api/blobs/archive', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            ...getAuthHeaders() 
        },
        body: JSON.stringify({ txHash })
      })
      
      const result = await response.json()
      
      if (result.success) {
        setStatus({ type: 'success', message: 'Blob archived successfully! Seeding now.' })
        setTxHash('')
        fetchBlobs() // Refresh list immediately
      } else {
        setStatus({ type: 'error', message: result.error || 'Failed to archive blob' })
      }
    } catch (error: any) {
      setStatus({ type: 'error', message: error.message || 'Network error' })
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async () => {
    if (!file) return

    setLoading(true)
    setStatus({ type: 'info', message: 'Uploading file and sending Blob Transaction...' })

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/blobs/create', {
        method: 'POST',
        headers: {
            ...getAuthHeaders()
            // Content-Type is set automatically for FormData
        },
        body: formData
      })
      
      const result = await response.json()
      
      if (result.success) {
        setStatus({ type: 'success', message: `Blob created! TX: ${result.data.txHash}` })
        setFile(null)
        // Reset file input if possible or rely on state
        fetchBlobs()
      } else {
        setStatus({ type: 'error', message: result.error || 'Failed to create blob' })
      }
    } catch (error: any) {
      setStatus({ type: 'error', message: error.message || 'Network error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
        <div className="flex justify-between items-center">
            <div>
                <h1 className="text-2xl font-bold">Blob Archiver</h1>
                <p className="text-base-content/60">Permanently archive Ethereum Blobs to Torrent/GunDB</p>
            </div>
        </div>

        {/* Tabs */}
        <div className="tabs tabs-boxed">
            <a 
                className={`tab ${activeTab === 'archive' ? 'tab-active' : ''}`}
                onClick={() => { setActiveTab('archive'); setStatus(null); }}
            >
                Archive by Hash
            </a>
            <a 
                className={`tab ${activeTab === 'create' ? 'tab-active' : ''}`}
                onClick={() => { setActiveTab('create'); setStatus(null); }}
            >
                Create New Blob
            </a>
        </div>

      {/* Action Card */}
      <div className="card bg-base-100 shadow-xl">
        <div className="card-body">
          <h2 className="card-title text-lg flex items-center gap-2">
            <span>{activeTab === 'archive' ? '📥' : '📤'}</span> 
            {activeTab === 'archive' ? 'Archive Existing Blob' : 'Create & Upload Blob'}
          </h2>
          
          {activeTab === 'archive' ? (
              <div className="form-control w-full">
                <label className="label">
                  <span className="label-text">Ethereum Transaction Hash (Type 3)</span>
                </label>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    placeholder="0x..." 
                    className="input input-bordered w-full font-mono"
                    value={txHash}
                    onChange={(e) => setTxHash(e.target.value)}
                    disabled={loading}
                  />
                  <button 
                    className={`btn btn-primary ${loading ? 'loading' : ''}`}
                    onClick={handleArchive}
                    disabled={loading || !txHash}
                  >
                    {loading ? 'Archiving...' : 'Archive Blob'}
                  </button>
                </div>
                <label className="label">
                  <span className="label-text-alt text-base-content/60">
                    Provide a transaction hash containing blobs. The blob data will be fetched, saved, and seeded via Torrent.
                  </span>
                </label>
              </div>
          ) : (
              <div className="form-control w-full">
                <label className="label">
                  <span className="label-text">Select File (max 128KB)</span>
                </label>
                <div className="flex gap-2 items-center">
                  <input 
                    type="file" 
                    className="file-input file-input-bordered w-full"
                    onChange={(e) => setFile(e.target.files ? e.target.files[0] : null)}
                    disabled={loading}
                  />
                  <button 
                    className={`btn btn-secondary ${loading ? 'loading' : ''}`}
                    onClick={handleCreate}
                    disabled={loading || !file}
                  >
                    {loading ? 'Creating...' : 'Upload & Create'}
                  </button>
                </div>
                <label className="label">
                  <span className="label-text-alt text-base-content/60">
                    Upload a file to create a blob transaction. Requires the relay to have a funded wallet.
                  </span>
                </label>
              </div>
          )}

          {status && (
            <div className={`alert ${
              status.type === 'error' ? 'alert-error' : 
              status.type === 'success' ? 'alert-success' : 'alert-info'
            } shadow-lg mt-4`}>
              <span>{status.message}</span>
            </div>
          )}
        </div>
      </div>

      {/* History Card */}
      <div className="card bg-base-100 shadow-xl">
        <div className="card-body">
          <h2 className="card-title text-lg mb-4">
            <span>📚</span> Archived Blobs
          </h2>
          
          <div className="overflow-x-auto">
            <table className="table table-zebra w-full">
              <thead>
                <tr>
                  <th>TX Hash</th>
                  <th>Size</th>
                  <th>Timestamp</th>
                  <th>Magnet</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {blobs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-8 text-base-content/50">
                      No blobs archived yet
                    </td>
                  </tr>
                ) : (
                  blobs.map((blob) => (
                    <tr key={blob.txHash}>
                      <td className="font-mono text-xs">
                        <span className="tooltip" data-tip={blob.txHash}>
                          {blob.txHash.substring(0, 10)}...{blob.txHash.substring(60)}
                        </span>
                      </td>
                      <td>{formatBytes(blob.size)}</td>
                      <td className="text-sm">
                        {blob.timestamp ? new Date(blob.timestamp).toLocaleString() : '-'}
                      </td>
                      <td>
                        {blob.magnetURI ? (
                           <div className="badge badge-success badge-outline text-xs">Seeding</div> 
                        ) : (
                           <div className="badge badge-ghost text-xs">Missing</div>
                        )}
                      </td>
                      <td>
                        {blob.magnetURI && (
                            <button 
                                className="btn btn-xs btn-ghost"
                                onClick={() => {
                                    navigator.clipboard.writeText(blob.magnetURI!)
                                    // Could show toast here
                                }}
                            >
                                Copy Magnet
                            </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

export default BlobArchiver
