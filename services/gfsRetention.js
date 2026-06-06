const { db } = require('./db');
const logger = require('./logger');
const fsSync = require('fs');
const fs = require('fs').promises;

function getISOWeekNumber(d) {
  const date = new Date(d.getTime());
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

async function runGfsRetention() {
  logger.info('Starting GFS Retention pruning...');
  try {
    // 1. Get all unique job names that have a policy
    const jobs = await db.all(`
      SELECT DISTINCT b.name, b."policyId", p."keepDaily", p."keepWeekly", p."keepMonthly", p."keepYearly"
      FROM backups b
      JOIN policies p ON b."policyId" = p.id
      WHERE b.status = 'completed'
    `);

    for (const job of jobs) {
      // Get all completed backups for this job name, oldest to newest
      const backups = await db.all(
        'SELECT * FROM backups WHERE name = ? AND status = ? ORDER BY "completedAt" ASC',
        job.name, 'completed'
      );

      if (backups.length === 0) continue;

      const keep = new Set(); // store backup IDs to keep

      // Group backups by year, month, week, day
      const byYear = {};
      const byMonth = {};
      const byWeek = {};
      const byDay = {};

      for (const b of backups) {
        if (!b.completedAt) continue;
        const d = new Date(b.completedAt);
        const year = d.getFullYear();
        const month = `${year}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const week = `${year}-W${String(getISOWeekNumber(d)).padStart(2, '0')}`;
        const day = `${year}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

        if (!byYear[year]) byYear[year] = [];
        byYear[year].push(b);

        if (!byMonth[month]) byMonth[month] = [];
        byMonth[month].push(b);

        if (!byWeek[week]) byWeek[week] = [];
        byWeek[week].push(b);

        if (!byDay[day]) byDay[day] = [];
        byDay[day].push(b);
      }

      // Helper: get the last 'N' keys from a sorted array of keys
      const getLastN = (obj, n) => {
        const keys = Object.keys(obj).sort();
        return keys.slice(Math.max(keys.length - n, 0));
      };

      // 1. Keep Daily (latest backup of each of the last N days)
      const dailyKeys = getLastN(byDay, job.keepDaily);
      for (const k of dailyKeys) {
        const dayBackups = byDay[k];
        keep.add(dayBackups[dayBackups.length - 1].id); // keep latest of the day
      }

      // 2. Keep Weekly (latest backup of each of the last N weeks)
      const weeklyKeys = getLastN(byWeek, job.keepWeekly);
      for (const k of weeklyKeys) {
        const weekBackups = byWeek[k];
        keep.add(weekBackups[weekBackups.length - 1].id);
      }

      // 3. Keep Monthly (latest backup of each of the last N months)
      const monthlyKeys = getLastN(byMonth, job.keepMonthly);
      for (const k of monthlyKeys) {
        const monthBackups = byMonth[k];
        keep.add(monthBackups[monthBackups.length - 1].id);
      }

      // 4. Keep Yearly (latest backup of each of the last N years)
      const yearlyKeys = getLastN(byYear, job.keepYearly);
      for (const k of yearlyKeys) {
        const yearBackups = byYear[k];
        keep.add(yearBackups[yearBackups.length - 1].id);
      }

      // Find backups to delete
      const toDelete = backups.filter(b => !keep.has(b.id));

      if (toDelete.length > 0) {
        logger.info(`GFS Pruning: Deleting ${toDelete.length} old backups for job "${job.name}"...`);
      }

      for (const b of toDelete) {
        // Delete physical file
        if (b.resultFile) {
           try {
             if (fsSync.existsSync(b.resultFile)) {
                const stat = await fs.stat(b.resultFile);
                if (stat.isDirectory() && (b.backupType === 'restic' || b.type === 'restic')) {
                  // Restic handles its own forget/prune, we might just skip deleting restic here
                  // or run restic forget. For simplicity, we skip physical deletion for restic repo dirs 
                  // to avoid destroying the whole repo.
                  logger.info(`GFS Pruning: Skipping physical deletion for Restic repo ${b.resultFile}`);
                } else {
                  await fs.unlink(b.resultFile);
                }
             }
           } catch (err) {
             logger.error(`GFS Pruning: Failed to delete file ${b.resultFile} - ${err.message}`);
           }
        }
        
        // Delete DB record
        await db.run('DELETE FROM backups WHERE id = ?', b.id);
      }
    }
  } catch (err) {
    logger.error('Error during GFS Retention pruning: ' + err.message);
  }
}

module.exports = { runGfsRetention };
