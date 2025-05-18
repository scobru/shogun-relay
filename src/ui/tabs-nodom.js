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
                class: `ipfs-status-badge ${ipfsStatus.enabled ? 'ipfs-status-enabled' : 'ipfs-status-disabled'}`
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
                class: 'secondary',
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
    
    setEffect(() => {
        const isActive = getActiveTab() === 'upload';
        tabContent.className = isActive ? 'tab-content active' : 'tab-content';
        
        if (isActive) {
            tabContent.innerHTML = '';
            
            // Card header with IPFS status indicator
            const ipfsStatus = getIpfsStatus();
            const ipfsStatusIndicator = h('span', { 
                class: `ipfs-status-badge ${ipfsStatus.enabled ? 'ipfs-status-enabled' : 'ipfs-status-disabled'}`
            }, ipfsStatus.enabled ? 'IPFS: Enabled' : 'IPFS: Disabled');
            
            const cardHeader = h('div', { class: 'card-header' },
                h('div', { style: 'display: flex; align-items: center;' },
                    h('h3', { class: 'card-title' }, 'Upload File'),
                    ipfsStatusIndicator
                )
            );
            
            // Form container
            const uploadForm = createUploadForm();
            
            // Results container
            const resultsContainer = h('div', { 
                id: 'upload-results', 
                style: 'margin-top: 20px;'
            });
            
            // Add to tab content
            tabContent.appendChild(cardHeader);
            tabContent.appendChild(uploadForm);
            tabContent.appendChild(resultsContainer);
        }
    });
    
    /**
     * Create upload form
     */
    function createUploadForm() {
        const form = h('form', { 
            id: 'file-upload-form',
            style: 'margin-top: 20px;'
        });
        
        // File input container with styling
        const fileInputContainer = h('div', { 
            style: 'margin-bottom: 20px; border: 2px dashed var(--border-color); border-radius: 10px; padding: 30px; text-align: center;'
        });
        
        // File input
        const fileInput = h('input', { 
            type: 'file', 
            id: 'file-upload', 
            style: 'display: none;'
        });
        
        // File input label (styled as button)
        const fileInputLabel = h('label', { 
            for: 'file-upload', 
            class: 'upload-btn',
            style: 'display: inline-block; cursor: pointer; padding: 12px 30px; background: var(--primary-color); color: white; border-radius: 6px; font-weight: 600; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); transition: all 0.3s ease;'
        }, 'Choose File');
        
        // File status
        const fileStatus = h('div', { 
            id: 'file-upload-status', 
            style: 'margin-top: 10px; color: var(--text-secondary);'
        }, 'No file selected');
        
        // Add to file input container
        fileInputContainer.appendChild(fileInput);
        fileInputContainer.appendChild(fileInputLabel);
        fileInputContainer.appendChild(fileStatus);
        
        // File name input
        const fileNameLabel = h('label', { 
            for: 'file-name',
            style: 'display: block; margin-bottom: 8px; font-weight: 600; color: var(--text-color);'
        }, 'Custom file name (optional)');
        
        const fileNameInput = h('input', { 
            type: 'text', 
            id: 'file-name', 
            placeholder: 'Enter custom name for the file'
        });
        
        // Submit button with styling
        const submitBtn = h('button', { 
            type: 'submit',
            class: 'upload-btn',
            style: 'margin-top: 20px; width: 100%;'
        }, 'Upload File');
        
        // Add all elements to form
        form.appendChild(fileInputContainer);
        form.appendChild(fileNameLabel);
        form.appendChild(fileNameInput);
        form.appendChild(submitBtn);
        
        // Add event listeners
        fileInput.addEventListener('change', () => {
            const fileName = fileInput.files[0]?.name || 'No file selected';
            fileStatus.textContent = fileName;
        });
        
        form.addEventListener('submit', handleUpload);
        
        return form;
    }
    
    // Handle file upload
    async function handleUpload(e) {
        e.preventDefault();
        
        const fileInput = document.getElementById('file-upload');
        const customName = document.getElementById('file-name').value;
        
        if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
            showToast('Please select a file to upload', 'warning');
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
                    showToast('File uploaded to IPFS successfully', 'success');
                } else {
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
                localStorage.setItem('lastUploadResult', JSON.stringify(completeFileData));
                
                // Clear file form after successful upload
                e.target.reset();
                
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
            showToast(`Upload error: ${error.message}`, 'error');
            console.error("Error uploading file:", error);
        } finally {
            setIsLoading(false);
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

