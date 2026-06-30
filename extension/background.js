// BCK Background Service Worker
const API_URL = 'http://localhost:8050/api/v1';
let accessToken = '';

// Periodically check backup status
chrome.alarms.create('healthCheck', { periodInMinutes: 5 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'healthCheck') {
    await checkHealth();
  }
});

async function checkHealth() {
  try {
    const res = await fetch(`${API_URL}/health`);
    const data = await res.json();
    
    chrome.action.setBadgeText({ text: '✓' });
    chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });

    const stored = await chrome.storage.local.get('notifyOnFailure');
    if (stored.notifyOnFailure && data.status !== 'ok') {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'BCK Alert',
        message: 'Backup system health check failed!'
      });
    }
  } catch {
    chrome.action.setBadgeText({ text: '✗' });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
  }
}

// Backup bookmarks
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'backupBookmarks') {
    chrome.bookmarks.getTree(async (tree) => {
      const bookmarks = JSON.stringify(tree);
      try {
        const res = await fetch(`${API_URL}/backup/bookmarks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookmarks, timestamp: new Date().toISOString() })
        });
        sendResponse({ success: res.ok });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    });
    return true;
  }
});

// Quick backup from context menu
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'backupNow',
    title: 'Trigger Backup',
    contexts: ['action']
  });
  chrome.contextMenus.create({
    id: 'backupBookmarksItem',
    title: 'Backup Bookmarks',
    contexts: ['action']
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'backupBookmarksItem') {
    chrome.runtime.sendMessage({ action: 'backupBookmarks' });
  }
});
