# Building a Drive Application with Shogun Relay SDK

This guide shows you how to build a drive application (like Google Drive or Dropbox) using the Shogun Relay SDK. The SDK provides all the necessary methods to interact with IPFS storage and metadata management.

## Table of Contents

- [Installation](#installation)
- [Initialization](#initialization)
- [Core Operations](#core-operations)
  - [File Upload](#file-upload)
  - [Directory Upload](#directory-upload)
  - [File Download](#file-download)
  - [Directory Navigation](#directory-navigation)
  - [Metadata Management](#metadata-management)
  - [File Deletion](#file-deletion)
- [Complete Example](#complete-example)
- [Advanced Features](#advanced-features)
- [Best Practices](#best-practices)

## Installation

```bash
npm install shogun-relay-sdk
```

## Initialization

```javascript
import ShogunRelaySDK from 'shogun-relay-sdk';

// Initialize the SDK
const sdk = new ShogunRelaySDK({
  baseURL: 'https://your-relay-server.com',
  token: 'your-auth-token'
});

// Update token if needed
sdk.setToken('new-token');
```

## Core Operations

### File Upload

Upload a single file to IPFS:

```javascript
async function uploadFile(file) {
  try {
    // The SDK handles FormData creation automatically
    const result = await sdk.ipfs.uploadFileBrowser(file);
    
    if (result.success && result.file?.hash) {
      const cid = result.file.hash;
      
      // Save metadata
      await sdk.uploads.saveSystemHash({
        hash: cid,
        userAddress: 'user-123',
        fileName: file.name,
        displayName: file.name,
        originalName: file.name,
        fileSize: file.size,
        contentType: file.type || 'application/octet-stream',
        isEncrypted: false,
        uploadedAt: Date.now(),
        timestamp: Date.now()
      });
      
      return cid;
    }
  } catch (error) {
    console.error('Upload failed:', error);
    throw error;
  }
}
```

### Directory Upload

Upload multiple files as a directory (maintains structure):

```javascript
async function uploadDirectory(files) {
  try {
    // Files should have webkitRelativePath for directory structure
    // or use file.name for flat structure
    const result = await sdk.ipfs.uploadDirectoryBrowser(files);
    
    if (result.success && result.directoryCid) {
      const directoryCid = result.directoryCid;
      
      // Save directory metadata
      await sdk.uploads.saveSystemHash({
        hash: directoryCid,
        userAddress: 'user-123',
        fileName: 'My Folder',
        displayName: 'My Folder',
        isDirectory: true,
        fileCount: result.fileCount || files.length,
        files: result.files?.map(f => ({
          name: f.name,
          path: f.path,
          size: f.size,
          mimetype: f.mimetype
        })),
        contentType: 'application/x-directory',
        uploadedAt: Date.now(),
        timestamp: Date.now()
      });
      
      return directoryCid;
    }
  } catch (error) {
    console.error('Directory upload failed:', error);
    throw error;
  }
}
```

### File Download

Download a file from IPFS:

```javascript
async function downloadFile(cid) {
  try {
    // Get file as Blob (browser-friendly)
    const blob = await sdk.ipfs.catBlob(cid);
    
    // Create download link
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'filename.ext'; // Use metadata for actual filename
    a.click();
    URL.revokeObjectURL(url);
    
    return blob;
  } catch (error) {
    console.error('Download failed:', error);
    throw error;
  }
}
```

### Directory Navigation

Access files within a directory:

```javascript
async function getFileFromDirectory(directoryCid, filePath) {
  try {
    // Get file from directory as Blob
    const blob = await sdk.ipfs.catFromDirectoryBlob(directoryCid, filePath);
    return blob;
  } catch (error) {
    console.error('Failed to get file from directory:', error);
    throw error;
  }
}
```

### Metadata Management

#### Get All Files Metadata

```javascript
async function getAllFiles() {
  try {
    const metadataMap = await sdk.uploads.getSystemHashesMap();
    
    // metadataMap.systemHashes contains all file metadata
    const files = Object.values(metadataMap.systemHashes || {});
    
    // Filter directories
    const directories = files.filter(f => f.isDirectory);
    const regularFiles = files.filter(f => !f.isDirectory);
    
    return { directories, files: regularFiles };
  } catch (error) {
    console.error('Failed to get files:', error);
    throw error;
  }
}
```

#### Save Metadata

```javascript
async function saveFileMetadata(cid, fileInfo) {
  try {
    await sdk.uploads.saveSystemHash({
      hash: cid,
      userAddress: 'user-123',
      fileName: fileInfo.name,
      displayName: fileInfo.displayName || fileInfo.name,
      originalName: fileInfo.originalName || fileInfo.name,
      fileSize: fileInfo.size,
      contentType: fileInfo.type,
      isEncrypted: fileInfo.isEncrypted || false,
      uploadedAt: Date.now(),
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Failed to save metadata:', error);
    throw error;
  }
}
```

#### Remove Metadata

```javascript
async function deleteFileMetadata(cid, userAddress = 'user-123') {
  try {
    await sdk.uploads.removeSystemHash(cid, userAddress);
    // Also remove IPFS pin if needed
    await sdk.ipfs.pinRm(cid);
  } catch (error) {
    console.error('Failed to remove metadata:', error);
    throw error;
  }
}
```

### File Deletion

Delete a file (unpin + remove metadata):

```javascript
async function deleteFile(cid) {
  try {
    // 1. Remove IPFS pin
    await sdk.ipfs.pinRm(cid);
    
    // 2. Remove metadata
    await sdk.uploads.removeSystemHash(cid, 'user-123');
    
    console.log('File deleted successfully');
  } catch (error) {
    console.error('Delete failed:', error);
    throw error;
  }
}
```

## Complete Example

Here's a complete example of a simple drive application:

```javascript
import ShogunRelaySDK from 'shogun-relay-sdk';

class SimpleDrive {
  constructor(relayUrl, authToken) {
    this.sdk = new ShogunRelaySDK({
      baseURL: relayUrl,
      token: authToken
    });
  }

  // Check connection
  async checkConnection() {
    try {
      await sdk.system.health();
      return true;
    } catch (error) {
      return false;
    }
  }

  // Upload file
  async uploadFile(file) {
    const result = await this.sdk.ipfs.uploadFileBrowser(file);
    
    if (result.success) {
      // Save metadata
      await this.sdk.uploads.saveSystemHash({
        hash: result.file.hash,
        userAddress: 'user-123',
        fileName: file.name,
        displayName: file.name,
        fileSize: file.size,
        contentType: file.type,
        uploadedAt: Date.now(),
        timestamp: Date.now()
      });
    }
    
    return result;
  }

  // Upload folder
  async uploadFolder(files) {
    const result = await this.sdk.ipfs.uploadDirectoryBrowser(files);
    
    if (result.success) {
      // Save directory metadata
      await this.sdk.uploads.saveSystemHash({
        hash: result.directoryCid,
        userAddress: 'user-123',
        fileName: 'Folder',
        displayName: 'Folder',
        isDirectory: true,
        fileCount: result.fileCount,
        files: result.files,
        contentType: 'application/x-directory',
        uploadedAt: Date.now(),
        timestamp: Date.now()
      });
    }
    
    return result;
  }

  // List files
  async listFiles() {
    const metadata = await this.sdk.uploads.getSystemHashesMap();
    return Object.values(metadata.systemHashes || {});
  }

  // Download file
  async downloadFile(cid, filename) {
    const blob = await this.sdk.ipfs.catBlob(cid);
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Delete file
  async deleteFile(cid) {
    await this.sdk.ipfs.pinRm(cid);
    await this.sdk.uploads.removeSystemHash(cid, 'user-123');
  }
}

// Usage
const drive = new SimpleDrive('https://relay.example.com', 'your-token');

// Upload a file
const fileInput = document.querySelector('input[type="file"]');
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  const result = await drive.uploadFile(file);
  console.log('File uploaded:', result.file.hash);
});

// List files
const files = await drive.listFiles();
console.log('Files:', files);
```

## Advanced Features

### Working with Directories

```javascript
// Get file from directory
async function getDirectoryFile(directoryCid, filePath) {
  const blob = await sdk.ipfs.catFromDirectoryBlob(directoryCid, filePath);
  return blob;
}

// List directory contents (from metadata)
async function listDirectory(directoryCid) {
  const metadata = await sdk.uploads.getSystemHashesMap();
  const dirMetadata = metadata.systemHashes?.[directoryCid];
  
  if (dirMetadata?.isDirectory && dirMetadata?.files) {
    return dirMetadata.files;
  }
  
  return [];
}
```

### Adding Files to Existing Directory

Since IPFS directories are immutable, adding files requires recreating the directory:

```javascript
async function addFilesToDirectory(directoryCid, newFiles) {
  // 1. Get existing directory metadata
  const metadata = await sdk.uploads.getSystemHashesMap();
  const dirMetadata = metadata.systemHashes?.[directoryCid];
  
  // 2. Download existing files
  const existingFiles = [];
  for (const fileMeta of dirMetadata.files || []) {
    const blob = await sdk.ipfs.catFromDirectoryBlob(directoryCid, fileMeta.path);
    const file = new File([blob], fileMeta.name, { type: fileMeta.mimetype });
    existingFiles.push(file);
  }
  
  // 3. Combine existing + new files
  const allFiles = [...existingFiles, ...newFiles];
  
  // 4. Upload new directory
  const result = await sdk.ipfs.uploadDirectoryBrowser(allFiles);
  
  // 5. Update metadata with new CID
  await sdk.uploads.saveSystemHash({
    ...dirMetadata,
    hash: result.directoryCid,
    files: result.files
  });
  
  // 6. Remove old directory pin and metadata
  await sdk.ipfs.pinRm(directoryCid);
  await sdk.uploads.removeSystemHash(directoryCid, 'user-123');
  
  return result.directoryCid;
}
```

### Encryption

For encrypted files, use the decryption endpoint:

```javascript
async function downloadEncryptedFile(cid, token) {
  const blob = await sdk.ipfs.catDecrypt(cid, token);
  return blob;
}
```

## Best Practices

1. **Cache Metadata Locally**: Use localStorage to cache metadata for faster loading:
   ```javascript
   // Cache metadata
   localStorage.setItem('drive-metadata', JSON.stringify({
     data: metadataMap.systemHashes,
     timestamp: Date.now()
   }));
   
   // Load from cache
   const cached = localStorage.getItem('drive-metadata');
   if (cached) {
     const { data, timestamp } = JSON.parse(cached);
     // Use cached data if fresh (e.g., less than 5 minutes old)
     if (Date.now() - timestamp < 5 * 60 * 1000) {
       return data;
     }
   }
   ```

2. **Error Handling**: Always wrap SDK calls in try-catch blocks:
   ```javascript
   try {
     await sdk.ipfs.uploadFileBrowser(file);
   } catch (error) {
     if (error.response?.status === 401) {
       // Handle authentication error
     } else if (error.response?.status === 402) {
       // Handle payment/subscription required
     } else {
       // Handle other errors
     }
   }
   ```

3. **Progress Tracking**: For large files, you may want to implement progress tracking:
   ```javascript
   // Note: SDK doesn't currently support progress callbacks
   // You may need to use fetch directly for progress tracking
   ```

4. **Health Checks**: Check relay connection before operations:
   ```javascript
   async function ensureConnected() {
     try {
       await sdk.system.health();
       return true;
     } catch (error) {
       console.error('Relay not available');
       return false;
     }
   }
   ```

5. **Batch Operations**: When possible, batch metadata operations:
   ```javascript
   // Instead of multiple individual saves, batch them
   const metadataList = [/* ... */];
   for (const metadata of metadataList) {
     await sdk.uploads.saveSystemHash(metadata);
   }
   ```

## API Reference

### IpfsModule (Browser Methods)

- `uploadFileBrowser(file: File, userAddress?: string): Promise<any>`
- `uploadDirectoryBrowser(files: File[], userAddress?: string): Promise<any>`
- `catBlob(cid: string): Promise<Blob>`
- `catFromDirectoryBlob(directoryCid: string, filePath: string): Promise<Blob>`
- `pinLs(): Promise<any>`
- `pinRm(cid: string): Promise<any>`

### UploadsModule

- `getSystemHashesMap(): Promise<any>` - Get all file metadata
- `saveSystemHash(metadata: object): Promise<any>` - Save file metadata
- `removeSystemHash(cid: string, userAddress?: string): Promise<any>` - Remove metadata

### SystemModule

- `health(): Promise<any>` - Check relay health
- `getHealth(): Promise<HealthResponse>` - Get detailed health info

## See Also

- [API Reference](./API.md) - Complete REST API documentation
- [SDK Source Code](https://github.com/shogun-network/shogun-2/tree/main/shogun-relay/sdk) - SDK implementation
- [Shogun Drive](https://github.com/shogun-network/shogun-2/tree/main/shogun-drive) - Reference implementation

