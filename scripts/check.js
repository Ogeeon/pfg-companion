// Syntax-checks every source file (node --check) and both built scripts, which are what the browsers run.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { bundle, userscript } = require('./build');

const root = path.join(__dirname, '..');

/** @param {string} dir @param {string[]} [acc] @returns {string[]} */
function jsFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) jsFiles(full, acc);
    else if (entry.isFile() && entry.name.endsWith('.js')) acc.push(full);
  }
  return acc;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pfg-companion-check-'));
const built = [['pfg-companion.user.js', userscript()], ['pfg-companion.js', bundle('extension')]].map(([name, text]) => {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, text);
  return file;
});

let failed = false;
for (const file of [...jsFiles(path.join(root, 'src')), ...built]) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`Syntax check failed: ${file}`);
    failed = true;
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
if (!failed) console.log('Syntax OK.');
process.exit(failed ? 1 : 0);
