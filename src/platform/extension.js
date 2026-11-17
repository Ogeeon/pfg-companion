// Platform layer of the browser-extension build (Chrome and Firefox): chrome.storage.local, a <style> element, and
// the page's own objects through src/main-world.js (a content script in the page's MAIN world), since the isolated
// world of a content script cannot reach them. src/platform/userscript.js provides the same functions.
const PLATFORM = 'extension';
const DEBUG_KEY = 'pfg-companion:debug';
const BRIDGE_REQUEST_EVENT = 'pfg-companion-bridge';
const BRIDGE_REPLY_EVENT = 'pfg-companion-bridge-reply';
const BRIDGE_TIMEOUT_MS = 200;
const TOOLTIP_TIMEOUT_MS = 500;

// The players enable debug logging by setting localStorage['pfg-companion:debug'] = '1' on a game page and
// reloading it (an extension has no editor like a userscript manager's).
let DEBUG = false;
try {
  DEBUG = localStorage.getItem(DEBUG_KEY) === '1';
} catch {
  DEBUG = false;
}

// chrome.storage is asynchronous, unlike GM storage: the snapshots are loaded once into this cache
// (initSnapshots) and every save writes through. chrome.storage.onChanged keeps the cache fresh when
// another tab writes, as GM_getValue reads the live value.
let snapshotsCache = {};

/** Normalises a stored value into the cache: any non-object is treated as empty. @param {any} value */
function setSnapshotsCache(value) {
  snapshotsCache = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/** Loads the snapshots once per document and registers the cross-tab cache sync. */
async function initSnapshots() {
  try {
    const items = await chrome.storage.local.get(SNAPSHOTS_KEY);
    setSnapshotsCache(items?.[SNAPSHOTS_KEY]);
  } catch (error) {
    debug('initSnapshots: failed to read storage:', error);
  }
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !(SNAPSHOTS_KEY in changes)) return;
    setSnapshotsCache(changes[SNAPSHOTS_KEY].newValue);
  });
}

/** @returns {Record<string, any>} */
function snapshots() {
  return snapshotsCache;
}

/** @param {Record<string, any>} value */
function saveSnapshots(value) {
  snapshotsCache = value;
  void chrome.storage.local.set({ [SNAPSHOTS_KEY]: value });
}

/** Calls back when another tab writes the snapshots. @param {() => void} callback */
function onSnapshotsChanged(callback) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && SNAPSHOTS_KEY in changes) callback();
  });
}

/** @param {string} css */
function addStyles(css) {
  const style = document.createElement('style');
  style.textContent = css;
  document.head?.append(style);
}

let bridgeSequence = 0;
/** @type {Map<string, (result: any) => void> | null} */
let bridgePending = null;

/**
 * Asks src/main-world.js; every request carries a requestId and resolves on the matching reply, or with null on timeout.
 * @param {Record<string, any>} request
 * @returns {Promise<any>}
 */
function bridgeCall(request, timeoutMs = BRIDGE_TIMEOUT_MS) {
  if (!bridgePending) {
    bridgePending = new Map();
    window.addEventListener(BRIDGE_REPLY_EVENT, (event) => {
      const detail = event.detail || {};
      const resolve = bridgePending.get(detail.requestId);
      if (!resolve) return;
      bridgePending.delete(detail.requestId);
      resolve(detail.result ?? null);
    });
  }
  return new Promise((resolve) => {
    const requestId = `pfg-${++bridgeSequence}`;
    const timer = setTimeout(() => {
      bridgePending.delete(requestId);
      resolve(null);
    }, timeoutMs);
    bridgePending.set(requestId, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
    window.dispatchEvent(new CustomEvent(BRIDGE_REQUEST_EVENT, { detail: pageEventDetail({ ...request, requestId }) }));
  });
}

/** The page's own `resourcesBar.resources.<key>.amount` (read-only), or null. @param {string} key */
async function pageResourceAmount(key) {
  return bridgeCall({ type: 'resourcesBar', key });
}

/** Gives the element an OGame tooltip through the page's changeTooltip(); false when that is not possible. @param {Element} element @param {string} text */
async function pageChangeTooltip(element, text) {
  return Boolean(await bridgeCall({ type: 'changeTooltip', elementId: element.id, text }, TOOLTIP_TIMEOUT_MS));
}

/**
 * The detail of an event dispatched to the page. Firefox: the page cannot read an object of the isolated world
 * (an Xray wrapper: "Permission denied"), so cloneInto copies it into the page. Chrome has no cloneInto.
 * @param {any} value
 */
function pageEventDetail(value) {
  return typeof cloneInto === 'function' ? cloneInto(value, window) : value;
}
