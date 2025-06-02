#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * Simple script to clean up duplicate files in the uploads directory
 * This helps clean up the duplicates that were created before the fix
 */

const uploadsDir = './uploads';

if (!fs.existsSync(uploadsDir)) {
    console.log('❌ Uploads directory not found:', uploadsDir);
    process.exit(1);
}

console.log('🔍 Scanning for duplicate files...');

const files = fs.readdirSync(uploadsDir);
const fileGroups = new Map(); // contentHash -> array of files

// Group files by content hash
for (const filename of files) {
    if (filename === 'ipfs-metadata.json') continue;
    
    const filePath = path.join(uploadsDir, filename);
    const stats = fs.statSync(filePath);
    
    if (!stats.isFile()) continue;
    
    try {
        // Calculate content hash
        const content = fs.readFileSync(filePath);
        const contentHash = crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
        
        if (!fileGroups.has(contentHash)) {
            fileGroups.set(contentHash, []);
        }
        
        fileGroups.get(contentHash).push({
            filename,
            filePath,
            stats,
            contentHash
        });
    } catch (error) {
        console.warn(`⚠️ Error processing ${filename}:`, error.message);
    }
}

// Find and report duplicates
const duplicateGroups = [];
let totalDuplicates = 0;

for (const [contentHash, fileList] of fileGroups.entries()) {
    if (fileList.length > 1) {
        // Sort by modification time, keep the newest
        fileList.sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs);
        
        const keepFile = fileList[0];
        const deleteFiles = fileList.slice(1);
        
        duplicateGroups.push({
            contentHash,
            keepFile: keepFile.filename,
            deleteFiles: deleteFiles.map(f => f.filename),
            duplicateCount: deleteFiles.length
        });
        
        totalDuplicates += deleteFiles.length;
    }
}

console.log(`\n📊 Found ${duplicateGroups.length} groups with duplicates`);
console.log(`📊 Total duplicate files to remove: ${totalDuplicates}`);

if (duplicateGroups.length === 0) {
    console.log('✅ No duplicates found!');
    process.exit(0);
}

// Show duplicates
duplicateGroups.forEach((group, index) => {
    console.log(`\n${index + 1}. Content Hash: ${group.contentHash}`);
    console.log(`   Keep: ${group.keepFile}`);
    console.log(`   Delete (${group.duplicateCount}): ${group.deleteFiles.join(', ')}`);
});

// Ask for confirmation
const args = process.argv.slice(2);
const dryRun = !args.includes('--delete');

if (dryRun) {
    console.log('\n🔍 This was a dry run. To actually delete duplicates, run:');
    console.log('node cleanup-duplicates.js --delete');
} else {
    console.log('\n🗑️ Deleting duplicate files...');
    
    let deletedCount = 0;
    let errorCount = 0;
    
    for (const group of duplicateGroups) {
        for (const filename of group.deleteFiles) {
            const filePath = path.join(uploadsDir, filename);
            try {
                fs.unlinkSync(filePath);
                console.log(`✅ Deleted: ${filename}`);
                deletedCount++;
            } catch (error) {
                console.error(`❌ Failed to delete ${filename}:`, error.message);
                errorCount++;
            }
        }
    }
    
    console.log(`\n📊 Cleanup completed:`);
    console.log(`   ✅ Deleted: ${deletedCount} files`);
    console.log(`   ❌ Errors: ${errorCount} files`);
    console.log(`   💾 Saved disk space: ~${(deletedCount * 254732 / 1024 / 1024).toFixed(2)} MB (estimated)`);
} 