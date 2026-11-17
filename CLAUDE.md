# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

PfG Companion collects an OGame account snapshot while the player browses the game and hands it to the ProxyForGame (PfG) site. One source tree (`src/`) is built into two products: a userscript (Tampermonkey/Violentmonkey) and a Chrome/Firefox Manifest V3 extension. No runtime dependencies, no bundler: `scripts/build.js` concatenates plain files. This repository replaced the separate `pfg-companion-extension` repository; the OGame tool reviewers asked for one submission with one source for both builds, so the builds must never get separate copies of shared code.

## Commands

- `npm run check` — `node --check` on every file in `src/` and on both built scripts (`scripts/check.js`).
- `npm test` — `node:test` suite in `test/companion.test.js`: builds both scripts in memory (`require('../scripts/build')`) and runs every test against each in jsdom on a minimal game page, with stubbed `GM_*` or `chrome.storage` and `fetch` (the fake `accountInfo` mirrors a real response), then asserts on storage. Full saved game pages (`view-source*.html`, gitignored) contain session tokens and must not be committed. No linter.
- `npm run build` — writes `dist/` (gitignored): `pfg-companion.user.js`, `pfg-companion.meta.js` (its metadata block alone), `chrome/`, `firefox/` and the store zips (packed with Windows' `System32\tar.exe`; `--no-zip` skips them).
- `npm run deploy` — builds and `scp`s the two userscript files to `vdsina:/var/www/pfg-companion/`, served as `https://proxyforgame.com/companion/` (an Apache `Alias` in the site's HTTPS vhost, outside the site checkout that its own deploy cleans). `@updateURL`/`@downloadURL` point there, so these URLs must never change. The extension zips are uploaded to the stores by hand.
- The version lives only in `package.json` (`{{version}}` in `src/userscript-header.js` and `manifests/*.json`); raise it for every release of either build. Publishing is a manual step, not tied to `git push`.
- Manual testing: install `dist/pfg-companion.user.js` in a userscript manager, or load `dist/chrome` / `dist/firefox/manifest.json` unpacked.

## Architecture

### Build

`bundle(platform)` in `scripts/build.js` wraps, in one `(function () { 'use strict'; ... }())`: `i18n.js`, `platform/<platform>.js`, `core.js`, `game.js`, `panel.js`, `main.js`. The userscript is `userscript-header.js` + `bundle('userscript')`; the extension package is `manifest.json` + `pfg-companion.js` (= `bundle('extension')`, one isolated-world content script for game and site pages) + `main-world.js` (MAIN world, game pages, `document_start`) + `icons/`. All files share one scope inside the wrapper: top-level names must be unique across files.

### Platform layer — the only code that differs

`src/platform/userscript.js` and `src/platform/extension.js` define the same names: `PLATFORM` (the marker value), `DEBUG`, `initSnapshots()`, `snapshots()`, `saveSnapshots()`, `onSnapshotsChanged(cb)`, `addStyles(css)`, `pageResourceAmount(key)`, `pageChangeTooltip(element, text)`, `pageEventDetail(value)`. Anything else that differs between the builds is a bug in the design: add a function to both platform files instead of branching in shared code.

- Userscript: GM storage (synchronous, read live), `GM_addValueChangeListener`, `GM_addStyle`, the page's `resourcesBar`/`changeTooltip()` through `unsafeWindow`. `DEBUG` is a `const` the player flips in the manager's editor; keep it `false` in commits.
- Extension: `chrome.storage.local` loaded once into a cache by `initSnapshots()`, written through on save, kept fresh by `chrome.storage.onChanged`; a `<style>` element; the page's objects via `bridgeCall()` — `pfg-companion-bridge` CustomEvents answered by `src/main-world.js`, with timeouts (200 ms read / 500 ms tooltip) after which the shared code falls back to the bar text / a plain `title`. `pageEventDetail()` uses Firefox's `cloneInto` (the page cannot read isolated-world objects). `DEBUG` comes from `localStorage['pfg-companion:debug'] === '1'`. No background service worker.

### Flow (`src/main.js`)

Mark the document (`document.documentElement.dataset.pfgCompanion = PLATFORM`) and stand down entirely when it is already marked: the userscript and the extension never collect together. Then `await initSnapshots()` and run game mode (hostname ends with `.ogame.gameforge.com`, `ON_GAME`) or site mode.

**Game mode**:
1. `installGameUi()` adds a `PfG Companion` entry to `#menuTable` with a battery-level icon and a slide-out panel.
2. `collectAccount()` fetches `accountInfo` and `speciesBonuses` from OGame's `externaldataexport` component, once per game session unless forced (panel "Refresh" button): `markCollectedThisSession()` writes the player id to the tab's `sessionStorage` (`SESSION_COLLECTED_KEY`) before the request, so failures are not retried either. Exception: on the first page after login (`relogin=1`) the game answers `speciesBonuses` without `data`; then `setSpeciesRetry()` marks the session and the next page load runs `retrySpeciesBonuses()` — `speciesBonuses` alone, once, keeping `collectedAt`. This follows the OGame tool rules: every `accountInfo` call marks the player active and refreshes the highscore, so it must not be polled. `fetchJson()` parses `response.text()` (Firefox extension: `response.json()` can be an Xray wrapper that rejects writes).
3. `buildExport()` strips bulky response keys, merges body details parsed from planet-list tooltips (coords, temperature, fields, diameter; parsed with an inert `DOMParser` document), stores `pfgCompanion.planetOrder` from `#planetList`, and sets `schemaVersion: 2`, `universe`, `exportedAt`.
4. `readResourceBar()` (async) reads metal/crystal/deuterium of the current body (`meta[name="ogame-planet-id"]`) at page load — `#resources_<name>[data-raw]`, then `pageResourceAmount()`, then the element's digits-only text — and `saveBodyResources()` stores it in `pfgCompanion.resources` after collection, only into an existing entry, without touching `exportedAt` or `collectedAt`, and not at all when the stored reading has the same amounts and is at most `SAME_RESOURCES_REFRESH_MS` (5 min) older — past that the same amounts are rewritten to refresh `at`, so a body whose amounts stand still (a moon, a full storage) does not look stale on the site.
5. `savePlanetOrder()` stores a re-sorted planet list without an account request and moves `exportedAt`.
6. `saveProductionFactors()` reads production-percentage selects **only** when `component=resourcesettings` is open, for the current planet. It keeps the entry's `collectedAt` and never fetches the account.
7. `persistExport()` merges new production factors with previously stored ones, merges `pfgCompanion.resources` per body by the newer `at` (seeded from `planets/moons[id].resources` at `collectedAt`, limited to the export's bodies) via `mergedResources()`, keeps `planetOrder`, derives `pfgCompanion.productionBoosters` from `planets[id].buffs` via `productionBoosters()`, recomputes `pfgCompanion.status` via `collectionStatus()` (level 1 = account/bodies missing, 2 = some planets lack production factors, 3 = complete), and saves.

**Site mode** (PfG page): `handOffToSite()` writes `{ version: 1, exports: [...] }` to `localStorage['pfg_companion_pending_export']` and dispatches the `pfg-companion:sync` document event; re-runs on `onSnapshotsChanged()`.

### Storage and contracts

- Storage key `pfg-companion:snapshots:v1` (GM storage or `chrome.storage.local`) holds `{ "<lang>:<uniNumber>:<playerId>": { collectedAt, export, error?: { at, message } } }`. `activeEntry()` finds the entry for the current universe host/player/planet. `recordError()` adds `error` to an existing entry; the next `persistExport()` rewrites the entry without it. The panel's "Clear data" removes the current account's entry, or all entries when there is no active one. The README "Stored data" section documents the stored fields for players, and `PRIVACY.md` / `store/` describe them for the extension stores — update them together with the code.
- `persistExport()` keeps previously stored `speciesBonuses` and `planets` when a new response lacks them; `productionFactors` of different planets accumulate.
- The export must stay compatible with the account-export format parsed by PfG's `profiles-core.js` (schema version 2); companion-specific data goes only under the optional `pfgCompanion` block (`productionFactors`, `productionBoosters`, `resources`, `planetOrder`, `status`). Changing these keys/event names breaks the site hand-off.
- Nothing writes account data to a PfG server.

### Behavioural constraints (from README — keep these)

- Never change the selected planet, navigate/open game pages, or run background polling loops. Collection happens only on page load or on explicit Refresh.
- Production factors are read only from the Resource Settings page the player opened themselves.
- The `data-pfg-companion` marker: the two builds never collect together.
- No new `@grant` or extension permission without updating `store/permissions-justification.txt`, `PRIVACY.md` and the tool-review submission text.

## Conventions

- `PRODUCTION_ITEMS` (`src/core.js`) maps production-booster item uuids to `{ resource, tier, percent? }`; each booster has one uuid per duration. Shop uuids come from the shop page's `itemNames`; bronze boosters are not in the shop, so their uuids come from a planet where they are active.
- `accountInfo` (requested with `X-Requested-With: XMLHttpRequest`; without it the game answers "An error has occured!") already contains per-planet `resources`, `production`, `buildings`, `ships`, `defenses` and `buffs` (active items with `itemUuid` and Unix-second `effectStart`/`effectEnd`) for all planets, so none of this is scraped from the page.
- `LEVEL_ICONS` (`src/panel.js`) holds base64 PNGs embedded from `assets/battery-level-{1,2,3}.png`; if the PNGs change, re-embed them. `icons/` are the extension icons (the PfG site favicon).
- UI strings live in the `I18N` dictionary (`src/i18n.js`; languages of the PfG site: en, ru, de, pl, es, fr, it, nl, sk, tr, pt, bs) and are read through `t(key, params)`. The language comes from the universe host (`s1-ru` → `ru`, with `HOST_LANGUAGES` for `ba`, `br` etc.), then from `navigator.language`, then English. A new string must be added to every language (a test checks that the key sets match); do not hardcode texts in the UI code.
- Debug logging goes through `debug('...')`, which prints `console.debug('[PfG Companion] ...')` only when `DEBUG` (from the platform layer) is true.
- Markup is parsed with `parseMarkup()` (an inert `DOMParser` document) with every dynamic value escaped by `escapeHtml()`, never assigned to `innerHTML` (store reviewers flag it).
- The battery icon's tooltip (`levelTooltip()`) uses OGame's own tooltips: the icon has class `tooltipRight`, and `setIconTooltip()` calls the page's `changeTooltip()` through `pageChangeTooltip()`, because OGame's `initTooltips()` has already run by the time the menu entry is added. It falls back to a plain `title`.
- The panel's "Copy"/"Save to file" buttons (`exportFile()`) export on the player's click only. Checked "Minified" = `trimmedExport()` of the active entry's export (contract: issue #1 and `docs/ogame-api-import.md` on the site side: no `resources`/`defenses`/`baseProduction` of planets and moons, no `pfgCompanion.resources`, `speciesBonuses` entries reduced to `{ totalBonus }`), minified; unchecked = the whole snapshots value, indented.
- The panel never opens on its own: only the menu entry opens it; after collection it is re-rendered only if already open.
- Commit messages are written in English (earlier history is in Russian; do not rewrite it).
- Source files use CRLF line endings; the build writes CRLF.
