import {
  init,
  setSignal,
  setEffect,
  setMemo,
  h,
  Fragment,
  auth,
  logout,
  getNamespace,
} from "./nodom.js";

// Global state signals
const [getIsAuthenticated, setIsAuthenticated] = setSignal(false, {
  key: "auth-status",
});
const [getIsLoading, setIsLoading] = setSignal(false, {
  key: "loading-status",
});
const [getActiveTab, setActiveTab] = setSignal("files", { key: "active-tab" });
const [_getToasts, _setToasts] = setSignal([], {
  key: "toast-notifications",
  bypass: true,
});
const [getServerStatus, setServerStatus] = setSignal(
  { status: "Unknown", port: "8765" },
  { key: "server-status" }
);
const [getFileStats, setFileStats] = setSignal(
  { count: 0, totalSize: 0 },
  { key: "file-stats" }
);
const [_getFiles, _setFiles] = setSignal([], {
  key: "files-data",
  bypass: true,
});
const [getIpfsStatus, setIpfsStatus] = setSignal(
  { enabled: false, service: "IPFS-CLIENT" },
  { key: "ipfs-status" }
);
const [getIpfsConnectionStatus, setIpfsConnectionStatus] = setSignal(
  { status: "unknown", message: "Unknown" },
  { key: "ipfs-connection-status" }
);

// Simplified peers state - only for configuration display
const [getPeers, setPeers] = setSignal([], {
  key: "network-peers",
  bypass: true,
});

// Tema signal
const [getTheme, setTheme] = setSignal(
  localStorage.getItem("app-theme") || "light",
  { key: "app-theme" }
);

// Track if event listeners are already set up
let eventListenersSetup = false;

// Throttling for file loading to prevent duplicates
let isLoadingFiles = false;
let loadFilesTimeout = null;
let lastLoadRequest = 0;
let lastLoadedFileCount = 0;

// Keep track of the last IPFS check time to prevent too many calls
let lastIpfsCheckTime = 0;
const ipfsCheckDebounceTime = 5000;
let ipfsCheckInProgress = false;

// Initialize debug module
if (typeof window !== "undefined" && !window.shogunDebug) {
  window.shogunDebug = {
    logs: [],
    errors: [],
    initialized: true,
  };

  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;

  console.log = function (...args) {
    window.shogunDebug.logs.push({
      type: "log",
      timestamp: new Date().toISOString(),
      message: args
        .map((arg) =>
          typeof arg === "object" ? JSON.stringify(arg) : String(arg)
        )
        .join(" "),
    });
    originalConsoleLog.apply(console, args);
  };

  console.error = function (...args) {
    window.shogunDebug.errors.push({
      type: "error",
      timestamp: new Date().toISOString(),
      message: args
        .map((arg) =>
          typeof arg === "object" ? JSON.stringify(arg) : String(arg)
        )
        .join(" "),
    });
    originalConsoleError.apply(console, args);
  };

  console.log("Debug module initialized");
}

/**
 * Initialize event listeners for file management
 */
function initializeFileEventListeners() {
  if (eventListenersSetup) {
    console.log('[Events] File event listeners already set up, skipping');
    return;
  }
  
  console.log('[Events] Setting up file event listeners');
  
  document.addEventListener('filesUpdated', (event) => {
    console.log('[Events] Files updated event received:', event.detail);
  });
  
  document.addEventListener('tabChanged', (event) => {
    console.log('[Events] Tab changed event received:', event.detail);
    if (event.detail.tab === 'files') {
      setTimeout(() => {
        const currentFiles = getFiles();
        if (currentFiles.length === 0) {
          console.log('[Events] Files tab activated with no files, loading...');
          loadFiles();
        }
      }, 100);
    }
  });
  
  window.addEventListener('storage', (event) => {
    if (event.key === 'files-data' && event.newValue) {
      try {
        const newFiles = JSON.parse(event.newValue);
        if (Array.isArray(newFiles)) {
          console.log('[Events] Files updated from another tab, syncing...');
          _setFiles(newFiles);
          updateFileStats(newFiles);
        }
      } catch (err) {
        console.error('[Events] Error syncing files from storage:', err);
      }
    }
  });
  
  eventListenersSetup = true;
  console.log('[Events] File event listeners setup complete');
}

/**
 * Load all files
 */
