// ==UserScript==
// @name         PolyStream - Multi-Tab Video Stream Enabler
// @namespace    https://github.com/pdev-labs/polystream
// @version      1.0.0
// @description  Stream multiple videos simultaneously across tabs without auto-pausing or single-tab lockouts on PhysicsWallah, LMS, and streaming sites.
// @author       pdev-labs
// @match        *://*/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // Prevent multiple injections in the same window context
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

  const config = {
    enabled: true,
    visibilityLock: true,
    broadcastIsolation: true,
    storageIsolation: true,
    webLocksShim: true,
    antiPauseShield: true,
    debugLogging: false
  };

  const stats = {
    blockedPauses: 0,
    blockedVisibilityEvents: 0,
    isolatedChannels: 0,
    blockedStorageEvents: 0,
    bypassedLocks: 0
  };

  function log(...args) {
    if (config.debugLogging) {
      console.log('%c[Multi-Tab Enabler (Userscript)]', 'background: #6366f1; color: #fff; padding: 2px 6px; border-radius: 4px;', ...args);
    }
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
    if (event.isTrusted && (event.code === 'Space' || event.code === 'KeyK' || event.code.startsWith('Media'))) {
      lastUserInteractionTime = Date.now();
    }
  }, { capture: true, passive: true });

  /* =========================================================================
   * 1. VISIBILITY & FOCUS SPOOFING
   * ========================================================================= */
  try {
    const originalHidden = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
    const originalVisibilityState = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');

    Object.defineProperty(Document.prototype, 'hidden', {
      get() {
        return (!config.enabled || !config.visibilityLock) ? (originalHidden ? originalHidden.get.call(this) : false) : false;
      },
      configurable: true
    });

    Object.defineProperty(Document.prototype, 'visibilityState', {
      get() {
        return (!config.enabled || !config.visibilityLock) ? (originalVisibilityState ? originalVisibilityState.get.call(this) : 'visible') : 'visible';
      },
      configurable: true
    });

    if ('webkitHidden' in Document.prototype) {
      Object.defineProperty(Document.prototype, 'webkitHidden', {
        get() { return (!config.enabled || !config.visibilityLock) ? false : false; },
        configurable: true
      });
    }

    if ('webkitVisibilityState' in Document.prototype) {
      Object.defineProperty(Document.prototype, 'webkitVisibilityState', {
        get() { return (!config.enabled || !config.visibilityLock) ? 'visible' : 'visible'; },
        configurable: true
      });
    }

    const originalHasFocus = Document.prototype.hasFocus;
    Document.prototype.hasFocus = function () {
      if (config.enabled && config.visibilityLock) return true;
      return originalHasFocus.apply(this, arguments);
    };

    const originalDocAddEventListener = Document.prototype.addEventListener;
    const originalWinAddEventListener = Window.prototype.addEventListener;

    const blockedDocEvents = new Set(['visibilitychange', 'webkitvisibilitychange']);
    const blockedWinEvents = new Set(['blur', 'focusout', 'pagehide']);

    Document.prototype.addEventListener = function (type, listener, options) {
      if (typeof type === 'string' && blockedDocEvents.has(type.toLowerCase())) {
        const wrappedListener = function (event) {
          if (config.enabled && config.visibilityLock) {
            stats.blockedVisibilityEvents++;
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
      if (typeof type === 'string' && blockedWinEvents.has(type.toLowerCase())) {
        const wrappedListener = function (event) {
          if (config.enabled && config.visibilityLock) {
            stats.blockedVisibilityEvents++;
            log(`Blocked window ${type} event dispatch`);
            return;
          }
          return typeof listener === 'function' ? listener.apply(this, arguments) : listener.handleEvent(event);
        };
        return originalWinAddEventListener.call(this, type, wrappedListener, options);
      }
      return originalWinAddEventListener.apply(this, arguments);
    };

    try {
      Object.defineProperty(document, 'onvisibilitychange', {
        get() { return null; },
        set(handler) {
          if (typeof handler === 'function') document.addEventListener('visibilitychange', handler);
        },
        configurable: true
      });
    } catch {}

  } catch (e) {
    console.warn('[Multi-Tab Enabler] Visibility spoofing init error:', e);
  }

  /* =========================================================================
   * 2. BROADCASTCHANNEL ISOLATION
   * ========================================================================= */
  try {
    if (typeof window.BroadcastChannel !== 'undefined') {
      const OriginalBroadcastChannel = window.BroadcastChannel;

      window.BroadcastChannel = function (name) {
        if (!config.enabled || !config.broadcastIsolation) {
          return new OriginalBroadcastChannel(name);
        }

        stats.isolatedChannels++;
        const isolatedName = `__mte_${TAB_ID}__${name}`;
        const channelInstance = new OriginalBroadcastChannel(isolatedName);

        const originalPostMessage = channelInstance.postMessage.bind(channelInstance);
        channelInstance.postMessage = function (msg) {
          try {
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
   * ========================================================================= */
  try {
    const tabScopedStorage = new Map();
    const originalWinAddEventListenerForStorage = Window.prototype.addEventListener;
    const hasStorage = typeof Storage !== 'undefined';
    const originalSetItem = hasStorage ? Storage.prototype.setItem : null;
    const originalGetItem = hasStorage ? Storage.prototype.getItem : null;
    const originalRemoveItem = hasStorage ? Storage.prototype.removeItem : null;

    const PLAYER_STORAGE_REGEX = /player|video|media|play|pause|session|token|active|tab|penpencil|watch|stream|concurr/i;

    if (hasStorage) {
      Storage.prototype.setItem = function (key, value) {
        if (this === window.localStorage && config.enabled && config.storageIsolation) {
          if (typeof key === 'string' && PLAYER_STORAGE_REGEX.test(key)) {
            tabScopedStorage.set(key, String(value));
            try {
              originalSetItem.call(this, `__mte_${TAB_ID}__${key}`, String(value));
            } catch {}
            stats.blockedStorageEvents++;
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

    try {
      let _onstorage = null;
      Object.defineProperty(window, 'onstorage', {
        get() { return _onstorage; },
        set(fn) {
          _onstorage = fn;
          if (typeof fn === 'function') window.addEventListener('storage', fn);
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
                  log('Dropped incoming WebSocket server interruption event:', dataStr);
                  return;
                }
              } catch {}
              return typeof listener === 'function' ? listener.apply(this, arguments) : listener.handleEvent(event);
            };
            return originalAddEventListener(type, wrappedListener, options);
          }
          return originalAddEventListener(type, listener, options);
        };

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
   * ========================================================================= */
  try {
    if (navigator.locks && typeof navigator.locks.request === 'function') {
      const originalLocksRequest = navigator.locks.request.bind(navigator.locks);

      navigator.locks.request = function (name, ...args) {
        if (!config.enabled || !config.webLocksShim) {
          return originalLocksRequest(name, ...args);
        }
        const scopedName = `__mte_${TAB_ID}__${name}`;
        stats.bypassedLocks++;
        log(`Scoped Web Lock "${name}" -> "${scopedName}"`);
        return originalLocksRequest(scopedName, ...args);
      };
    }
  } catch (e) {
    console.warn('[Multi-Tab Enabler] Web Locks shim error:', e);
  }

  /* =========================================================================
   * 5. ANTI-PAUSE SHIELD (HTMLMediaElement.prototype.pause)
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

      const isNaturalEnded = this.ended || (this.duration && Math.abs(this.currentTime - this.duration) < 0.5);
      const isDirectUserAction = timeSinceUserGesture < 450 || (
        lastInteractedElement && (
          lastInteractedElement === this ||
          this.contains(lastInteractedElement) ||
          (lastInteractedElement.closest && (lastInteractedElement.closest('video, audio, .video-player, .player-container, button') !== null))
        ) && timeSinceUserGesture < 800
      );

      const isUserActive = (navigator.userActivation && navigator.userActivation.isActive);

      if (isNaturalEnded || isDirectUserAction || isUserActive) {
        log('User pause permitted.');
        return originalPause.apply(this, arguments);
      }

      stats.blockedPauses++;
      log('Shielded against programmatic/background pause call on media element:', this);
      return Promise.resolve();
    };

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
          setTimeout(() => {
            if (media.paused && !media.ended) {
              originalPlay.call(media).catch(() => {});
            }
          }, 50);
        }
      }, { capture: true });
    };

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

  // Expose global controller for easy devtools inspection or custom scripting
  window.__MultiTabEnabler = {
    config,
    stats,
    enable: () => { config.enabled = true; console.log('[Multi-Tab Enabler] ENABLED'); },
    disable: () => { config.enabled = false; console.log('[Multi-Tab Enabler] DISABLED'); },
    playAll: () => {
      document.querySelectorAll('video, audio').forEach(m => m.play().catch(() => {}));
    }
  };

  log('Multi-Tab Video Stream Enabler initialized (Userscript)');
})();
