/**
 * Multi-Tab Stream Enabler - Content Script (ISOLATED World)
 * Acts as a bridge between Chrome extension storage/popup and the injected MAIN world script.
 */
(() => {
  // Inject script into MAIN world for Firefox compatibility
  try {
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('inject.js');
    s.onload = function() { this.remove(); };
    (document.head || document.documentElement).appendChild(s);
  } catch (e) {
    // If inline script injection is preferred
  }

  const DEFAULT_CONFIG = {
    enabled: true,
    visibilityLock: true,
    broadcastIsolation: true,
    storageIsolation: true,
    webLocksShim: true,
    antiPauseShield: true,
    debugLogging: false
  };

  let currentConfig = { ...DEFAULT_CONFIG };
  let currentStats = {
    blockedPauses: 0,
    blockedVisibilityEvents: 0,
    isolatedChannels: 0,
    blockedStorageEvents: 0,
    bypassedLocks: 0
  };

  // Load saved settings from Chrome storage
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get(['mte_config'], (result) => {
      if (result && result.mte_config) {
        currentConfig = { ...DEFAULT_CONFIG, ...result.mte_config };
      }
      sendConfigToInjected();
    });
  } else {
    sendConfigToInjected();
  }

  function sendConfigToInjected() {
    window.postMessage({
      source: 'MTE_CONTENT_CONFIG',
      config: currentConfig
    }, '*');
  }

  // Listen for messages from inject.js
  window.addEventListener('message', (event) => {
    // Only accept messages from the current window
    if (event.source !== window) return;

    if (event.data && event.data.source === 'MTE_INJECTED_READY') {
      sendConfigToInjected();
    } else if (event.data && event.data.source === 'MTE_INJECTED_STATS') {
      currentStats = { ...currentStats, ...event.data.stats };
      // Notify background service worker to update badge if needed
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          const totalBlocked = (currentStats.blockedPauses || 0) + (currentStats.blockedVisibilityEvents || 0) + (currentStats.blockedStorageEvents || 0);
          chrome.runtime.sendMessage({
            action: 'UPDATE_BADGE',
            count: totalBlocked
          }).catch(() => {});
        }
      } catch {}
    }
  });

  // Listen for messages from popup
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'GET_STATE') {
        sendResponse({
          config: currentConfig,
          stats: currentStats
        });
        return true;
      } else if (request.action === 'UPDATE_CONFIG') {
        currentConfig = { ...currentConfig, ...request.config };
        if (chrome.storage && chrome.storage.sync) {
          chrome.storage.sync.set({ mte_config: currentConfig });
        }
        sendConfigToInjected();
        sendResponse({ success: true, config: currentConfig });
        return true;
      }
    });
  }
})();
