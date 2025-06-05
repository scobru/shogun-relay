import { h, setSignal, setEffect } from './nodom.js';
import {
    getActiveTab,
    getFiles,
    getIpfsStatus,
    setIpfsStatus,
    loadFiles,
    showToast,
    updateIpfsStatus,
    getAuthToken,
    formatFileSize,
    getIsLoading,
    setIsLoading,
    checkIpfsConnection,
    getIpfsConnectionStatus,
    setIpfsConnectionStatus,
    setFiles,
    deleteFile,
    deleteIpfsFile,
    forceRefreshFileList,
    pinFileToIpfs,
    unpinFileFromIpfs,
    checkIpfsPinStatus,
    // Import toast management functions
    getToasts,
    setToasts,
    // Import peer functions
    getPeers,
    loadPeersFromConfig,
    setActiveTab,
    uploadToIpfsDirect,
    loadAllFiles
} from './app-nodom.js';
import { FileSearchForm, FileItem, EmptyState, LoadingState } from './components-nodom.js';

// Global variables for files tab state management
let selectedFiles = new Set();
let isSelectAllChecked = false;

// Debouncing per evitare richieste multiple
let networkUpdateTimeout = null;
let networkTabActive = false;

// Add flag to prevent multiple refreshes
let isRefreshingAfterUpload = false;

// Track recent uploads to prevent immediate duplicates
let recentUploads = new Map(); // filename -> timestamp
const uploadCooldownTime = 3000; // 3 seconds cooldown for same file

// Add global flag to prevent double uploads
let isUploadInProgress = false;
let uploadClickTimeout = null;

// Client-side content tracking to prevent immediate duplicates
let clientContentHashes = new Map(); // contentHash -> file info
const contentHashTimeout = 60000; // 1 minute timeout for content hashes

// Debug function to check upload status
window.debugUploadStatus = function() {
    console.log('=== UPLOAD DEBUG STATUS ===');
    console.log('isUploadInProgress:', isUploadInProgress);
    console.log('isRefreshingAfterUpload:', isRefreshingAfterUpload);
    console.log('uploadClickTimeout:', uploadClickTimeout);
    console.log('recentUploads size:', recentUploads.size);
    console.log('recentUploads entries:', Array.from(recentUploads.entries()));
    console.log('clientContentHashes size:', clientContentHashes.size);
    console.log('clientContentHashes entries:', Array.from(clientContentHashes.entries()));
    console.log('getIsLoading():', getIsLoading());
    
    const uploadBtn = document.getElementById('upload-submit');
    if (uploadBtn) {
        console.log('Upload button disabled:', uploadBtn.disabled);
        console.log('Upload button text:', uploadBtn.textContent);
    }
    console.log('=========================');
    
    return {
        isUploadInProgress,
        isRefreshingAfterUpload,
        uploadClickTimeout,
        recentUploadsCount: recentUploads.size,
        clientContentHashesCount: clientContentHashes.size,
        isSystemLoading: getIsLoading()
    };
};

// Reset function for emergency cases
window.resetUploadState = function() {
    console.log('🚨 EMERGENCY: Resetting upload state');
    isUploadInProgress = false;
    isRefreshingAfterUpload = false;
    uploadClickTimeout = null;
    recentUploads.clear();
    clientContentHashes.clear();
    setIsLoading(false);
    
    const uploadBtn = document.getElementById('upload-submit');
    if (uploadBtn) {
        uploadBtn.disabled = false;
        uploadBtn.textContent = '🚀 Upload File';
        uploadBtn.classList.remove('loading');
    }
    
    console.log('✅ Upload state reset completed');
};

/**
 * Files Tab Content Component
 */
