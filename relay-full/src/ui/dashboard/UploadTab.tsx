"use client";

import { useState, useCallback } from "react";
import toast from "react-hot-toast";

interface UploadTabProps {
  onFileStatsUpdate: (stats: { count: number; totalSize: number }) => void;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
}

const UploadTab = ({ onFileStatsUpdate, isLoading, setIsLoading }: UploadTabProps) => {
  const [dragActive, setDragActive] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [uploadToIpfs, setUploadToIpfs] = useState(true);

  // Handle drag events
  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  // Handle file drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(Array.from(e.dataTransfer.files));
    }
  }, []);

  // Handle file input change
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      handleFiles(Array.from(e.target.files));
    }
  }, []);

  // Process uploaded files
  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;

    setIsLoading(true);
    
    for (const file of files) {
      const fileId = Math.random().toString(36).substr(2, 9);
      
      try {
        console.log(`[UploadTab] Starting upload: ${file.name} (${file.size} bytes)`);
        
        // Initialize progress tracking
        setUploadProgress(prev => ({ ...prev, [fileId]: 0 }));

        // Create FormData for file upload
        const formData = new FormData();
        formData.append('file', file);
        formData.append('uploadId', fileId);
        if (file.name) {
          formData.append('customName', file.name);
        }

        // Choose upload endpoint based on IPFS setting
        const uploadEndpoint = uploadToIpfs ? '/api/ipfs/upload' : '/api/files/upload';
        
        console.log(`[UploadTab] Uploading to: ${uploadEndpoint}`);

        // Upload file with progress tracking
        const response = await fetch(uploadEndpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`
          },
          body: formData
        });

        // Simulate progress updates during upload
        for (let progress = 20; progress <= 90; progress += 20) {
          setUploadProgress(prev => ({ ...prev, [fileId]: progress }));
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        
        // Complete progress
        setUploadProgress(prev => ({ ...prev, [fileId]: 100 }));
        
        if (result.success) {
          console.log(`[UploadTab] Upload successful:`, result);
          
          if (uploadToIpfs && result.ipfsHash) {
            toast.success(`${file.name} uploaded to IPFS successfully! Hash: ${result.ipfsHash.substring(0, 8)}...`);
          } else {
            toast.success(`${file.name} uploaded successfully!`);
          }
          
          // Update file stats
          onFileStatsUpdate({
            count: 1, // Increment by 1
            totalSize: file.size
          });
        } else {
          throw new Error(result.error || 'Upload failed');
        }

        // Remove from progress tracking after a delay
        setTimeout(() => {
          setUploadProgress(prev => {
            const newProgress = { ...prev };
            delete newProgress[fileId];
            return newProgress;
          });
        }, 2000);

      } catch (error) {
        console.error(`[UploadTab] Upload error for ${file.name}:`, error);
        toast.error(`Failed to upload ${file.name}: ${error.message}`);
        
        // Remove from progress tracking
        setUploadProgress(prev => {
          const newProgress = { ...prev };
          delete newProgress[fileId];
          return newProgress;
        });
      }
    }

    setIsLoading(false);
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">File Upload</h2>
        <div className="form-control">
          <label className="label cursor-pointer">
            <span className="label-text mr-2">Upload to IPFS</span>
            <input
              type="checkbox"
              className="toggle toggle-primary"
              checked={uploadToIpfs}
              onChange={(e) => setUploadToIpfs(e.target.checked)}
            />
          </label>
        </div>
      </div>

      {/* Upload Area */}
      <div
        className={`
          border-2 border-dashed rounded-lg p-8 text-center transition-colors
          ${dragActive 
            ? "border-primary bg-primary/10" 
            : "border-base-300 hover:border-primary hover:bg-base-200"
          }
        `}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <div className="space-y-4">
          <div className="text-6xl mb-4">
            {dragActive ? "📂" : "📁"}
          </div>
          
          <div>
            <h3 className="text-xl font-semibold mb-2">
              {dragActive ? "Drop files here" : "Drop files to upload"}
            </h3>
            <p className="text-base-content/70 mb-4">
              or click to select files
            </p>
          </div>

          <input
            type="file"
            multiple
            onChange={handleChange}
            className="file-input file-input-bordered file-input-primary w-full max-w-xs"
            disabled={isLoading}
          />

          <div className="text-sm text-base-content/60 mt-4">
            <p>Supported formats: All file types</p>
            <p>Maximum file size: 100MB per file</p>
          </div>
        </div>
      </div>

      {/* Upload Progress */}
      {Object.keys(uploadProgress).length > 0 && (
        <div className="card bg-base-100 shadow-lg">
          <div className="card-body">
            <h3 className="card-title">Upload Progress</h3>
            <div className="space-y-3">
              {Object.entries(uploadProgress).map(([fileId, progress]) => (
                <div key={fileId} className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Uploading file...</span>
                    <span>{progress}%</span>
                  </div>
                  <progress 
                    className="progress progress-primary w-full" 
                    value={progress} 
                    max="100"
                  ></progress>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Upload Options */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Server Upload Settings */}
        <div className="card bg-base-100 shadow-lg">
          <div className="card-body">
            <h3 className="card-title flex items-center gap-2">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
              </svg>
              Server Storage
            </h3>
            <p className="text-base-content/70 mb-4">
              Files uploaded to the relay server storage
            </p>
            <div className="stats shadow">
              <div className="stat">
                <div className="stat-title">Available Space</div>
                <div className="stat-value text-lg">2.4 GB</div>
                <div className="stat-desc">of 5 GB total</div>
              </div>
            </div>
          </div>
        </div>

        {/* IPFS Upload Settings */}
        <div className="card bg-base-100 shadow-lg">
          <div className="card-body">
            <h3 className="card-title flex items-center gap-2">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
              </svg>
              IPFS Storage
            </h3>
            <p className="text-base-content/70 mb-4">
              Distributed storage on IPFS network
            </p>
            <div className="form-control">
              <label className="label">
                <span className="label-text">Auto-pin files</span>
                <input type="checkbox" className="checkbox" defaultChecked />
              </label>
              <label className="label">
                <span className="label-text">Public gateway access</span>
                <input type="checkbox" className="checkbox" defaultChecked />
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Uploads */}
      <div className="card bg-base-100 shadow-lg">
        <div className="card-body">
          <h3 className="card-title">Recent Uploads</h3>
          <div className="overflow-x-auto">
            <table className="table table-zebra w-full">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Size</th>
                  <th>Status</th>
                  <th>IPFS Hash</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">📄</span>
                      <div>
                        <div className="font-medium">sample-document.pdf</div>
                        <div className="text-sm text-base-content/70">2 minutes ago</div>
                      </div>
                    </div>
                  </td>
                  <td>{formatFileSize(1024000)}</td>
                  <td>
                    <span className="badge badge-success">Uploaded</span>
                  </td>
                  <td>
                    <div className="font-mono text-xs">QmHash123...</div>
                  </td>
                  <td>
                    <button className="btn btn-ghost btn-sm">View</button>
                  </td>
                </tr>
                <tr>
                  <td>
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">🖼️</span>
                      <div>
                        <div className="font-medium">photo.jpg</div>
                        <div className="text-sm text-base-content/70">5 minutes ago</div>
                      </div>
                    </div>
                  </td>
                  <td>{formatFileSize(512000)}</td>
                  <td>
                    <span className="badge badge-success">Uploaded</span>
                  </td>
                  <td>
                    <div className="font-mono text-xs">QmHash456...</div>
                  </td>
                  <td>
                    <button className="btn btn-ghost btn-sm">View</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UploadTab; 