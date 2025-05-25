#!/usr/bin/env node

import { backupRadataToIpfs } from '../src/utils/radataBackup.js';
import { backupLogger } from '../src/utils/logger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Script to backup radata folder to IPFS
 * Usage: node backup-radata.js [options]
 * 
 * Options:
 *   --radataPath <path>  Path to radata folder
 *   --backupDir <path>   Path to store backups
 *   --no-compress        Do not compress the backup
 */
async function runBackup() {
  try {
    backupLogger.info('=== RADATA BACKUP TO IPFS ===');
    backupLogger.info(`Starting backup process at ${new Date().toISOString()}`);
    
    // Parse command line arguments (same as in radataBackup.js)
    const args = process.argv.slice(2);
    const options = {};
    
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
    
    // Default paths relative to this script if not specified
    if (!options.radataPath) {
      options.radataPath = path.resolve(__dirname, '../radata');
    }
    
    if (!options.backupDir) {
      options.backupDir = path.resolve(__dirname, '../backups');
    }
    
    // Make sure directories exist
    if (!fs.existsSync(options.radataPath)) {
      backupLogger.error(`Error: radata directory not found: ${options.radataPath}`);
      process.exit(1);
    }
    
    // Create backup directory if it doesn't exist
    if (!fs.existsSync(options.backupDir)) {
      fs.mkdirSync(options.backupDir, { recursive: true });
      backupLogger.info(`Created backup directory: ${options.backupDir}`);
    }
    
    backupLogger.info(`Using radata path: ${options.radataPath}`);
    backupLogger.info(`Using backup directory: ${options.backupDir}`);
    backupLogger.info(`Compression: ${options.compress !== false ? 'Enabled' : 'Disabled'}`);
    
    // Run the backup
    const result = await backupRadataToIpfs(options);
    
    // Output summary
    backupLogger.info('Backup Summary', {
      timestamp: result.timestamp,
      localBackup: result.localBackupPath,
      ipfsHash: result.ipfsHash,
      ipfsUrl: result.ipfsUrl,
      sizeMB: (result.size / (1024 * 1024)).toFixed(2)
    });
    
    backupLogger.info('Backup completed successfully');
    
    // Create a symlink to the most recent backup
    const latestLinkPath = path.join(options.backupDir, 'latest_backup');
    try {
      if (fs.existsSync(latestLinkPath)) {
        fs.unlinkSync(latestLinkPath);
      }
      fs.symlinkSync(result.localBackupPath, latestLinkPath);
      backupLogger.info(`Created symlink to latest backup: ${latestLinkPath}`);
    } catch (err) {
      backupLogger.warn(`Could not create symlink to latest backup: ${err.message}`);
    }
    
    return result;
  } catch (error) {
    backupLogger.error('Backup failed', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

// Run the backup
runBackup().catch(err => {
  backupLogger.error('Unhandled error during backup', { error: err.message, stack: err.stack });
  process.exit(1);
}); 