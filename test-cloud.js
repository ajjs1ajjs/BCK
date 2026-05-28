const { upload, download, list, checkTools, PROVIDERS } = require('./services/cloud');
const { runAsync } = require('./services/exec');

console.log('Testing cloud service functions...');

// Test that we can import the cloud service
console.log('Cloud service imports OK');
console.log('PROVIDERS:', Object.keys(PROVIDERS));

// Test if checkTools works for a provider
try {
  const result = checkTools('aws');
  console.log('checkTools for aws:', result);
} catch (error) {
  console.error('Error in checkTools:', error.message);
}

console.log('Cloud service test completed');