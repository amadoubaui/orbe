// Chargé dans le processus principal avant Orbe (option -r d'Electron), pendant
// les tests d'interface uniquement.
//
// Les fenêtres s'ouvrent sans prendre le clavier : la personne qui travaille
// sur ce Mac garde le focus dans son application. Les événements envoyés par
// Playwright visent une page précise et n'ont pas besoin du focus système.
// ORBE_UI_FOCUS=1 rend le comportement normal (la fenêtre de test passe alors
// au premier plan).
const { BaseWindow, BrowserWindow, app } = require('electron');

if (process.env.ORBE_UI_FOCUS !== '1') {
  for (const proto of [BaseWindow.prototype, BrowserWindow.prototype]) {
    const inactive = proto.showInactive;
    proto.show = function show() { return inactive.call(this); };
    proto.focus = function focus() {};
  }
  app.focus = () => {};
}

// --- Journal de fin de vie ------------------------------------------------------
// Une fenêtre fermée ou une application qui s'arrête au milieu d'un groupe doit
// pouvoir s'expliquer après coup : chaque demande est écrite sur la sortie
// d'erreur, avec la pile d'appels de qui l'a faite (tests/ui/harness.js la garde).
const dire = (texte) => { try { process.stderr.write(`[orbe-ui ${new Date().toISOString().slice(11, 23)}] ${texte}\n`); } catch {} };
const pile = () => String(new Error().stack).split('\n').slice(3, 9).map((l) => l.trim()).join(' < ');
for (const [objet, nom, methodes] of [[app, 'app', ['quit', 'exit']], [BaseWindow.prototype, 'fenêtre', ['close', 'destroy']]]) {
  for (const m of methodes) {
    const vraie = objet[m];
    if (typeof vraie !== 'function') continue;
    objet[m] = function journalise(...args) {
      let qui = '';
      try { if (nom === 'fenêtre') qui = ` n° ${this.id}`; } catch {}
      dire(`${nom}${qui}.${m}(${args.map(String).join(', ')}) demandé par : ${pile()}`);
      return vraie.apply(this, args);
    };
  }
}
for (const ev of ['before-quit', 'will-quit', 'window-all-closed']) app.on(ev, () => dire(`événement « ${ev} »`));
app.on('quit', (e, code) => dire(`événement « quit », code ${code}`));
app.on('render-process-gone', (e, wc, d) => dire(`processus de rendu perdu : ${d.reason}, code ${d.exitCode}, page ${(() => { try { return wc.getURL(); } catch { return '?'; } })()}`));
app.on('child-process-gone', (e, d) => dire(`processus auxiliaire perdu : ${d.type} ${d.reason}, code ${d.exitCode}`));
// Sans cela, Electron ouvre une boîte de dialogue que personne ne lit.
process.on('uncaughtException', (err) => dire(`exception non rattrapée : ${(err && err.stack) || err}`));
process.on('unhandledRejection', (err) => dire(`promesse rejetée sans suite : ${(err && err.stack) || err}`));
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => { dire(`signal ${sig} reçu : arrêt demandé de l’extérieur`); process.exit(128); });