export async function loadFiles(searchParams = {}) {
  const now = Date.now();
  
  if (isLoadingFiles || getIsLoading()) {
    console.log("[LoadFiles] Already loading, skipping duplicate call");
    return;
  }
  
  if (now - lastLoadRequest < 1000) {
    console.log("[LoadFiles] Request too soon after last one, throttling");
    return;
  }
  
  lastLoadRequest = now;
  
  if (loadFilesTimeout) {
    clearTimeout(loadFilesTimeout);
    loadFilesTimeout = null;
  }
  
  isLoadingFiles = true;
  setIsLoading(true);
  
  console.log(`[LoadFiles] Starting file load at ${new Date().toISOString()}`);

  try {
    if (!(await checkAuth())) {
      setIsLoading(false);
      isLoadingFiles = false;
      return;
    }

    const currentFiles = getFiles();
    const currentFileIds = currentFiles.map(f => f.id).sort();

    let url = "/files/all";
    if (Object.keys(searchParams).length > 0) {
      const queryParams = new URLSearchParams();
      for (const key in searchParams) {
        if (searchParams[key]) {
          queryParams.append(key, searchParams[key]);
        }
      }
      url = `/files/search?${queryParams.toString()}`;
    }

    url += (url.includes("?") ? "&" : "?") + "_t=" + Date.now();

    const token = getAuthToken();
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.success) {
      const fileArray = data.files || data.results || [];

      console.log("DEBUG: Raw API response:", data);
      console.log("DEBUG: File array length:", fileArray.length);

      const processedFiles = [];
      const seenIds = new Set();
      const seenContent = new Map();
      
      console.log(`[LoadFiles] Processing ${fileArray.length} files from API...`);
      
      fileArray.forEach((file, index) => {
        if (!file || typeof file !== 'object') {
          console.warn(`[LoadFiles] Skipping invalid file at index ${index}:`, file);
          return;
        }
        
        if (seenIds.has(file.id)) {
          console.warn(`[LoadFiles] Skipping duplicate file ID: ${file.id}`);
          return;
        }
        
        const contentSignature = `${file.originalName || file.name}_${file.size}_${file.mimetype || file.mimeType}`;
        
        if (seenContent.has(contentSignature)) {
          const existingFile = seenContent.get(contentSignature);
          console.warn(`[LoadFiles] Found content duplicate: ${file.id} matches ${existingFile.id}`);
          
          const newTimestamp = parseInt(file.timestamp || file.uploadedAt || 0);
          const existingTimestamp = parseInt(existingFile.timestamp || existingFile.uploadedAt || 0);
          
          if (newTimestamp > existingTimestamp) {
            const oldIndex = processedFiles.findIndex(f => f.id === existingFile.id);
            if (oldIndex !== -1) {
              processedFiles.splice(oldIndex, 1);
              seenIds.delete(existingFile.id);
              console.log(`[LoadFiles] Replacing older duplicate ${existingFile.id} with ${file.id}`);
            }
          } else {
            console.log(`[LoadFiles] Keeping existing file ${existingFile.id}, skipping ${file.id}`);
            return;
          }
        }
        
        const processedFile = { ...file };

        if (file.ipfsHash) {
          console.log(
            `File with IPFS hash found: ${file.id}, hash: ${file.ipfsHash}`
          );

          const ipfsGateway = getIpfsStatus().gateway || "https://ipfs.io/ipfs";
          processedFile.ipfsUrl =
            file.ipfsUrl || `${ipfsGateway}/${file.ipfsHash}`;
        }

        processedFiles.push(processedFile);
        seenIds.add(file.id);
        seenContent.set(contentSignature, processedFile);
      });

      const ipfsFiles = processedFiles.filter((file) => file.ipfsHash);
      if (ipfsFiles.length > 0) {
        console.log(
          `Found ${ipfsFiles.length} files with IPFS hashes:`,
          ipfsFiles.map((f) => ({
            id: f.id,
            name: f.originalName,
            hash: f.ipfsHash,
          }))
        );
      }

      const newFileIds = processedFiles.map(f => f.id).sort();
      const hasChanged = JSON.stringify(currentFileIds) !== JSON.stringify(newFileIds);
      const countChanged = processedFiles.length !== lastLoadedFileCount;
      
      if (!hasChanged && !countChanged && processedFiles.length === currentFiles.length) {
        console.log("[LoadFiles] No changes detected, skipping update");
        return;
      }

      try {
        console.log(
          `[LoadFiles] Updating files: ${processedFiles.length} unique files from API (${ipfsFiles.length} IPFS files)`
        );

        localStorage.setItem("files-data", JSON.stringify(processedFiles));
        _setFiles(processedFiles);
        lastLoadedFileCount = processedFiles.length;
        updateFileStats(processedFiles);
        
        const event = new CustomEvent('filesUpdated', { detail: { files: processedFiles } });
        document.dispatchEvent(event);
        
        console.log(`[LoadFiles] Successfully updated ${processedFiles.length} files`);
        
      } catch (err) {
        console.error("Error updating files:", err);
      }

      if (processedFiles.length === 0) {
        console.warn("No files found after processing");
        lastLoadedFileCount = 0;
      }
    } else {
      try {
        localStorage.setItem("files-data", JSON.stringify([]));
        _setFiles([]);
        updateFileStats([]);
        lastLoadedFileCount = 0;
      } catch (err) {
        console.error("Error resetting files:", err);
      }
      console.warn("API returned success: false");
    }
  } catch (error) {
    console.error(`Error loading files: ${error.message}`);
    showToast(`Failed to load files: ${error.message}`, "error");

    try {
      localStorage.setItem("files-data", JSON.stringify([]));
      _setFiles([]);
      updateFileStats([]);
      lastLoadedFileCount = 0;
    } catch (err) {
      console.error("Error resetting files on error:", err);
    }
  } finally {
    setIsLoading(false);
    isLoadingFiles = false;
    console.log(`[LoadFiles] Completed file load at ${new Date().toISOString()}`);
  }
}

