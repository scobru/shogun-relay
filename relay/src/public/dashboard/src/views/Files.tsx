import { useEffect, useState, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import './Files.css'

interface Pin {
  cid: string
  type: string
  name?: string
}

function Files() {
  const { isAuthenticated, getAuthHeaders, password } = useAuth()
  const [pins, setPins] = useState<Pin[]>([])
  const [loading, setLoading] = useState(true)
  const [newCid, setNewCid] = useState('')

  // Upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadStatus, setUploadStatus] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isAuthenticated) {
      loadPins()
    } else {
      setLoading(false)
    }
  }, [isAuthenticated])

  async function loadPins() {
    try {
      const res = await fetch('/api/v1/ipfs/pin/ls', { headers: getAuthHeaders() })
      const data = await res.json()
      if (data.pins) {
        const pinList = Object.entries(data.pins).map(([cid, info]: [string, any]) => ({
          cid,
          type: info.Type || 'recursive',
          name: info.Name || ''
        }))
        setPins(pinList)
      }
    } catch (error) {
      console.error('Failed to load pins:', error)
    } finally {
      setLoading(false)
    }
  }

  async function addPin() {
    if (!newCid.trim()) return
    try {
      const res = await fetch('/api/v1/ipfs/pin/add', {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ cid: newCid.trim() })
      })
      if (res.ok) {
        setNewCid('')
        loadPins()
      }
    } catch (error) {
      console.error('Failed to add pin:', error)
    }
  }

  async function removePin(cid: string) {
    if (!confirm(`Remove pin ${cid.slice(0, 16)}...?`)) return
    try {
      await fetch('/api/v1/ipfs/pin/rm', {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ cid })
      })
      loadPins()
    } catch (error) {
      console.error('Failed to remove pin:', error)
    }
  }

  // Upload handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const files = e.dataTransfer.files
    if (files.length > 0) {
      setSelectedFile(files[0])
      setUploadStatus('')
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFile(e.target.files[0])
      setUploadStatus('')
    }
  }

  const uploadFile = async () => {
    if (!selectedFile || !password) return

    setUploading(true)
    setUploadProgress(10)
    setUploadStatus('Uploading...')

    try {
      const formData = new FormData()
      formData.append('file', selectedFile, selectedFile.name)

      setUploadProgress(30)

      const res = await fetch('/api/v1/ipfs/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${password}` },
        body: formData
      })

      setUploadProgress(80)

      const result = await res.json()

      if (result.success) {
        setUploadProgress(100)
        const hash = result.cid || (result.file && result.file.hash)
        setUploadStatus(`✅ Uploaded! CID: ${hash}`)
        setSelectedFile(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
        loadPins()
      } else {
        setUploadStatus(`❌ ${result.error || 'Upload failed'}`)
      }
    } catch (error) {
      console.error('Upload error:', error)
      setUploadStatus('❌ Upload failed')
    } finally {
      setUploading(false)
    }
  }

  if (!isAuthenticated) {
    return (
      <div className="files-auth card">
        <span className="files-auth-icon">🔒</span>
        <h3>Authentication Required</h3>
        <p>Please enter admin password in Settings to access file management.</p>
      </div>
    )
  }

  if (loading) {
    return <div className="files-loading">Loading pins...</div>
  }

  return (
    <div className="files-page">
      {/* Upload Section */}
      <div className="files-upload card">
        <h3>📤 Upload to IPFS</h3>
        <div
          className={`files-dropzone ${isDragging ? 'dragging' : ''} ${selectedFile ? 'has-file' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            hidden
            onChange={handleFileSelect}
          />
          {selectedFile ? (
            <>
              <span className="dropzone-icon">📄</span>
              <p className="dropzone-filename">{selectedFile.name}</p>
              <p className="dropzone-size">{(selectedFile.size / 1024).toFixed(1)} KB</p>
            </>
          ) : (
            <>
              <span className="dropzone-icon">☁️</span>
              <p>Drag & drop file here or click to select</p>
            </>
          )}
        </div>

        {selectedFile && (
          <div className="files-upload-actions">
            <button
              className="btn btn-primary"
              onClick={uploadFile}
              disabled={uploading}
            >
              {uploading ? `Uploading... ${uploadProgress}%` : '⬆️ Upload'}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => {
                setSelectedFile(null)
                setUploadStatus('')
                if (fileInputRef.current) fileInputRef.current.value = ''
              }}
            >
              Cancel
            </button>
          </div>
        )}

        {uploading && (
          <div className="files-progress">
            <div className="files-progress-bar" style={{ width: `${uploadProgress}%` }} />
          </div>
        )}

        {uploadStatus && (
          <p className={`files-upload-status ${uploadStatus.startsWith('✅') ? 'success' : 'error'}`}>
            {uploadStatus}
          </p>
        )}
      </div>

      {/* Quick Add */}
      <div className="files-add card">
        <h3>📌 Pin Existing CID</h3>
        <div className="files-add-row">
          <input
            type="text"
            className="input"
            placeholder="Enter IPFS CID (Qm... or ba...)"
            value={newCid}
            onChange={(e) => setNewCid(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && addPin()}
          />
          <button className="btn btn-primary" onClick={addPin}>Add Pin</button>
        </div>
      </div>

      {/* Stats */}
      <div className="files-stats">
        <span>Total Pins: <strong>{pins.length}</strong></span>
        <button className="btn btn-secondary" onClick={loadPins}>🔄 Refresh</button>
      </div>

      {/* Pins Grid */}
      {pins.length === 0 ? (
        <div className="files-empty card">
          <span>📁</span>
          <h3>No pins found</h3>
          <p>Upload a file or add a CID to get started</p>
        </div>
      ) : (
        <div className="files-grid">
          {pins.map(pin => (
            <div key={pin.cid} className="file-card card">
              <div className="file-cid">{pin.cid}</div>
              <div className="file-meta">
                <span className="file-type">{pin.type}</span>
                {pin.name && <span className="file-name">{pin.name}</span>}
              </div>
              <div className="file-actions">
                <button 
                  className="btn btn-secondary" 
                  onClick={() => navigator.clipboard.writeText(pin.cid)}
                >
                  📋 Copy
                </button>
                <button 
                  className="btn btn-secondary"
                  onClick={() => window.open(`/ipfs/${pin.cid}`, '_blank')}
                >
                  🌐 Open
                </button>
                <button 
                  className="btn btn-secondary"
                  onClick={() => removePin(pin.cid)}
                  style={{ color: 'var(--color-error)' }}
                >
                  🗑️
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default Files
