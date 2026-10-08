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
// ORBE_DRM=1 : moteur castlabs (Electron avec Widevine), pour lire les vidéos
// protégées. Il suit Electron avec un peu de retard : ce n'est pas le défaut.
const drm = !!process.env.ORBE_DRM;
const conf = require('../package.json').orbe;
const version = drm ? conf.electronDrm : conf.electron;
const runtime = process.env.ORBE_RUNTIME || path.join(os.homedir(), drm ? '.orbe-dev-drm' : '.orbe-dev');
const spec = drm ? `https://github.com/castlabs/electron-releases#v${version}` : `electron@${version}`;
const pkg = path.join(runtime, 'node_modules', 'electron', 'package.json');

function installed() {
  try { return JSON.parse(fs.readFileSync(pkg, 'utf8')).version; } catch { return null; }
}

// Sous Windows, npm est un script « npm.cmd » : il lui faut un interpréteur.
function npm(args, cwd) {
  execFileSync('npm', args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
}

function ensure() {
  if (installed() !== version) {
    console.log(`Installation d'Electron ${version} dans ${runtime}…`);
    fs.mkdirSync(runtime, { recursive: true });
    const manifest = path.join(runtime, 'package.json');
    if (!fs.existsSync(manifest)) fs.writeFileSync(manifest, '{"name":"orbe-runtime","private":true}\n');
    npm(['install', spec, '--no-audit', '--no-fund'], runtime);
  }
  return path.join(runtime, 'node_modules', 'electron', 'cli.js');
}

if (require.main === module) {
  const cli = ensure();
  const child = spawn(process.execPath, [cli, root, ...process.argv.slice(2)], { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code == null ? 1 : code));
}

module.exports = { ensure, npm, runtime, version, root, drm };
