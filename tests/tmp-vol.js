const { app, BaseWindow, WebContentsView } = require('electron');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.setPath('userData', require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'orbe-anim-')));
app.whenReady().then(async () => {
  const win = new BaseWindow({ width: 900, height: 600, show: false });
  win.showInactive();
  const v = new WebContentsView();
  win.contentView.addChildView(v);
  await v.webContents.loadURL('data:text/html,<body style="margin:0;background:teal">x');
  const real = async () => v.webContents.executeJavaScript('innerWidth+"x"+innerHeight');
  const A = { x: 10, y: 10, width: 800, height: 500 };
  const B = { x: 250, y: 10, width: 560, height: 500 };
  const C = { x: 100, y: 10, width: 700, height: 500 };
  const g = () => JSON.stringify(v.getBounds());
  let t0 = Date.now(); const ev = [];
  v.on('bounds-changed', () => ev.push(`${Date.now() - t0}ms:${v.getBounds().x},${v.getBounds().width}`));
  const reset = async () => { v.setBounds(A); await sleep(300); ev.length = 0; t0 = Date.now(); };
  v.setBounds(A); await sleep(300);
  console.log('0 départ', g(), await real());

  await reset();
  v.setBounds(B, { animate: { duration: 200, easing: 'linear' } });
  await sleep(100); console.log('1 animé simple, à 100 ms', g(), await real());
  await sleep(300); console.log('1 à 400 ms', g(), await real(), 'événements', ev.join(' '));

  await reset();
  v.setBounds(B, { animate: { duration: 400, easing: 'linear' } });
  await sleep(150);
  v.setBounds(C); // direct en plein vol
  console.log('2 direct en vol, aussitôt', g(), await real());
  await sleep(100); console.log('2 +100', g(), await real());
  await sleep(1500); console.log('2 +1600 (après la fin théorique)', g(), await real(), 'événements', ev.join(' '));
  v.setBounds(C); await sleep(100); console.log('2 après un second direct vers C', g(), await real());
  v.setBounds(A); await sleep(100); console.log('2 après direct vers A', g(), await real());

  await reset();
  v.setBounds(B, { animate: { duration: 400, easing: 'linear' } });
  await sleep(150);
  v.setBounds(C, { animate: { duration: 200, easing: 'linear' } });
  await sleep(50); console.log('3 animé puis animé, +50', g(), await real());
  await sleep(600); console.log('3 fin', g(), await real(), 'événements', ev.join(' '));

  await reset();
  v.setBounds(B, { animate: { duration: 400, easing: 'linear' } });
  await sleep(150);
  v.setBounds(C, { animate: { duration: 1 } });
  await sleep(100); console.log('4 animé puis animé 1 ms, +100', g(), await real(), 'événements', ev.join(' '));
  await sleep(500); console.log('4 fin', g(), await real(), 'événements', ev.join(' '));

  // même cible directe en vol
  await reset();
  v.setBounds(B, { animate: { duration: 400, easing: 'linear' } });
  await sleep(150);
  v.setBounds(B);
  console.log('5 direct même cible en vol, aussitôt', g(), await real());
  await sleep(600); console.log('5 fin', g(), await real(), 'événements', ev.join(' '));

  // retrait de la vue en vol
  await reset();
  v.setBounds(B, { animate: { duration: 400, easing: 'linear' } });
  await sleep(150);
  win.contentView.removeChildView(v);
  await sleep(500);
  win.contentView.addChildView(v);
  console.log('6 retirée en vol puis remise', g(), await real(), 'événements', ev.join(' '));
  v.setBounds(A); await sleep(100); console.log('6 direct A', g(), await real());
  app.exit(0);
});
