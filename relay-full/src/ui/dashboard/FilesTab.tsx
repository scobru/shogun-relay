"use client";

import { useState, useEffect } from "react";
import toast from "react-hot-toast";

interface FileItem {
  id: string;
  name: string;
  size: number;
  type: string;
  uploadDate: string;
  ipfsHash?: string;
  isPinned?: boolean;
}

interface SharedLinkItem {
  token: string;
  fileName: string;
  hasPassword: boolean;
  expiresAt: number | null; // Unix timestamp in milliseconds
  maxDownloads: number;
  downloadCount: number;
  description: string | null;
  createdAt: number; // Unix timestamp in milliseconds
  remainingDownloads: number;
  shareUrl: string;
  isExhausted: boolean;
  exhaustedAt: number | null;
  status: 'active' | 'expired' | 'exhausted';
}

interface FilesTabProps {
  onFileStatsUpdate: (stats: { count: number; totalSize: number }) => void;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
}

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

const formatDate = (dateString: string): string => {
  return new Date(dateString).toLocaleDateString() + " " + new Date(dateString).toLocaleTimeString();
};

const formatTimestamp = (timestamp: number | null): string => {
  if (!timestamp) return "Never";
  const date = new Date(timestamp);
  return date.toLocaleDateString() + " " + date.toLocaleTimeString();
};

const getFileIcon = (type: string): string => {
  if (type.startsWith("image/")) return "🖼️";
  if (type.startsWith("video/")) return "🎥";
  if (type.startsWith("audio/")) return "🎵";
  if (type.includes("pdf")) return "📄";
  if (type.includes("text")) return "📝";
  if (type.includes("zip") || type.includes("archive")) return "📦";
  return "📁";
};

