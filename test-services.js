const { backup: dbBackup, restore: dbRestore } = require('./services/database');
const { backup: vmBackup, restore: vmRestore } = require('./services/vm');
const { backup: cloudBackup, restore: cloudRestore } = require('./services/cloud');
const { backup: hostBackup, restore: hostRestore } = require('./services/host');
const { backup: sshBackup, restore: sshRestore } = require('./services/ssh');

// Simple test to ensure all services are importable and have basic functions
console.log('Testing service imports...');

try {
  // Test database service
  console.log('Database service:', typeof dbBackup, typeof dbRestore);
  
  // Test VM service  
  console.log('VM service:', typeof vmBackup, typeof vmRestore);
  
  // Test cloud service
  console.log('Cloud service:', typeof cloudBackup, typeof cloudRestore);
  
  // Test host service
  console.log('Host service:', typeof hostBackup, typeof hostRestore);
  
  // Test SSH service
  console.log('SSH service:', typeof sshBackup, typeof sshRestore);
  
  console.log('All services loaded successfully!');
} catch (error) {
  console.error('Error loading services:', error);
  process.exit(1);
}