/**
 * Update file statistics
 */
function updateFileStats(files) {
  let totalSize = 0;
  files.forEach((file) => {
    totalSize += parseInt(file.size || 0);
  });

  setFileStats({
    count: files.length,
    totalSize,
  });
}

/**
 * Format file size
 */
export function formatFileSize(bytes) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/**
 * Show toast notification
 */
export function showToast(message, type = "info", duration = 5000) {
  try {
    let currentToasts = [];
    try {
      const storedToasts = localStorage.getItem("app-toasts");
      if (storedToasts && storedToasts !== "undefined" && storedToasts.trim() !== "") {
        const parsed = JSON.parse(storedToasts);
        currentToasts = Array.isArray(parsed) ? parsed : [];
      }
    } catch (parseError) {
      console.warn("Error parsing stored toasts, resetting:", parseError);
      localStorage.removeItem("app-toasts");
      currentToasts = [];
    }

    const toast = {
      id: Date.now() + Math.random(),
      message,
      type,
      timestamp: Date.now(),
    };

    const recentSimilarToast = currentToasts.find(
      (t) =>
        t.message === message &&
        Date.now() - t.timestamp < 2000 &&
        t.type === type
    );

    if (recentSimilarToast && type === "error") {
      console.log("Toast error spam blocked:", message);
      return;
    }

    if (currentToasts.length >= 10) {
      currentToasts = currentToasts.slice(-9);
    }

    currentToasts.push(toast);

    if (!Array.isArray(currentToasts)) {
      console.error("Current toasts is not an array, resetting:", currentToasts);
      currentToasts = [toast];
    }

    localStorage.setItem("app-toasts", JSON.stringify(currentToasts));
    _setToasts(currentToasts);

    if (duration > 0) {
      setTimeout(() => {
        removeToast(toast.id);
      }, duration);
    }
  } catch (error) {
    console.error("Error in showToast:", error);
  }
}

function removeToast(id) {
  try {
    let currentToasts = [];
    try {
      const storedToasts = localStorage.getItem("app-toasts");
      if (storedToasts && storedToasts !== "undefined" && storedToasts.trim() !== "") {
        const parsed = JSON.parse(storedToasts);
        currentToasts = Array.isArray(parsed) ? parsed : [];
      }
    } catch (parseError) {
      console.warn("Error parsing stored toasts in removeToast, resetting:", parseError);
      localStorage.removeItem("app-toasts");
      currentToasts = [];
    }

    const updatedToasts = currentToasts.filter((toast) => toast && toast.id !== id);

    if (!Array.isArray(updatedToasts)) {
      console.error("Updated toasts is not an array, resetting:", updatedToasts);
      localStorage.setItem("app-toasts", JSON.stringify([]));
      _setToasts([]);
      return;
    }

    localStorage.setItem("app-toasts", JSON.stringify(updatedToasts));
    _setToasts(updatedToasts);
  } catch (err) {
    console.error("Error in removeToast:", err);
    try {
      localStorage.setItem("app-toasts", JSON.stringify([]));
      _setToasts([]);
    } catch (fallbackError) {
      console.error("Critical error in removeToast fallback:", fallbackError);
    }
  }
}

