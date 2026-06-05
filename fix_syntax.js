const fs = require('fs');
const path = require('path');

const dirs = ['routes', 'services', 'middleware', '.'];

function fixFile(fp) {
  if (!fp.endsWith('.js') || fp === 'fix_syntax.js' || fp === 'transform.js' || fp === 'migrate_to_pg.js') return;
  let content = fs.readFileSync(fp, 'utf8');
  let original = content;
  
  // Fix signature errors
  content = content.replace(/async\s*\(req,\s*async\s*res/g, 'async (req, res');
  content = content.replace(/async\s*\(err,\s*async\s*req/g, 'async (err, req');
  
  // Fix double awaits
  content = content.replace(/await\s+await\s+/g, 'await ');
  
  // Fix missed db.prepare with multiline support
  content = content.replace(/await\s+db\.prepare\(([\s\S]*?)\)\.run\(([\s\S]*?)\)/g, 'await db.run($1, $2)');
  content = content.replace(/await\s+db\.prepare\(([\s\S]*?)\)\.get\(([\s\S]*?)\)/g, 'await db.get($1, $2)');
  content = content.replace(/await\s+db\.prepare\(([\s\S]*?)\)\.all\(([\s\S]*?)\)/g, 'await db.all($1, $2)');
  content = content.replace(/await\s+db\.prepare\(([\s\S]*?)\)\.run\(\)/g, 'await db.run($1)');
  content = content.replace(/await\s+db\.prepare\(([\s\S]*?)\)\.get\(\)/g, 'await db.get($1)');
  content = content.replace(/await\s+db\.prepare\(([\s\S]*?)\)\.all\(\)/g, 'await db.all($1)');

  content = content.replace(/db\.prepare\(([\s\S]*?)\)\.run\(([\s\S]*?)\)/g, 'await db.run($1, $2)');
  content = content.replace(/db\.prepare\(([\s\S]*?)\)\.get\(([\s\S]*?)\)/g, 'await db.get($1, $2)');
  content = content.replace(/db\.prepare\(([\s\S]*?)\)\.all\(([\s\S]*?)\)/g, 'await db.all($1, $2)');
  content = content.replace(/db\.prepare\(([\s\S]*?)\)\.run\(\)/g, 'await db.run($1)');
  content = content.replace(/db\.prepare\(([\s\S]*?)\)\.get\(\)/g, 'await db.get($1)');
  content = content.replace(/db\.prepare\(([\s\S]*?)\)\.all\(\)/g, 'await db.all($1)');

  if (content !== original) {
    fs.writeFileSync(fp, content);
    console.log('Fixed', fp);
  }
}

dirs.forEach(d => {
  if (!fs.existsSync(d)) return;
  const stat = fs.statSync(d);
  if (stat.isDirectory()) {
    fs.readdirSync(d).filter(f => f.endsWith('.js')).forEach(f => {
      fixFile(path.join(d, f));
    });
  }
});
