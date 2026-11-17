# PfG Companion

PfG Companion collects an OGame account snapshot while the player has an OGame page open, keeps it in the browser, and makes it available to ProxyForGame when the site is opened.

It comes in two builds made from the one source tree in `src/`:

- a **userscript** for Tampermonkey or Violentmonkey;
- a **browser extension** for Chrome and Firefox (Manifest V3), for players who do not use a userscript manager.

The builds behave the same, store the same data and share all code except a thin platform layer (see [Structure](#structure)). Install only one of them; if both are installed, whoever runs first marks the document (`data-pfg-companion="userscript"` or `"extension"` on `<html>`) and the other stands down entirely, so the account is never requested twice on one page.

## Behaviour

- Requests the account from OGame (`accountInfo` and `speciesBonuses`) once per game session — on the first game page load in a browser tab — and afterwards only when the player presses "Refresh" in the panel. Every such request marks the player active and refreshes the highscore, so it is not repeated on its own, not even after a failed attempt. The one exception: on the first page after login the game answers `speciesBonuses` without data, and then `speciesBonuses` alone (not `accountInfo`) is requested once more on the next page the player loads.
- Never changes the selected planet, opens a game page, or runs a background polling loop.
- Reads production factors only when the player has opened Resource Settings for that planet.
- Reads the metal, crystal and deuterium of the current planet or moon off the game's resource bar on every game page the player loads — no request, nothing on its own.
- Adds a `PfG Companion` entry to the OGame menu. Its battery indicator shows whether account, bodies, and production settings have been collected. The panel explains every missing part and shows the time of the last collection.
- The panel's "Copy" and "Save to file" buttons export the data by hand. With "Minified (current universe only)" checked (the default) the export is one minified document of the current universe for pasting into an AI chat (ProxyForGame's `ogame_import_account` MCP tool): the snapshot below without `resources`, `defenses` and `baseProduction` of every planet and moon and without `pfgCompanion.resources`, and with every `speciesBonuses` entry reduced to `{ totalBonus }`. Unchecked, it is everything stored (all accounts, the whole `pfg-companion:snapshots:v1` value), indented.
- Keeps snapshots in the browser (the userscript manager's storage or the extension's `chrome.storage.local`), separated by universe and player id. No account data is written to a ProxyForGame server.

## Stored data

Both builds keep a single value, `pfg-companion:snapshots:v1`: an object with one entry per account, keyed `<lang>:<uniNumber>:<playerId>` (for example `ru:135:123456`). Each entry is `{ collectedAt, export, error? }`:

- `collectedAt` — ISO time of the last `accountInfo` fetch. Saving production factors does not change it.
- `export` — the snapshot described below.
- `error` — `{ at, message }` of the last failed collection; it is dropped by the next successful save.

The tab's `sessionStorage` on the game page holds `pfg-companion:collected` — the id of the player whose account was already requested in this tab — and, while a `speciesBonuses` retry is pending, `pfg-companion:species-retry` with the same id.

The snapshot is OGame's `accountInfo` response without the bulky `components`, `newAjaxToken`, `spaceObjects`, `static` and `speciesInformation` keys, plus:

- name, coordinates, temperature, fields and diameter of planets and moons, read from the planet list tooltips;
- `speciesBonuses` — the `data` of OGame's `speciesBonuses` response without `details`;
- `schemaVersion: 2`, `universe: { number, language, host }` and `exportedAt` (ISO time of the last change);
- the `pfgCompanion` block (see below).

If a later response lacks `speciesBonuses` or planets, the previously stored ones are kept. The panel's "Clear data" button removes the entry of the current account (all entries if the current account has none). Removing the extension deletes all of its data.

What the extension stores and hands on is also described for the stores in [PRIVACY.md](PRIVACY.md).

## Site hand-off contract

On a ProxyForGame page, all stored snapshots are written to local storage under `pfg_companion_pending_export` as `{ version: 1, exports: [snapshot, ...] }`, and the `pfg-companion:sync` document event is emitted with the same object in `detail`. This is repeated whenever the stored snapshots change. The site should validate the JSON with its existing profile export parser before applying it.

The snapshot is compatible with the account-export format consumed by `profiles-core.js` and uses schema version 2. Planet resources, production and active items (`planets[id].resources`, `production`, `buffs`) come as part of OGame's `accountInfo`. The snapshot adds an optional `pfgCompanion` block:

- `productionFactors[planetId] = { [techId]: percent }` — production percentages from Resource Settings for metal mine (1), crystal mine (2), deuterium synthesizer (3), solar plant (4), fusion reactor (12), solar satellites (212) and crawlers (217). Factors of different planets accumulate across visits.
- `resources[bodyId] = { metal, crystal, deuterium, at }` — the resources of every planet and moon with the ISO time `at` they were read. They are seeded from `planets/moons[id].resources` of every `accountInfo` response (`at` = `collectedAt`) and replaced by the resource-bar readings of later game pages; per body the newer `at` wins. A reading is stored only once the account has been collected and only for a body of that account; bodies that leave the account are dropped. A page whose bar shows the stored amounts writes nothing unless the stored reading is more than 5 minutes old; then only its `at` is refreshed, so a body whose amounts stand still (a moon, a full storage) is not shown as outdated. A reading does not change `exportedAt`.
- `productionBoosters[planetId] = [{ uuid, name, resource, tier, percent?, effectStart, effectEnd }]` — production boosters derived from `buffs`, where `resource` is `metal`, `crystal`, `deuterium`, `energy` or `all` and the times are Unix seconds. The site should ignore boosters whose `effectEnd` has passed.
- `planetOrder = [planetId, ...]` — the planets' ids (numbers) in the order the game's planet list shows them, i.e. the sort the player chose in the game's options; `accountInfo` keys planets by id and loses it. Planets only — a moon follows its planet. Read on every collection and on every later game page; a page whose list order differs from the stored one stores the new order without an account request and moves `exportedAt`, so the site re-imports it. A page without a planet list keeps the stored order. The minified export keeps it.
- `status = { level, accountReady, bodiesReady, missingProduction: [{ id, name, coords }] }` — collection completeness: level 1 means account or bodies are missing, 2 means some planets lack production factors, 3 means complete.

## Installation

- **Userscript:** open https://proxyforgame.com/companion/pfg-companion.user.js with Tampermonkey or Violentmonkey installed. The userscript manager checks `pfg-companion.meta.js` next to it for a newer `@version` and updates the script from there.
- **Extension:** install PfG Companion from the Chrome Web Store or addons.mozilla.org; the stores deliver updates. Minimum versions: Chrome 111, Firefox 128 (the first to support a content script in the page's MAIN world).

## Structure

`scripts/build.js` concatenates the files below, in this order, into one function — the same way for both builds — and adds what is specific to each build:

- `src/i18n.js` — the interface strings in the languages of ProxyForGame and the language choice.
- `src/platform/userscript.js` or `src/platform/extension.js` — **the only code that differs**: storage (`GM_getValue`/`GM_setValue`/`GM_addValueChangeListener` vs `chrome.storage.local` with an in-memory cache and `chrome.storage.onChanged`), styles (`GM_addStyle` vs a `<style>` element), the debug switch, and access to two of the page's own objects (`resourcesBar` and `changeTooltip()`: `unsafeWindow` vs a request to `src/main-world.js`).
- `src/core.js` — contract keys, building and merging the snapshot, the site hand-off.
- `src/game.js` — game mode: the throttled account request, production settings, resource-bar readings, planet list order.
- `src/panel.js` — the menu entry with the battery icon and the panel.
- `src/main.js` — the entry point: the `data-pfg-companion` stand-down, then game mode or site mode.

Build-specific files:

- `src/userscript-header.js` — the userscript's metadata block (`@grant`s, `@match`es, update URLs).
- `manifests/chrome.json`, `manifests/firefox.json` — the extension manifests (the only difference between the two packages).
- `src/main-world.js` — extension only: a content script in the page's MAIN world that answers the two read/call requests above; it makes no requests and touches no storage.
- `icons/` — the extension icons (the ProxyForGame site favicon); `assets/` — the battery-level PNGs embedded into `src/panel.js`.
- `store/` — the store listing and permission texts; `PRIVACY.md` — the extension's privacy policy.

The version lives only in `package.json`; the build writes it into the userscript header and both manifests.

## Releasing

1. Raise `version` in `package.json` — userscript managers and the stores update only when it grows.
2. Commit and push.
3. `npm run build` writes `dist/`: `pfg-companion.user.js` and `pfg-companion.meta.js` (its metadata block alone), `chrome/` and `firefox/` (the unpacked extensions) and `pfg-companion-<browser>-<version>.zip`.
4. Userscript: `npm run deploy` builds the userscript and copies both files over SSH (host alias `vdsina`) to `/var/www/pfg-companion/` on the site's host, served as `/companion/` with `Cache-Control: no-cache`. The directory is outside the site checkout, so site deploys do not touch it.
5. Extension: upload the zips to the Chrome Web Store and addons.mozilla.org (for AMO, the source is this repository at the release commit; `npm install && npm run build` reproduces the package).

Publishing is a manual step, not tied to `git push`.

## Local development

```
npm install
npm run build -- --no-zip
```

- Userscript: install `dist/pfg-companion.user.js` in Tampermonkey or Violentmonkey. Set `const DEBUG = true;` in the manager's editor to see debug logs.
- Extension: load `dist/chrome` unpacked on `chrome://extensions`, or `dist/firefox/manifest.json` via `about:debugging` → This Firefox → Load Temporary Add-on. Set `localStorage['pfg-companion:debug'] = '1'` on a game page and reload to see debug logs.
- `npm run check` syntax-checks every source file and both built scripts; `npm test` runs the jsdom suite, every test against both builds.