/**
 * Delete a file
 */
export async function deleteFile(fileId, fileName) {
  try {
    if (!(await checkAuth())) {
      showToast("Authentication required to delete files", "error");
      return;
    }

    if (!confirm(`Are you sure you want to delete "${fileName || fileId}"?`)) {
      return;
    }

    setIsLoading(true);
    console.log(`[DeleteFile] Starting deletion of file: ${fileId}`);

    const response = await fetch(`/files/${fileId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${getAuthToken()}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.success) {
      showToast("File deleted successfully", "success");
      console.log(`[DeleteFile] File ${fileId} deleted successfully on server`);
      await forceRefreshFileList();
    } else {
      throw new Error(data.error || "Unknown error");
    }
  } catch (error) {
    console.error(`[DeleteFile] Error deleting file: ${error.message}`);
    showToast(`Error deleting file: ${error.message}`, "error");
  } finally {
    setIsLoading(false);
  }
}

/**
 * Force refresh the file list
 */
async function forceRefreshFileList() {
  try {
    console.log('[ForceRefresh] Starting forced file list refresh...');
    
    localStorage.setItem("files-data", JSON.stringify([]));
    _setFiles([]);
    updateFileStats([]);
    lastLoadedFileCount = 0;
    
    if (loadFilesTimeout) {
      clearTimeout(loadFilesTimeout);
      loadFilesTimeout = null;
    }
    
    const originalLastLoadRequest = lastLoadRequest;
    lastLoadRequest = 0;
    
    const cacheBuster = Date.now();
    const token = getAuthToken();
    const response = await fetch(`/files/all?_nocache=${cacheBuster}&_force=true`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      },
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success) {
        const fileArray = data.files || data.results || [];
        console.log(`[ForceRefresh] Fetched ${fileArray.length} files from server`);

        const processedFiles = [];
        const seenIds = new Set();
        
        fileArray.forEach((file) => {
          if (file && file.id && !seenIds.has(file.id)) {
            processedFiles.push(file);
            seenIds.add(file.id);
          }
        });

        localStorage.setItem("files-data", JSON.stringify(processedFiles));
        _setFiles(processedFiles);
        updateFileStats(processedFiles);
        lastLoadedFileCount = processedFiles.length;

        const event = new CustomEvent('filesUpdated', { 
          detail: { files: processedFiles, source: 'forceRefresh' } 
        });
        document.dispatchEvent(event);
        
        console.log(`[ForceRefresh] Successfully refreshed with ${processedFiles.length} files`);
      }
    } else {
      console.error('[ForceRefresh] Server returned error:', response.status);
      await new Promise(resolve => setTimeout(resolve, 500));
      lastLoadRequest = 0;
      await loadFiles();
    }
    
    lastLoadRequest = Math.max(originalLastLoadRequest, Date.now() - 2000);
    
  } catch (error) {
    console.error('[ForceRefresh] Error during forced refresh:', error);
    try {
      lastLoadRequest = 0;
      await loadFiles();
    } catch (fallbackError) {
      console.error('[ForceRefresh] Fallback refresh also failed:', fallbackError);
    }
  }
}

/**
 * Update IPFS status
 */
export async function updateIpfsStatus() {
  try {
    const response = await fetch("/api/ipfs/status", {
      headers: {
        Authorization: `Bearer ${getAuthToken()}`,
      },
    });

    const data = await response.json();

    if (data.success) {
      setIpfsStatus({
        enabled: data.status.enabled,
        service: data.status.nodeType || "IPFS-CLIENT",
        nodeUrl: data.status.nodeUrl,
        gateway: data.status.gateway || data.status.defaultGateway,
      });

      if (data.status.enabled) {
        checkIpfsConnection();
      }
    } else {
      console.error("Error retrieving IPFS status:", data.error);
    }
  } catch (error) {
    console.error(`Error checking IPFS status: ${error.message}`);
  }
}

/**
 * Check IPFS connection
 */
export async function checkIpfsConnection() {
  try {
    const now = Date.now();
    if (now - lastIpfsCheckTime < ipfsCheckDebounceTime) {
      console.log(
        `IPFS check debounced. Last check was ${
          (now - lastIpfsCheckTime) / 1000
        }s ago.`
      );
      return getIpfsConnectionStatus();
    }

    if (ipfsCheckInProgress) {
      console.log("IPFS check already in progress");
      return getIpfsConnectionStatus();
    }

    ipfsCheckInProgress = true;
    lastIpfsCheckTime = now;

    const status = {
      status: "checking",
      message: "Checking...",
    };
    setIpfsConnectionStatus(status);

    const configResponse = await fetch("/api/ipfs/status", {
      headers: {
        Authorization: `Bearer ${getAuthToken()}`,
      },
      cache: "no-cache",
    });

    if (!configResponse.ok) {
      throw new Error(`Failed to get IPFS status: ${configResponse.status}`);
    }

    const configData = await configResponse.json();
    console.log("Current IPFS configuration:", configData.status);

    if (!configData.status.enabled) {
      const disabledStatus = {
        status: "disabled",
        message: "IPFS disabled",
      };
      setIpfsConnectionStatus(disabledStatus);
      ipfsCheckInProgress = false;
      return disabledStatus;
    }

    try {
      const healthResponse = await fetch("/api/ipfs/health-check", {
        headers: {
          Authorization: `Bearer ${getAuthToken()}`,
        },
        signal: AbortSignal.timeout(5000),
        cache: "no-cache",
      });

      if (!healthResponse.ok) {
        throw new Error(`Health check API error: ${healthResponse.status}`);
      }

      const healthData = await healthResponse.json();
      console.log("IPFS health check result:", healthData);

      let resultStatus;
      if (!healthData.enabled) {
        showToast("IPFS is disabled", "info");
        resultStatus = {
          status: "disabled",
          message: "IPFS disabled",
        };
      } else if (healthData.success) {
        showToast("IPFS connection verified successfully", "success");

        if (healthData.health && healthData.health.details) {
          console.log("IPFS connection details:", healthData.health.details);
        }

        resultStatus = {
          status: "connected",
          message: "Connected",
        };
      } else {
        let errorDetails = "";
        if (healthData.health && healthData.health.error) {
          errorDetails = `: ${healthData.health.error}`;
        }

        showToast(`Error in IPFS connection${errorDetails}`, "error");
        console.error("IPFS connection error:", healthData);

        resultStatus = {
          status: "error",
          message: healthData.message || "Connection error",
        };
      }

      setIpfsConnectionStatus(resultStatus);
      ipfsCheckInProgress = false;
      return resultStatus;
    } catch (healthError) {
      console.error("Health check failed:", healthError);

      let resultStatus;
      if (
        healthError.name === "AbortError" ||
        healthError.message.includes("ERR_CONNECTION_REFUSED")
      ) {
        showToast(
          "IPFS health check timeout - server might be unreachable",
          "warning"
        );
        resultStatus = {
          status: "error",
          message: "Server unreachable",
        };
      } else {
        showToast(`IPFS health check error: ${healthError.message}`, "error");
        resultStatus = {
          status: "error",
          message: "API error",
        };
      }

      setIpfsConnectionStatus(resultStatus);
      ipfsCheckInProgress = false;
      return resultStatus;
    }
  } catch (error) {
    console.error("IPFS connection check error:", error);

    let message = "Network error";
    if (error.message.includes("ERR_CONNECTION_REFUSED")) {
      message = "Server unreachable";
      showToast("Server connection refused. Is the server running?", "error");
    } else {
      showToast(`IPFS connection check error: ${error.message}`, "error");
    }

    const resultStatus = {
      status: "error",
      message: message,
    };

    setIpfsConnectionStatus(resultStatus);
    ipfsCheckInProgress = false;
    return resultStatus;
  }
}

/**
 * Pin a file to IPFS
 */
export async function pinFileToIpfs(fileId, ipfsHash) {
  try {
    if (!ipfsHash) {
      const files = getFiles();
      const file = files.find(f => f.id === fileId);
      if (!file || !file.ipfsHash) {
        showToast("❌ File does not have an IPFS hash", "error");
        return false;
      }
      ipfsHash = file.ipfsHash;
    }
    
    setIsLoading(true);
    showToast("📌 Pinning file to IPFS...", "info");

    const response = await fetch(`/api/ipfs/pin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getAuthToken()}`,
      },
      body: JSON.stringify({ hash: ipfsHash })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.success) {
      showToast("✅ File pinned to IPFS successfully!", "success");
      
      loadFilesTimeout = setTimeout(() => {
        if (!isLoadingFiles) {
          loadFiles();
        }
      }, 1000);
      
      return true;
    } else {
      throw new Error(data.error || "Unknown error");
    }
  } catch (error) {
    console.error("Error pinning file to IPFS:", error);
    showToast(`❌ Failed to pin file: ${error.message}`, "error");
    return false;
  } finally {
    setIsLoading(false);
  }
}

/**
 * Unpin a file from IPFS
 */
export async function unpinFileFromIpfs(fileId, ipfsHash) {
  try {
    if (!ipfsHash) {
      const files = getFiles();
      const file = files.find(f => f.id === fileId);
      if (!file || !file.ipfsHash) {
        showToast("❌ File does not have an IPFS hash", "error");
        return false;
      }
      ipfsHash = file.ipfsHash;
    }
    
    setIsLoading(true);
    showToast("📌 Unpinning file from IPFS...", "info");

    const response = await fetch(`/api/ipfs/unpin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getAuthToken()}`,
      },
      body: JSON.stringify({ hash: ipfsHash })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.success) {
      showToast("✅ File unpinned from IPFS successfully!", "success");
      
      loadFilesTimeout = setTimeout(() => {
        if (!isLoadingFiles) {
          loadFiles();
        }
      }, 1000);
      
      return true;
    } else {
      throw new Error(data.error || "Unknown error");
    }
  } catch (error) {
    console.error("Error unpinning file from IPFS:", error);
    showToast(`❌ Failed to unpin file: ${error.message}`, "error");
    return false;
  } finally {
    setIsLoading(false);
  }
}

/**
 * Check IPFS pin status for a file
 */
export async function checkIpfsPinStatus(ipfsHash) {
  try {
    if (!ipfsHash) {
      return false;
    }
    
    const response = await fetch(`/api/ipfs/pin-status/${ipfsHash}`, {
      headers: {
        Authorization: `Bearer ${getAuthToken()}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.success ? data.isPinned : false;
  } catch (error) {
    console.error("Error checking IPFS pin status:", error);
    return false;
  }
}

