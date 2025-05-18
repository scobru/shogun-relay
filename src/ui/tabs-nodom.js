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
    _setFiles
} from './app-nodom.js';
import { FileSearchForm, FileItem, EmptyState, LoadingState } from './components-nodom.js';

/**
 * Files Tab Content Component
 */
export function FilesTabContent() {
    const tabContent = h('div', { id: 'files-tab', class: 'tab-content' });
    
    setEffect(() => {
        const isActive = getActiveTab() === 'files';
        tabContent.className = isActive ? 'tab-content active' : 'tab-content';
        
        if (isActive) {
            tabContent.innerHTML = '';
            
            // Card header with IPFS status indicator
            const ipfsStatus = getIpfsStatus();
            const ipfsStatusIndicator = h('span', { 
                class: 'badge', 
                style: ipfsStatus.enabled 
                    ? 'background-color: #4CAF50; margin-left: 10px; font-size: 0.8em; padding: 2px 6px;' 
                    : 'background-color: #ff3366; margin-left: 10px; font-size: 0.8em; padding: 2px 6px;'
            }, ipfsStatus.enabled ? 'IPFS: Active' : 'IPFS: Disabled');
            
            const cardHeader = h('div', { class: 'card-header' },
                h('div', { style: 'display: flex; align-items: center;' },
                    h('h3', { class: 'card-title' }, 'File Management'),
                    ipfsStatusIndicator
                ),
                h('div', { class: 'card-actions' },
                    h('button', { 
                        id: 'refresh-files',
                        onclick: () => {
                            loadFiles();
                            showToast('Refreshing files...', 'info');
                        }
                    }, 'Refresh')
                )
            );
            
            // Search form
            const searchForm = FileSearchForm();
            
            // IPFS filter and tab controls
            const filterContainer = h('div', { 
                class: 'filter-controls', 
                style: 'margin-top: 10px; margin-bottom: 10px; display: flex; align-items: center; gap: 15px;'
            });
            
            // IPFS filter toggle
            const ipfsFilterContainer = h('div', { 
                class: 'ipfs-filter',
                style: 'display: flex; align-items: center;'
            });
            const ipfsFilterCheckbox = h('input', { 
                type: 'checkbox', 
                id: 'ipfs-filter',
                style: 'margin-right: 5px;'
            });
            const ipfsFilterLabel = h('label', { 
                for: 'ipfs-filter',
                style: 'font-weight: bold; color: #6e3fff;'
            }, 'Show only IPFS files');
            
            ipfsFilterContainer.appendChild(ipfsFilterCheckbox);
            ipfsFilterContainer.appendChild(ipfsFilterLabel);
            
            // Add debug button for IPFS metadata
            const debugIpfsButton = h('button', {
                style: 'background-color: #6e3fff; margin-left: auto;',
                onclick: async () => {
                    try {
                        const response = await fetch('/api/ipfs/metadata', {
                            headers: {
                                'Authorization': `Bearer ${getAuthToken()}`
                            }
                        });
                        
                        if (response.ok) {
                            const data = await response.json();
                            console.log('IPFS Metadata:', data);
                            showToast(`IPFS Metadata: ${data.count} entries found`, 'info');
                        } else {
                            showToast('Failed to fetch IPFS metadata', 'error');
                        }
                    } catch (error) {
                        console.error('Error fetching IPFS metadata:', error);
                        showToast(`Error: ${error.message}`, 'error');
                    }
                }
            }, 'Debug IPFS Metadata');
            
            filterContainer.appendChild(ipfsFilterContainer);
            filterContainer.appendChild(debugIpfsButton);
            
            // Create file list container
            const fileListContainer = h('div', { class: 'file-list', id: 'file-list' });
            
            // Add these elements to tab content
            tabContent.appendChild(cardHeader);
            tabContent.appendChild(searchForm);
            tabContent.appendChild(filterContainer);
            tabContent.appendChild(fileListContainer);
            
            // Initialize file list
            updateFileList(fileListContainer);
            
            // Add IPFS filter functionality
            ipfsFilterCheckbox.addEventListener('change', () => {
                updateFileList(fileListContainer);
            });
            
            // Set up effect to update file list when files change
            setEffect(() => {
                updateFileList(fileListContainer);
            });
        }
    });
    
    // Function to update file list
    function updateFileList(container) {
        if (!container) return;
        
        const files = getFiles();
        const isLoading = getIsLoading();
        const ipfsFilterEnabled = document.getElementById('ipfs-filter')?.checked || false;
        
        // Show loading state or empty state
        if (isLoading) {
            container.innerHTML = '<div class="loading">Loading files...</div>';
            return;
        }
        
        if (!files || !Array.isArray(files) || files.length === 0) {
            container.innerHTML = '<div class="empty-state">No files found</div>';
            return;
        }
        
        // Filter for IPFS files if the filter is enabled
        const filteredFiles = ipfsFilterEnabled
            ? files.filter(file => file && file.ipfsHash)
            : files;
            
        if (filteredFiles.length === 0) {
            container.innerHTML = '<div class="empty-state">No ' + (ipfsFilterEnabled ? 'IPFS ' : '') + 'files found</div>';
            return;
        }
        
        // Clear container
        container.innerHTML = '';
        
        // Display summary
        const ipfsCount = files.filter(file => file && file.ipfsHash).length;
        const summary = h('div', { 
            class: 'file-summary',
            style: 'margin-bottom: 15px; padding: 8px; background-color: #f5f5f5; border-radius: 4px;'
        },
            h('span', {}, `Showing ${filteredFiles.length} of ${files.length} files`),
            h('span', { 
                style: 'margin-left: 10px; color: #6e3fff; font-weight: bold;'
            }, `(${ipfsCount} stored on IPFS)`)
        );
        container.appendChild(summary);
        
        // Add each file
        try {
            // Sort files by timestamp (newest first)
            const sortedFiles = [...filteredFiles].sort((a, b) => {
                const timeA = parseInt(a.timestamp || a.uploadedAt || 0, 10);
                const timeB = parseInt(b.timestamp || b.uploadedAt || 0, 10);
                return timeB - timeA; // Newest first
            });
            
            sortedFiles.forEach(file => {
                if (!file || typeof file !== 'object') return;
                
                const fileEl = FileItem(file);
                container.appendChild(fileEl);
            });
        } catch (error) {
            console.error('Error displaying files:', error);
            container.innerHTML = `<div class="error">Error displaying files: ${error.message}</div>`;
        }
    }
    
    return tabContent;
}

