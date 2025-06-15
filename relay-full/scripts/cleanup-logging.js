#!/usr/bin/env node

/**
 * Logging Cleanup Script for Shogun Relay
 * Removes verbose and unnecessary console.log statements for better performance
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, '../src');

// Patterns to replace with more efficient alternatives
const replacementPatterns = [
  // FileManager verbose logging patterns
  {
    pattern: /console\.log\(`\[FileManager\] .*?`\);/g,
    replacement: '// FileManager operation (verbose logging removed)',
    description: 'FileManager verbose logs'
  },
  
  // IPFS API verbose logging patterns
  {
    pattern: /console\.log\(`\[IPFS .*?\] .*?`\);/g,
    replacement: '// IPFS operation (verbose logging removed)',
    description: 'IPFS API verbose logs'
  },
  
  // GunDB debug logging patterns
  {
    pattern: /console\.log\(`\[Gun.*?\] .*?`\);/g,
    replacement: '// Gun operation (verbose logging removed)',
    description: 'Gun debug logs'
  },
  
  // Storage debug logging patterns
  {
    pattern: /console\.log\(`\[Storage.*?\] .*?`\);/g,
    replacement: '// Storage operation (verbose logging removed)',
    description: 'Storage debug logs'
  },
  
  // Multi-line console.log statements (common in IPFS routes)
  {
    pattern: /console\.log\(\s*`\[IPFS.*?\][\s\S]*?`[\s\S]*?\);/g,
    replacement: '// IPFS operation (multi-line logging removed)',
    description: 'Multi-line IPFS logs'
  },
  
  // Debug information logs
  {
    pattern: /console\.log\(".*?debug.*?".*?\);/gi,
    replacement: '// Debug info (verbose logging removed)',
    description: 'Debug information logs'
  },
  
  // Status and progress logs
  {
    pattern: /console\.log\(".*?(starting|completed|processing|finished).*?".*?\);/gi,
    replacement: '// Status update (verbose logging removed)',
    description: 'Status and progress logs'
  }
];

// Files to process
const filesToProcess = [
  'managers/FileManager.js',
  'managers/IpfsManager.js',
  'managers/AuthenticationManager.js',
  'routes/ipfsApiRoutes.js',
  'routes/fileManagerRoutes.js',
  'routes/relayApiRoutes.js',
  'routes/authRoutes.js',
  'routes/gatewayRoutes.js',
  'utils/storageLog.js',
  'utils/gunIpfsUtils.js',
  'utils/shogunCoreUtils.js',
  'utils/typeValidation.js',
  'utils/debugUtils.js'
];

// Configuration for cleanup levels
const cleanupConfig = {
  // Keep only error and warn logs
  conservative: {
    removeDebugLogs: true,
    removeInfoLogs: true,
    removeVerboseLogs: true,
    keepErrorLogs: true,
    keepWarnLogs: true
  },
  
  // Remove most logs except critical errors
  aggressive: {
    removeDebugLogs: true,
    removeInfoLogs: true,
    removeVerboseLogs: true,
    keepErrorLogs: true,
    keepWarnLogs: false
  },
  
  // Remove all console.logs (use structured logging only)
  complete: {
    removeDebugLogs: true,
    removeInfoLogs: true,
    removeVerboseLogs: true,
    keepErrorLogs: false,
    keepWarnLogs: false
  }
};

async function cleanupFile(filePath, level = 'conservative') {
  const config = cleanupConfig[level];
  
  if (!fs.existsSync(filePath)) {
    console.log(`⚠️ File not found: ${filePath}`);
    return { processed: false, reason: 'File not found' };
  }
  
  let content = fs.readFileSync(filePath, 'utf8');
  const originalLength = content.length;
  let changesCount = 0;
  
  // Apply replacement patterns
  for (const { pattern, replacement, description } of replacementPatterns) {
    const matches = content.match(pattern);
    if (matches) {
      content = content.replace(pattern, replacement);
      changesCount += matches.length;
      console.log(`  📝 Replaced ${matches.length} instances of ${description}`);
    }
  }
  
  // Remove specific console.log patterns based on config
  if (config.removeDebugLogs) {
    const debugPattern = /console\.log\(.*?(debug|Debug|DEBUG).*?\);/g;
    const debugMatches = content.match(debugPattern);
    if (debugMatches) {
      content = content.replace(debugPattern, '// Debug log removed');
      changesCount += debugMatches.length;
      console.log(`  🔍 Removed ${debugMatches.length} debug logs`);
    }
  }
  
  if (config.removeInfoLogs) {
    const infoPattern = /console\.log\(.*?(info|Info|INFO|✅|🚀|📦|💾).*?\);/g;
    const infoMatches = content.match(infoPattern);
    if (infoMatches) {
      content = content.replace(infoPattern, '// Info log removed');
      changesCount += infoMatches.length;
      console.log(`  ℹ️ Removed ${infoMatches.length} info logs`);
    }
  }
  
  if (config.removeVerboseLogs) {
    // Remove verbose logging with timestamps, request IDs, etc.
    const verbosePattern = /console\.log\([^)]*\$\{[^}]*\}[^)]*\);/g;
    const verboseMatches = content.match(verbosePattern);
    if (verboseMatches) {
      content = content.replace(verbosePattern, '// Verbose log removed');
      changesCount += verboseMatches.length;
      console.log(`  🔇 Removed ${verboseMatches.length} verbose logs`);
    }
  }
  
  // Optionally remove error and warn logs
  if (!config.keepErrorLogs) {
    const errorPattern = /console\.error\(/g;
    content = content.replace(errorPattern, '// console.error(');
  }
  
  if (!config.keepWarnLogs) {
    const warnPattern = /console\.warn\(/g;
    content = content.replace(warnPattern, '// console.warn(');
  }
  
  // Clean up multiple consecutive comment lines
  content = content.replace(/\/\/ .*?(log|Log|LOG).*?\n(\/\/ .*?(log|Log|LOG).*?\n)+/g, '// Multiple logs removed for performance\n');
  
  // Write back if changes were made
  if (changesCount > 0) {
    fs.writeFileSync(filePath, content);
    const newLength = content.length;
    const reduction = originalLength - newLength;
    
    return {
      processed: true,
      changesCount,
      sizeBefore: originalLength,
      sizeAfter: newLength,
      reduction: reduction,
      reductionPercent: ((reduction / originalLength) * 100).toFixed(1)
    };
  }
  
  return { processed: false, reason: 'No changes needed' };
}

async function cleanupLogging(level = 'conservative') {
  console.log(`🧹 Starting logging cleanup (level: ${level})`);
  console.log(`📁 Processing files in: ${srcDir}`);
  
  const results = {
    processed: 0,
    skipped: 0,
    totalChanges: 0,
    totalReduction: 0,
    files: []
  };
  
  for (const file of filesToProcess) {
    const fullPath = path.join(srcDir, file);
    console.log(`\n🔧 Processing: ${file}`);
    
    const result = await cleanupFile(fullPath, level);
    results.files.push({ file, ...result });
    
    if (result.processed) {
      results.processed++;
      results.totalChanges += result.changesCount;
      results.totalReduction += result.reduction || 0;
      console.log(`  ✅ Cleaned up ${result.changesCount} logging statements`);
      console.log(`  📏 Size: ${result.sizeBefore} → ${result.sizeAfter} bytes (-${result.reductionPercent}%)`);
    } else {
      results.skipped++;
      console.log(`  ⏭️ Skipped: ${result.reason}`);
    }
  }
  
  // Summary
  console.log(`\n📊 Cleanup Summary:`);
  console.log(`  📁 Files processed: ${results.processed}`);
  console.log(`  ⏭️ Files skipped: ${results.skipped}`);
  console.log(`  🔧 Total changes: ${results.totalChanges}`);
  console.log(`  📏 Total size reduction: ${(results.totalReduction / 1024).toFixed(1)} KB`);
  
  // Create backup info
  const backupInfo = {
    timestamp: new Date().toISOString(),
    level: level,
    results: results,
    config: cleanupConfig[level]
  };
  
  const backupPath = path.join(__dirname, `../logs/logging-cleanup-${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(backupInfo, null, 2));
  console.log(`\n💾 Cleanup report saved to: ${backupPath}`);
  
  return results;
}

// CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const level = process.argv[2] || 'conservative';
  
  if (!cleanupConfig[level]) {
    console.error(`❌ Invalid cleanup level: ${level}`);
    console.error(`Available levels: ${Object.keys(cleanupConfig).join(', ')}`);
    process.exit(1);
  }
  
  cleanupLogging(level)
    .then(() => {
      console.log('\n🎉 Logging cleanup completed successfully!');
      console.log('\n💡 To run again with different levels:');
      console.log('  node cleanup-logging.js conservative  # Keep errors and warnings');
      console.log('  node cleanup-logging.js aggressive    # Keep only errors');
      console.log('  node cleanup-logging.js complete      # Remove all console logs');
    })
    .catch(error => {
      console.error('❌ Cleanup failed:', error);
      process.exit(1);
    });
}

export { cleanupLogging, cleanupConfig }; 