/**
 * Toggle between light and dark theme
 */
export function toggleTheme() {
  const currentTheme = getTheme();
  const newTheme = currentTheme === 'light' ? 'dark' : 'light';
  
  setTheme(newTheme);
  localStorage.setItem('app-theme', newTheme);
  
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', newTheme);
    document.body.className = document.body.className.replace(/theme-\w+/g, '');
    document.body.classList.add(`theme-${newTheme}`);
  }
  
  console.log(`Theme switched to: ${newTheme}`);
  showToast(`🎨 Theme changed to ${newTheme} mode`, 'success', 2000);
}

/**
 * Initialize theme on app startup
 */
export function initializeTheme() {
  const savedTheme = localStorage.getItem('app-theme') || 'light';
  setTheme(savedTheme);
  
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', savedTheme);
    document.body.classList.add(`theme-${savedTheme}`);
  }
  
  console.log(`Theme initialized: ${savedTheme}`);
}

export const initTheme = initializeTheme;

/**
 * Update server status
 */
export async function updateServerStatus() {
  try {
    const response = await fetch("/api/status", {
      headers: {
        Authorization: `Bearer ${getAuthToken()}`,
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    setServerStatus({
      status: data.status || "Unknown",
      port: window.location.port || "8765",
      version: data.server?.version || "1.0.0",
      timestamp: data.timestamp,
    });

    console.log("Server status updated:", data);
    return data;
  } catch (error) {
    console.error(`Error updating server status: ${error.message}`);
    setServerStatus({
      status: "Error",
      port: window.location.port || "8765",
      error: error.message,
    });
  }
}

/**
 * Load peers from server configuration (no connection testing)
 */
export async function loadPeersFromConfig() {
  try {
    const response = await fetch('/api/relay/peers', {
      headers: {
        'Authorization': `Bearer ${getAuthToken()}`
      }
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success && data.peers) {
        setPeers(data.peers);
        console.log(`[Config] Loaded ${data.peers.length} peers from configuration`);
        return data.peers;
      }
    }
    
    console.warn('[Config] Failed to load peers from server config');
    return [];
  } catch (error) {
    console.error('[Config] Error loading peers:', error);
    return [];
  }
}

// Internal file management functions
function getFiles() {
  try {
    const storedFiles = localStorage.getItem("files-data");
    if (!storedFiles || storedFiles === "undefined" || storedFiles.trim() === "") {
      return [];
    }
    const parsed = JSON.parse(storedFiles);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("Error getting files:", err);
    localStorage.removeItem("files-data");
    return [];
  }
}

function setFiles(files) {
  try {
    if (!Array.isArray(files)) {
      console.warn("setFiles called with non-array:", files);
      files = [];
    }
    localStorage.setItem("files-data", JSON.stringify(files));
    _setFiles(files);
  } catch (err) {
    console.error("Error setting files:", err);
  }
}

function getToasts() {
  try {
    const storedToasts = localStorage.getItem("app-toasts");
    if (!storedToasts || storedToasts === "undefined" || storedToasts.trim() === "") {
      return [];
    }
    const parsed = JSON.parse(storedToasts);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("Error getting toasts:", err);
    localStorage.removeItem("app-toasts");
    return [];
  }
}

function setToasts(toasts) {
  try {
    if (typeof toasts === 'function') {
      const currentToasts = getToasts();
      toasts = toasts(currentToasts);
    }
    
    if (!Array.isArray(toasts)) {
      console.warn("setToasts called with non-array:", toasts);
      toasts = [];
    }
    localStorage.setItem("app-toasts", JSON.stringify(toasts));
    _setToasts(toasts);
  } catch (err) {
    console.error("Error setting toasts:", err);
  }
}

/**
 * Authentication functions
 */
export function getAuthToken() {
  return localStorage.getItem('authToken');
}

export async function checkAuth() {
  const token = getAuthToken();
  if (!token) {
    console.log('[Auth] No token found');
    setIsAuthenticated(false);
    return false;
  }

  try {
    const response = await fetch('/check-websocket', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const isValid = response.ok;
    setIsAuthenticated(isValid);
    
    if (!isValid) {
      console.log('[Auth] Token validation failed');
      localStorage.removeItem('authToken');
      sessionStorage.removeItem('shogunSession');
    }
    
    return isValid;
  } catch (error) {
    console.error('[Auth] Token verification error:', error);
    setIsAuthenticated(false);
    return false;
  }
}

export function handleLogout() {
  localStorage.removeItem('authToken');
  sessionStorage.removeItem('shogunSession');
  sessionStorage.removeItem('loginTime');
  setIsAuthenticated(false);
  
  showToast('👋 Logged out successfully', 'info');
  
  setTimeout(() => {
    window.location.href = '/login';
  }, 1000);
}

export function isTokenExpired() {
  const loginTime = sessionStorage.getItem('loginTime');
  if (!loginTime) return true;
  
  const now = Date.now();
  const tokenAge = now - parseInt(loginTime);
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  
  return tokenAge > maxAge;
}

export function getTokenData() {
  const token = getAuthToken();
  if (!token) return null;
  
  const loginTime = sessionStorage.getItem('loginTime');
  return {
    id: 'user',
    username: 'relay-user',
    exp: loginTime ? Math.floor((parseInt(loginTime) + 24 * 60 * 60 * 1000) / 1000) : 0,
    loginTime: loginTime
  };
}

// Export state getters and setters for use in other modules
export { 
  getIsAuthenticated, 
  setIsAuthenticated,
  getIsLoading,
  setIsLoading,
  getActiveTab,
  setActiveTab,
  getToasts,
  setToasts,
  getServerStatus,
  setServerStatus,
  getFileStats,
  setFileStats,
  getFiles,
  setFiles,
  getIpfsStatus,
  setIpfsStatus,
  getIpfsConnectionStatus,
  setIpfsConnectionStatus,
  getTheme,
  setTheme,
  getPeers,
  setPeers,
  initializeFileEventListeners,
  forceRefreshFileList
}; 