export function FilesTabContent() {
    // Add storage filter state
    let storageFilter = 'all'; // 'all', 'local-only', 'local-with-ipfs', 'ipfs-independent'
    
    const tabContent = h('div', { 
        id: 'files-tab', 
        class: 'tab-content',
        style: 'display: none;' 
    });
    
    setEffect(() => {
        const isActive = getActiveTab() === 'files';
        tabContent.style.display = isActive ? 'block' : 'none';
        
        if (isActive) {
            // Load combined files when tab becomes active
            console.log('[FilesTab] Tab activated, loading all files...');
            loadAllFiles();
        }
    });
    
    // Global refresh function
    window.refreshFilesDisplay = () => {
        console.log('[FilesTab] Refreshing files display...');
        const filesContainer = document.getElementById('files-display-container');
        if (filesContainer) {
            filesContainer.innerHTML = '';
            filesContainer.appendChild(FilesDisplay());
        }
    };
    
    // Create enhanced file search form with storage filter
    const createEnhancedFileSearch = () => {
        return h('div', { class: 'mb-6' },
            // Storage type filter
            h('div', { class: 'flex flex-wrap gap-2 mb-4' },
                h('div', { class: 'flex items-center gap-2' },
                    h('span', { class: 'text-sm font-medium' }, '📂 Filter by Storage:'),
                    h('div', { class: 'join', id: 'storage-filter-buttons' },
                        h('button', { 
                            class: `btn btn-sm join-item ${storageFilter === 'all' ? 'btn-active' : 'btn-outline'}`,
                            'data-filter': 'all',
                            onclick: () => {
                                storageFilter = 'all';
                                updateFilterButtons();
                                window.refreshFilesDisplay();
                            }
                        }, 'All Files'),
                        h('button', { 
                            class: `btn btn-sm join-item ${storageFilter === 'local-only' ? 'btn-active' : 'btn-outline'}`,
                            'data-filter': 'local-only',
                            onclick: () => {
                                storageFilter = 'local-only';
                                updateFilterButtons();
                                window.refreshFilesDisplay();
                            }
                        }, '💾 Local Only'),
                        h('button', { 
                            class: `btn btn-sm join-item ${storageFilter === 'local-with-ipfs' ? 'btn-active' : 'btn-outline'}`,
                            'data-filter': 'local-with-ipfs',
                            onclick: () => {
                                storageFilter = 'local-with-ipfs';
                                updateFilterButtons();
                                window.refreshFilesDisplay();
                            }
                        }, '🌐💾 Local+IPFS'),
                        h('button', { 
                            class: `btn btn-sm join-item ${storageFilter === 'ipfs-independent' ? 'btn-active' : 'btn-outline'}`,
                            'data-filter': 'ipfs-independent',
                            onclick: () => {
                                storageFilter = 'ipfs-independent';
                                updateFilterButtons();
                                window.refreshFilesDisplay();
                            }
                        }, '🌐⚡ Direct IPFS')
                    )
                )
            ),
            
            // Original search form
            FileSearchForm()
        );
    };
    
    // Function to get display name for filter
    const getFilterDisplayName = (filter) => {
        switch (filter) {
            case 'all': return 'All Files';
            case 'local-only': return 'Local Only';
            case 'local-with-ipfs': return 'Local + IPFS';
            case 'ipfs-independent': return 'Direct IPFS';
            default: return 'Unknown Filter';
        }
    };
    
    // Update filter button states
    const updateFilterButtons = () => {
        const filterContainer = document.getElementById('storage-filter-buttons');
        if (filterContainer) {
            const buttons = filterContainer.querySelectorAll('button[data-filter]');
            buttons.forEach(button => {
                const filter = button.getAttribute('data-filter');
                if (filter === storageFilter) {
                    button.classList.remove('btn-outline');
                    button.classList.add('btn-active');
                } else {
                    button.classList.remove('btn-active');
                    button.classList.add('btn-outline');
                }
            });
        }
    };
    
    // Function to create batch controls
    const createBatchControls = (files) => {
        return h('div', { class: 'bg-base-200 p-4 rounded-lg mb-4 border border-base-300' },
            h('div', { class: 'flex justify-between items-center' },
                h('div', { class: 'flex items-center gap-4' },
                    h('label', { class: 'label cursor-pointer flex items-center gap-2' },
                        h('input', {
                            type: 'checkbox',
                            id: 'select-all-checkbox',
                            class: 'checkbox checkbox-primary',
                            checked: isSelectAllChecked,
                            onchange: handleSelectAll
                        }),
                        h('span', { class: 'label-text font-medium' }, 'Select All')
                    ),
                    h('span', { class: 'text-sm text-base-content/70' }, 
                        `${selectedFiles.size} of ${files.length} files selected`
                    )
                ),
                h('div', { class: 'flex gap-2' },
                    h('button', {
                        id: 'batch-delete-btn',
                        class: `btn btn-error btn-sm ${selectedFiles.size === 0 ? 'btn-disabled' : ''}`,
                        disabled: selectedFiles.size === 0,
                        onclick: handleBatchDelete
                    }, `🗑️ Delete Selected (${selectedFiles.size})`)
                )
            )
        );
    };

    // Function to handle file selection
    const handleFileSelection = (fileId, isSelected) => {
        if (isSelected) {
            selectedFiles.add(fileId);
        } else {
            selectedFiles.delete(fileId);
        }
        
        // Update select all checkbox state
        const allFiles = getFiles();
        const filteredFiles = storageFilter === 'all' 
            ? allFiles 
            : allFiles.filter(file => file.storageType === storageFilter);
        
        // Check if all filtered files are now selected
        const allFilteredSelected = filteredFiles.length > 0 && filteredFiles.every(file => selectedFiles.has(file.id));
        isSelectAllChecked = allFilteredSelected;
        
        console.log(`[FileSelection] File ${fileId} ${isSelected ? 'selected' : 'deselected'}. Total selected: ${selectedFiles.size}/${filteredFiles.length}. All selected: ${allFilteredSelected}`);
        
        // Update UI using the new function
        updateBatchControlsUI(filteredFiles);
    };

    // Function to handle select all
    const handleSelectAll = (e) => {
        const isChecked = e.target.checked;
        const allFiles = getFiles();
        const filteredFiles = storageFilter === 'all' 
            ? allFiles 
            : allFiles.filter(file => file.storageType === storageFilter);
        
        console.log(`[SelectAll] Checkbox clicked: ${isChecked}, filteredFiles: ${filteredFiles.length}`);
        
        if (isChecked) {
            // Select all filtered files
            console.log(`[SelectAll] Selecting all ${filteredFiles.length} files`);
            filteredFiles.forEach(file => selectedFiles.add(file.id));
        } else {
            // Deselect all filtered files
            console.log(`[SelectAll] Deselecting all ${filteredFiles.length} files`);
            filteredFiles.forEach(file => selectedFiles.delete(file.id));
        }
        
        isSelectAllChecked = isChecked;
        
        // Update all file checkboxes immediately
        filteredFiles.forEach(file => {
            const checkbox = document.getElementById(`file-checkbox-${file.id}`);
            if (checkbox) {
                checkbox.checked = isChecked;
            }
        });
        
        // Update batch controls immediately without full refresh
        updateBatchControlsUI(filteredFiles);
        
        console.log(`[SelectAll] Result: ${selectedFiles.size} files selected, isSelectAllChecked: ${isSelectAllChecked}`);
    };

    // Function to update batch controls UI without full refresh
    const updateBatchControlsUI = (filteredFiles = null) => {
        if (!filteredFiles) {
            const allFiles = getFiles();
            filteredFiles = storageFilter === 'all' 
                ? allFiles 
                : allFiles.filter(file => file.storageType === storageFilter);
        }
        
        // Update Select All checkbox
        const selectAllCheckbox = document.getElementById('select-all-checkbox');
        if (selectAllCheckbox) {
            selectAllCheckbox.checked = isSelectAllChecked;
        }
        
        // Update batch delete button
        const batchDeleteBtn = document.getElementById('batch-delete-btn');
        if (batchDeleteBtn) {
            batchDeleteBtn.disabled = selectedFiles.size === 0;
            batchDeleteBtn.className = `btn btn-error btn-sm ${selectedFiles.size === 0 ? 'btn-disabled' : ''}`;
            batchDeleteBtn.textContent = `🗑️ Delete Selected (${selectedFiles.size})`;
        }
        
        // Update selection count
        const fileListContainer = document.getElementById('file-list-container');
        if (fileListContainer) {
            const selectionSpan = fileListContainer.querySelector('.text-base-content\\/70');
            if (selectionSpan) {
                selectionSpan.textContent = `${selectedFiles.size} of ${filteredFiles.length} files selected`;
            }
        }
    };

    // Function to handle batch delete
    const handleBatchDelete = async () => {
        if (selectedFiles.size === 0) return;
        
        const filesToDelete = Array.from(selectedFiles);
        const allFiles = getFiles();
        const fileNames = filesToDelete.map(id => {
            const file = allFiles.find(f => f.id === id);
            return file ? file.originalName || file.name : id;
        }).join(', ');
        
        if (!confirm(`Delete ${filesToDelete.length} selected files?\n\nFiles: ${fileNames}\n\nThis action cannot be undone.`)) {
            return;
        }
        
        setIsLoading(true);
        let successCount = 0;
        let errorCount = 0;
        
        showToast(`🗑️ Deleting ${filesToDelete.length} files...`, 'info');
        
        for (const fileId of filesToDelete) {
            try {
                const file = allFiles.find(f => f.id === fileId);
                if (file) {
                    let result;
                    if (file.storageType === 'ipfs-independent') {
                        result = await deleteIpfsFile(file.ipfsHash, file.originalName);
                    } else {
                        result = await deleteFile(file.id, file.originalName);
                    }
                    
                    if (result) {
                        successCount++;
                        selectedFiles.delete(fileId);
                    } else {
                        errorCount++;
                    }
                } else {
                    errorCount++;
                }
            } catch (error) {
                console.error(`Error deleting file ${fileId}:`, error);
                errorCount++;
            }
        }
        
        setIsLoading(false);
        
        // Show result
        if (errorCount === 0) {
            showToast(`✅ Successfully deleted ${successCount} files`, 'success');
        } else if (successCount > 0) {
            showToast(`⚠️ Deleted ${successCount}/${filesToDelete.length} files. ${errorCount} failed.`, 'warning');
        } else {
            showToast(`❌ Failed to delete any files`, 'error');
        }
        
        // Clear selections and refresh
        selectedFiles.clear();
        isSelectAllChecked = false;
        
        // Refresh file lists
        setTimeout(() => {
            loadAllFiles();
        }, 1000);
    };
    
    const FilesDisplay = () => {
        const files = getFiles();
        
        if (getIsLoading()) {
            return LoadingState();
        }
        
        if (!files || files.length === 0) {
            return EmptyState("No files uploaded yet. Go to the Upload tab to add some files!");
        }
        
        // Apply current filter
        const filteredFiles = storageFilter === 'all' 
            ? files 
            : files.filter(file => {
                const matches = file.storageType === storageFilter;
                return matches;
            });
        
        // Debug logging for filtering
        console.log(`[FilesDisplay] Filter debug:`);
        console.log(`- Current filter: "${storageFilter}"`);
        console.log(`- Total files: ${files.length}`);
        
        // Group files by storage type for summary
        const typeBreakdown = files.reduce((acc, f) => {
            const type = f.storageType || 'unknown';
            acc[type] = (acc[type] || 0) + 1;
            return acc;
        }, {});
        
        console.log(`- Storage type breakdown:`, typeBreakdown);
        console.log(`- Files matching filter "${storageFilter}": ${filteredFiles.length}`);
        
        if (filteredFiles.length === 0) {
            return h('div', { class: 'text-center py-8' },
                h('div', { class: 'alert alert-info max-w-md mx-auto' },
                    h('div', { class: 'flex flex-col items-center gap-2' },
                        h('span', { class: 'text-lg' }, '🔍'),
                        h('span', { class: 'font-medium' }, `No files found for filter: ${getFilterDisplayName(storageFilter)}`),
                        h('span', { class: 'text-sm opacity-75' }, `Total files available: ${files.length}`)
                    )
                )
            );
        }
        
        // Create container for filtered files
        const container = h('div', { class: 'space-y-4' });
        
        // Add files count info with storage breakdown
        const fileStats = h('div', { class: 'stats stats-horizontal shadow-sm mb-4' },
            h('div', { class: 'stat' },
                h('div', { class: 'stat-title' }, 'Total Files'),
                h('div', { class: 'stat-value text-primary' }, files.length),
                h('div', { class: 'stat-desc' }, 'All storage types')
            ),
            h('div', { class: 'stat' },
                h('div', { class: 'stat-title' }, 'Showing'),
                h('div', { class: 'stat-value text-secondary' }, filteredFiles.length),
                h('div', { class: 'stat-desc' }, getFilterDisplayName(storageFilter))
            ),
            h('div', { class: 'stat' },
                h('div', { class: 'stat-title' }, 'Storage Types'),
                h('div', { class: 'stat-desc text-xs' }, 
                    Object.entries(typeBreakdown).map(([type, count]) => 
                        h('div', {}, `${type}: ${count}`)
                    )
                )
            )
        );
        container.appendChild(fileStats);
        
        // Add file items with batch selection
        const fileList = h('div', { id: 'file-list-container', class: 'space-y-4' });
        
        // Add batch controls
        const batchControls = createBatchControls(filteredFiles);
        fileList.appendChild(batchControls);
        
        // Add filtered files with checkboxes
        filteredFiles.forEach(file => {
            const fileElement = FileItem(file, {
                showCheckbox: true,
                checked: selectedFiles.has(file.id),
                onSelectionChange: handleFileSelection
            });
            fileList.appendChild(fileElement);
        });
        
        container.appendChild(fileList);
        return container;
    };
    
    // Listen for files updated events
    document.addEventListener('filesUpdated', (event) => {
        if (getActiveTab() === 'files') {
            console.log('[FilesTab] Files updated event received, refreshing display');
            setTimeout(() => {
                window.refreshFilesDisplay();
            }, 100);
        }
    });
    
    // Build tab content
    setTimeout(() => {
        tabContent.innerHTML = '';
        
        // Tab header with title and refresh button
        const tabHeader = h('div', { class: 'flex justify-between items-center mb-6' },
            h('div', { class: 'flex items-center gap-4' },
                h('h2', { class: 'text-2xl font-bold' }, '📁 File Manager'),
                h('div', { class: 'badge badge-info' }, 'View & Manage Files')
            ),
            h('div', { class: 'flex gap-2' },
                h('button', { 
                    class: 'btn btn-outline btn-sm',
                    onclick: () => {
                        console.log('[FilesTab] Manual refresh triggered');
                        // Clear selections
                        selectedFiles.clear();
                        isSelectAllChecked = false;
                        // Force reload
                        loadAllFiles();
                    }
                }, '🔄 Refresh'),
                h('button', { 
                    class: 'btn btn-primary btn-sm',
                    onclick: () => {
                        setActiveTab('upload');
                    }
                }, '📤 Upload Files')
            )
        );
        
        tabContent.appendChild(tabHeader);
        tabContent.appendChild(createEnhancedFileSearch());
        
        // Files display container - ONLY FILES, NO UPLOAD SECTION
        const filesContainer = h('div', { id: 'files-display-container' });
        tabContent.appendChild(filesContainer);
        
        // Initial load
        console.log('[FilesTab] Initial load starting...');
        loadAllFiles().then(() => {
            console.log('[FilesTab] Initial load completed, refreshing display');
            window.refreshFilesDisplay();
        });
        
        // Listen for state changes with effect
        setEffect(() => {
            if (getActiveTab() === 'files') {
                window.refreshFilesDisplay();
            }
        });
    }, 0);
    
    return tabContent;
}

