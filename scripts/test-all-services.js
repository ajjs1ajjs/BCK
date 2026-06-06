const fs = require('fs');
const path = require('path');

// Test to verify all services are working and have proper exports
console.log('=== Testing BCK Backup System Services ===\n');

// Test database service
try {
  const dbService = require('./services/database');
  console.log('✓ Database service loaded successfully');
  
  // Check if it has expected functions
  const dbFunctions = Object.keys(dbService).filter(key => 
    ['backup', 'restore', 'checkTools'].includes(key)
  );
  console.log(`  Functions found: ${dbFunctions.length > 0 ? dbFunctions.join(', ') : 'none'}`);
  
} catch (error) {
  console.error('✗ Database service error:', error.message);
}

// Test VM service
try {
  const vmService = require('./services/vm');
  console.log('✓ VM service loaded successfully');
  
  // Check if it has expected functions
  const vmFunctions = Object.keys(vmService).filter(key => 
    ['backup', 'restore', 'checkTools'].includes(key)
  );
  console.log(`  Functions found: ${vmFunctions.length > 0 ? vmFunctions.join(', ') : 'none'}`);
  
} catch (error) {
  console.error('✗ VM service error:', error.message);
}

// Test SSH service
try {
  const sshService = require('./services/ssh');
  console.log('✓ SSH service loaded successfully');
  
  // Check if it has expected functions
  const sshFunctions = Object.keys(sshService).filter(key => 
    ['backup', 'restore', 'checkTools'].includes(key)
  );
  console.log(`  Functions found: ${sshFunctions.length > 0 ? sshFunctions.join(', ') : 'none'}`);
  
} catch (error) {
  console.error('✗ SSH service error:', error.message);
}

// Test Host service
try {
  const hostService = require('./services/host');
  console.log('✓ Host service loaded successfully');
  
  // Check if it has expected functions
  const hostFunctions = Object.keys(hostService).filter(key => 
    ['backup', 'restore', 'checkTools'].includes(key)
  );
  console.log(`  Functions found: ${hostFunctions.length > 0 ? hostFunctions.join(', ') : 'none'}`);
  
} catch (error) {
  console.error('✗ Host service error:', error.message);
}

// Test cloud service
try {
  const cloudService = require('./services/cloud');
  console.log('✓ Cloud service loaded successfully');
  
  // Check if it has expected functions
  const cloudFunctions = Object.keys(cloudService).filter(key => 
    ['upload', 'download', 'list', 'checkTools'].includes(key)
  );
  console.log(`  Functions found: ${cloudFunctions.length > 0 ? cloudFunctions.join(', ') : 'none'}`);
  
} catch (error) {
  console.error('✗ Cloud service error:', error.message);
}

console.log('\n=== Testing Exec service ===');
try {
  const execService = require('./services/exec');
  console.log('✓ Exec service loaded successfully');
  
  // Check if it has expected functions
  const execFunctions = Object.keys(execService).filter(key => 
    ['run', 'runAsync', 'checkTool'].includes(key)
  );
  console.log(`  Functions found: ${execFunctions.length > 0 ? execFunctions.join(', ') : 'none'}`);
  
} catch (error) {
  console.error('✗ Exec service error:', error.message);
}

console.log('\n=== All service tests completed ===');