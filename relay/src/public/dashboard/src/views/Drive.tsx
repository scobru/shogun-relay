import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'

interface DriveItem { name: string; path: string; type: 'file' | 'directory'; size?: number; modified: number }
interface DriveStats { totalSizeGB: string; totalSizeMB: string; fileCount: number; dirCount: number }

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

  const formatBytes = (bytes: number) => { if (!bytes) return '0 B'; const k = 1024; const sizes = ['B', 'KB', 'MB', 'GB']; const i = Math.floor(Math.log(bytes) / Math.log(k)); return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i] }
  const formatDate = (ts: number) => new Date(ts).toLocaleString()

  const loadFiles = useCallback(async () => {
    if (!isAuthenticated) return; setLoading(true)
    try { const res = await fetch(`/api/v1/drive/list${currentPath ? `/${currentPath}` : ''}`, { headers: getAuthHeaders() }); const data = await res.json(); if (data.success) setItems(data.items || []) }
    catch (e) { console.error('Failed to load files:', e) } finally { setLoading(false) }
  }, [currentPath, isAuthenticated, getAuthHeaders])

  const loadStats = useCallback(async () => {
    if (!isAuthenticated) return
    try { const res = await fetch('/api/v1/drive/stats', { headers: getAuthHeaders() }); const data = await res.json(); if (data.success && data.stats) setStats(data.stats) } catch {}
  }, [isAuthenticated, getAuthHeaders])

  useEffect(() => { if (isAuthenticated) { loadFiles(); loadStats() } else setLoading(false) }, [isAuthenticated, loadFiles, loadStats])

  const navigateTo = (path: string) => setCurrentPath(path)
  const downloadFile = async (filePath: string) => { try { const res = await fetch(`/api/v1/drive/download/${encodeURIComponent(filePath)}`, { headers: getAuthHeaders() }); if (!res.ok) throw new Error('Download failed'); const blob = await res.blob(); const url = window.URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filePath.split('/').pop() || 'file'; document.body.appendChild(a); a.click(); document.body.removeChild(a); window.URL.revokeObjectURL(url) } catch {} }
  const deleteItem = async (itemPath: string) => { if (!confirm(`Delete "${itemPath.split('/').pop()}"?`)) return; try { const res = await fetch(`/api/v1/drive/delete/${encodeURIComponent(itemPath)}`, { method: 'DELETE', headers: getAuthHeaders() }); const data = await res.json(); if (data.success) { loadFiles(); loadStats() } } catch {} }
  const createFolder = async () => { if (!newFolderName.trim()) return; try { const path = currentPath ? `${currentPath}/${newFolderName}` : newFolderName; const res = await fetch('/api/v1/drive/mkdir', { method: 'POST', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) }); const data = await res.json(); if (data.success) { setShowFolderModal(false); setNewFolderName(''); loadFiles(); loadStats() } } catch {} }
  const uploadFiles = async () => { if (selectedFiles.length === 0) return; setUploading(true); try { for (const file of selectedFiles) { const formData = new FormData(); formData.append('file', file); if (currentPath) formData.append('path', currentPath); await fetch('/api/v1/drive/upload', { method: 'POST', headers: getAuthHeaders(), body: formData }) }; setShowUploadModal(false); setSelectedFiles([]); loadFiles(); loadStats() } catch {} finally { setUploading(false) } }
  const getBreadcrumbs = () => { const parts = currentPath.split('/').filter(p => p); const crumbs = [{ name: 'Home', path: '' }]; let path = ''; parts.forEach(part => { path += (path ? '/' : '') + part; crumbs.push({ name: part, path }) }); return crumbs }

  if (!isAuthenticated) return <div className="alert alert-warning"><span className="text-2xl">🔒</span><span>Authentication required to access Drive.</span></div>

  return (
    <div className="flex flex-col gap-6 max-w-6xl">
      {/* Stats */}
      <div className="stats stats-vertical lg:stats-horizontal shadow w-full">
        <div className="stat"><div className="stat-title">Storage Used</div><div className="stat-value text-primary">{stats ? (parseFloat(stats.totalSizeGB) >= 1 ? `${parseFloat(stats.totalSizeGB).toFixed(2)}` : stats.totalSizeMB) : '--'}</div><div className="stat-desc">{parseFloat(stats?.totalSizeGB || '0') >= 1 ? 'GB' : 'MB'}</div></div>
        <div className="stat"><div className="stat-title">Files</div><div className="stat-value">{stats?.fileCount ?? '--'}</div></div>
        <div className="stat"><div className="stat-title">Folders</div><div className="stat-value">{stats?.dirCount ?? '--'}</div></div>
      </div>

      {/* Breadcrumb & Actions */}
      <div className="card bg-base-100 shadow">
        <div className="card-body flex-row items-center justify-between flex-wrap gap-4">
          <div className="breadcrumbs text-sm">
            <ul>{getBreadcrumbs().map((crumb, i) => (<li key={crumb.path}><a onClick={() => navigateTo(crumb.path)} className="cursor-pointer">{i === 0 ? '🏠' : ''} {crumb.name}</a></li>))}</ul>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-primary btn-sm" onClick={() => setShowUploadModal(true)}>📤 Upload</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowFolderModal(true)}>📁 New Folder</button>
            <button className="btn btn-ghost btn-sm" onClick={() => { loadFiles(); loadStats() }}>🔄</button>
          </div>
        </div>
      </div>

      {/* File List */}
      <div className="card bg-base-100 shadow">
        <div className="card-body p-0">
          {loading ? (
            <div className="flex justify-center p-8"><span className="loading loading-spinner loading-lg"></span></div>
          ) : items.length === 0 ? (
            <div className="text-center p-8 text-base-content/50"><span className="text-4xl block mb-2">📁</span><p>This folder is empty</p></div>
          ) : (
            <ul className="menu">
              {items.map(item => (
                <li key={item.path}>
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-3 flex-1" onClick={() => item.type === 'directory' ? navigateTo(item.path) : downloadFile(item.path)}>
                      <span className="text-xl">{item.type === 'directory' ? '📁' : '📄'}</span>
                      <div>
                        <div className="font-medium">{item.name}</div>
                        <div className="text-xs text-base-content/60">{item.type === 'directory' ? 'Folder' : formatBytes(item.size || 0)} • {formatDate(item.modified)}</div>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {item.type === 'file' && <button className="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); downloadFile(item.path) }}>⬇️</button>}
                      <button className="btn btn-ghost btn-xs text-error" onClick={(e) => { e.stopPropagation(); deleteItem(item.path) }}>🗑️</button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Upload Modal */}
      {showUploadModal && (
        <dialog className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">Upload Files</h3>
            <div className="border-2 border-dashed border-base-300 rounded-lg p-8 text-center mt-4 cursor-pointer hover:border-primary transition-colors" onClick={() => document.getElementById('drive-file-input')?.click()}>
              <span className="text-4xl">📤</span>
              <p className="mt-2">Click or drag files here</p>
              <input id="drive-file-input" type="file" multiple className="hidden" onChange={e => setSelectedFiles(Array.from(e.target.files || []))} />
            </div>
            {selectedFiles.length > 0 && (
              <div className="mt-4 space-y-1">{selectedFiles.map((f, i) => (<div key={i} className="text-sm">📄 {f.name} ({formatBytes(f.size)})</div>))}</div>
            )}
            <div className="modal-action">
              <button className="btn" onClick={() => setShowUploadModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={uploadFiles} disabled={uploading || selectedFiles.length === 0}>{uploading ? <span className="loading loading-spinner loading-xs"></span> : 'Upload'}</button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop"><button onClick={() => setShowUploadModal(false)}>close</button></form>
        </dialog>
      )}

      {/* Folder Modal */}
      {showFolderModal && (
        <dialog className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">Create Folder</h3>
            <input type="text" className="input input-bordered w-full mt-4" placeholder="Folder name" value={newFolderName} onChange={e => setNewFolderName(e.target.value)} onKeyPress={e => e.key === 'Enter' && createFolder()} autoFocus />
            <div className="modal-action">
              <button className="btn" onClick={() => setShowFolderModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={createFolder}>Create</button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop"><button onClick={() => setShowFolderModal(false)}>close</button></form>
        </dialog>
      )}
    </div>
  )
}

export default Drive
