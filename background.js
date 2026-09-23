/**
 * Multi-Tab Stream Enabler - Background Service Worker
 */

chrome.runtime.onInstalled.addListener(() => {
  // Initialize default configuration in chrome.storage
  chrome.storage.sync.get(['mte_config'], (result) => {
    if (!result.mte_config) {
      chrome.storage.sync.set({
        mte_config: {
          enabled: true,
          visibilityLock: true,
          broadcastIsolation: true,
          storageIsolation: true,
          webLocksShim: true,
          antiPauseShield: true,
          debugLogging: false
        }
      });
    }
  });

  // Set default badge appearance
  chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });
});

// Handle incoming messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'UPDATE_BADGE' && sender.tab && sender.tab.id) {
    const count = message.count || 0;
    const text = count > 0 ? (count > 99 ? '99+' : String(count)) : '';
    chrome.action.setBadgeText({
      tabId: sender.tab.id,
      text: text
    });
    chrome.action.setBadgeBackgroundColor({
      tabId: sender.tab.id,
      color: '#6366f1'
    });
    sendResponse({ success: true });
    return true;
  }
});
