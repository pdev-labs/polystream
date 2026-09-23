# PolyStream ⚡

<p align="center">
  <strong>Stream multiple videos simultaneously across browser tabs without auto-pausing or "streaming on another device" lockouts.</strong>
</p>

<p align="center">
  <a href="https://github.com/pdev-labs/polystream/actions/workflows/test.yml"><img src="https://github.com/pdev-labs/polystream/actions/workflows/test.yml/badge.svg" alt="PolyStream CI"></a>
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT">
  <img src="https://img.shields.io/badge/Firefox-Supported-orange.svg" alt="Firefox">
  <img src="https://img.shields.io/badge/Chrome-Supported-green.svg" alt="Chrome">
  <img src="https://img.shields.io/badge/Tampermonkey-Compatible-darkgreen.svg" alt="Tampermonkey">
  <img src="https://img.shields.io/badge/Violentmonkey-Compatible-purple.svg" alt="Violentmonkey">
</p>

---

## 📖 Overview

Many online learning platforms, course portals (e.g. **PhysicsWallah**, **Coursera**, **Udemy**, **Panopto**), and streaming websites intentionally restrict playback to only one tab at a time. When you open a second lecture or switch tabs, they:
- Automatically pause the video.
- Show intrusive lockout popups: *"Playback Interrupted. Your account is already streaming on another device."*
- Freeze or mute background tabs.

**PolyStream** eliminates these restrictions using a client-side API interception engine available as both a **Firefox / Chrome Extension (Manifest V3)** and a **1-click Userscript**.

---

## ✨ Features

- 👁️ **Visibility & Focus Lock**: Spoofs `document.hidden = false` and `document.visibilityState = 'visible'`. Suppresses `visibilitychange` and window blur listeners so background tabs remain active.
- 📡 **BroadcastChannel Tab Isolator**: Scopes `BroadcastChannel` instances per tab (`__mte_${TAB_ID}__...`), preventing tabs from transmitting pause/stop commands to each other.
- 💾 **Per-Tab Storage Virtualization**: Isolates player heartbeat keys in `localStorage` so concurrent tabs never detect each other claiming active playback.
- 🔒 **Web Locks API Shim**: Bypasses `navigator.locks` exclusivity, granting playback locks concurrently to all tabs.
- 🛑 **WebSocket Concurrency Shield**: Intercepts server-sent WebSocket interrupt signals and silently drops concurrency kick notices before the frontend UI can react.
- 🎯 **Modal Annihilator (MutationObserver)**: Instantly detects and deletes *"Playback Interrupted / streaming on another device"* dialogs within 0 milliseconds, cleans up backdrops, and restores unhindered mouse clicks.
- 🛡️ **Anti-Pause Shield**: Blocks programmatic background `video.pause()` calls while preserving genuine user clicks and spacebar controls.

---

## 🚀 Installation

### Option 1: Userscript (Recommended for Firefox & Mobile)
*Works with **Violentmonkey**, **Tampermonkey**, **Greasemonkey**, and mobile browsers like Kiwi / Orion.*

1. Install **[Violentmonkey](https://violentmonkey.github.io/)** or **[Tampermonkey](https://www.tampermonkey.net/)** in your browser.
2. Open the userscript dashboard and click **"Create a new script"**.
3. Copy the raw contents of [`multi-tab-enabler.user.js`](./multi-tab-enabler.user.js).
4. Paste it into the editor and press **`Ctrl + S`** to save.
5. Open your streaming portal (e.g. PhysicsWallah) in multiple tabs—they will now stream side-by-side without interruptions!

---

### Option 2: Browser Extension (Chrome / Edge / Brave / Opera)

1. Clone or download this repository:
   ```bash
   git clone https://github.com/pdev-labs/polystream.git
   ```
2. Open `chrome://extensions` (or `edge://extensions`).
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `polystream` directory.
5. Pin PolyStream to your browser toolbar to access the dark-mode popup dashboard and live telemetry counters!

---

### Option 3: Firefox Temporary Add-on

1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
2. Click **"Load Temporary Add-on..."**.
3. Select [`manifest.json`](./manifest.json) from this folder.
4. The extension with full popup UI is now active in Firefox!

---

### Option 4: Firefox Multi-Account Containers (Native Firefox Trick)
*For a zero-extension solution:*
1. Install Mozilla's **[Firefox Multi-Account Containers](https://addons.mozilla.org/en-US/firefox/addon/multi-account-containers/)**.
2. Open your first video in your default container.
3. Open your second video in a different container (e.g. "Work" or "Personal").
4. Firefox isolates cookies, `localStorage`, and `BroadcastChannel` at the browser engine level, completely hiding each tab from the other!

---

## 🛠️ Interactive Test Lab

PolyStream includes a built-in test laboratory simulating the 4 most common stream restrictions:
1. Open [`test/test-page.html`](./test/test-page.html) in your browser.
2. Duplicate the tab into a second window.
3. Test procedural canvas video playback, visibility changes, and cross-tab pause broadcasting.

---

## 🧪 Automated Testing

Run the automated interception test suite:

```bash
# Validate JavaScript syntax
npm run lint

# Run interception unit tests
npm test
```

Expected output:
```bash
--- Loading inject.js ---
Test 1: Visibility Spoofing
✓ Test 1 passed: Document appears always visible and focused
Test 2: BroadcastChannel Tab Isolation
✓ Test 2 passed: BroadcastChannel name is safely scoped
Test 3: Anti-Pause Shield
✓ Test 3 passed: Background script pause attempt was prevented!
Test 4: Web Locks Concurrent Shim
✓ Test 4 passed: Web Lock request was successfully scoped and acquired
Test 5: Storage Virtualization (PW active-tab bypass)
✓ Test 5 passed: Player key virtualization functional
Test 6: WebSocket Concurrency Interruption Dropping
✓ Test 6 passed: WebSocket interruption event was intercepted and dropped!

======================================
ALL INTERCEPTION TESTS PASSED CLEANLY!
======================================
```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       WEBPAGE TAB                           │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │                 Target Video Player                 │   │
│   │               <video> / MediaSession                │   │
│   └──────────────────────────┬──────────────────────────┘   │
│                              │                              │
│   ┌──────────────────────────▼──────────────────────────┐   │
│   │             PolyStream Injected Engine              │   │
│   │                                                     │   │
│   │   • document.hidden = false                         │   │
│   │   • document.visibilityState = 'visible'            │   │
│   │   • BroadcastChannel Scoped Namespace               │   │
│   │   • localStorage Player Key Virtualization          │   │
│   │   • WebSocket Concurrency Message Dropper           │   │
│   │   • MutationObserver Modal Annihilator              │   │
│   │   • HTMLMediaElement.prototype.pause Shield         │   │
│   └──────────────────────────┬──────────────────────────┘   │
│                              │ postMessage                  │
│   ┌──────────────────────────▼──────────────────────────┐   │
│   │          Content Script Bridge (ISOLATED)           │   │
│   └──────────────────────────┬──────────────────────────┘   │
│                              │ chrome.runtime               │
│   ┌──────────────────────────▼──────────────────────────┐   │
│   │             Extension Popup Dashboard               │   │
│   │            Live telemetry & module toggles          │   │
│   └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 📄 License

This project is licensed under the [MIT License](./LICENSE) &copy; 2026 [pdev-labs](https://github.com/pdev-labs).
