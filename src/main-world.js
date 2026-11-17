// Extension build only. Runs in the page's MAIN world (manifest content_scripts entry with "world": "MAIN"):
// the isolated world of a content script cannot read OGame's own JS objects, and this script cannot use chrome.*.
// It only answers bridge requests from bridgeCall() in src/platform/extension.js; without a requester it stays inert.
// It makes no requests, touches no storage and writes nothing to the page.
(function () {
  'use strict';
  window.addEventListener('pfg-companion-bridge', (event) => {
    const detail = event.detail || {};
    let result = null;
    if (detail.type === 'resourcesBar') {
      const value = window.resourcesBar?.resources?.[detail.key]?.amount;
      if (typeof value === 'number' || typeof value === 'string') result = value;
    } else if (detail.type === 'changeTooltip') {
      if (typeof window.changeTooltip === 'function') {
        try {
          window.changeTooltip(document.getElementById(detail.elementId), detail.text);
          result = true;
        } catch {
          result = null; // A failed tooltip falls back to a plain title on the caller's side.
        }
      }
    }
    window.dispatchEvent(new CustomEvent('pfg-companion-bridge-reply', { detail: { requestId: detail.requestId, result } }));
  });
}());
