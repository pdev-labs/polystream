/**
 * Multi-Tab Stream Enabler - Popup Script
 */

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const toggleMaster = document.getElementById('toggleMaster');
  const toggleVisibility = document.getElementById('toggleVisibility');
  const toggleBroadcast = document.getElementById('toggleBroadcast');
  const toggleStorage = document.getElementById('toggleStorage');
  const toggleLocks = document.getElementById('toggleLocks');
  const toggleAntiPause = document.getElementById('toggleAntiPause');

  const statusBadge = document.getElementById('statusBadge');
  const statusBadgeText = document.getElementById('statusBadgeText');
  const masterCard = document.getElementById('masterCard');
  const masterStatusDesc = document.getElementById('masterStatusDesc');

  const statBlockedPauses = document.getElementById('statBlockedPauses');
  const statVisibility = document.getElementById('statVisibility');
  const statSyncSignals = document.getElementById('statSyncSignals');

  const btnResumeVideos = document.getElementById('btnResumeVideos');
  const btnOpenTest = document.getElementById('btnOpenTest');
  const btnResetDefaults = document.getElementById('btnResetDefaults');

  let activeTabId = null;

  // Retrieve current active tab
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0]) {
        activeTabId = tabs[0].id;
        loadState();
      }
    });
  } else {
    loadState();
  }

  function updateUI(config, stats) {
    toggleMaster.checked = !!config.enabled;
    toggleVisibility.checked = !!config.visibilityLock;
    toggleBroadcast.checked = !!config.broadcastIsolation;
    toggleStorage.checked = !!config.storageIsolation;
    toggleLocks.checked = !!config.webLocksShim;
    toggleAntiPause.checked = !!config.antiPauseShield;

    if (config.enabled) {
      statusBadge.classList.remove('disabled');
      statusBadgeText.textContent = 'ACTIVE';
      masterCard.classList.remove('inactive');
      masterStatusDesc.textContent = 'Bypassing tab lockout & auto-pauses';
    } else {
      statusBadge.classList.add('disabled');
      statusBadgeText.textContent = 'OFF';
      masterCard.classList.add('inactive');
      masterStatusDesc.textContent = 'Protection paused for this tab';
    }

    if (stats) {
      statBlockedPauses.textContent = stats.blockedPauses || 0;
      statVisibility.textContent = stats.blockedVisibilityEvents || 0;
      const totalSync = (stats.isolatedChannels || 0) + (stats.blockedStorageEvents || 0) + (stats.bypassedLocks || 0);
      statSyncSignals.textContent = totalSync;
    }
  }

  function loadState() {
    if (typeof chrome === 'undefined' || !chrome.storage) return;

    // Load from storage first
    chrome.storage.sync.get(['mte_config'], (result) => {
      const config = result.mte_config || {
        enabled: true,
        visibilityLock: true,
        broadcastIsolation: true,
        storageIsolation: true,
        webLocksShim: true,
        antiPauseShield: true,
        debugLogging: false
      };

      // Also try to query active tab for live stats
      if (activeTabId && chrome.tabs.sendMessage) {
        chrome.tabs.sendMessage(activeTabId, { action: 'GET_STATE' }, (response) => {
          if (chrome.runtime.lastError) {
            // Tab might not have content script loaded yet
            updateUI(config, null);
            return;
          }
          if (response) {
            updateUI(response.config || config, response.stats);
          } else {
            updateUI(config, null);
          }
        });
      } else {
        updateUI(config, null);
      }
    });
  }

  function saveAndDispatch() {
    const config = {
      enabled: toggleMaster.checked,
      visibilityLock: toggleVisibility.checked,
      broadcastIsolation: toggleBroadcast.checked,
      storageIsolation: toggleStorage.checked,
      webLocksShim: toggleLocks.checked,
      antiPauseShield: toggleAntiPause.checked
    };

    // Save to sync storage
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.set({ mte_config: config });
    }

    // Send update to content script of current tab
    if (activeTabId && chrome.tabs && chrome.tabs.sendMessage) {
      chrome.tabs.sendMessage(activeTabId, {
        action: 'UPDATE_CONFIG',
        config: config
      }, () => {
        if (chrome.runtime.lastError) {}
      });
    }

    updateUI(config, null);
  }

  // Event Listeners for Toggles
  [toggleMaster, toggleVisibility, toggleBroadcast, toggleStorage, toggleLocks, toggleAntiPause].forEach((el) => {
    el.addEventListener('change', saveAndDispatch);
  });

  // Action: Force Play All Videos in Current Tab
  btnResumeVideos.addEventListener('click', () => {
    if (activeTabId && chrome.scripting && chrome.scripting.executeScript) {
      chrome.scripting.executeScript({
        target: { tabId: activeTabId, allFrames: true },
        func: () => {
          let count = 0;
          document.querySelectorAll('video, audio').forEach((media) => {
            if (media.paused) {
              media.play().catch(() => {});
              count++;
            }
          });
          return count;
        }
      }, (results) => {
        const originalText = btnResumeVideos.innerHTML;
        btnResumeVideos.textContent = '✓ Resumed Playing!';
        setTimeout(() => {
          btnResumeVideos.innerHTML = originalText;
        }, 1500);
      });
    }
  });

  // Action: Open Test Lab
  btnOpenTest.addEventListener('click', () => {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url: chrome.runtime.getURL('test/test-page.html') });
    } else {
      window.open('test/test-page.html', '_blank');
    }
  });

  // Action: Reset Defaults
  btnResetDefaults.addEventListener('click', () => {
    const defaultConfig = {
      enabled: true,
      visibilityLock: true,
      broadcastIsolation: true,
      storageIsolation: true,
      webLocksShim: true,
      antiPauseShield: true
    };
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.set({ mte_config: defaultConfig }, () => {
        loadState();
      });
    } else {
      updateUI(defaultConfig, null);
    }
  });

  // Auto-refresh stats every 1 second while popup is open
  setInterval(() => {
    if (activeTabId && typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.sendMessage) {
      chrome.tabs.sendMessage(activeTabId, { action: 'GET_STATE' }, (response) => {
        if (!chrome.runtime.lastError && response && response.stats) {
          statBlockedPauses.textContent = response.stats.blockedPauses || 0;
          statVisibility.textContent = response.stats.blockedVisibilityEvents || 0;
          const totalSync = (response.stats.isolatedChannels || 0) + (response.stats.blockedStorageEvents || 0) + (response.stats.bypassedLocks || 0);
          statSyncSignals.textContent = totalSync;
        }
      });
    }
  }, 1000);
});
