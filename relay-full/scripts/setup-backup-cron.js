#!/usr/bin/env node

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

/**
 * Set up a cron job to run the backup script
 */
async function setupCronJob() {
  try {
    console.log('=== SETUP BACKUP CRON JOB ===');
    
    // Get the absolute path to the backup script
    const backupScriptPath = path.resolve(__dirname, 'backup-radata.js');
    
    // Check if the backup script exists
    if (!fs.existsSync(backupScriptPath)) {
      console.error(`Error: Backup script not found: ${backupScriptPath}`);
      process.exit(1);
    }
    
    // Make sure the script is executable
    await execAsync(`chmod +x "${backupScriptPath}"`);
    
    console.log('\nThis script will set up a cron job to regularly backup your radata folder to IPFS.');
    
    // Get cron schedule from user
    const defaultSchedule = '0 */6 * * *'; // Every 6 hours
    const schedule = await question(`Enter cron schedule (default: "${defaultSchedule}" - every 6 hours): `);
    const cronSchedule = schedule || defaultSchedule;
    
    // Get Node.js path
    const nodePath = process.execPath;
    
    // Create the cron job command
    const cronCmd = `${cronSchedule} cd ${path.dirname(backupScriptPath)} && ${nodePath} ${backupScriptPath} >> ${path.resolve(__dirname, '../logs/backup.log')} 2>&1`;
    
    console.log(`\nCron job to be added:`);
    console.log(`${cronCmd}`);
    
    const confirm = await question('\nAdd this cron job? (y/n): ');
    
    if (confirm.toLowerCase() === 'y' || confirm.toLowerCase() === 'yes') {
      // Add the cron job
      try {
        // Get existing crontab
        const { stdout: existingCrontab } = await execAsync('crontab -l 2>/dev/null || echo ""');
        
        // Check if the job already exists
        if (existingCrontab.includes(backupScriptPath)) {
          console.log('\nA cron job for this backup script already exists. Updating it...');
          
          // Remove existing job
          const updatedCrontab = existingCrontab
            .split('\n')
            .filter(line => !line.includes(backupScriptPath))
            .join('\n');
          
          // Add new job
          const newCrontab = `${updatedCrontab}\n${cronCmd}\n`;
          
          // Write to temp file
          const tempFile = path.resolve(__dirname, '.temp_crontab');
          fs.writeFileSync(tempFile, newCrontab);
          
          // Install new crontab
          await execAsync(`crontab "${tempFile}"`);
          
          // Remove temp file
          fs.unlinkSync(tempFile);
        } else {
          // Add new job
          const newCrontab = `${existingCrontab}\n${cronCmd}\n`;
          
          // Write to temp file
          const tempFile = path.resolve(__dirname, '.temp_crontab');
          fs.writeFileSync(tempFile, newCrontab);
          
          // Install new crontab
          await execAsync(`crontab "${tempFile}"`);
          
          // Remove temp file
          fs.unlinkSync(tempFile);
        }
        
        console.log('\nCron job added successfully!');
        console.log(`The backup script will run according to the schedule: ${cronSchedule}`);
        
        // Create a test script to run the backup manually
        const testScriptPath = path.resolve(__dirname, 'run-backup-now.sh');
        const testScript = `#!/bin/bash\n\n# Run the backup script manually\ncd "${path.dirname(backupScriptPath)}"\n"${nodePath}" "${backupScriptPath}"\n`;
        
        fs.writeFileSync(testScriptPath, testScript);
        await execAsync(`chmod +x "${testScriptPath}"`);
        
        console.log(`\nA test script has been created at: ${testScriptPath}`);
        console.log('You can run this script to manually trigger a backup.');
      } catch (error) {
        console.error('Error setting up cron job:', error);
        console.log('\nAutomatic cron setup failed. Please add the cron job manually:');
        console.log('Run: crontab -e');
        console.log('And add this line:');
        console.log(cronCmd);
      }
    } else {
      console.log('\nCron job setup cancelled.');
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    rl.close();
  }
}

// Run the setup
setupCronJob(); 