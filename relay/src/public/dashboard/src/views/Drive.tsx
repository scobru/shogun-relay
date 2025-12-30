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
  const [renameModal, setRenameModal] = useState<{open: boolean, item: DriveItem | null, newName: string}>({open: false, item: null, newName: ''})
  const [linkModal, setLinkModal] = useState<{open: boolean, link: string | null}>({open: false, link: null})

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
  const getBreadcrumbs = () => { const parts = currentPath.split('/').filter((p: string) => p); const crumbs = [{ name: 'Home', path: '' }]; let path = ''; parts.forEach((part: string) => { path += (path ? '/' : '') + part; crumbs.push({ name: part, path }) }); return crumbs }

  const handleRename = async () => {
      if (!renameModal.item || !renameModal.newName) return
      try {
          const res = await fetch('/api/v1/drive/rename', {
              method: 'POST',
              headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
              body: JSON.stringify({ oldPath: renameModal.item.path, newName: renameModal.newName })
          })
          const data = await res.json()
          if (data.success) {
              setRenameModal({open: false, item: null, newName: ''})
              loadFiles()
          } else {
              alert('Rename failed: ' + data.error)
          }
      } catch (e) {
          console.error(e)
      }
  }

  const generateLink = async (filePath: string) => {
      try {
          // Use POST /links to generate a public link
          const res = await fetch('/api/v1/drive/links', { 
              method: 'POST',
              headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
              body: JSON.stringify({ filePath })
          })
          const data = await res.json()
          
          if (data.success && data.publicUrl) {
              setLinkModal({open: true, link: data.publicUrl})
          } else {
              alert('Could not generate public link: ' + (data.error || 'Unknown error'))
          }
      } catch (e) {
          console.error(e)
          alert('Failed to generate link')
      }
  }

  const copyToClipboard = () => {
      if (linkModal.link) {
          navigator.clipboard.writeText(linkModal.link)
          // Could show toast
      }
  }

  // ... (keep existing imports and render) ...

    return (
    <div className="flex flex-col gap-6 max-w-6xl">
      {/* ... (existing stats and breadcrumbs) ... */}
      
      {/* Modals */}
      {/* Rename Modal */}
      {renameModal.open && (
        <dialog className="modal modal-open">
            <div className="modal-box">
                <h3 className="font-bold text-lg">Rename Item</h3>
                <input 
                    type="text" 
                    className="input input-bordered w-full mt-4" 
                    value={renameModal.newName} 
                    onChange={e => setRenameModal({...renameModal, newName: e.target.value})}
                    onKeyPress={e => e.key === 'Enter' && handleRename()}
                    autoFocus 
                />
                <div className="modal-action">
                    <button className="btn" onClick={() => setRenameModal({open: false, item: null, newName: ''})}>Cancel</button>
                    <button className="btn btn-primary" onClick={handleRename}>Rename</button>
                </div>
            </div>
            <form method="dialog" className="modal-backdrop"><button onClick={() => setRenameModal({open: false, item: null, newName: ''})}>close</button></form>
        </dialog>
      )}

      {/* Link Modal */}
      {linkModal.open && (
        <dialog className="modal modal-open">
            <div className="modal-box">
                <h3 className="font-bold text-lg">Public Link</h3>
                <div className="flex gap-2 mt-4">
                    <input type="text" className="input input-bordered w-full" value={linkModal.link || ''} readOnly />
                    <button className="btn btn-square" onClick={copyToClipboard} title="Copy">📋</button>
                </div>
                <div className="modal-action">
                    <button className="btn" onClick={() => setLinkModal({open: false, link: null})}>Close</button>
                </div>
            </div>
            <form method="dialog" className="modal-backdrop"><button onClick={() => setLinkModal({open: false, link: null})}>close</button></form>
        </dialog>
      )}

      {/* ... (rest of the component) ... */}
      {/* File List Item Update to include new buttons */}
      {/* We need to inject the rename/share buttons into the list item */}
       {/* File List */}
      <div className="card bg-base-100 shadow">
        <div className="card-body p-0">
          {loading ? (
            <div className="flex justify-center p-8"><span className="loading loading-spinner loading-lg"></span></div>
          ) : items.length === 0 ? (
            <div className="text-center p-8 text-base-content/50"><span className="text-4xl block mb-2">📁</span><p>This folder is empty</p></div>
          ) : (
            <ul className="menu">
              {items.map((item: DriveItem) => (
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
                      {item.type === 'file' && <button className="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); downloadFile(item.path) }} title="Download">⬇️</button>}
                      <button className="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); setRenameModal({open: true, item, newName: item.name}) }} title="Rename">✏️</button>
                      <button className="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); generateLink(item.path) }} title="Share">🔗</button>
                      <button className="btn btn-ghost btn-xs text-error" onClick={(e) => { e.stopPropagation(); deleteItem(item.path) }} title="Delete">🗑️</button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    
      {/* Upload Modal ... (existing) */}
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
              <div className="mt-4 space-y-1">{selectedFiles.map((f: File, i: number) => (<div key={i} className="text-sm">📄 {f.name} ({formatBytes(f.size)})</div>))}</div>
            )}
            <div className="modal-action">
              <button className="btn" onClick={() => setShowUploadModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={uploadFiles} disabled={uploading || selectedFiles.length === 0}>{uploading ? <span className="loading loading-spinner loading-xs"></span> : 'Upload'}</button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop"><button onClick={() => setShowUploadModal(false)}>close</button></form>
        </dialog>
      )}

      {/* Folder Modal ... (existing) */}
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
