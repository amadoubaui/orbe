#!/usr/bin/env node
// Lance Orbe en développement.
// Le moteur (Electron) est installé une fois dans ~/.orbe-dev, hors du projet :
// le dépôt reste léger et fonctionne aussi depuis un disque réseau, où les
// exécutables ne peuvent pas être lancés.
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const version = require('../package.json').orbe.electron;
const runtime = process.env.ORBE_RUNTIME || path.join(os.homedir(), '.orbe-dev');
const pkg = path.join(runtime, 'node_modules', 'electron', 'package.json');

function installed() {
  try { return JSON.parse(fs.readFileSync(pkg, 'utf8')).version; } catch { return null; }
}

function ensure() {
  if (installed() !== version) {
    console.log(`Installation d'Electron ${version} dans ${runtime}…`);
    fs.mkdirSync(runtime, { recursive: true });
    const manifest = path.join(runtime, 'package.json');
    if (!fs.existsSync(manifest)) fs.writeFileSync(manifest, '{"name":"orbe-runtime","private":true}\n');
    execFileSync('npm', ['install', `electron@${version}`, '--no-audit', '--no-fund'], { cwd: runtime, stdio: 'inherit' });
  }
  return path.join(runtime, 'node_modules', 'electron', 'cli.js');
}

if (require.main === module) {
  const cli = ensure();
  const child = spawn(process.execPath, [cli, root, ...process.argv.slice(2)], { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code == null ? 1 : code));
}

module.exports = { ensure, runtime, version, root };
