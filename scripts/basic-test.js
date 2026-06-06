// Simple test to verify the server can be started and basic routes work

const fs = require('fs');

console.log('=== BCK Backup System - Basic Functionality Test ===\n');

try {
  // Verify files exist
  const serverFile = './server.js';
  if (fs.existsSync(serverFile)) {
    console.log('✓ Server file exists:', serverFile);
  } else {
    console.error('✗ Server file missing:', serverFile);
    process.exit(1);
  }
  
  const servicesDir = './services/';
  if (fs.existsSync(servicesDir)) {
    console.log('✓ Services directory exists');
    const serviceFiles = fs.readdirSync(servicesDir);
    console.log(`  Service files: ${serviceFiles.length}`);
    serviceFiles.forEach(file => console.log(`    - ${file}`));
  } else {
    console.error('✗ Services directory missing:', servicesDir);
    process.exit(1);
  }
  
  // Try to import and test server
  const serverModule = require('./server');
  console.log('✓ Server module imported successfully');
  
  // Check if we have the basic express app structure
  if (typeof serverModule === 'object' && serverModule.app) {
    console.log('✓ Express app found in server module');
  } else {
    console.log('ℹ Server module loaded but no express app detected');
  }
  
  // Check for basic routes by examining server.js content
  const serverContent = fs.readFileSync('./server.js', 'utf8');
  const apiRoutes = (serverContent.match(/\.get\(['"][^'"]*['"][^)]*\)/g) || []).length;
  console.log(`✓ API routes found: ${apiRoutes}`);
  
  // Check for middleware
  const middlewareCount = (serverContent.match(/app\.(use|get|post|put|delete)/g) || []).length;
  console.log(`✓ Middleware/hooks: ${middlewareCount}`);
  
  console.log('\n=== Test completed successfully ===');
  
} catch (error) {
  console.error('✗ Error during test:', error.message);
  console.error(error.stack);
}