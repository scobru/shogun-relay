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
          if (!token) throw new Error("Authentication required for encryption")
          
          const encryptedBytes = await encryptData(buffer, token)
          const encryptedBlob = new Blob([encryptedBytes], { type: 'application/octet-stream' })
          file = new File([encryptedBlob], name + '.enc', { type: 'application/octet-stream' })
        }
        
        formData.append('file', file, encryptUpload ? file.name : name)
      } else {
        Array.from(files).forEach(file => {
          // @ts-ignore
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

  const formatBytes = (bytes: number) => {
    if (!bytes) return 'Unknown size'
    if (bytes < 1024) return bytes + ' B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  if (!isAuthenticated) return (
    <div className="alert alert-warning">
      <span className="text-2xl">🔒</span>
      <span>Authentication required to access Files. Please enter admin password in Settings.</span>
    </div>
  )

  return (
    <div className="flex flex-col gap-6 max-w-6xl">
      {/* Header */}
      <div className="card bg-base-100 shadow">
        <div className="card-body flex-row items-center justify-between flex-wrap gap-4">
          <div>
            <h2 className="card-title text-2xl">🗄️ File Manager</h2>
            <p className="text-base-content/70">Managed IPFS Storage & Pins</p>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-ghost btn-sm" onClick={handleGarbageCollection}>🧹 Run GC</button>
            <button className="btn btn-error btn-sm" onClick={handleRemoveAll}>🗑️ Remove All</button>
          </div>
        </div>
      </div>

      {/* Upload Section */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h3 className="font-bold text-lg mb-4">Upload Files</h3>
          
          <div 
            className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${dragActive ? 'border-primary bg-primary/5' : 'border-base-300'}`}
            onDragOver={e => { e.preventDefault(); setDragActive(true) }}
            onDragLeave={() => setDragActive(false)}
            onDrop={e => { e.preventDefault(); setDragActive(false) }}
          >
            {/* Upload Mode Selection */}
            <div className="flex flex-wrap justify-center gap-4 mb-4">
              <label className="label cursor-pointer gap-2">
                <input 
                  type="radio" 
                  className="radio radio-primary" 
                  checked={uploadMode === 'single'} 
                  onChange={() => setUploadMode('single')} 
                />
                <span>Single File</span>
              </label>
              <label className="label cursor-pointer gap-2">
                <input 
                  type="radio" 
                  className="radio radio-primary" 
                  checked={uploadMode === 'directory'} 
                  onChange={() => setUploadMode('directory')} 
                />
                <span>Directory</span>
              </label>
            </div>
            
            {uploadMode === 'single' && (
              <div className="flex flex-wrap justify-center gap-4 mb-4">
                <input 
                  type="text" 
                  className="input input-bordered input-sm" 
                  placeholder="Filename Override (optional)" 
                  value={fileNameOverride}
                  onChange={e => setFileNameOverride(e.target.value)}
                />
                <label className="label cursor-pointer gap-2">
                  <input 
                    type="checkbox" 
                    className="checkbox checkbox-primary checkbox-sm" 
                    checked={encryptUpload} 
                    onChange={e => setEncryptUpload(e.target.checked)} 
                  />
                  <span className="text-sm">Encrypt (AES-GCM)</span>
                </label>
              </div>
            )}
            
            {uploadMode === 'single' ? (
              <input 
                ref={fileInputRef} 
                type="file" 
                className="file-input file-input-bordered file-input-primary w-full max-w-xs"
                onChange={e => handleUpload(e)} 
              />
            ) : (
              <input 
                ref={dirInputRef} 
                type="file" 
                className="file-input file-input-bordered file-input-primary w-full max-w-xs"
                // @ts-ignore
                webkitdirectory="" 
                directory="" 
                onChange={e => handleUpload(e)} 
              />
            )}
            
            {uploading && (
              <div className="mt-4">
                <progress className="progress progress-primary w-full" value={uploadProgress} max="100"></progress>
                <p className="text-sm mt-1">{Math.round(uploadProgress)}%</p>
              </div>
            )}
            {statusMessage && <p className="mt-2 text-sm">{statusMessage}</p>}
          </div>
        </div>
      </div>

      {/* Pins List */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          {/* Search & Filter */}
          <div className="flex flex-wrap gap-4 mb-4">
            <input 
              type="text" 
              className="input input-bordered flex-1 min-w-[200px]" 
              placeholder="Search pins by name or CID..." 
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            <select 
              className="select select-bordered" 
              value={filterType} 
              onChange={e => setFilterType(e.target.value)}
            >
              <option value="all">All Types</option>
              <option value="recursive">Recursive</option>
              <option value="direct">Direct</option>
            </select>
          </div>

          {loading ? (
            <div className="flex justify-center p-8">
              <span className="loading loading-spinner loading-lg"></span>
            </div>
          ) : filteredPins.length === 0 ? (
            <div className="text-center p-8 text-base-content/50">
              <span className="text-4xl block mb-2">📭</span>
              <p>No pins found</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredPins.map(pin => (
                <div key={pin.cid} className="card card-compact bg-base-200">
                  <div className="card-body">
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">{pin.type === 'recursive' ? '📁' : '📄'}</span>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium truncate" title={pin.name}>{pin.name}</h4>
                        <p className="text-xs text-base-content/60 font-mono truncate" title={pin.cid}>{pin.cid.substring(0, 16)}...</p>
                        <p className="text-xs text-base-content/50">
                          {new Date(pin.timestamp).toLocaleDateString()} • {formatBytes(pin.size || 0)}
                        </p>
                      </div>
                    </div>
                    <div className="card-actions justify-end mt-2">
                      <button className="btn btn-ghost btn-xs" onClick={() => handlePreview(pin)} title="Preview">👁️</button>
                      <button className="btn btn-ghost btn-xs" onClick={() => {
                        navigator.clipboard.writeText(pin.cid)
                        setStatusMessage('CID Copied!')
                        setTimeout(() => setStatusMessage(''), 2000)
                      }} title="Copy CID">📋</button>
                      <button className="btn btn-ghost btn-xs text-error" onClick={() => handleRemove(pin.cid)} title="Delete">🗑️</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Preview Modal */}
      {preview && (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-3xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg truncate">{preview.name}</h3>
              <button className="btn btn-sm btn-circle btn-ghost" onClick={closePreview}>✕</button>
            </div>
            
            <div className="max-h-96 overflow-auto">
              {preview.type.startsWith('image/') && <img src={preview.url} alt="preview" className="max-w-full" />}
              {preview.type.startsWith('video/') && <video src={preview.url} controls className="max-w-full" />}
              {preview.type.startsWith('audio/') && <audio src={preview.url} controls className="w-full" />}
              {preview.type === 'application/pdf' && <iframe src={preview.url} title="PDF Preview" className="w-full h-96" />}
              {(preview.type.startsWith('text/') || preview.type.includes('json')) && (
                <iframe src={preview.url} title="Text Preview" className="w-full h-96" />
              )}
              {!preview.type.match(/image|video|audio|pdf|text|json/) && (
                <div className="text-center p-8">
                  <p className="mb-4">Preview not available for this file type.</p>
                  <a href={preview.url} download={preview.name} className="btn btn-primary">Download File</a>
                </div>
              )}
            </div>
            
            <div className="mt-4 text-xs text-base-content/60 font-mono">CID: {preview.cid}</div>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button onClick={closePreview}>close</button>
          </form>
        </dialog>
      )}
    </div>
  )
}

export default Files