/**
 * Upload Tab Content Component
 */
export function UploadTabContent() {
    // State for storage type selection
    let useDirectIpfs = false;
    
    const handleFileUpload = async (files) => {
        if (!files || files.length === 0) {
            showToast("❌ No files selected", "error");
            return;
        }

        console.log(`[UploadTab] Starting upload of ${files.length} files`);
        setIsLoading(true);

        let successCount = 0;
        let errorCount = 0;
        const uploadResults = [];

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const uploadId = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            try {
                console.log(`[UploadTab] Uploading file ${i + 1}/${files.length}: ${file.name} (${file.size} bytes)`);
                showToast(`📤 Uploading ${file.name}...`, "info", 3000);

                let result;
                
                if (useDirectIpfs) {
                    // Upload directly to IPFS
                    console.log(`[UploadTab] Using direct IPFS upload for ${file.name}`);
                    result = await uploadToIpfsDirect(file, file.name);
                    
                    if (result && result.success) {
                        successCount++;
                        uploadResults.push({
                            fileName: file.name,
                            success: true,
                            ipfsHash: result.ipfsHash,
                            ipfsUrl: result.ipfsUrl,
                            storageType: 'ipfs-independent'
                        });
                        console.log(`[UploadTab] File uploaded successfully to IPFS: ${result.ipfsHash} - ${file.name}`);
                    } else {
                        throw new Error(result?.error || "IPFS upload failed");
                    }
                } else {
                    // Upload to FileManager (local storage)
                    console.log(`[UploadTab] Using FileManager upload for ${file.name}`);
                    const formData = new FormData();
                    formData.append('file', file);
                    formData.append('uploadId', uploadId);
                    formData.append('customName', file.name);

                    const response = await fetch('/upload', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${getAuthToken()}`
                        },
                        body: formData
                    });

                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }

                    result = await response.json();
                    console.log(`[UploadTab] Upload result for ${file.name}:`, result);

                    if (result.success) {
                        successCount++;
                        uploadResults.push({
                            fileName: file.name,
                            success: true,
                            fileId: result.file?.id,
                            fileUrl: result.file?.fileUrl,
                            isDuplicate: result.file?.isDuplicate,
                            processingTime: result.file?.processingTime,
                            storageType: 'local-only'
                        });
                        
                        const duplicateMsg = result.file?.isDuplicate ? " (duplicate detected)" : "";
                        showToast(`✅ ${file.name} uploaded successfully${duplicateMsg}`, "success", 4000);
                        
                        console.log(`[UploadTab] File uploaded successfully: ${result.file?.id} - ${file.name}`);
                    } else {
                        throw new Error(result.error || "Upload failed");
                    }
                }

            } catch (error) {
                console.error(`[UploadTab] Upload error for ${file.name}:`, error);
                errorCount++;
                uploadResults.push({
                    fileName: file.name,
                    success: false,
                    error: error.message
                });
                showToast(`❌ Failed to upload ${file.name}: ${error.message}`, "error", 6000);
            }
        }

        setIsLoading(false);

        // Show final summary
        if (errorCount === 0) {
            showToast(`🎉 All ${successCount} files uploaded successfully!`, "success", 5000);
        } else if (successCount > 0) {
            showToast(`⚠️ ${successCount} files uploaded, ${errorCount} failed`, "warning", 6000);
        } else {
            showToast(`❌ All uploads failed`, "error", 6000);
        }

        console.log(`[UploadTab] Upload batch completed: ${successCount} success, ${errorCount} errors`);
        console.log(`[UploadTab] Upload results:`, uploadResults);

        // Force immediate refresh of file list if any uploads were successful
        if (successCount > 0) {
            console.log(`[UploadTab] Triggering immediate file list refresh...`);
            
            // Clear any existing file cache
            localStorage.removeItem("files-data");
            
            // Force reload files with longer delay to ensure server has processed everything
            setTimeout(async () => {
                try {
                    console.log(`[UploadTab] Executing loadAllFiles refresh...`);
                    const updatedFiles = await loadAllFiles();
                    console.log(`[UploadTab] Refresh completed, got ${updatedFiles.length} files`);
                    
                    // Force UI refresh if we're on the files tab
                    const activeTab = getActiveTab();
                    if (activeTab === 'files' && typeof window.refreshFilesDisplay === 'function') {
                        console.log(`[UploadTab] Triggering UI refresh since we're on files tab`);
                        window.refreshFilesDisplay();
                    }
                    
                    // Also dispatch a custom event to ensure all components are notified
                    const refreshEvent = new CustomEvent('filesUpdated', { 
                        detail: { 
                            files: updatedFiles, 
                            source: 'post-upload-refresh',
                            uploadResults: uploadResults,
                            timestamp: Date.now()
                        } 
                    });
                    document.dispatchEvent(refreshEvent);
                    
                    showToast(`🔄 File list refreshed (${updatedFiles.length} files)`, "info", 3000);
                } catch (refreshError) {
                    console.error(`[UploadTab] Error during refresh:`, refreshError);
                    showToast(`⚠️ Upload completed but refresh failed. Please manually refresh.`, "warning", 5000);
                }
            }, 2000); // Wait 2 seconds for server processing
            
            // Also trigger an immediate partial refresh for responsiveness
            setTimeout(() => {
                const currentFiles = getFiles();
                console.log(`[UploadTab] Quick check: ${currentFiles.length} files currently in state`);
                
                // If files tab is active, force a display refresh anyway
                if (getActiveTab() === 'files' && typeof window.refreshFilesDisplay === 'function') {
                    window.refreshFilesDisplay();
                }
            }, 500);
        }

        // Clear the file input
        const fileInput = document.getElementById('file-input');
        if (fileInput) {
            fileInput.value = '';
        }

        // Reset drag and drop area
        const dropArea = document.querySelector('.drop-area');
        if (dropArea) {
            dropArea.classList.remove('drag-over');
        }
    };
    
    return h('div', { class: 'space-y-6' }, 
        // Upload header with title and storage type selector
        h('div', { class: 'bg-base-100 p-6 rounded-lg shadow-sm border border-base-300' },
            h('div', { class: 'flex justify-between items-start mb-4' },
                h('h2', { class: 'text-xl font-semibold' }, '📤 Upload Files'),
                h('div', { class: 'form-control' },
                    h('label', { class: 'label cursor-pointer gap-3' },
                        h('span', { class: 'label-text font-medium' }, 
                            h('span', { class: 'flex items-center gap-2' },
                                h('span', {}, useDirectIpfs ? '🌐⚡' : '💾🌐'),
                                h('span', {}, useDirectIpfs ? 'Direct IPFS Upload' : 'FileManager Upload')
                            )
                        ),
                        h('input', { 
                            type: 'checkbox',
                            class: 'toggle toggle-accent',
                            checked: useDirectIpfs,
                            onchange: (e) => {
                                useDirectIpfs = e.target.checked;
                                // Update the label text
                                const labelSpan = e.target.parentElement.querySelector('.label-text span span:last-child');
                                const iconSpan = e.target.parentElement.querySelector('.label-text span span:first-child');
                                if (labelSpan && iconSpan) {
                                    labelSpan.textContent = useDirectIpfs ? 'Direct IPFS Upload' : 'FileManager Upload';
                                    iconSpan.textContent = useDirectIpfs ? '🌐⚡' : '💾🌐';
                                }
                            }
                        })
                    )
                )
            ),
            
            // Storage type explanation
            h('div', { class: 'alert alert-info mb-4' },
                h('div', { class: 'flex items-start gap-2' },
                    h('span', {}, 'ℹ️'),
                    h('div', {},
                        h('h4', { class: 'font-semibold mb-1' }, 
                            useDirectIpfs ? 'Direct IPFS Upload' : 'FileManager Upload'
                        ),
                        h('p', { class: 'text-sm' },
                            useDirectIpfs 
                                ? 'Files will be uploaded directly to the IPFS network as independent files. Perfect for public content and decentralized sharing.'
                                : 'Files will be stored in the local FileManager and can optionally be backed up to IPFS later. Recommended for managed content.'
                        )
                    )
                )
            ),
            
            // Drag and drop area
            h('div', { 
                class: 'border-2 border-dashed border-base-300 rounded-lg p-8 text-center hover:border-primary transition-colors cursor-pointer',
                id: 'upload-drop-zone',
                ondragover: (e) => {
                    e.preventDefault();
                    e.currentTarget.classList.add('border-primary', 'bg-base-200');
                },
                ondragleave: (e) => {
                    e.preventDefault();
                    e.currentTarget.classList.remove('border-primary', 'bg-base-200');
                },
                ondrop: (e) => {
                    e.preventDefault();
                    e.currentTarget.classList.remove('border-primary', 'bg-base-200');
                    const files = Array.from(e.dataTransfer.files);
                    if (files.length > 0) {
                        handleFileUpload(files);
                    }
                },
                onclick: () => {
                    document.getElementById('file-input').click();
                }
            },
                h('div', { class: 'space-y-4' },
                    h('div', { class: 'text-4xl' }, '📁'),
                    h('h3', { class: 'text-lg font-medium' }, 'Drop files here or click to select'),
                    h('p', { class: 'text-sm opacity-70' }, 
                        `Upload to: ${useDirectIpfs ? 'IPFS Network (Direct)' : 'FileManager (Local)'}`
                    ),
                    h('input', { 
                        type: 'file',
                        id: 'file-input',
                        multiple: true,
                        style: 'display: none;',
                        onchange: (e) => {
                            const files = Array.from(e.target.files);
                            if (files.length > 0) {
                                handleFileUpload(files);
                            }
                        }
                    }),
                    h('button', { 
                        class: 'btn btn-primary btn-outline',
                        onclick: (e) => {
                            e.stopPropagation();
                            document.getElementById('file-input').click();
                        }
                    }, '📂 Select Files')
                )
            )
        )
    );
}

