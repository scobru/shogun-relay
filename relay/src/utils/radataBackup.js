import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import ShogunIpfsManager from '../managers/IpfsManager.js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { backupLogger } from './logger.js';

// Load environment variables
dotenv.config();

// Get directory name (ESM equivalent of __dirname)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execAsync = promisify(exec);

/**
 * Creates a backup of the radata folder and uploads it to IPFS
 * @param {Object} options - Configuration options
 * @param {string} options.radataPath - Path to the radata folder (default: '../../radata')
 * @param {string} options.backupDir - Directory to store backups (default: '../../backups')
 * @param {boolean} options.compress - Whether to compress the backup (default: true)
 * @param {Object} options.ipfsConfig - IPFS configuration options
 * @returns {Promise<Object>} - Information about the backup
 */
export async function backupRadataToIpfs(options = {}) {
  try {
    backupLogger.info('Starting radata backup to IPFS...');
    
    // Default options
    const {
      radataPath = path.resolve(__dirname, '../../radata'),
      backupDir = path.resolve(__dirname, '../../backups'),
      compress = true,
      ipfsConfig = {}
    } = options;
    
    // Create backup directory if it doesn't exist
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    
    // Generate backup filename with timestamp
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const backupFilename = `radata_backup_${timestamp}`;
    const tarFilePath = path.join(backupDir, `${backupFilename}.tar`);
    const gzFilePath = path.join(backupDir, `${backupFilename}.tar.gz`);
    const finalBackupPath = compress ? gzFilePath : tarFilePath;
    
    backupLogger.info(`Backing up radata from: ${radataPath}`);
    backupLogger.info(`Backup will be stored at: ${finalBackupPath}`);

    // Create tar archive
    if (compress) {
      backupLogger.info('Creating compressed tar archive...');
      await execAsync(`tar -czf "${gzFilePath}" -C "${path.dirname(radataPath)}" "${path.basename(radataPath)}"`);
    } else {
      backupLogger.info('Creating tar archive...');
      await execAsync(`tar -cf "${tarFilePath}" -C "${path.dirname(radataPath)}" "${path.basename(radataPath)}"`);
    }
    
    backupLogger.info('Archive created successfully');
    
    // Initialize IPFS manager with provided or default config
    const defaultIpfsConfig = {
      enabled: true,
      service: process.env.IPFS_SERVICE || 'IPFS-CLIENT',
      nodeUrl: process.env.IPFS_NODE_URL || 'http://127.0.0.1:5001',
      gateway: process.env.IPFS_GATEWAY || 'http://127.0.0.1:8080/ipfs',
      pinataGateway: process.env.PINATA_GATEWAY || 'https://gateway.pinata.cloud',
      pinataJwt: process.env.PINATA_JWT || '',
      encryptionEnabled: process.env.ENCRYPTION_ENABLED === 'true',
      encryptionKey: process.env.ENCRYPTION_KEY || '',
      encryptionAlgorithm: process.env.ENCRYPTION_ALGORITHM || 'aes-256-gcm',
      apiKey: process.env.SECRET_TOKEN || ''
    };
    
    const ipfsManager = new ShogunIpfsManager({
      ...defaultIpfsConfig,
      ...ipfsConfig
    });
    
    // Check if IPFS is enabled
    if (!ipfsManager.isEnabled()) {
      throw new Error('IPFS is not enabled. Cannot upload backup.');
    }
    
    backupLogger.info('Uploading backup to IPFS...');
    
    // Upload file to IPFS
    const fileStream = fs.createReadStream(finalBackupPath);
    const ipfsResult = await ipfsManager.uploadFile(fileStream, {
      fileName: path.basename(finalBackupPath),
      pin: true
    });
    
    backupLogger.info(`Backup successfully uploaded to IPFS with hash: ${ipfsResult.hash}`);
    
    // Return backup information
    const backupInfo = {
      timestamp,
      localBackupPath: finalBackupPath,
      ipfsHash: ipfsResult.hash,
      ipfsUrl: `${ipfsManager.getConfig().gateway}/${ipfsResult.hash}`,
      pinned: true,
      size: fs.statSync(finalBackupPath).size
    };
    
    // Save backup info to a log file
    const backupLogPath = path.join(backupDir, 'backups.json');
    let backupLog = [];
    
    if (fs.existsSync(backupLogPath)) {
      try {
        backupLog = JSON.parse(fs.readFileSync(backupLogPath, 'utf8'));
      } catch (err) {
        backupLogger.error('Error reading backup log:', { error: err.message });
      }
    }
    
    backupLog.push(backupInfo);
    fs.writeFileSync(backupLogPath, JSON.stringify(backupLog, null, 2));
    
    backupLogger.info('Backup process completed successfully', { 
      ipfsHash: backupInfo.ipfsHash, 
      size: backupInfo.size 
    });
    return backupInfo;
  } catch (error) {
    backupLogger.error('Error during radata backup:', { 
      error: error.message, 
      stack: error.stack 
    });
    throw error;
  }
}

/**
 * CLI entry point
 */
async function main() {
  try {
    // Parse command line arguments
    const args = process.argv.slice(2);
    const options = {};
    
    // Simple arg parsing
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--radataPath' && i + 1 < args.length) {
        options.radataPath = args[i + 1];
        i++;
      } else if (args[i] === '--backupDir' && i + 1 < args.length) {
        options.backupDir = args[i + 1];
        i++;
      } else if (args[i] === '--no-compress') {
        options.compress = false;
      }
    }
    
    const result = await backupRadataToIpfs(options);
    backupLogger.info('Backup Summary:', {
      timestamp: result.timestamp,
      localPath: result.localBackupPath,
      ipfsHash: result.ipfsHash,
      ipfsUrl: result.ipfsUrl,
      sizeMB: (result.size / 1024 / 1024).toFixed(2)
    });
  } catch (error) {
    backupLogger.error('Backup failed:', { error: error.message });
    process.exit(1);
  }
}

// Run main function if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
} 