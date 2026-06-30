const API = 'http://localhost:8080/api/v1';

async function init() {
  try {
    const res = await fetch(`${API}/stats`);
    const stats = await res.json();
    document.getElementById('jobsVal').textContent = stats.total_jobs || 0;
    document.getElementById('reposVal').textContent = stats.total_repositories || 0;
    document.getElementById('snapVal').textContent = stats.total_snapshots || 0;
    document.getElementById('storeVal').textContent = formatBytes(stats.total_storage_bytes || 0);
    document.getElementById('statusDot').classList.add('online');
    document.getElementById('statusText').textContent = 'Online';
  } catch {
    document.getElementById('statusDot').classList.add('offline');
    document.getElementById('statusText').textContent = 'Offline';
  }
}

function formatBytes(b) {
  if (!b) return '0 B';
  return (b / 1024 / 1024).toFixed(1) + ' MB';
}

document.getElementById('runBackup').onclick = () => chrome.tabs.create({ url: 'http://localhost:3000/jobs' });
document.getElementById('bookmarkBackup').onclick = () => chrome.runtime.sendMessage({ action: 'backupBookmarks' });
document.getElementById('openDashboard').onclick = () => chrome.tabs.create({ url: 'http://localhost:3000' });

init();
