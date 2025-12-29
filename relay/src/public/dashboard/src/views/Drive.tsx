import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import './Drive.css'

interface DriveItem {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  modified: number
}

interface DriveStats {
  totalSizeGB: string
  totalSizeMB: string
  fileCount: number
  dirCount: number
}

function Drive() {
  const { isAuthenticated, getAuthHeaders } = useAuth()
  const [currentPath, setCurrentPath] = useState('')
  const [items, setItems] = useState<DriveItem[]>([])
  const [stats, setStats] = useState<DriveStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [showFolderModal, setShowFolderModal] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [notification, setNotification] = useState<{ message: string; type: string } | null>(null)

  const showNotification = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setNotification({ message, type })
    setTimeout(() => setNotification(null), 3000)
  }

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const formatDate = (timestamp: number) => new Date(timestamp).toLocaleString()

  const loadFiles = useCallback(async () => {
    if (!isAuthenticated) return
    setLoading(true)
    try {
      const pathParam = currentPath ? `/${currentPath}` : ''
      const res = await fetch(`/api/v1/drive/list${pathParam}`, { headers: getAuthHeaders() })
      const data = await res.json()
      if (data.success) {
        setItems(data.items || [])
      }
    } catch (error) {
      console.error('Failed to load files:', error)
    } finally {
      setLoading(false)
    }
  }, [currentPath, isAuthenticated, getAuthHeaders])

  const loadStats = useCallback(async () => {
    if (!isAuthenticated) return
    try {
      const res = await fetch('/api/v1/drive/stats', { headers: getAuthHeaders() })
      const data = await res.json()
      if (data.success && data.stats) {
        setStats(data.stats)
      }
    } catch (error) {
      console.error('Failed to load stats:', error)
    }
  }, [isAuthenticated, getAuthHeaders])

  useEffect(() => {
    if (isAuthenticated) {
      loadFiles()
      loadStats()
    } else {
      setLoading(false)
    }
  }, [isAuthenticated, loadFiles, loadStats])

  const navigateTo = (path: string) => {
    setCurrentPath(path)
  }

  const downloadFile = async (filePath: string) => {
    try {
      const res = await fetch(`/api/v1/drive/download/${encodeURIComponent(filePath)}`, {
        headers: getAuthHeaders()
      })
      if (!res.ok) throw new Error('Download failed')
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filePath.split('/').pop() || 'file'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
      showNotification('File downloaded', 'success')
    } catch (error) {
      showNotification('Download failed', 'error')
    }
  }

  const deleteItem = async (itemPath: string) => {
    if (!confirm(`Delete "${itemPath.split('/').pop()}"?`)) return
    try {
      const res = await fetch(`/api/v1/drive/delete/${encodeURIComponent(itemPath)}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      })
      const data = await res.json()
      if (data.success) {
        showNotification('Deleted', 'success')
        loadFiles()
        loadStats()
      } else {
        showNotification(data.error || 'Delete failed', 'error')
      }
    } catch (error) {
      showNotification('Delete failed', 'error')
    }
  }

  const createFolder = async () => {
    if (!newFolderName.trim()) return
    try {
      const path = currentPath ? `${currentPath}/${newFolderName}` : newFolderName
      const res = await fetch('/api/v1/drive/mkdir', {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ path })
      })
      const data = await res.json()
      if (data.success) {
        showNotification('Folder created', 'success')
        setShowFolderModal(false)
        setNewFolderName('')
        loadFiles()
        loadStats()
      } else {
        showNotification(data.error || 'Failed to create folder', 'error')
      }
    } catch (error) {
      showNotification('Failed to create folder', 'error')
    }
  }

  const uploadFiles = async () => {
    if (selectedFiles.length === 0) return
    setUploading(true)
    try {
      for (const file of selectedFiles) {
        const formData = new FormData()
        formData.append('file', file)
        if (currentPath) formData.append('path', currentPath)

        const res = await fetch('/api/v1/drive/upload', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: formData
        })
        const data = await res.json()
        if (!data.success) {
          showNotification(`Failed to upload ${file.name}`, 'error')
        }
      }
      showNotification('Upload complete', 'success')
      setShowUploadModal(false)
      setSelectedFiles([])
      loadFiles()
      loadStats()
    } catch (error) {
      showNotification('Upload failed', 'error')
    } finally {
      setUploading(false)
    }
  }

  const getBreadcrumbs = () => {
    const parts = currentPath.split('/').filter(p => p)
    const crumbs = [{ name: 'Home', path: '' }]
    let path = ''
    parts.forEach(part => {
      path += (path ? '/' : '') + part
      crumbs.push({ name: part, path })
    })
    return crumbs
  }

  if (!isAuthenticated) {
    return (
      <div className="drive-auth card">
        <span className="drive-auth-icon">🔒</span>
        <h3>Authentication Required</h3>
        <p>Please enter admin password in Settings to access Admin Drive.</p>
      </div>
    )
  }

  return (
    <div className="drive-page">
      {/* Notification */}
      {notification && (
        <div className={`drive-notification ${notification.type}`}>
          {notification.message}
        </div>
      )}

      {/* Stats Bar */}
      <div className="drive-stats-bar">
        <div className="drive-stat">
          <span className="drive-stat-value">
            {stats ? (parseFloat(stats.totalSizeGB) >= 1 ? `${parseFloat(stats.totalSizeGB).toFixed(2)} GB` : `${stats.totalSizeMB} MB`) : '--'}
          </span>
          <span className="drive-stat-label">Storage Used</span>
        </div>
        <div className="drive-stat">
          <span className="drive-stat-value">{stats?.fileCount ?? '--'}</span>
          <span className="drive-stat-label">Files</span>
        </div>
        <div className="drive-stat">
          <span className="drive-stat-value">{stats?.dirCount ?? '--'}</span>
          <span className="drive-stat-label">Folders</span>
        </div>
      </div>

      {/* Breadcrumb */}
      <div className="drive-breadcrumb">
        {getBreadcrumbs().map((crumb, i, arr) => (
          <span key={crumb.path}>
            <span className="drive-breadcrumb-item" onClick={() => navigateTo(crumb.path)}>
              {i === 0 ? '🏠' : ''} {crumb.name}
            </span>
            {i < arr.length - 1 && <span className="drive-breadcrumb-sep">/</span>}
          </span>
        ))}
      </div>

      {/* Action Bar */}
      <div className="drive-actions">
        <button className="btn btn-primary" onClick={() => setShowUploadModal(true)}>📤 Upload</button>
        <button className="btn btn-secondary" onClick={() => setShowFolderModal(true)}>📁 New Folder</button>
        <button className="btn btn-secondary" onClick={() => { loadFiles(); loadStats(); }}>🔄 Refresh</button>
      </div>

      {/* File Browser */}
      <div className="drive-browser card">
        {loading ? (
          <div className="drive-loading">Loading...</div>
        ) : items.length === 0 ? (
          <div className="drive-empty">
            <span>📁</span>
            <p>This folder is empty</p>
          </div>
        ) : (
          items.map(item => (
            <div key={item.path} className="drive-item">
              <div className="drive-item-icon">
                {item.type === 'directory' ? '📁' : '📄'}
              </div>
              <div 
                className="drive-item-info"
                onClick={() => item.type === 'directory' ? navigateTo(item.path) : downloadFile(item.path)}
              >
                <div className="drive-item-name">{item.name}</div>
                <div className="drive-item-meta">
                  {item.type === 'directory' ? 'Folder' : formatBytes(item.size || 0)} • {formatDate(item.modified)}
                </div>
              </div>
              <div className="drive-item-actions">
                {item.type === 'file' && (
                  <button className="btn-icon" onClick={() => downloadFile(item.path)} title="Download">⬇️</button>
                )}
                <button className="btn-icon" onClick={() => deleteItem(item.path)} title="Delete">🗑️</button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="drive-modal-overlay" onClick={() => setShowUploadModal(false)}>
          <div className="drive-modal" onClick={e => e.stopPropagation()}>
            <div className="drive-modal-header">
              <h3>Upload Files</h3>
              <button className="drive-modal-close" onClick={() => setShowUploadModal(false)}>×</button>
            </div>
            <div 
              className="drive-upload-area"
              onClick={() => document.getElementById('drive-file-input')?.click()}
              onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('dragover'); }}
              onDragLeave={e => e.currentTarget.classList.remove('dragover')}
              onDrop={e => {
                e.preventDefault();
                e.currentTarget.classList.remove('dragover');
                const files = Array.from(e.dataTransfer.files);
                setSelectedFiles(prev => [...prev, ...files]);
              }}
            >
              <span>📤</span>
              <p>Click or drag files here</p>
              <input
                id="drive-file-input"
                type="file"
                multiple
                style={{ display: 'none' }}
                onChange={e => setSelectedFiles(Array.from(e.target.files || []))}
              />
            </div>
            {selectedFiles.length > 0 && (
              <div className="drive-selected-files">
                {selectedFiles.map((f, i) => (
                  <div key={i} className="drive-selected-file">
                    📄 {f.name} ({formatBytes(f.size)})
                  </div>
                ))}
              </div>
            )}
            <div className="drive-modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowUploadModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={uploadFiles} disabled={uploading || selectedFiles.length === 0}>
                {uploading ? 'Uploading...' : 'Upload'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Folder Modal */}
      {showFolderModal && (
        <div className="drive-modal-overlay" onClick={() => setShowFolderModal(false)}>
          <div className="drive-modal" onClick={e => e.stopPropagation()}>
            <div className="drive-modal-header">
              <h3>Create Folder</h3>
              <button className="drive-modal-close" onClick={() => setShowFolderModal(false)}>×</button>
            </div>
            <input
              type="text"
              className="input"
              placeholder="Folder name"
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              onKeyPress={e => e.key === 'Enter' && createFolder()}
              autoFocus
            />
            <div className="drive-modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowFolderModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={createFolder}>Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Drive