/**
 * Settings Tab Content Component
 */
export function SettingsTabContent() {
    const tabContent = h('div', { 
        class: 'space-y-6 p-4',
        id: 'settings-tab'
    });

    // State for configuration display only (read-only)
    let currentConfig = {};

    // Function to load configuration from server (READ-ONLY)
    async function loadConfiguration() {
        try {
            const response = await fetch('/api/config', {
                headers: {
                    'Authorization': `Bearer ${getAuthToken()}`
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                currentConfig = data.config;
                
                // Re-render the configuration display
                renderConfigurationDisplay();
                
                showToast('✅ Configuration loaded from file', 'success');
            } else {
                showToast('❌ Failed to load configuration', 'error');
            }
        } catch (error) {
            console.error('Error loading configuration:', error);
            showToast(`❌ Error loading configuration: ${error.message}`, 'error');
        }
    }

    // Function to reload configuration from file 
    async function reloadConfigurationFromFile() {
        try {
            const response = await fetch('/api/config/reload', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${getAuthToken()}`
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                showToast(`✅ ${data.message}`, 'success');
                
                // After reloading from file, refresh the display
                await loadConfiguration();
            } else {
                const error = await response.json();
                showToast(`❌ Failed to reload configuration: ${error.error}`, 'error');
            }
        } catch (error) {
            console.error('Error reloading configuration:', error);
            showToast(`❌ Error reloading configuration: ${error.message}`, 'error');
        }
    }

    // Function to render the configuration display (READ-ONLY)
    function renderConfigurationDisplay() {
        tabContent.innerHTML = '';
        
        // Card header
        const cardHeader = h('div', { class: 'flex justify-between items-center mb-6' },
            h('h3', { class: 'text-2xl font-bold text-base-content flex items-center gap-2' }, 
                '📋 Server Configuration (Read-Only)'
            ),
            h('div', { class: 'flex gap-2' },
                h('button', {
                    class: 'btn btn-outline btn-sm',
                    onclick: reloadConfigurationFromFile,
                    title: 'Reload configuration from config.json file'
                }, '🔄 Reload From File'),
                h('button', {
                    class: 'btn btn-outline btn-sm',
                    onclick: loadConfiguration,
                    title: 'Refresh display from server'
                }, '↻ Refresh Display')
            )
        );

        // Info message
        const infoMessage = h('div', { class: 'alert alert-info mb-6' },
            h('svg', { class: 'stroke-current shrink-0 h-6 w-6', fill: 'none', viewBox: '0 0 24 24' },
                h('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' })
            ),
            h('div', {},
                h('h4', { class: 'font-bold' }, 'Configuration Management'),
                h('div', { class: 'text-sm' }, 'This dashboard shows the current configuration loaded from config.json. To modify settings, edit the config.json file and click "Reload From File".')
            )
        );

        // Core Server Settings
        const coreSettingsCard = h('div', { class: 'card bg-base-200 shadow-lg mb-6' },
            h('div', { class: 'card-body' },
                h('h4', { class: 'card-title text-lg mb-4' }, '🖥️ Core Server Settings'),
                h('div', { class: 'grid grid-cols-1 md:grid-cols-2 gap-4' },
                    // Environment
                    h('div', { class: 'form-control' },
                        h('label', { class: 'label' }, h('span', { class: 'label-text font-medium' }, 'Environment')),
                        h('div', { class: 'input input-bordered flex items-center' }, currentConfig.NODE_ENV || 'development')
                    ),
                    // Port
                    h('div', { class: 'form-control' },
                        h('label', { class: 'label' }, h('span', { class: 'label-text font-medium' }, 'Port')),
                        h('div', { class: 'input input-bordered flex items-center' }, currentConfig.PORT || 8765)
                    ),
                    // HTTPS Port
                    h('div', { class: 'form-control' },
                        h('label', { class: 'label' }, h('span', { class: 'label-text font-medium' }, 'HTTPS Port')),
                        h('div', { class: 'input input-bordered flex items-center' }, currentConfig.HTTPS_PORT || 8443)
                    ),
                    // Allowed Origins
                    h('div', { class: 'form-control' },
                        h('label', { class: 'label' }, h('span', { class: 'label-text font-medium' }, 'Allowed Origins')),
                        h('div', { class: 'input input-bordered flex items-center' }, currentConfig.ALLOWED_ORIGINS || 'Not set')
                    )
                )
            )
        );

        // Security Settings
        const securitySettingsCard = h('div', { class: 'card bg-base-200 shadow-lg mb-6' },
            h('div', { class: 'card-body' },
                h('h4', { class: 'card-title text-lg mb-4' }, '🔒 Security Settings'),
                h('div', { class: 'grid grid-cols-1 md:grid-cols-2 gap-4' },
                    // Disable CORS
                    h('div', { class: 'form-control' },
                        h('label', { class: 'label' }, h('span', { class: 'label-text font-medium' }, 'CORS Disabled')),
                        h('div', { class: `badge ${currentConfig.DISABLE_CORS ? 'badge-warning' : 'badge-success'}` }, 
                            currentConfig.DISABLE_CORS ? 'Yes' : 'No'
                        )
                    ),
                    // Disable Gun Auth
                    h('div', { class: 'form-control' },
                        h('label', { class: 'label' }, h('span', { class: 'label-text font-medium' }, 'Gun Auth Disabled')),
                        h('div', { class: `badge ${currentConfig.DISABLE_GUN_AUTH ? 'badge-warning' : 'badge-success'}` }, 
                            currentConfig.DISABLE_GUN_AUTH ? 'Yes' : 'No'
                        )
                    ),
                    // Onchain Membership
                    h('div', { class: 'form-control' },
                        h('label', { class: 'label' }, h('span', { class: 'label-text font-medium' }, 'Onchain Membership')),
                        h('div', { class: `badge ${currentConfig.ONCHAIN_MEMBERSHIP_ENABLED ? 'badge-success' : 'badge-neutral'}` }, 
                            currentConfig.ONCHAIN_MEMBERSHIP_ENABLED ? 'Enabled' : 'Disabled'
                        )
                    ),
                    // Type Validation
                    h('div', { class: 'form-control' },
                        h('label', { class: 'label' }, h('span', { class: 'label-text font-medium' }, 'Type Validation')),
                        h('div', { class: `badge ${currentConfig.TYPE_VALIDATION_ENABLED ? 'badge-success' : 'badge-neutral'}` }, 
                            currentConfig.TYPE_VALIDATION_ENABLED ? 'Enabled' : 'Disabled'
                        )
                    ),
                    // Strict Validation
                    h('div', { class: 'form-control' },
                        h('label', { class: 'label' }, h('span', { class: 'label-text font-medium' }, 'Strict Validation')),
                        h('div', { class: `badge ${currentConfig.TYPE_VALIDATION_STRICT ? 'badge-warning' : 'badge-neutral'}` }, 
                            currentConfig.TYPE_VALIDATION_STRICT ? 'Strict' : 'Normal'
                        )
                    )
                )
            )
        );

        // IPFS Settings
        const ipfsSettingsCard = h('div', { class: 'card bg-base-200 shadow-lg mb-6' },
            h('div', { class: 'card-body' },
                h('h4', { class: 'card-title text-lg mb-4' }, '📁 IPFS Settings'),
                h('div', { class: 'grid grid-cols-1 md:grid-cols-2 gap-4' },
                    // IPFS Enabled
                    h('div', { class: 'form-control' },
                        h('label', { class: 'label' }, h('span', { class: 'label-text font-medium' }, 'IPFS Status')),
                        h('div', { class: `badge ${currentConfig.IPFS_ENABLED ? 'badge-success' : 'badge-neutral'}` }, 
                            currentConfig.IPFS_ENABLED ? 'Enabled' : 'Disabled'
                        )
                    ),
                    // IPFS Service
                    h('div', { class: 'form-control' },
                        h('label', { class: 'label' }, h('span', { class: 'label-text font-medium' }, 'IPFS Service')),
                        h('div', { class: 'input input-bordered flex items-center' }, currentConfig.IPFS_SERVICE || 'IPFS-CLIENT')
                    ),
                    // Node URL
                    h('div', { class: 'form-control' },
                        h('label', { class: 'label' }, h('span', { class: 'label-text font-medium' }, 'Node URL')),
                        h('div', { class: 'input input-bordered flex items-center text-sm' }, currentConfig.IPFS_NODE_URL || 'Not set')
                    ),
                    // Gateway
                    h('div', { class: 'form-control' },
                        h('label', { class: 'label' }, h('span', { class: 'label-text font-medium' }, 'Gateway')),
                        h('div', { class: 'input input-bordered flex items-center text-sm' }, currentConfig.IPFS_GATEWAY || 'Not set')
                    )
                )
            )
        );

        // S3 Settings
        const s3SettingsCard = h('div', { class: 'card bg-base-200 shadow-lg mb-6' },
            h('div', { class: 'card-body' },
                h('h4', { class: 'card-title text-lg mb-4' }, '☁️ S3 Storage Settings'),
                h('div', { class: 'grid grid-cols-1 md:grid-cols-2 gap-4' },
                    // S3 Bucket
                    h('div', { class: 'form-control' },
                        h('label', { class: 'label' }, h('span', { class: 'label-text font-medium' }, 'S3 Bucket')),
                        h('div', { class: 'input input-bordered flex items-center' }, currentConfig.S3_BUCKET || 'Not configured')
                    ),
                    // S3 Region
                    h('div', { class: 'form-control' },
                        h('label', { class: 'label' }, h('span', { class: 'label-text font-medium' }, 'S3 Region')),
                        h('div', { class: 'input input-bordered flex items-center' }, currentConfig.S3_REGION || 'us-east-1')
                    ),
                    // S3 Endpoint
                    h('div', { class: 'form-control' },
                        h('label', { class: 'label' }, h('span', { class: 'label-text font-medium' }, 'S3 Endpoint')),
                        h('div', { class: 'input input-bordered flex items-center text-sm' }, currentConfig.S3_ENDPOINT || 'Not set')
                    ),
                    // S3 Port
                    h('div', { class: 'form-control' },
                        h('label', { class: 'label' }, h('span', { class: 'label-text font-medium' }, 'S3 Port')),
                        h('div', { class: 'input input-bordered flex items-center' }, currentConfig.S3_PORT || 4569)
                    )
                )
            )
        );

        // Peers Configuration
        const peersCard = h('div', { class: 'card bg-base-200 shadow-lg mb-6' },
            h('div', { class: 'card-body' },
                h('h4', { class: 'card-title text-lg mb-4' }, '🌐 Configured Relay Peers'),
                h('div', { class: 'space-y-2' },
                    ...(currentConfig.PEERS && currentConfig.PEERS.length > 0 ? 
                        currentConfig.PEERS.map(peer => 
                            h('div', { class: 'card bg-base-300 shadow-sm' },
                                h('div', { class: 'card-body p-4' },
                                    h('div', { class: 'flex justify-between items-center' },
                                        h('div', {},
                                            h('p', { class: 'font-mono text-sm break-all' }, peer),
                                            h('div', { class: 'flex gap-2 mt-2' },
                                                h('div', { class: 'badge badge-info badge-sm' }, '⚙️ Configured'),
                                                h('div', { class: 'badge badge-neutral badge-sm' }, '🔗 Relay')
                                            )
                                        ),
                                        h('div', { class: 'text-2xl opacity-50' }, '📡')
                                    )
                                )
                            )
                        ) : 
                        [h('div', { class: 'alert alert-warning' }, 
                            h('div', { class: 'flex items-center gap-2' },
                                h('span', {}, '⚠️'),
                                h('span', {}, 'No relay peers configured. Add peers to the PEERS array in config.json to enable peer-to-peer connectivity.')
                            )
                        )]
                    )
                )
            )
        );

        // Raw Configuration (collapsible)
        const rawConfigCard = h('div', { class: 'card bg-base-200 shadow-lg' },
            h('div', { class: 'card-body' },
                h('div', { class: 'collapse collapse-arrow' },
                    h('input', { type: 'checkbox' }),
                    h('div', { class: 'collapse-title text-lg font-medium' }, '🔍 Raw Configuration (JSON)'),
                    h('div', { class: 'collapse-content' },
                        h('pre', { class: 'bg-base-300 p-4 rounded-lg text-sm overflow-auto max-h-96' },
                            JSON.stringify(currentConfig, null, 2)
                        )
                    )
                )
            )
        );

        // Add all components to tab content
        tabContent.appendChild(cardHeader);
        tabContent.appendChild(infoMessage);
        tabContent.appendChild(coreSettingsCard);
        tabContent.appendChild(securitySettingsCard);
        tabContent.appendChild(ipfsSettingsCard);
        tabContent.appendChild(s3SettingsCard);
        tabContent.appendChild(peersCard);
        tabContent.appendChild(rawConfigCard);
    }
    
    setEffect(() => {
        const isActive = getActiveTab() === 'settings';
        tabContent.style.display = isActive ? 'block' : 'none';
        
        if (isActive && Object.keys(currentConfig).length === 0) {
            // Load configuration when tab becomes active for the first time
            loadConfiguration();
            // Also load peers from server configuration
            loadPeersFromConfig();
        }
    });
    
    return tabContent;
}

/**
 * Calculate SHA-256 hash of file content for client-side duplicate detection
 * @param {File} file - The file to hash
 * @returns {Promise<string>} The hash string
 */
async function calculateFileHash(file) {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return hashHex.substring(0, 16); // Use first 16 characters like server
    } catch (error) {
        console.warn('[Upload] Failed to calculate file hash:', error);
        return null; // Fallback to server-side processing
    }
}

