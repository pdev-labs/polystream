/**
 * Multi-Tab Stream Enabler - Core Injection Engine
 * Runs at document_start in the MAIN world to override browser APIs
 * that websites use to detect background tabs or enforce single-stream playback.
 */
(() => {
  // Prevent duplicate injection in the same execution context
  if (window.__MULTI_TAB_ENABLER_LOADED__) return;
  window.__MULTI_TAB_ENABLER_LOADED__ = true;

  // Generate a unique identifier for this specific tab session
  const TAB_ID = (() => {
    try {
      let id = sessionStorage.getItem('__mte_tab_session_id__');
      if (!id) {
        id = 'tab_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now();
        sessionStorage.setItem('__mte_tab_session_id__', id);
      }
      return id;
    } catch {
      return 'tab_' + Math.random().toString(36).substring(2, 10);
    }
  })();

  // Default configuration (can be updated via postMessage from content script)
  const config = {
    enabled: true,
    visibilityLock: true,
    broadcastIsolation: true,
    storageIsolation: true,
    webLocksShim: true,
    antiPauseShield: true,
    debugLogging: false
  };

  // Telemetry stats
  const stats = {
    blockedPauses: 0,
    blockedVisibilityEvents: 0,
    isolatedChannels: 0,
    blockedStorageEvents: 0,
    bypassedLocks: 0
  };

  function log(...args) {
    if (config.debugLogging) {
      console.log('%c[Multi-Tab Enabler]', 'background: #6366f1; color: #fff; padding: 2px 6px; border-radius: 4px;', ...args);
    }
  }

  function reportStats() {
    window.postMessage({
      source: 'MTE_INJECTED_STATS',
      stats: { ...stats }
    }, '*');
  }

  // Track recent user gestures (clicks, keydown) to allow intentional pauses
  let lastUserInteractionTime = 0;
  let lastInteractedElement = null;

  function recordUserInteraction(event) {
    if (event.isTrusted) {
      lastUserInteractionTime = Date.now();
      lastInteractedElement = event.target;
    }
  }

  window.addEventListener('click', recordUserInteraction, { capture: true, passive: true });
  window.addEventListener('pointerdown', recordUserInteraction, { capture: true, passive: true });
  window.addEventListener('keydown', (event) => {
    // Space or 'k' or media keys are standard video toggle keys
    if (event.isTrusted && (event.code === 'Space' || event.code === 'KeyK' || event.code.startsWith('Media'))) {
      lastUserInteractionTime = Date.now();
    }
  }, { capture: true, passive: true });

  /* =========================================================================
   * 1. VISIBILITY & FOCUS SPOOFING
   * Prevents pages from detecting when the user switches tabs or blurs window
   * ========================================================================= */
  try {
    // Override document.hidden & document.visibilityState
    const originalHidden = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
    const originalVisibilityState = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');

    Object.defineProperty(Document.prototype, 'hidden', {
      get() {
        if (!config.enabled || !config.visibilityLock) {
          return originalHidden ? originalHidden.get.call(this) : false;
        }
        return false;
      },
      configurable: true
    });

    Object.defineProperty(Document.prototype, 'visibilityState', {
      get() {
        if (!config.enabled || !config.visibilityLock) {
          return originalVisibilityState ? originalVisibilityState.get.call(this) : 'visible';
        }
        return 'visible';
      },
      configurable: true
    });

    // Webkit prefixes
    if ('webkitHidden' in Document.prototype) {
      Object.defineProperty(Document.prototype, 'webkitHidden', {
        get() {
          return (!config.enabled || !config.visibilityLock) ? false : false;
        },
        configurable: true
      });
    }

    if ('webkitVisibilityState' in Document.prototype) {
      Object.defineProperty(Document.prototype, 'webkitVisibilityState', {
        get() {
          return (!config.enabled || !config.visibilityLock) ? 'visible' : 'visible';
        },
        configurable: true
      });
    }

    // Intercept document.hasFocus
    const originalHasFocus = Document.prototype.hasFocus;
    Document.prototype.hasFocus = function () {
      if (config.enabled && config.visibilityLock) {
        return true;
      }
      return originalHasFocus.apply(this, arguments);
    };

    // Override event listeners for visibilitychange, blur, focusout, pagehide
    const originalDocAddEventListener = Document.prototype.addEventListener;
    const originalWinAddEventListener = Window.prototype.addEventListener;

    const blockedEventNames = new Set(['visibilitychange', 'webkitvisibilitychange']);
    const windowBlockedEvents = new Set(['blur', 'focusout', 'pagehide']);

    Document.prototype.addEventListener = function (type, listener, options) {
      if (typeof type === 'string' && blockedEventNames.has(type.toLowerCase())) {
        const wrappedListener = function (event) {
          if (config.enabled && config.visibilityLock) {
            stats.blockedVisibilityEvents++;
            reportStats();
            log('Blocked document visibilitychange event dispatch');
            return;
          }
          return typeof listener === 'function' ? listener.apply(this, arguments) : listener.handleEvent(event);
        };
        return originalDocAddEventListener.call(this, type, wrappedListener, options);
      }
      return originalDocAddEventListener.apply(this, arguments);
    };

    Window.prototype.addEventListener = function (type, listener, options) {
      if (typeof type === 'string' && windowBlockedEvents.has(type.toLowerCase())) {
        const wrappedListener = function (event) {
          if (config.enabled && config.visibilityLock) {
            stats.blockedVisibilityEvents++;
            reportStats();
            log(`Blocked window ${type} event dispatch`);
            return;
          }
          return typeof listener === 'function' ? listener.apply(this, arguments) : listener.handleEvent(event);
        };
        return originalWinAddEventListener.call(this, type, wrappedListener, options);
      }
      return originalWinAddEventListener.apply(this, arguments);
    };

    // Protect onvisibilitychange, onblur properties
    try {
      Object.defineProperty(document, 'onvisibilitychange', {
        get() { return null; },
        set(handler) {
          if (typeof handler === 'function') {
            document.addEventListener('visibilitychange', handler);
          }
        },
        configurable: true
      });
    } catch {}

  } catch (e) {
    console.warn('[Multi-Tab Enabler] Visibility spoofing init error:', e);
  }

  /* =========================================================================
   * 2. BROADCASTCHANNEL ISOLATION
   * Prevents tabs from exchanging pause/play commands via BroadcastChannel
   * ========================================================================= */
  try {
    if (typeof window.BroadcastChannel !== 'undefined') {
      const OriginalBroadcastChannel = window.BroadcastChannel;

      window.BroadcastChannel = function (name) {
        if (!config.enabled || !config.broadcastIsolation) {
          return new OriginalBroadcastChannel(name);
        }

        stats.isolatedChannels++;
        reportStats();
        log(`Isolated BroadcastChannel: "${name}" for current tab`);

        // Prefix the channel name with the unique tab ID to isolate cross-tab messages
        // while preserving same-tab / iframe communication
        const isolatedName = `__mte_${TAB_ID}__${name}`;
        const channelInstance = new OriginalBroadcastChannel(isolatedName);

        // Also proxy postMessage and addEventListener to filter pause/playback sync payloads
        const originalPostMessage = channelInstance.postMessage.bind(channelInstance);
        channelInstance.postMessage = function (msg) {
          try {
            // If the message is a pause/stop command aimed at other tabs, log it
            const str = typeof msg === 'object' ? JSON.stringify(msg) : String(msg);
            if (/pause|stop|concurrent|active_tab|heartbeat/i.test(str)) {
              log(`BroadcastChannel "${name}" message intercepted:`, msg);
            }
          } catch {}
          return originalPostMessage(msg);
        };

        return channelInstance;
      };

      window.BroadcastChannel.prototype = OriginalBroadcastChannel.prototype;
    }
  } catch (e) {
    console.warn('[Multi-Tab Enabler] BroadcastChannel isolation error:', e);
  }

  /* =========================================================================
   * 3. STORAGE VIRTUALIZATION & EVENT FILTERING (PW & LMS Player Tab Sync)
   * Prevents other tabs from triggering pause through localStorage update events
   * or by reading overwritten active-tab keys.
   * ========================================================================= */
  try {
    const tabScopedStorage = new Map();
    const originalWinAddEventListenerForStorage = Window.prototype.addEventListener;
    const hasStorage = typeof Storage !== 'undefined';
    const originalSetItem = hasStorage ? Storage.prototype.setItem : null;
    const originalGetItem = hasStorage ? Storage.prototype.getItem : null;
    const originalRemoveItem = hasStorage ? Storage.prototype.removeItem : null;

    // Pattern for keys related to active playback tab, session sync, or video player state
    const PLAYER_STORAGE_REGEX = /player|video|media|play|pause|session|token|active|tab|penpencil|watch|stream|concurr/i;

    if (hasStorage) {
      Storage.prototype.setItem = function (key, value) {
        if (this === window.localStorage && config.enabled && config.storageIsolation) {
          if (typeof key === 'string' && PLAYER_STORAGE_REGEX.test(key)) {
            // Virtualize storage: keep tab-specific values isolated
            tabScopedStorage.set(key, String(value));
            // Save with tab-scoped key in real storage
            try {
              originalSetItem.call(this, `__mte_${TAB_ID}__${key}`, String(value));
            } catch {}
            stats.blockedStorageEvents++;
            reportStats();
            log(`Virtualized localStorage.setItem for key: "${key}"`);
            return;
          }
        }
        return originalSetItem.apply(this, arguments);
      };

      Storage.prototype.getItem = function (key) {
        if (this === window.localStorage && config.enabled && config.storageIsolation) {
          if (typeof key === 'string' && PLAYER_STORAGE_REGEX.test(key)) {
            if (tabScopedStorage.has(key)) {
              return tabScopedStorage.get(key);
            }
            try {
              const scopedVal = originalGetItem.call(this, `__mte_${TAB_ID}__${key}`);
              if (scopedVal !== null) return scopedVal;
            } catch {}
          }
        }
        return originalGetItem.apply(this, arguments);
      };

      Storage.prototype.removeItem = function (key) {
        if (this === window.localStorage && config.enabled && config.storageIsolation) {
          if (typeof key === 'string' && PLAYER_STORAGE_REGEX.test(key)) {
            tabScopedStorage.delete(key);
            try {
              originalRemoveItem.call(this, `__mte_${TAB_ID}__${key}`);
            } catch {}
            return;
          }
        }
        return originalRemoveItem.apply(this, arguments);
      };
    }

    Window.prototype.addEventListener = function (type, listener, options) {
      if (typeof type === 'string' && type.toLowerCase() === 'storage') {
        const wrappedListener = function (event) {
          if (config.enabled && config.storageIsolation) {
            const key = event.key || '';
            const val = event.newValue || '';
            if (!key || PLAYER_STORAGE_REGEX.test(key + val)) {
              stats.blockedStorageEvents++;
              reportStats();
              log(`Blocked cross-tab storage sync event on key: "${key}"`);
              return;
            }
          }
          return typeof listener === 'function' ? listener.apply(this, arguments) : listener.handleEvent(event);
        };
        return originalWinAddEventListenerForStorage.call(this, type, wrappedListener, options);
      }
      return originalWinAddEventListenerForStorage.apply(this, arguments);
    };

    // Override window.onstorage property
    try {
      let _onstorage = null;
      Object.defineProperty(window, 'onstorage', {
        get() { return _onstorage; },
        set(fn) {
          _onstorage = fn;
          if (typeof fn === 'function') {
            window.addEventListener('storage', fn);
          }
        },
        configurable: true
      });
    } catch {}

  } catch (e) {
    console.warn('[Multi-Tab Enabler] Storage event isolation error:', e);
  }

  /* =========================================================================
   * 3.5 POPUP & MODAL AUTO-KILLER ("Playback Interrupted" / "Streaming on another device")
   * Specifically neutralizes PW's "Playback Interrupted / streaming on another device" dialog
   * ========================================================================= */
  try {
    const INTERRUPT_PATTERNS = /playback\s*interrupted|already\s*streaming\s*on\s*another\s*device|refresh\s*to\s*watch\s*on\s*this\s*device|playback\s*will\s*stop\s*on\s*the\s*other\s*device|streaming\s*on\s*another\s*device|watching\s*on\s*another\s*(tab|device|window)|signed\s*in\s*with\s*another\s*tab|opened\s*in\s*another\s*tab|another\s*session/i;

    const killInterruptionModals = () => {
      if (!config.enabled) return;

      const candidates = document.querySelectorAll('div, section, aside, dialog, .modal, [role="dialog"], [role="alertdialog"], .popup');
      for (const el of candidates) {
        if (el.children.length > 25) continue;
        const text = (el.innerText || el.textContent || '').trim();
        if (INTERRUPT_PATTERNS.test(text)) {
          log('Detected "Playback Interrupted / Another Device" modal overlay. Annihilating...');
          stats.blockedPauses++;
          reportStats();

          // Find root modal container (not body or main content)
          let targetContainer = el;
          while (
            targetContainer.parentElement &&
            targetContainer.parentElement !== document.body &&
            targetContainer.parentElement !== document.documentElement &&
            targetContainer.parentElement.children.length <= 3 &&
            !targetContainer.parentElement.querySelector('video')
          ) {
            targetContainer = targetContainer.parentElement;
          }

          // Instantly hide and remove
          targetContainer.style.setProperty('display', 'none', 'important');
          targetContainer.style.setProperty('visibility', 'hidden', 'important');
          targetContainer.style.setProperty('opacity', '0', 'important');
          targetContainer.style.setProperty('pointer-events', 'none', 'important');
          try { targetContainer.remove(); } catch {}

          // Remove any dimmed backdrops or overlay blockers
          document.querySelectorAll('.modal-backdrop, [class*="backdrop"], [class*="overlay"], [class*="dimmer"]').forEach((bd) => {
            if (!bd.querySelector('video')) {
              bd.style.setProperty('display', 'none', 'important');
              try { bd.remove(); } catch {}
            }
          });

          // Unfreeze page scrolling & pointer events
          if (document.body) {
            document.body.style.setProperty('overflow', 'auto', 'important');
            document.body.style.setProperty('pointer-events', 'auto', 'important');
          }
          if (document.documentElement) {
            document.documentElement.style.setProperty('overflow', 'auto', 'important');
          }

          // Check if there is an affirmative continue button (DO NOT click Refresh / Reload!)
          const actionBtn = el.querySelector('button, a, [role="button"]');
          if (actionBtn) {
            const btnText = (actionBtn.textContent || '').trim().toLowerCase();
            if (!/refresh|reload|logout|sign out/.test(btnText) && /continue|resume|play|dismiss|close|okay|got it/.test(btnText)) {
              log('Clicking safe continue button:', btnText);
              actionBtn.click();
            }
          }

          // Force unpause video in case PW tried to pause it
          document.querySelectorAll('video').forEach((v) => {
            if (v.paused) v.play().catch(() => {});
          });
          break;
        }
      }
    };

    // Fast interval check
    setInterval(killInterruptionModals, 150);

    // Instant DOM MutationObserver hook to kill on arrival
    if (typeof MutationObserver !== 'undefined') {
      const modalObserver = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const text = (node.innerText || node.textContent || '');
              if (INTERRUPT_PATTERNS.test(text)) {
                killInterruptionModals();
                return;
              }
            }
          }
        }
      });

      const attachObserver = () => {
        const root = document.body || document.documentElement;
        if (root) {
          modalObserver.observe(root, { childList: true, subtree: true });
        }
      };

      if (document.body) {
        attachObserver();
      } else {
        document.addEventListener('DOMContentLoaded', attachObserver);
      }
    }
  } catch (e) {
    console.warn('[Multi-Tab Enabler] Modal auto-dismiss error:', e);
  }

  /* =========================================================================
   * 3.6 WEBSOCKET & HEARTBEAT INTERCEPTION (Server-Side Concurrency Shield)
   * Drops server-sent interruption messages before they trigger the UI dialog
   * ========================================================================= */
  try {
    if (typeof window.WebSocket !== 'undefined') {
      const OriginalWebSocket = window.WebSocket;

      window.WebSocket = function (url, protocols) {
        const ws = protocols !== undefined ? new OriginalWebSocket(url, protocols) : new OriginalWebSocket(url);

        const originalAddEventListener = ws.addEventListener.bind(ws);
        ws.addEventListener = function (type, listener, options) {
          if (type === 'message') {
            const wrappedListener = function (event) {
              try {
                const dataStr = typeof event.data === 'string' ? event.data : '';
                if (/playback\s*interrupted|streaming\s*on\s*another\s*device|already\s*streaming|concurrency|conflict|device_limit/i.test(dataStr)) {
                  stats.blockedPauses++;
                  reportStats();
                  log('Dropped incoming WebSocket server interruption event:', dataStr);
                  return; // Silently swallow interruption message!
                }
              } catch {}
              return typeof listener === 'function' ? listener.apply(this, arguments) : listener.handleEvent(event);
            };
            return originalAddEventListener(type, wrappedListener, options);
          }
          return originalAddEventListener(type, listener, options);
        };

        // Protect onmessage property
        let _onmessage = null;
        Object.defineProperty(ws, 'onmessage', {
          get() { return _onmessage; },
          set(handler) {
            if (typeof handler === 'function') {
              _onmessage = function (event) {
                try {
                  const dataStr = typeof event.data === 'string' ? event.data : '';
                  if (/playback\s*interrupted|streaming\s*on\s*another\s*device|already\s*streaming|concurrency|conflict|device_limit/i.test(dataStr)) {
                    stats.blockedPauses++;
                    reportStats();
                    log('Dropped onmessage server interruption event:', dataStr);
                    return;
                  }
                } catch {}
                return handler.apply(this, arguments);
              };
              ws.addEventListener('message', _onmessage);
            } else {
              _onmessage = null;
            }
          },
          configurable: true
        });

        return ws;
      };

      window.WebSocket.prototype = OriginalWebSocket.prototype;
    }
  } catch (e) {
    console.warn('[Multi-Tab Enabler] WebSocket interception error:', e);
  }

  /* =========================================================================
   * 4. WEB LOCKS API SHIM (navigator.locks)
   * Allows all tabs to acquire locks concurrently without waiting or throwing
   * ========================================================================= */
  try {
    if (navigator.locks && typeof navigator.locks.request === 'function') {
      const originalLocksRequest = navigator.locks.request.bind(navigator.locks);

      navigator.locks.request = function (name, ...args) {
        if (!config.enabled || !config.webLocksShim) {
          return originalLocksRequest(name, ...args);
        }

        // Scope the lock name to the tab ID so it is non-blocking across tabs
        const scopedName = `__mte_${TAB_ID}__${name}`;
        stats.bypassedLocks++;
        reportStats();
        log(`Scoped Web Lock "${name}" -> "${scopedName}"`);
        return originalLocksRequest(scopedName, ...args);
      };
    }
  } catch (e) {
    console.warn('[Multi-Tab Enabler] Web Locks shim error:', e);
  }

  /* =========================================================================
   * 5. ANTI-PAUSE SHIELD (HTMLMediaElement.prototype.pause)
   * Prevents programmatic/background pauses while allowing genuine user pauses
   * ========================================================================= */
  try {
    const originalPause = HTMLMediaElement.prototype.pause;
    const originalPlay = HTMLMediaElement.prototype.play;

    HTMLMediaElement.prototype.pause = function () {
      if (!config.enabled || !config.antiPauseShield) {
        return originalPause.apply(this, arguments);
      }

      const now = Date.now();
      const timeSinceUserGesture = now - lastUserInteractionTime;

      // Allow pause if:
      // 1. User interacted within the last 400ms (clicked pause button, pressed space, etc.)
      // 2. Video has naturally reached the end
      // 3. User clicked directly on this video or its controls/wrapper
      const isNaturalEnded = this.ended || (this.duration && Math.abs(this.currentTime - this.duration) < 0.5);
      const isDirectUserAction = timeSinceUserGesture < 450 || (
        lastInteractedElement && (
          lastInteractedElement === this ||
          this.contains(lastInteractedElement) ||
          (lastInteractedElement.closest && (lastInteractedElement.closest('video, audio, .video-player, .player-container, button') !== null))
        ) && timeSinceUserGesture < 800
      );

      // Check navigator userActivation API if available
      const isUserActive = (navigator.userActivation && navigator.userActivation.isActive);

      if (isNaturalEnded || isDirectUserAction || isUserActive) {
        log('Legitimate user pause allowed.');
        return originalPause.apply(this, arguments);
      }

      // If pause is invoked programmatically while tab is hidden or backgrounded, block it!
      stats.blockedPauses++;
      reportStats();
      log('Shielded against programmatic/background pause call on media element:', this);

      // Return a resolved Promise for consistency with async pause patterns
      return Promise.resolve();
    };

    // Auto-resume safeguard: if an external script forcefully paused the video anyway,
    // listen for the pause event and verify if it should have stayed playing
    const registerMediaGuards = (media) => {
      if (media.__mte_guarded__) return;
      media.__mte_guarded__ = true;

      media.addEventListener('pause', (e) => {
        if (!config.enabled || !config.antiPauseShield) return;

        const now = Date.now();
        const timeSinceUserGesture = now - lastUserInteractionTime;
        const isNaturalEnded = media.ended || (media.duration && Math.abs(media.currentTime - media.duration) < 0.5);

        if (!isNaturalEnded && timeSinceUserGesture > 600 && !document.hasFocus()) {
          log('Video was paused in background tab without user gesture! Auto-resuming...');
          stats.blockedPauses++;
          reportStats();
          setTimeout(() => {
            if (media.paused && !media.ended) {
              originalPlay.call(media).catch(() => {});
            }
          }, 50);
        }
      }, { capture: true });
    };

    // Observe existing and newly added media elements
    document.querySelectorAll('video, audio').forEach(registerMediaGuards);

    if (typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.tagName === 'VIDEO' || node.tagName === 'AUDIO') {
                registerMediaGuards(node);
              } else if (node.querySelectorAll) {
                node.querySelectorAll('video, audio').forEach(registerMediaGuards);
              }
            }
          }
        }
      });

      if (document.documentElement) {
        observer.observe(document.documentElement, { childList: true, subtree: true });
      } else {
        document.addEventListener('DOMContentLoaded', () => {
          if (document.documentElement) {
            observer.observe(document.documentElement, { childList: true, subtree: true });
          }
        });
      }
    }

  } catch (e) {
    console.warn('[Multi-Tab Enabler] Anti-pause shield error:', e);
  }

  /* =========================================================================
   * 6. CONFIGURATION & COMMUNICATION BRIDGE
   * Listen for updates from popup / content script
   * ========================================================================= */
  window.addEventListener('message', (event) => {
    if (event.data && event.data.source === 'MTE_CONTENT_CONFIG') {
      Object.assign(config, event.data.config);
      log('Updated configuration:', config);
      reportStats();
    } else if (event.data && event.data.source === 'MTE_REQUEST_STATS') {
      reportStats();
    }
  });

  // Signal ready to content script
  window.postMessage({ source: 'MTE_INJECTED_READY' }, '*');
  log('Multi-Tab Stream Enabler injected and active for tab:', TAB_ID);
})();