const FilesTab = ({ onFileStatsUpdate, isLoading, setIsLoading }: FilesTabProps) => {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [sharedLinks, setSharedLinks] = useState<SharedLinkItem[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "size" | "date">("name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  // Load files from API
  const loadFiles = async () => {
    setIsLoading(true);
    try {
      console.log("[FilesTab] Loading files from API...");
      
      // Call the real API endpoint
      const response = await fetch('/api/files/list', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.success && data.files) {
        // Transform API data to match our interface
        const transformedFiles: FileItem[] = data.files.map((file: any) => ({
          id: file.id,
          name: file.originalName || file.name,
          size: file.size || 0,
          type: file.mimetype || file.mimeType || 'application/octet-stream',
          uploadDate: new Date(file.timestamp || file.uploadedAt || Date.now()).toISOString(),
          ipfsHash: file.ipfsHash || undefined,
          isPinned: file.ipfsHash ? true : false
        }));
        
        setFiles(transformedFiles);
        console.log(`[FilesTab] Loaded ${transformedFiles.length} files from API`);
        
        // Update file stats
        const totalSize = transformedFiles.reduce((sum, file) => sum + file.size, 0);
        onFileStatsUpdate({
          count: transformedFiles.length,
          totalSize
        });
      } else {
        console.warn("[FilesTab] API returned no files or error:", data);
        setFiles([]);
        onFileStatsUpdate({ count: 0, totalSize: 0 });
      }
    } catch (error) {
      console.error("[FilesTab] Error loading files:", error);
      toast.error(`Error loading files: ${error.message}`);
      
      // Fallback to empty state
      setFiles([]);
      onFileStatsUpdate({ count: 0, totalSize: 0 });
    } finally {
      setIsLoading(false);
    }
  };

  // Load shared links from API
  const loadSharedLinks = async () => {
    try {
      console.log("[FilesTab] Loading shared links from API...");
      
      const response = await fetch('/api/files/shared-links', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.success && data.sharedLinks) {
        setSharedLinks(data.sharedLinks);
        console.log(`[FilesTab] Loaded ${data.sharedLinks.length} shared links from API`);
      } else {
        console.warn("[FilesTab] API returned no shared links or error:", data);
        setSharedLinks([]);
      }
    } catch (error) {
      console.error("[FilesTab] Error loading shared links:", error);
      toast.error(`Error loading shared links: ${error.message}`);
      setSharedLinks([]);
    }
  };

  // Delete file
  const deleteFile = async (fileId: string, fileName: string) => {
    if (!confirm(`Are you sure you want to delete "${fileName}"?`)) return;

    try {
      console.log(`[FilesTab] Deleting file: ${fileId}`);
      
      const response = await fetch(`/api/files/delete/${fileId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.success) {
        // Remove file from local state
        setFiles(prevFiles => prevFiles.filter(f => f.id !== fileId));
        toast.success("File deleted successfully");
        
        // Update stats
        const remainingFiles = files.filter(f => f.id !== fileId);
        const totalSize = remainingFiles.reduce((sum, file) => sum + file.size, 0);
        onFileStatsUpdate({
          count: remainingFiles.length,
          totalSize
        });
        
        console.log(`[FilesTab] File deleted successfully: ${fileId}`);
      } else {
        throw new Error(data.error || 'Delete failed');
      }
    } catch (error) {
      console.error("[FilesTab] Error deleting file:", error);
      toast.error(`Error deleting file: ${error.message}`);
    }
  };

  // Revoke shared link
  const revokeSharedLink = async (token: string, fileName: string) => {
    if (!confirm(`Are you sure you want to revoke the shared link for "${fileName}"?`)) return;

    try {
      console.log(`[FilesTab] Revoking shared link: ${token}`);
      
      const response = await fetch(`/api/files/share/${token}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.success) {
        // Remove link from local state
        setSharedLinks(prevLinks => prevLinks.filter(link => link.token !== token));
        toast.success("Shared link revoked successfully");
        console.log(`[FilesTab] Shared link revoked successfully: ${token}`);
      } else {
        throw new Error(data.error || 'Revoke failed');
      }
    } catch (error) {
      console.error("[FilesTab] Error revoking shared link:", error);
      toast.error(`Error revoking shared link: ${error.message}`);
    }
  };

  // Download file
  const downloadFile = (fileId: string, fileName: string) => {
    try {
      console.log(`[FilesTab] Downloading file: ${fileId}`);
      
      // Create download link
      const downloadUrl = `/uploads/${fileName}?token=${localStorage.getItem('authToken') || ''}`;
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      toast.success(`Downloading ${fileName}...`);
    } catch (error) {
      console.error("[FilesTab] Error downloading file:", error);
      toast.error(`Error downloading file: ${error.message}`);
    }
  };

  // Toggle file selection
  const toggleFileSelection = (fileId: string) => {
    const newSelected = new Set(selectedFiles);
    if (newSelected.has(fileId)) {
      newSelected.delete(fileId);
    } else {
      newSelected.add(fileId);
    }
    setSelectedFiles(newSelected);
  };

  // Select all files
  const selectAllFiles = () => {
    if (selectedFiles.size === filteredFiles.length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(filteredFiles.map(f => f.id)));
    }
  };

  // Delete selected files
  const deleteSelectedFiles = async () => {
    if (selectedFiles.size === 0) return;
    
    if (!confirm(`Delete ${selectedFiles.size} selected files?`)) return;

    setIsLoading(true);
    try {
      setFiles(prevFiles => prevFiles.filter(f => !selectedFiles.has(f.id)));
      toast.success(`Deleted ${selectedFiles.size} files`);
      setSelectedFiles(new Set());
      
      // Update stats
      const remainingFiles = files.filter(f => !selectedFiles.has(f.id));
      const totalSize = remainingFiles.reduce((sum, file) => sum + file.size, 0);
      onFileStatsUpdate({
        count: remainingFiles.length,
        totalSize
      });
    } catch (error) {
      console.error("Error deleting files:", error);
      toast.error("Error deleting selected files");
    } finally {
      setIsLoading(false);
    }
  };

  // Filter and sort files
  const filteredFiles = files
    .filter(file => 
      file.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      file.type.toLowerCase().includes(searchTerm.toLowerCase())
    )
    .sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case "name":
          comparison = a.name.localeCompare(b.name);
          break;
        case "size":
          comparison = a.size - b.size;
          break;
        case "date":
          comparison = new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime();
          break;
      }
      return sortOrder === "asc" ? comparison : -comparison;
    });

  useEffect(() => {
    loadFiles();
    loadSharedLinks();
  }, []);

  return (
    <div className="space-y-6">
      {/* Header with controls */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex items-center gap-4">
          <h2 className="text-2xl font-bold">Files Management</h2>
          <button 
            onClick={loadFiles}
            className="btn btn-circle btn-ghost"
            disabled={isLoading}
          >
            <svg className={`w-5 h-5 ${isLoading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>

        <div className="flex items-center gap-2">
          {selectedFiles.size > 0 && (
            <button 
              onClick={deleteSelectedFiles}
              className="btn btn-error btn-sm"
            >
              Delete ({selectedFiles.size})
            </button>
          )}
        </div>
      </div>

      {/* Search and Sort */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="form-control flex-1">
          <input
            type="text"
            placeholder="Search files..."
            className="input input-bordered w-full"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        
        <div className="flex gap-2">
          <select
            className="select select-bordered"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as "name" | "size" | "date")}
          >
            <option value="name">Sort by Name</option>
            <option value="size">Sort by Size</option>
            <option value="date">Sort by Date</option>
          </select>
          
          <button
            onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
            className="btn btn-square btn-outline"
          >
            {sortOrder === "asc" ? "↑" : "↓"}
          </button>
        </div>
      </div>

      {/* Files Table */}
      <div className="overflow-x-auto">
        <table className="table table-zebra w-full">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={selectedFiles.size === filteredFiles.length && filteredFiles.length > 0}
                  onChange={selectAllFiles}
                />
              </th>
              <th>File</th>
              <th>Size</th>
              <th>Type</th>
              <th>Upload Date</th>
              <th>IPFS</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredFiles.map((file) => (
              <tr key={file.id} className="hover">
                <td>
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={selectedFiles.has(file.id)}
                    onChange={() => toggleFileSelection(file.id)}
                  />
                </td>
                <td>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{getFileIcon(file.type)}</span>
                    <div>
                      <div className="font-medium">{file.name}</div>
                      <div className="text-sm text-base-content/70">{file.id}</div>
                    </div>
                  </div>
                </td>
                <td>{formatFileSize(file.size)}</td>
                <td>
                  <span className="badge badge-ghost">{file.type}</span>
                </td>
                <td className="text-sm">{formatDate(file.uploadDate)}</td>
                <td>
                  {file.ipfsHash ? (
                    <div className="flex items-center gap-2">
                      <span className={`badge ${file.isPinned ? "badge-success" : "badge-warning"}`}>
                        {file.isPinned ? "Pinned" : "Unpinned"}
                      </span>
                    </div>
                  ) : (
                    <span className="badge badge-ghost">Not on IPFS</span>
                  )}
                </td>
                <td>
                  <div className="flex gap-2">
                    <button
                      onClick={() => downloadFile(file.id, file.name)}
                      className="btn btn-ghost btn-sm"
                      title="Download"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => deleteFile(file.id, file.name)}
                      className="btn btn-ghost btn-sm text-error"
                      title="Delete"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filteredFiles.length === 0 && !isLoading && (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">📁</div>
            <h3 className="text-lg font-medium mb-2">No files found</h3>
            <p className="text-base-content/70">
              {searchTerm ? "Try a different search term" : "Upload some files to get started"}
            </p>
          </div>
        )}

        {isLoading && (
          <div className="flex justify-center py-12">
            <div className="loading loading-spinner loading-lg"></div>
          </div>
        )}
      </div>

      {/* Shared Links Section */}
      <div className="divider"></div>
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <h2 className="text-2xl font-bold">Shared Links</h2>
        <button 
          onClick={loadSharedLinks}
          className="btn btn-circle btn-ghost"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="table table-zebra w-full">
          <thead>
            <tr>
              <th>File Name</th>
              <th>Status</th>
              <th>Downloads</th>
              <th>Expires</th>
              <th>Password</th>
              <th>Created At</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sharedLinks.map((link) => (
              <tr key={link.token} className="hover">
                <td>
                  <a href={link.shareUrl} target="_blank" rel="noopener noreferrer" className="link link-primary">
                    {link.fileName}
                  </a>
                  <div className="text-sm text-base-content/70 truncate" title={link.token}>{link.token}</div>
                </td>
                <td>
                  <span className={`badge ${
                    link.status === 'active' ? 'badge-success' :
                    link.status === 'expired' ? 'badge-error' :
                    'badge-warning'
                  }`}>
                    {link.status}
                  </span>
                </td>
                <td>{link.downloadCount}/{link.maxDownloads}</td>
                <td>{formatTimestamp(link.expiresAt)}</td>
                <td>
                  {link.hasPassword ? (
                    <span className="badge badge-info">Yes</span>
                  ) : (
                    <span className="badge badge-ghost">No</span>
                  )}
                </td>
                <td>{formatTimestamp(link.createdAt)}</td>
                <td>
                  <div className="flex gap-2">
                    <a 
                      href={link.shareUrl} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="btn btn-ghost btn-sm"
                      title="Open Link"
                    >
                      🔗
                    </a>
                    <button
                      onClick={() => navigator.clipboard.writeText(link.shareUrl).then(() => toast.success("Link copied!"))}
                      className="btn btn-ghost btn-sm"
                      title="Copy Link"
                    >
                      📋
                    </button>
                    <button
                      onClick={() => revokeSharedLink(link.token, link.fileName)}
                      className="btn btn-ghost btn-sm text-error"
                      title="Revoke Link"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {sharedLinks.length === 0 && (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">🔗</div>
            <h3 className="text-lg font-medium mb-2">No shared links found</h3>
            <p className="text-base-content/70">
              Create a shared link to see it here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default FilesTab; 