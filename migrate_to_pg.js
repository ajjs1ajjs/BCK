const fs = require('fs');
const path = require('path');

const directories = ['routes', 'services', 'middleware'];
const baseDir = path.resolve(__dirname);

function migrateFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let originalContent = content;

  // Pattern: await db.run(...).get(...) or await db.all(..., ...) or db.prepare(..., ...)
  // We want to replace it with: await db.get(..., ...)
  // Note: this regex is simplistic and may need careful tuning.
  
  // 1. Replace db.prepare(...).xxx(...) with await db.prepare(...).xxx(...)
  // Only if there is no 'await ' before it.
  content = content.replace(/(?<!await\s+)(db\.prepare\([^)]+\)\.(?:get|all|run)\([^)]*\))/g, 'await $1');
  
  // Also replace cases where arguments might span multiple lines or be chained differently
  // e.g. .run(user)
  // Let's use a more robust regex for .run(...), .get(...), .all(...)
  content = content.replace(/(?<!await\s+)(db\.prepare\([\s\S]*?\)\.(?:get|all|run)\([\s\S]*?\))/g, 'await $1');

  // Some db.prepare calls might not have arguments in the action e.g. .all()
  
  // Update transaction: db.transaction(() => { ... })()
  // This needs manual intervention or we can change it to await db.transaction(async () => { ... })()
  content = content.replace(/db\.transaction\(\(\)\s*=>\s*\{/g, 'db.transaction(async () => {');

  // Any function containing `await` needs to be `async` if it isn't already.
  // This is hard to do perfectly with Regex. I'll just write the basic replacement and then manually fix syntax errors.

  if (content !== originalContent) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Migrated ${filePath}`);
  }
}

for (const dir of directories) {
  const dirPath = path.join(baseDir, dir);
  if (!fs.existsSync(dirPath)) continue;
  const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.js'));
  for (const file of files) {
    migrateFile(path.join(dirPath, file));
  }
}
// Also migrate server.js
migrateFile(path.join(baseDir, 'server.js'));

console.log('Migration script complete.');
