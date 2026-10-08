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
