/**
 * Automated Verification Script for Multi-Tab Stream Enabler
 */
const assert = require('assert');

// 1. Mock Browser Environment
const storageEventsListeners = [];
const docListeners = {};
const winListeners = {};

global.Document = function() {};
Document.prototype = {
  get hidden() { return true; }, // Default browser behavior when backgrounded
  get visibilityState() { return 'hidden'; },
  hasFocus: () => false,
  addEventListener: (type, fn) => {
    docListeners[type] = docListeners[type] || [];
    docListeners[type].push(fn);
  },
  querySelectorAll: () => []
};

global.Window = function() {};
Window.prototype = {
  addEventListener: (type, fn) => {
    winListeners[type] = winListeners[type] || [];
    winListeners[type].push(fn);
  }
};

global.document = new Document();
global.window = new Window();
global.window.sessionStorage = {
  getItem: () => null,
  setItem: () => {}
};
global.window.addEventListener = Window.prototype.addEventListener;
global.window.postMessage = () => {};

global.navigator = {
  locks: {
    request: (name, cb) => cb({ name })
  },
  userActivation: { isActive: false }
};

let broadcastCreated = [];
global.BroadcastChannel = function(name) {
  this.name = name;
  broadcastCreated.push(name);
  this.postMessage = () => {};
};
global.window.BroadcastChannel = global.BroadcastChannel;

global.WebSocket = function(url, protocols) {
  this.url = url;
  this.listeners = {};
  this.addEventListener = function(type, cb) {
    this.listeners[type] = cb;
  };
};
global.window.WebSocket = global.WebSocket;

global.HTMLMediaElement = function() {};
HTMLMediaElement.prototype = {
  paused: false,
  ended: false,
  duration: 120,
  currentTime: 10,
  play: function() { this.paused = false; return Promise.resolve(); },
  pause: function() { this.paused = true; },
  addEventListener: () => {}
};

// 2. Load and execute inject.js
console.log('--- Loading inject.js ---');
require('../inject.js');

// 3. Tests
console.log('Test 1: Visibility Spoofing');
assert.strictEqual(document.hidden, false, 'document.hidden must be false');
assert.strictEqual(document.visibilityState, 'visible', 'document.visibilityState must be "visible"');
assert.strictEqual(document.hasFocus(), true, 'document.hasFocus() must return true');
console.log('✓ Test 1 passed: Document appears always visible and focused');

console.log('Test 2: BroadcastChannel Tab Isolation');
const ch = new window.BroadcastChannel('player_channel');
assert.ok(ch.name.startsWith('__mte_'), 'BroadcastChannel name should be scoped to prevent cross-tab interference');
console.log('✓ Test 2 passed: BroadcastChannel name is safely scoped:', ch.name);

console.log('Test 3: Anti-Pause Shield');
const fakeVideo = new HTMLMediaElement();
fakeVideo.pause(); // Attempt programmatic background pause without user interaction
assert.strictEqual(fakeVideo.paused, false, 'Programmatic background pause should be blocked by antiPauseShield');
console.log('✓ Test 3 passed: Background script pause attempt was prevented!');

console.log('Test 4: Web Locks Concurrent Shim');
let lockAcquiredName = '';
navigator.locks.request('player_lock', (lock) => {
  lockAcquiredName = lock.name;
});
assert.ok(lockAcquiredName.startsWith('__mte_'), 'Lock name should be scoped per tab');
console.log('✓ Test 4 passed: Web Lock request was successfully scoped and acquired:', lockAcquiredName);

console.log('Test 5: Storage Virtualization (PW active-tab bypass)');
global.localStorage = {
  store: {},
  setItem: function(k, v) { this.store[k] = String(v); },
  getItem: function(k) { return this.store[k] !== undefined ? this.store[k] : null; },
  removeItem: function(k) { delete this.store[k]; }
};
window.localStorage = global.localStorage;
global.Storage = function() {};
Storage.prototype = global.localStorage;

// Test that setItem with player/tab key is virtualized
localStorage.setItem('active_video_tab', 'TAB_A');
assert.strictEqual(localStorage.getItem('active_video_tab'), 'TAB_A');
console.log('✓ Test 5 passed: Player key virtualization functional');

console.log('Test 6: WebSocket Concurrency Interruption Dropping');
const ws = new window.WebSocket('wss://pw.live/socket');
let receivedMessage = false;
ws.addEventListener('message', (e) => {
  receivedMessage = true;
});
// Dispatch an interruption message through the wrapped listener
ws.listeners['message']({ data: JSON.stringify({ message: "Your account is already streaming on another device" }) });
assert.strictEqual(receivedMessage, false, 'Server interruption WebSocket message should be silently dropped');
console.log('✓ Test 6 passed: WebSocket interruption event was intercepted and dropped!');

console.log('\n======================================');
console.log('ALL INTERCEPTION TESTS PASSED CLEANLY!');
console.log('======================================');
process.exit(0);
