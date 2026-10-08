#!/usr/bin/env node
// Fabrique Orbe pour Windows, sans dépendance : copie le moteur Electron, le
// renomme, y place le code d'Orbe, puis en fait une archive zip.
//
//   node scripts/build-win.js          -> <runtime>/dist/Orbe-win32-x64/Orbe.exe
//                                         <runtime>/dist/Orbe-win32-x64.zip
//   node scripts/build-win.js --icon   -> régénère d'abord assets/orbe.ico
//
// À lancer sous Windows (le moteur installé doit être celui de Windows).
//
// Limite connue : l'icône et les informations de version inscrites DANS
// Orbe.exe restent celles d'Electron. Les changer demande de réécrire les
// ressources de l'exécutable (outil « rcedit »), ce qui ne se fait pas
// proprement sans dépendance. L'icône d'Orbe est en revanche bien celle des
// fenêtres et de la barre des tâches (assets/orbe.ico, chargée au lancement).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const dev = require('./dev');
const { makeIco } = require('./make-ico');

const root = dev.root;
const args = process.argv.slice(2);
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
const name = `Orbe-win32-${arch}`;
const out = path.join(dev.runtime, 'dist');
const appDir = path.join(out, name);
const ico = path.join(root, 'assets', 'orbe.ico');

if (args.includes('--icon') || !fs.existsSync(ico)) {
  makeIco(path.join(root, 'assets', 'icon.png'), ico);
  console.log('Icône régénérée.');
}

const cli = dev.ensure();
const dist = path.join(dev.runtime, 'node_modules', 'electron', 'dist');
if (!fs.existsSync(path.join(dist, 'electron.exe'))) {
  // Le téléchargement du moteur a pu être différé : un lancement à vide le déclenche.
  try { execFileSync(process.execPath, [cli, '--version'], { stdio: 'pipe' }); } catch {}
}
if (!fs.existsSync(path.join(dist, 'electron.exe'))) {
  console.error(`Moteur Windows introuvable dans ${dist}. Ce script se lance sous Windows.`);
  process.exit(1);
}

console.log('Copie du moteur…');
fs.rmSync(appDir, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.cpSync(dist, appDir, { recursive: true });
fs.renameSync(path.join(appDir, 'electron.exe'), path.join(appDir, 'Orbe.exe'));

console.log('Installation du code d’Orbe…');
const resources = path.join(appDir, 'resources');
fs.rmSync(path.join(resources, 'default_app.asar'), { force: true });
const target = path.join(resources, 'app');
fs.mkdirSync(path.join(target, 'assets'), { recursive: true });
fs.cpSync(path.join(root, 'src'), path.join(target, 'src'), { recursive: true });
for (const f of ['package.json', 'LICENSE']) fs.copyFileSync(path.join(root, f), path.join(target, f));
for (const f of ['blocklist.txt', 'orbe.ico']) fs.copyFileSync(path.join(root, 'assets', f), path.join(target, 'assets', f));
console.log('Application prête : ' + path.join(appDir, 'Orbe.exe'));

// Archive : « tar » de Windows 10 et suivants (bsdtar) sait écrire du zip.
const zip = path.join(out, name + '.zip');
fs.rmSync(zip, { force: true });
try {
  if (process.platform === 'win32') execFileSync('tar.exe', ['-a', '-c', '-f', zip, name], { cwd: out, stdio: 'inherit' });
  else execFileSync('zip', ['-qr', zip, name], { cwd: out, stdio: 'inherit' });
  console.log('Archive : ' + zip);
} catch (err) {
  console.error('Archive non créée : ' + err.message);
  process.exitCode = 1;
}
