import { useEffect, useState, useCallback, useRef } from 'react'
import { useAuth } from '../context/AuthContext'


interface Pin {
  cid: string
  name: string
  type: string
  timestamp: number
  size?: number
  metadata?: any
}

interface PreviewState {
  cid: string
  name: string
  type: string
  content?: string
  blob?: Blob
  url?: string
}

function Files() {
  const { isAuthenticated, getAuthHeaders, token: adminToken } = useAuth()
  const [pins, setPins] = useState<Pin[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [dragActive, setDragActive] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  
  // New State variables
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [uploadMode, setUploadMode] = useState<'single' | 'directory'>('single')
  const [encryptUpload, setEncryptUpload] = useState(false)
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [fileNameOverride, setFileNameOverride] = useState('')

  const fileInputRef = useRef<HTMLInputElement>(null)
  const dirInputRef = useRef<HTMLInputElement>(null)

  const fetchPins = useCallback(async () => {
    try {
      setLoading(true)
      const [pinsRes, metaRes] = await Promise.all([
        fetch('/api/v1/ipfs/pin/ls', { headers: getAuthHeaders() }),
        fetch('/api/v1/user-uploads/system-hashes-map', { headers: getAuthHeaders() })
      ])
      
      const pinsData = await pinsRes.json()
      const metaData = await metaRes.json()
      const systemHashes = metaData.systemHashes || {}

      if (pinsData.pins) {
        const mappedPins = Object.entries(pinsData.pins).map(([cid, info]: [string, any]) => {
          const meta = systemHashes[cid] || {}
          return {
            cid,
            name: meta.displayName || meta.fileName || meta.originalName || info.Name || 'Unnamed',
            type: info.Type || 'recursive',
            timestamp: meta.timestamp || Date.now(),
            size: meta.fileSize,
            metadata: meta
          }
        })
        setPins(mappedPins.sort((a, b) => b.timestamp - a.timestamp))
      }
    } catch (error) {
      console.error('Failed to fetch pins:', error)
    } finally {
      setLoading(false)
    }
  }, [getAuthHeaders])

  useEffect(() => {
    if (isAuthenticated) fetchPins()
  }, [isAuthenticated, fetchPins])

  const filteredPins = pins.filter(pin => {
    const matchesSearch = pin.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                         pin.cid.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesFilter = filterType === 'all' || pin.type === filterType
    return matchesSearch && matchesFilter
  })

  // --- File Handling & Encryption ---

  const deriveKey = async (password: string, salt: Uint8Array) => {
    const enc = new TextEncoder()
    const keyMaterial = await window.crypto.subtle.importKey(
      "raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits", "deriveKey"]
    )
    return window.crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    )
  }

  const encryptData = async (data: ArrayBuffer, password: string) => {
    const salt = window.crypto.getRandomValues(new Uint8Array(16))
    const iv = window.crypto.getRandomValues(new Uint8Array(12))
    const key = await deriveKey(password, salt)
    const encrypted = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv }, key, data
    )
    
    // Combine salt + iv + encrypted data for storage
    const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength)
    combined.set(salt, 0)
    combined.set(iv, salt.length)
    combined.set(new Uint8Array(encrypted), salt.length + iv.length)
    return combined
  }

  const handleUpload = async (event?: React.ChangeEvent<HTMLInputElement>) => {
    const files = event?.target.files || (fileInputRef.current?.files)
    if (!files || files.length === 0) return

    setUploading(true)
    setUploadProgress(0)
    setStatusMessage('')

    try {
      const formData = new FormData()
      const token = adminToken || ''
      
      if (uploadMode === 'single') {
        let file = files[0]
        const name = fileNameOverride || file.name
        
        if (encryptUpload) {
          setStatusMessage('Encrypting...')
          const buffer = await file.arrayBuffer()
          // Use admin token as password if available, otherwise prompt or error? 
          // Assuming adminToken is the password for simplicity in this context.
          if (!token) throw new Error("Authentication required for encryption")
          
          const encryptedBytes = await encryptData(buffer, token)
          const encryptedBlob = new Blob([encryptedBytes], { type: 'application/octet-stream' })
          file = new File([encryptedBlob], name + '.enc', { type: 'application/octet-stream' })
        }
        
        formData.append('file', file, encryptUpload ? file.name : name)
      } else {
        // Directory upload
        Array.from(files).forEach(file => {
          // @ts-ignore - webkitRelativePath exists on File in browsers
          const path = file.webkitRelativePath || file.name
          formData.append('files', file, path)
        })
      }

      const endpoint = uploadMode === 'directory' ? '/api/v1/ipfs/upload-directory' : '/api/v1/ipfs/upload'
      
      const xhr = new XMLHttpRequest()
      xhr.open('POST', endpoint)
      xhr.setRequestHeader('Authorization', `Bearer ${token}`)
      
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setUploadProgress((e.loaded / e.total) * 100)
        }
      }

      xhr.onload = async () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const result = JSON.parse(xhr.responseText)
          setStatusMessage('✅ Upload complete!')
          // Save system hash metadata
          await saveMetadata(result, files, uploadMode === 'directory')
          fetchPins()
        } else {
          setStatusMessage(`❌ Upload failed: ${xhr.statusText}`)
        }
        setUploading(false)
      }

      xhr.onerror = () => {
        setStatusMessage('❌ Network error during upload')
        setUploading(false)
      }

      xhr.send(formData)

    } catch (error: any) {
      console.error(error)
      setStatusMessage(`❌ Error: ${error.message}`)
      setUploading(false)
    }
  }

  const saveMetadata = async (result: any, files: FileList, isDir: boolean) => {
    try {
      const hash = result.directoryCid || result.cid || result.file?.hash
      const mainFile = files[0]
      const name = fileNameOverride || mainFile.name
      
      const metadata = {
        hash,
        userAddress: 'admin-upload',
        timestamp: Date.now(),
        fileName: isDir ? `Directory (${files.length} files)` : name,
        displayName: isDir ? `Directory (${files.length} files)` : name,
        originalName: isDir ? `Directory (${files.length} files)` : mainFile.name,
        fileSize: result.totalSize || mainFile.size,
        isEncrypted: encryptUpload && !isDir,
        contentType: isDir ? 'application/directory' : (mainFile.type || 'application/octet-stream'),
        isDirectory: isDir,
        fileCount: files.length
      }

      await fetch('/api/v1/user-uploads/save-system-hash', {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(metadata)
      })
    } catch (e) {
      console.error('Failed to save metadata', e)
    }
  }

  // --- Preview Logic ---

  const handlePreview = async (pin: Pin) => {
    try {
      setStatusMessage('Loading preview...')
      const res = await fetch(`/api/v1/ipfs/cat/${pin.cid}`, { headers: getAuthHeaders() })
      if (!res.ok) throw new Error('Failed to fetch content')
      
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const type = res.headers.get('Content-Type') || 'unknown'
      
      setPreview({
        cid: pin.cid,
        name: pin.name,
        type: type,
        blob,
        url
      })
      setStatusMessage('')
    } catch (e: any) {
      setStatusMessage(`Preview failed: ${e.message}`)
    }
  }

  const closePreview = () => {
    if (preview?.url) URL.revokeObjectURL(preview.url)
    setPreview(null)
  }

  // --- Actions ---

  const handleRemove = async (cid: string) => {
    if (!confirm('Are you sure you want to remove this pin?')) return
    try {
      await fetch('/api/v1/ipfs/pin/rm', {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ cid })
      })
      fetchPins()
    } catch (e) {
      console.error(e)
    }
  }

  const handleGarbageCollection = async () => {
    if (!confirm('Run Garbage Collection? This will remove unpinned blocks.')) return
    setStatusMessage('Running GC...')
    try {
      await fetch('/api/v1/ipfs/repo/gc', {
        method: 'POST',
        headers: getAuthHeaders()
      })
      setStatusMessage('✅ GC Completed')
    } catch (e) {
      setStatusMessage('❌ GC Failed')
    }
  }

  const handleRemoveAll = async () => {
    if (!confirm('WARNING: Remove ALL pins? This cannot be undone.')) return
    setStatusMessage('Removing all pins...')
    try {
      for (const pin of pins) {
        await fetch('/api/v1/ipfs/pin/rm', {
          method: 'POST',
          headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ cid: pin.cid })
        })
      }
      setStatusMessage('✅ All pins removed')
      fetchPins()
    } catch (e) {
      setStatusMessage('❌ Failed to remove all')
    }
  }

  if (!isAuthenticated) return (
    <div className="files-auth card">
      <h3>Authentication Required</h3>
      <p>Please enter admin password in Settings to manage files.</p>
    </div>
  )

  return (
    <div className="files-page">
      {/* Header */}
      <div className="files-header card">
        <div>
          <h2>🗄️ File Manager</h2>
          <p>Managed IPFS Storage & Pins</p>
        </div>
        <div className="files-header-actions">
           <button className="btn btn-secondary" onClick={handleGarbageCollection}>🧹 Run GC</button>
           <button className="btn btn-danger" onClick={handleRemoveAll}>🗑️ Remove All</button>
        </div>
      </div>

      {/* Upload Section */}
      <div className="card files-upload-section">
        <h3>Upload Files</h3>
        <div className={`drop-zone ${dragActive ? 'active' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragActive(true) }}
          onDragLeave={() => setDragActive(false)}
          onDrop={e => {
            e.preventDefault(); setDragActive(false)
            // Handle drop logic if needed, simplify to click for now
          }}
        >
          <div className="upload-controls">
            <div className="radio-group">
              <label>
                <input type="radio" checked={uploadMode === 'single'} onChange={() => setUploadMode('single')} />
                Single File
              </label>
              <label>
                <input type="radio" checked={uploadMode === 'directory'} onChange={() => setUploadMode('directory')} />
                Directory
              </label>
            </div>
            
            {uploadMode === 'single' && (
              <>
                <input 
                  type="text" 
                  className="input" 
                  placeholder="Filename Override (optional)" 
                  value={fileNameOverride}
                  onChange={e => setFileNameOverride(e.target.value)}
                />
                <label className="checkbox-label">
                  <input type="checkbox" checked={encryptUpload} onChange={e => setEncryptUpload(e.target.checked)} />
                  Encrypt File (Client-side AES-GCM)
                </label>
              </>
            )}
            
            <div className="upload-buttons">
              {uploadMode === 'single' ? (
                 <input ref={fileInputRef} type="file" onChange={e => handleUpload(e)} />
              ) : (
                 // @ts-ignore
                 <input ref={dirInputRef} type="file" webkitdirectory="" directory="" onChange={e => handleUpload(e)} />
              )}
            </div>
          </div>
          
          {uploading && (
            <div className="upload-progress">
              <div className="progress-bar">
                <div className="fill" style={{ width: `${uploadProgress}%` }}></div>
              </div>
              <span>{Math.round(uploadProgress)}%</span>
            </div>
          )}
          {statusMessage && <div className="status-message">{statusMessage}</div>}
        </div>
      </div>

      {/* Pins List */}
      <div className="files-list-section">
        <div className="files-search-bar">
           <input 
             type="text" 
             className="input search-input" 
             placeholder="Search pins by name or CID..." 
             value={searchQuery}
             onChange={e => setSearchQuery(e.target.value)}
           />
           <select className="input filter-select" value={filterType} onChange={e => setFilterType(e.target.value)}>
             <option value="all">All Types</option>
             <option value="recursive">Recursive</option>
             <option value="direct">Direct</option>
           </select>
        </div>

        {loading ? <div className="loading">Loading pins...</div> : (
          <div className="pins-grid">
            {filteredPins.map(pin => (
              <div key={pin.cid} className="pin-card">
                <div className="pin-icon">
                   {pin.type === 'recursive' ? '📁' : '📄'}
                </div>
                <div className="pin-details">
                  <div className="pin-name" title={pin.name}>{pin.name}</div>
                  <div className="pin-cid" title={pin.cid}>{pin.cid.substring(0, 12)}...</div>
                  <div className="pin-meta-text">
                    {new Date(pin.timestamp).toLocaleDateString()} • {pin.size ? (pin.size / 1024 / 1024).toFixed(2) + ' MB' : 'Unknown size'}
                  </div>
                </div>
                <div className="pin-actions">
                  <button className="btn-icon" onClick={() => handlePreview(pin)} title="Preview">👁️</button>
                  <button className="btn-icon" onClick={() => {
                    navigator.clipboard.writeText(pin.cid)
                    setStatusMessage('CID Copied!')
                    setTimeout(() => setStatusMessage(''), 2000)
                  }} title="Copy CID">📋</button>
                  <button className="btn-icon btn-danger" onClick={() => handleRemove(pin.cid)} title="Delete">🗑️</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Preview Modal */}
      {preview && (
        <div className="preview-modal-overlay" onClick={closePreview}>
          <div className="preview-modal" onClick={e => e.stopPropagation()}>
            <div className="preview-header">
              <h3>{preview.name}</h3>
              <button className="btn-close" onClick={closePreview}>×</button>
            </div>
            <div className="preview-content">
              {preview.type.startsWith('image/') && <img src={preview.url} alt="preview" />}
              {preview.type.startsWith('video/') && <video src={preview.url} controls />}
              {preview.type.startsWith('audio/') && <audio src={preview.url} controls />}
              {preview.type === 'application/pdf' && <iframe src={preview.url} title="PDF Preview" />}
              {(preview.type.startsWith('text/') || preview.type.includes('json')) && (
                 <iframe src={preview.url} title="Text Preview" className="text-preview-frame" />
              )}
              {/* Fallback */}
              {!preview.type.match(/image|video|audio|pdf|text|json/) && (
                <div className="no-preview">
                  <p>Preview not available for this file type.</p>
                  <a href={preview.url} download={preview.name} className="btn btn-primary">Download File</a>
                </div>
              )}
            </div>
            <div className="preview-footer">
               <div className="preview-cid">CID: {preview.cid}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Files
