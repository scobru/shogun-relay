#!/usr/bin/env node

import { serverLogger, ipfsLogger, gunLogger, authLogger, backupLogger } from '../src/utils/logger.js';
import logger, { createModuleLogger } from '../src/utils/logger.js';

// Test all the different logger instances and log levels
async function testLogger() {
  console.log('Testing Winston logger...\n');
  
  // Test all log levels with the main logger
  logger.error('Direct logger error test');
  logger.warn('Direct logger warning test');
  logger.info('Direct logger info test');
  logger.http('Direct logger http test');
  logger.verbose('Direct logger verbose test');
  logger.debug('Direct logger debug test');
  logger.silly('Direct logger silly test');
  
  console.log('\nTesting module-specific loggers...\n');
  
  // Test server logger
  serverLogger.info('Server starting up');
  serverLogger.error('Server error occurred', { reason: 'test error' });
  
  // Test IPFS logger
  ipfsLogger.info('IPFS connected');
  ipfsLogger.error('IPFS error occurred', { reason: 'connection failed' });
  
  // Test Gun logger
  gunLogger.info('Gun database initialized');
  gunLogger.warn('Gun database warning', { peers: 0 });
  
  // Test Auth logger
  authLogger.info('User authenticated');
  authLogger.warn('Auth token expiring', { expiresIn: '5m' });
  
  // Test Backup logger
  backupLogger.info('Backup started');
  backupLogger.info('Backup completed', { 
    timestamp: new Date().toISOString(),
    size: '15MB',
    path: '/backups/latest' 
  });
  
  // Test creating a custom module logger
  const customLogger = createModuleLogger('custom');
  customLogger.info('Custom module initialized');
  customLogger.error('Custom module error', { errorCode: 'CUSTOM_ERROR' });
  
  console.log('\nLogs have been written to the following files:');
  console.log('- ./logs/application-YYYY-MM-DD.log');
  console.log('- ./logs/error-YYYY-MM-DD.log');
  console.log('- ./logs/backup-YYYY-MM-DD.log');
}

// Run the test
testLogger().catch(err => {
  console.error('Error during logger test:', err);
}); 