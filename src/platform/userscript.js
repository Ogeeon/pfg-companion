// Platform layer of the userscript build: GM storage, GM_addStyle and the page's own objects through unsafeWindow.
// src/platform/extension.js provides the same functions for the browser extension; nothing else differs.
const PLATFORM = 'userscript';

// Set to true to print collection details to the browser console.
const DEBUG = false;

/** GM storage is synchronous, so there is nothing to load. */
async function initSnapshots() {}

/** @returns {Record<string, any>} */
function snapshots() {
  const saved = GM_getValue(SNAPSHOTS_KEY, {});
  return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
}

/** @param {Record<string, any>} value */
function saveSnapshots(value) {
  GM_setValue(SNAPSHOTS_KEY, value);
}

/** Calls back when another tab writes the snapshots. @param {() => void} callback */
function onSnapshotsChanged(callback) {
  GM_addValueChangeListener(SNAPSHOTS_KEY, () => callback());
}

/** @param {string} css */
function addStyles(css) {
  GM_addStyle(css);
}

function pageWindow() {
  return typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
}

/** The page's own `resourcesBar.resources.<key>.amount` (read-only), or null. @param {string} key */
async function pageResourceAmount(key) {
  try {
    const value = pageWindow().resourcesBar?.resources?.[key]?.amount;
    return typeof value === 'number' || typeof value === 'string' ? value : null;
  } catch {
    return null; // A page object that cannot be read is no source.
  }
}

/** Gives the element an OGame tooltip through the page's changeTooltip(); false when that is not possible. @param {Element} element @param {string} text */
async function pageChangeTooltip(element, text) {
  const page = pageWindow();
  if (typeof page.changeTooltip !== 'function') return false;
  try {
    page.changeTooltip(element, text);
    return true;
  } catch (error) {
    debug('pageChangeTooltip: changeTooltip failed, using a plain title:', error);
    return false;
  }
}

/** The detail of an event dispatched to the page. @param {any} value */
function pageEventDetail(value) {
  return value;
}
