const { db, initSchema } = require('./services/db');
const { runGfsRetention } = require('./services/gfsRetention');
const { v4: uuidv4 } = require('uuid');

async function test() {
  await initSchema();

  // Create a test policy
  const policyId = 'test-policy-1';
  await db.run('INSERT OR IGNORE INTO policies (id, name, "keepDaily", "keepWeekly", "keepMonthly", "keepYearly", "createdAt") VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [policyId, 'Test Policy', 3, 2, 2, 1, new Date().toISOString()]);

  // Generate mock backups spanning the last 100 days
  const jobName = 'Test-GFS-Job';
  
  // Clear old ones
  await db.run('DELETE FROM backups WHERE name = $1', [jobName]);

  const now = new Date();
  for (let i = 0; i < 100; i++) {
    const d = new Date(now.getTime() - i * 86400000);
    await db.run(
      'INSERT INTO backups (id, name, status, "policyId", "completedAt", "createdAt") VALUES ($1, $2, $3, $4, $5, $6)',
      [uuidv4(), jobName, 'completed', policyId, d.toISOString(), d.toISOString()]
    );
  }

  const countBefore = (await db.get('SELECT COUNT(*) as c FROM backups WHERE name = $1', [jobName])).c;
  console.log(`Before GFS: ${countBefore} backups`);

  await runGfsRetention();

  const countAfter = (await db.get('SELECT COUNT(*) as c FROM backups WHERE name = $1', [jobName])).c;
  console.log(`After GFS: ${countAfter} backups remaining`);

  console.log('Test successful');
  process.exit(0);
}

test().catch(console.error);
