const fs = require('fs');
const path = require('path');

const directories = ['routes', 'services', 'middleware'];
const baseDir = path.resolve(__dirname);

function migrateFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let originalContent = content;

  // Change await db.all('...', args) to await db.all('...', args)
  content = content.replace(/db\.prepare\((.*?)\)\.all\((.*?)\)/g, (match, query, args) => {
    return `await db.all(${query}${args ? ', ' + args : ''})`;
  });

  // Change await db.get('...', args) to await db.get('...', args)
  content = content.replace(/db\.prepare\((.*?)\)\.get\((.*?)\)/g, (match, query, args) => {
    return `await db.get(${query}${args ? ', ' + args : ''})`;
  });

  // Change await db.run('...', args) to await db.run('...', args)
  content = content.replace(/db\.prepare\((.*?)\)\.run\((.*?)\)/g, (match, query, args) => {
    return `await db.run(${query}${args ? ', ' + args : ''})`;
  });
  
  // Make enclosing route handlers async
  // (req, res) => ...
  content = content.replace(/router\.(get|post|put|delete)\((.*?), (req|authorize|validate)(.*?) \=> \{/g, (match, method, path, arg1, rest) => {
    if (arg1 === 'authorize' || arg1 === 'validate') {
      // it's middleware, next arg is the function
      return match.replace(/, (async )?(req|res)/, ', async $2');
    }
    return match.replace('req', 'async req');
  });
  
  content = content.replace(/router\.(get|post|put|delete)\((.*?), (.*?),\s*(req|res)(.*?) \=> \{/g, 'router.$1($2, $3, async $4$5 => {');

  // Any function containing `await db.` needs to be `async`
  // We'll just run it and manually fix if needed, this regex is a best effort.

  if (content !== originalContent) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Migrated ${filePath}`);
  }
}

for (const dir of directories) {
  const dirPath = path.join(baseDir, dir);
  if (!fs.existsSync(dirPath)) continue;
  const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.js') && f !== 'db.js');
  for (const file of files) {
    migrateFile(path.join(dirPath, file));
  }
}
// Also migrate server.js
migrateFile(path.join(baseDir, 'server.js'));

console.log('Migration script complete.');