/**
 * Upload Tab Content Component
 */
export function UploadTabContent() {
    const tabContent = h('div', { id: 'upload-tab', class: 'tab-content' });
    
    // Form state - use bypass to prevent GunDB storage
    const [getUploadStatus, setUploadStatus] = setSignal('', { key: 'upload-status', bypass: true });
    const [getUploadResult, setUploadResult] = setSignal(null, { key: 'upload-result', bypass: true });
    
    // Track if we've already checked IPFS on this tab activation
    let ipfsCheckedOnActivation = false;
    
    // Effect to update the tab content based on active state
    setEffect(() => {
        const isActive = getActiveTab() === 'upload';
        tabContent.className = isActive ? 'tab-content active' : 'tab-content';
        
        if (isActive) {
            tabContent.innerHTML = '';
            
            // IPFS status badge
            const ipfsStatus = getIpfsStatus();
            const ipfsStatusBadge = h('span', { 
                id: 'ipfs-status-badge',
                class: 'badge',
                style: ipfsStatus.enabled 
                    ? 'background-color: #4CAF50;' 
                    : 'background-color: #ff3366;'
            }, ipfsStatus.enabled ? 'IPFS: Active' : 'IPFS: Disabled');
            
            // Card header
            const cardHeader = h('div', { class: 'card-header' },
                h('h3', { class: 'card-title' }, 'Upload File'),
                h('div', { class: 'card-actions' }, ipfsStatusBadge)
            );
            
            // Upload form
            const uploadForm = createUploadForm();
            
            // Result container
            const resultContainer = h('div', { 
                id: 'upload-result',
                style: 'margin-top: 20px'
            });
            
            // Add all elements to tab content
            tabContent.appendChild(cardHeader);
            tabContent.appendChild(uploadForm);
            tabContent.appendChild(resultContainer);
            
            // Try to get the upload result from both signal and localStorage
            let uploadResult = getUploadResult();
            
            // If signal doesn't have valid data, try localStorage
            if (!uploadResult || !uploadResult.originalName) {
                try {
                    const storedResult = localStorage.getItem('lastUploadResult');
                    if (storedResult) {
                        uploadResult = JSON.parse(storedResult);
                        // Update the signal with the parsed data
                        setUploadResult(uploadResult);
                    }
                } catch (error) {
                    console.error('Error parsing stored upload result:', error);
                }
            }
            
            // Now display the result if we have valid data
            if (uploadResult && typeof uploadResult === 'object' && uploadResult.originalName) {
                console.log('Found valid upload result to display:', uploadResult.originalName);
                resultContainer.innerHTML = '';
                resultContainer.appendChild(createResultCard(uploadResult));
            }
            
            // Check IPFS status on tab activation, but only once
            if (ipfsStatus.enabled && !ipfsCheckedOnActivation) {
                // Set the flag to prevent multiple checks
                ipfsCheckedOnActivation = true;
                
                // Use a timeout to avoid too many simultaneous checks
                setTimeout(() => {
                    checkIpfsConnection().then(status => {
                        setIpfsConnectionStatus(status);
                    }).catch(error => {
                        console.error("Error checking IPFS status on tab activation:", error);
                        setIpfsConnectionStatus({
                            status: 'error',
                            message: 'Check failed'
                        });
                    });
                }, 1000);
            }
        }
    });
    
    // Create upload form
    function createUploadForm() {
        // Create form container
        const form = h('form', { id: 'upload-form' });
        
        // File input
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.id = 'file-input';
        
        // Custom name input
        const customNameInput = document.createElement('input');
        customNameInput.type = 'text';
        customNameInput.id = 'custom-name';
        customNameInput.placeholder = 'Custom name (optional)';
        
        // Upload button
        const uploadButton = h('button', { 
            type: 'submit',
            id: 'upload-button'
        }, 'Upload File');
        
        // Status display
        const uploadStatus = h('div', { 
            id: 'upload-status',
            class: 'status',
            innerHTML: getUploadStatus()
        });
        
        // IPFS connection status display (only show when IPFS is enabled)
        const ipfsStatus = getIpfsStatus();
        let connectionStatus = null;
        
        if (ipfsStatus.enabled) {
            const connStatus = getIpfsConnectionStatus();
            
            connectionStatus = h('div', { 
                class: 'connection-status',
                id: 'ipfs-connection-status'
            },
                h('span', { class: 'status-label' }, 'Connection status:'),
                h('span', { 
                    id: 'ipfs-status-indicator',
                    class: `status-${connStatus.status || 'unknown'}`
                }, connStatus.message || 'Unknown'),
                h('button', {
                    id: 'ipfs-check-connection',
                    class: 'btn-small',
                    onclick: async (e) => {
                        e.preventDefault();
                        const statusIndicator = document.getElementById('ipfs-status-indicator');
                        if (statusIndicator) {
                            statusIndicator.className = 'status-checking';
                            statusIndicator.textContent = 'Verifica in corso...';
                        }
                        const status = await checkIpfsConnection();
                        setIpfsConnectionStatus(status);
                    }
                }, 'Check')
            );
        }
        
        // Append all elements to form
        form.appendChild(fileInput);
        form.appendChild(customNameInput);
        form.appendChild(uploadButton);
        form.appendChild(uploadStatus);
        if (connectionStatus) form.appendChild(connectionStatus);
        
        // Handle form submission
        form.addEventListener('submit', handleUpload);
        
        return form;
    }
    
    // Handle file upload
    async function handleUpload(e) {
        e.preventDefault();
        
        const fileInput = document.getElementById('file-input');
        const customName = document.getElementById('custom-name').value;
        
        if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
            showToast('Please select a file to upload', 'warning');
            setUploadStatus('<div class="error">Please select a file to upload</div>');
            return;
        }
        
        const file = fileInput.files[0];
        
        // Check IPFS status first
        let ipfsStatus = null;
        try {
            const ipfsResponse = await fetch("/api/ipfs/status", {
                headers: { Authorization: `Bearer ${getAuthToken()}` }
            });
            
            if (ipfsResponse.ok) {
                ipfsStatus = await ipfsResponse.json();
                console.log("IPFS Status before upload:", ipfsStatus.config);
            }
        } catch (error) {
            console.error("Error checking IPFS status:", error);
        }
        
        // Show loading
        setIsLoading(true);
        setUploadStatus('<div class="info">Uploading file...</div>');
        
        try {
            const formData = new FormData();
            formData.append('file', file);
            if (customName) {
                formData.append('customName', customName);
            }
            
            const response = await fetch("/upload", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${getAuthToken()}`
                },
                body: formData
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.success) {
                // Check if the file was uploaded to IPFS
                if (data.file && data.file.ipfsHash) {
                    console.log(`File uploaded to IPFS successfully: ${data.file.ipfsHash}`);
                    setUploadStatus('<div class="success">File uploaded to IPFS successfully</div>');
                    showToast('File uploaded to IPFS successfully', 'success');
                } else {
                    setUploadStatus('<div class="success">File uploaded successfully</div>');
                    showToast('File uploaded successfully', 'success');
                }
                
                // Ensure the file data is complete
                const completeFileData = {
                    id: data.file.id || `file-${Date.now()}`,
                    originalName: data.file.originalName || file.name,
                    name: data.file.name || data.file.originalName || file.name,
                    mimeType: data.file.mimeType || data.file.mimetype || file.type,
                    size: data.file.size || file.size,
                    fileUrl: data.file.fileUrl || data.file.url || '#',
                    ipfsHash: data.file.ipfsHash || null,
                    ipfsUrl: data.file.ipfsUrl || (data.file.ipfsHash ? `${ipfsStatus?.config?.gateway || 'https://ipfs.io/ipfs'}/${data.file.ipfsHash}` : null),
                    timestamp: data.file.timestamp || Date.now()
                };
                
                // Log detailed file info for debugging
                console.log('Upload result complete file data:', completeFileData);
                
                // Store the completed file data both in signal and localStorage for redundancy
                setUploadResult(completeFileData);
                localStorage.setItem('lastUploadResult', JSON.stringify(completeFileData));
                
                // Clear file form after successful upload
                e.target.reset();
                
                // Only update the result container once with the complete data
                const resultContainer = document.getElementById('upload-result');
                if (resultContainer) {
                    resultContainer.innerHTML = '';
                    resultContainer.appendChild(createResultCard(completeFileData));
                }
                
                // Wait a moment to ensure the file is processed
                await new Promise(resolve => setTimeout(resolve, 1500));
                
                // Reload files list with cache busting
                try {
                    // First clear the existing files to avoid showing stale data
                    localStorage.setItem('files-data', JSON.stringify([]));
                    _setFiles([]);
                    
                    // Load files with cache busting
                    loadFiles();
                } catch (refreshError) {
                    console.error("Error refreshing files after upload:", refreshError);
                }
            } else {
                throw new Error(data.error || "Unknown error");
            }
        } catch (error) {
            setUploadStatus(`<div class="error">Upload error: ${error.message}</div>`);
            showToast(`Upload error: ${error.message}`, 'error');
            console.error("Error uploading file:", error);
        } finally {
            setIsLoading(false);
        }
    }
    
    // Create result card
    function createResultCard(file) {
        // Additional safety check
        if (!file || typeof file !== 'object' || !file.originalName) {
            console.error('Invalid or empty file data provided to result card:', file);
            return h('div', { class: 'card error' }, 'Invalid file data');
        }
        
        try {
            // Debug log for IPFS data
            console.log("Creating result card for file:", {
                name: file.originalName,
                size: file.size,
                mimeType: file.mimeType || file.mimetype,
                hasIPFS: !!file.ipfsHash,
                ipfsHash: file.ipfsHash,
                ipfsUrl: file.ipfsUrl,
                fileUrl: file.fileUrl
            });
            
            const card = h('div', { class: 'card' });
            
            // Card header with file icon based on mimetype
            const cardHeader = h('div', { class: 'card-header' },
                h('h3', { class: 'card-title' }, 'File Uploaded')
            );
            
            // File info 
            const fileInfo = h('div', { class: 'file-info' });
            
            // File name
            const fileName = h('div', { class: 'file-name' }, file.originalName);
            
            // File metadata
            const fileMeta = h('div', { class: 'file-meta' },
                `${formatFileSize(file.size)} • ${file.mimeType || file.mimetype} `,
                file.ipfsHash 
                    ? h('span', { class: 'ipfs-badge' }, 'IPFS')
                    : h('span', { class: 'local-badge' }, 'Local')
            );
            
            // File URL
            const fileUrl = h('div', { class: 'file-url' },
                h('strong', {}, 'URL: '),
                h('a', { 
                    href: file.fileUrl,
                    target: '_blank'
                }, file.fileUrl)
            );
            
            fileInfo.appendChild(fileName);
            fileInfo.appendChild(fileMeta);
            fileInfo.appendChild(fileUrl);
            
            // IPFS information if available
            if (file.ipfsHash) {
                const ipfsGateway = getIpfsStatus().gateway || 'https://ipfs.io/ipfs';
                const ipfsUrl = file.ipfsUrl || `${ipfsGateway}/${file.ipfsHash}`;
                
                const ipfsInfo = h('div', { class: 'ipfs-info' },
                    h('small', {}, `IPFS Hash: ${file.ipfsHash}`),
                    h('br'),
                    h('small', {}, 
                        'IPFS URL: ',
                        h('a', { 
                            href: ipfsUrl,
                            target: '_blank'
                        }, ipfsUrl)
                    )
                );
                fileInfo.appendChild(ipfsInfo);
                
                // Add copy hash button
                const copyButton = h('button', {
                    class: 'copy-hash',
                    onclick: async () => {
                        try {
                            await navigator.clipboard.writeText(file.ipfsHash);
                            showToast('IPFS hash copied to clipboard', 'success');
                        } catch (error) {
                            showToast(`Error copying hash: ${error.message}`, 'error');
                        }
                    }
                }, 'Copy Hash');
                fileInfo.appendChild(copyButton);
            }
            
            // Add elements to card
            card.appendChild(cardHeader);
            card.appendChild(fileInfo);
            
            return card;
        } catch (error) {
            console.error('Error creating result card:', error);
            return h('div', { class: 'card error' }, 'Error creating result card');
        }
    }
    
    return tabContent;
}

/**
 * Settings Tab Content Component
 */
export function SettingsTabContent() {
    const tabContent = h('div', { id: 'settings-tab', class: 'tab-content' });
    
    // Settings state
    const [getIpfsSwitch, setIpfsSwitch] = setSignal(false, { key: 'ipfs-switch-state' });
    const [getIpfsService, setIpfsService] = setSignal('IPFS-CLIENT', { key: 'ipfs-service' });
    const [getIpfsNodeUrl, setIpfsNodeUrl] = setSignal('http://localhost:5001', { key: 'ipfs-node-url' });
    const [getIpfsGateway, setIpfsGateway] = setSignal('https://ipfs.io/ipfs', { key: 'ipfs-gateway' });
    const [getPinataJwt, setPinataJwt] = setSignal('', { key: 'pinata-jwt' });
    
    // Track if we've already checked IPFS on this tab activation
    let ipfsCheckedOnActivation = false;
    
    // Using global connection status now
    
    // Update settings from global state
    setEffect(() => {
        const ipfsStatus = getIpfsStatus();
        setIpfsSwitch(ipfsStatus.enabled);
        setIpfsService(ipfsStatus.service || 'IPFS-CLIENT');
        setIpfsNodeUrl(ipfsStatus.nodeUrl || 'http://localhost:5001');
        setIpfsGateway(ipfsStatus.gateway || 'https://ipfs.io/ipfs');
    });
    
    // Effect to update the tab content based on active state
    setEffect(() => {
        const isActive = getActiveTab() === 'settings';
        tabContent.className = isActive ? 'tab-content active' : 'tab-content';
        
        if (isActive) {
            tabContent.innerHTML = '';
            
            // Card header
            const cardHeader = h('div', { class: 'card-header' },
                h('h3', { class: 'card-title' }, 'Settings')
            );
            
            // IPFS Settings Group
            const ipfsSettingsGroup = h('div', { class: 'settings-group' },
                h('h4', {}, 'IPFS'),
                // IPFS Toggle
                h('div', { class: 'setting-item' },
                    h('label', { for: 'ipfs-switch' }, 'Enable IPFS storage'),
                    h('div', { class: 'switch-container' },
                        h('label', { class: 'switch' },
                            h('input', { 
                                type: 'checkbox', 
                                id: 'ipfs-switch',
                                checked: getIpfsSwitch(),
                                onchange: handleIpfsToggle
                            }),
                            h('span', { class: 'slider round' })
                        ),
                        h('span', { id: 'ipfs-status' }, 
                            () => getIpfsSwitch() ? 'Active' : 'Disabled'
                        )
                    )
                ),
                
                // IPFS Connection Status
                h('div', { id: 'ipfs-connection-status', class: 'connection-status' },
                    h('span', { class: 'status-label' }, 'Connection status:'),
                    h('span', { 
                        id: 'ipfs-status-indicator', 
                        class: () => `status-${getIpfsConnectionStatus().status}`
                    }, () => getIpfsConnectionStatus().message),
                    h('button', { 
                        id: 'ipfs-check-connection', 
                        class: 'btn-small',
                        onclick: async () => {
                            const status = await checkIpfsConnection();
                            setIpfsConnectionStatus(status);
                        }
                    }, 'Check'),
                    h('button', { 
                        id: 'ipfs-reconnect', 
                        class: 'btn-small btn-warning',
                        style: () => getIpfsConnectionStatus().status === 'error' ? '' : 'display:none;',
                        onclick: reconnectIpfs
                    }, 'Reconnect')
                ),
                
                // IPFS Service dropdown
                h('div', { class: 'form-group' },
                    h('label', { for: 'ipfs-service' }, 'IPFS Service'),
                    h('select', { 
                        id: 'ipfs-service', 
                        class: 'form-control',
                        value: getIpfsService(),
                        onchange: (e) => {
                            setIpfsService(e.target.value);
                            // Toggle conditional config forms
                            document.getElementById('ipfs-client-config').style.display = 
                                e.target.value === 'IPFS-CLIENT' ? 'block' : 'none';
                            document.getElementById('pinata-config').style.display = 
                                e.target.value === 'PINATA' ? 'block' : 'none';
                        }
                    },
                        h('option', { value: 'IPFS-CLIENT' }, 'IPFS Client (Local)'),
                        h('option', { value: 'PINATA' }, 'Pinata Cloud')
                    )
                )
            );
            
            // IPFS Client Config Form
            const ipfsClientConfig = h('div', { 
                id: 'ipfs-client-config', 
                class: 'conditional-config',
                style: () => getIpfsService() === 'IPFS-CLIENT' ? '' : 'display: none;'
            },
                h('div', { class: 'form-group' },
                    h('label', { for: 'ipfs-node-url' }, 'IPFS Node URL'),
                    h('input', { 
                        type: 'text', 
                        id: 'ipfs-node-url', 
                        class: 'form-control',
                        placeholder: 'http://localhost:5001',
                        value: getIpfsNodeUrl(),
                        oninput: (e) => setIpfsNodeUrl(e.target.value)
                    })
                )
            );
            
            // Pinata Config Form
            const pinataConfig = h('div', { 
                id: 'pinata-config', 
                class: 'conditional-config',
                style: () => getIpfsService() === 'PINATA' ? '' : 'display: none;'
            },
                h('div', { class: 'form-group' },
                    h('label', { for: 'pinata-jwt' }, 'Pinata JWT'),
                    h('input', { 
                        type: 'text', 
                        id: 'pinata-jwt', 
                        class: 'form-control',
                        placeholder: 'JWT Token',
                        value: getPinataJwt(),
                        oninput: (e) => setPinataJwt(e.target.value)
                    })
                )
            );
            
            // Gateway Config
            const gatewayConfig = h('div', { class: 'form-group' },
                h('label', { for: 'ipfs-gateway' }, 'IPFS Gateway'),
                h('input', { 
                    type: 'text', 
                    id: 'ipfs-gateway', 
                    class: 'form-control',
                    placeholder: 'https://ipfs.io/ipfs',
                    value: getIpfsGateway(),
                    oninput: (e) => setIpfsGateway(e.target.value)
                })
            );
            
            // Save button
            const saveButton = h('button', { 
                id: 'save-ipfs-config', 
                class: 'btn primary',
                onclick: saveIpfsConfig
            }, 'Save Configuration');
            
            // Config status message
            const configStatus = h('div', { id: 'ipfs-config-status', class: 'status' });
            
            // Authentication section
            const authSection = h('div', {},
                h('h4', { style: 'margin-top: 20px' }, 'Authentication'),
                h('div', { class: 'setting-item' },
                    h('label', { for: 'auth-token' }, 'Authentication Token'),
                    h('div', { style: 'display: flex; gap: 10px' },
                        h('input', {
                            type: 'password',
                            id: 'auth-token',
                            class: 'form-control',
                            placeholder: 'Enter authentication token'
                        }),
                        h('button', {
                            id: 'save-token',
                            class: 'btn primary',
                            onclick: () => {
                                const token = document.getElementById('auth-token').value;
                                if (token) {
                                    localStorage.setItem('authToken', token);
                                    showToast('Authentication token saved', 'success');
                                    
                                    // Show status message
                                    document.getElementById('auth-status').innerHTML = 
                                        '<div class="success">Token saved successfully</div>';
                                    
                                    // Clear input
                                    document.getElementById('auth-token').value = '';
                                } else {
                                    showToast('Please enter a token', 'warning');
                                }
                            }
                        }, 'Save')
                    ),
                    h('div', { id: 'auth-status', class: 'status' })
                )
            );
            
            // Add config forms to IPFS settings group
            ipfsSettingsGroup.appendChild(ipfsClientConfig);
            ipfsSettingsGroup.appendChild(pinataConfig);
            ipfsSettingsGroup.appendChild(gatewayConfig);
            ipfsSettingsGroup.appendChild(saveButton);
            ipfsSettingsGroup.appendChild(configStatus);
            ipfsSettingsGroup.appendChild(authSection);
            
            // Add all elements to the tab content
            tabContent.appendChild(cardHeader);
            tabContent.appendChild(ipfsSettingsGroup);
            
            // Check IPFS status on tab activation, but only once
            if (getIpfsSwitch() && !ipfsCheckedOnActivation) {
                // Set the flag to prevent multiple checks
                ipfsCheckedOnActivation = true;
                
                // Use a timeout to avoid too many simultaneous checks
                setTimeout(() => {
                    checkIpfsConnection().catch(err => {
                        console.error("Error checking IPFS connection on tab activation:", err);
                    });
                }, 1000);
            }
        }
    });
    
    // Handle IPFS toggle
    async function handleIpfsToggle() {
        try {
            // Get current state
            const currentState = getIpfsSwitch();
            const newState = !currentState;
            
            // Show a loading indicator in the UI
            showToast(`${newState ? 'Enabling' : 'Disabling'} IPFS...`, 'info');
            
            // Optimistically update the UI
            setIpfsSwitch(newState);
            
            const response = await fetch('/api/ipfs/toggle', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${getAuthToken()}`
                }
            });
            
            if (!response.ok) {
                throw new Error(`Server error: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.success) {
                // Update UI with new state
                await updateIpfsStatus();
                
                // If enabling, check connection
                if (newState) {
                    showToast('IPFS enabled. Checking connection...', 'info');
                    
                    // Give the server a moment to initialize
                    setTimeout(() => {
                        checkIpfsConnection();
                    }, 500);
                } else {
                    showToast('IPFS disabled successfully', 'success');
                }
            } else {
                // Reset switch to previous state
                setIpfsSwitch(currentState);
                
                const errorMsg = data.error || 'Unknown error';
                showToast(`Failed to ${newState ? 'enable' : 'disable'} IPFS: ${errorMsg}`, 'error');
                console.error(`IPFS toggle error:`, data);
            }
        } catch (error) {
            // Reset switch to previous state
            setIpfsSwitch(!getIpfsSwitch());
            
            showToast(`IPFS toggle error: ${error.message}`, 'error');
            console.error('IPFS toggle error:', error);
        }
    }
    
    // Reconnect IPFS
    async function reconnectIpfs() {
        try {
            // Show reconnecting status
            setIpfsConnectionStatus({
                status: 'checking',
                message: 'Reconnecting...'
            });
            
            // Make API call to reinitialize connection
            const response = await fetch('/api/ipfs/reinitialize', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${getAuthToken()}`
                }
            });
            
            const data = await response.json();
            
            // Update status based on API response
            if (data.success) {
                setIpfsConnectionStatus({
                    status: 'connected',
                    message: 'Connected'
                });
                showToast('IPFS connection restored successfully', 'success');
                
                // Refresh configuration UI
                updateIpfsStatus();
            } else {
                setIpfsConnectionStatus({
                    status: 'error',
                    message: 'Reconnection error'
                });
                showToast(`Unable to restore connection: ${data.message}`, 'error');
            }
        } catch (error) {
            setIpfsConnectionStatus({
                status: 'error',
                message: 'Network error'
            });
            showToast(`Network error: ${error.message}`, 'error');
        }
    }
    
    // Save IPFS configuration
    async function saveIpfsConfig() {
        const configStatus = document.getElementById('ipfs-config-status');
        configStatus.innerHTML = '<div class="info">Saving configuration...</div>';
        
        try {
            // Get the current IPFS status first
            const currentStatus = getIpfsStatus();
            
            // Prepare the new configuration
            const config = {
                service: getIpfsService(),
                nodeUrl: getIpfsNodeUrl(),
                gateway: getIpfsGateway(),
                // Preserve current enabled status to avoid toggling it
                enabled: currentStatus.enabled
            };
            
            // Add Pinata JWT conditionally
            if (getIpfsService() === 'PINATA') {
                const pinataJwt = getPinataJwt();
                if (pinataJwt && pinataJwt.length > 0) {
                    config.pinataJwt = pinataJwt;
                } else if (!currentStatus.pinataJwt) {
                    configStatus.innerHTML = '<div class="error">Pinata JWT is required for Pinata service</div>';
                    showToast('Pinata JWT is required for Pinata service', 'error');
                    return;
                }
            }
            
            console.log('Sending IPFS config update:', JSON.stringify(config, null, 2));
            
            // First save the configuration
            const response = await fetch('/api/ipfs/config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${getAuthToken()}`
                },
                body: JSON.stringify(config)
            });
            
            const data = await response.json();
            
            if (data.success) {
                configStatus.innerHTML = '<div class="success">Configuration saved successfully</div>';
                
                // Update IPFS status with the new configuration
                await updateIpfsStatus();
                
                // Check connection if IPFS is enabled
                if (currentStatus.enabled) {
                    // Show connection checking message
                    configStatus.innerHTML = '<div class="info">Testing IPFS connection...</div>';
                    
                    // Test connection
                    const healthResponse = await fetch('/api/ipfs/health-check', {
                        headers: {
                            Authorization: `Bearer ${getAuthToken()}`
                        }
                    });
                    
                    const healthData = await healthResponse.json();
                    
                    if (healthData.success) {
                        configStatus.innerHTML = '<div class="success">Configuration saved and connection verified</div>';
                    } else {
                        configStatus.innerHTML = '<div class="warning">Configuration saved but connection test failed</div>';
                        showToast('IPFS configuration saved but connection test failed. Check your settings.', 'warning');
                    }
                } else {
                    showToast('IPFS configuration updated successfully', 'success');
                }
            } else {
                configStatus.innerHTML = `<div class="error">Error: ${data.error}</div>`;
                showToast(`Error: ${data.error}`, 'error');
            }
        } catch (error) {
            configStatus.innerHTML = `<div class="error">Error: ${error.message}</div>`;
            showToast(`Error: ${error.message}`, 'error');
        }
    }
    
    return tabContent;
}

