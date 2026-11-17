// Builds every published file from the one source tree in src/:
// - dist/pfg-companion.user.js and dist/pfg-companion.meta.js (its metadata block alone, which userscript managers
//   poll for updates), published at https://proxyforgame.com/companion/;
// - dist/chrome and dist/firefox, the extension packages, and their store zips.
// Both builds wrap the same shared files in one function; they differ only in the platform layer
// (src/platform/<build>.js), the userscript header vs the manifest, and the extension's MAIN-world script.
// The version comes from package.json alone.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');
const BROWSERS = ['chrome', 'firefox'];
// Concatenated in this order; the platform layer is inserted after i18n.js.
const SHARED_FILES = ['i18n.js', 'core.js', 'game.js', 'panel.js'];
const ENTRY_FILE = 'main.js';
const EOL = '\r\n';

const version = () => JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const read = (name) => fs.readFileSync(path.join(src, name), 'utf8').replace(/\r?\n/g, EOL);

/** The ordered source files of a build. @param {'userscript'|'extension'} platform */
function sourceFiles(platform) {
  return [SHARED_FILES[0], `platform/${platform}.js`, ...SHARED_FILES.slice(1), ENTRY_FILE];
}

/** The script body of a build: its source files in one function, so nothing leaks into the page or other scripts. @param {'userscript'|'extension'} platform */
function bundle(platform) {
  const parts = sourceFiles(platform).map((name) => `// ---- src/${name}${EOL}${EOL}${read(name).trimEnd()}${EOL}`);
  return `(function () {${EOL}'use strict';${EOL}${EOL}${parts.join(EOL)}}());${EOL}`;
}

function userscriptHeader() {
  return read('userscript-header.js').replace('{{version}}', version());
}

function userscript() {
  return `${userscriptHeader()}${EOL}${bundle('userscript')}`;
}

/** @param {'chrome'|'firefox'} browser */
function manifest(browser) {
  return fs.readFileSync(path.join(root, 'manifests', `${browser}.json`), 'utf8').replace('{{version}}', version());
}

/** @param {string} from @param {string} to */
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(source, target);
    else if (entry.isFile()) fs.copyFileSync(source, target);
  }
}

/** @param {string} browser @param {string} target */
function pack(browser, target) {
  const zip = path.join(dist, `pfg-companion-${browser}-${version()}.zip`);
  fs.rmSync(zip, { force: true });
  // Packed by Windows' bsdtar (System32\tar.exe): on a machine where `tar` resolves to GNU tar (Git Bash),
  // `-a` writes a plain tar instead of a zip. Relative paths and cwd: bsdtar reads an absolute path such
  // as D:\... as a host name. Entries are listed by name, not as '.': with '.' the zip holds "./manifest.json",
  // which the Chrome Web Store dashboard rejects ("manifest.json is missing from the root of the archive").
  const tarExe = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  const packed = spawnSync(tarExe, ['-a', '-c', '-f', path.basename(zip), '-C', browser, ...fs.readdirSync(target)], { cwd: dist, stdio: 'inherit' });
  if (packed.status !== 0) throw new Error(`Failed to pack ${zip}`);
}

function build({ zip = true } = {}) {
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, 'pfg-companion.user.js'), userscript());
  fs.writeFileSync(path.join(dist, 'pfg-companion.meta.js'), userscriptHeader());
  const content = bundle('extension');
  for (const browser of BROWSERS) {
    const target = path.join(dist, browser);
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'manifest.json'), manifest(browser));
    fs.writeFileSync(path.join(target, 'pfg-companion.js'), content);
    fs.writeFileSync(path.join(target, 'main-world.js'), read('main-world.js'));
    copyTree(path.join(root, 'icons'), path.join(target, 'icons'));
    if (zip) pack(browser, target);
  }
  console.log(`dist/ ready, version ${version()}.`);
}

module.exports = { bundle, userscript, sourceFiles, manifest };

if (require.main === module) build({ zip: !process.argv.includes('--no-zip') });
