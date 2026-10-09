// TEMPORAIRE : première page après le démarrage (blocage intermittent sous Windows).
const http = require('http');

module.exports = async function premiere({ first: w, win }) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<title>Page A</title>ok'); });
  await new Promise((r) => server.listen(0, r));
  const t0 = Date.now();
  const marks = {};
  const mark = (k) => () => { if (!(k in marks)) marks[k] = Date.now() - t0; };
  // Le magasin de témoins de la session des onglets, et celui de la session par défaut.
  const ses = w.session;
  ses.cookies.get({}).then(mark('temoins'), mark('temoins-erreur'));
  require('electron').session.defaultSession.cookies.get({}).then(mark('temoins-defaut'), mark('temoins-defaut-erreur'));
  ses.resolveProxy('http://127.0.0.1/').then(mark('proxy'), mark('proxy-erreur'));
  // Une requête du processus principal, sans témoins puis avec.
  const { net } = require('electron');
  const url = `http://127.0.0.1:${server.address().port}/a`;
  net.fetch(url, { credentials: 'omit' }).then(mark('requete-sans-temoins'), mark('requete-sans-temoins-erreur'));
  ses.fetch(url).then(mark('requete-session'), mark('requete-session-erreur'));
  const tab = w.newTab(url);
  const wc = win.live.get(tab.id).wc;
  wc.once('did-finish-load', mark('page'));
  for (let i = 0; i < 240 && !('page' in marks); i++) await sleep(250);
  await sleep(300);
  const lent = !('page' in marks) || marks.page > 3000;
  console.log(`${lent ? 'LENT' : 'ok'} ${JSON.stringify(marks)}${'page' in marks ? '' : ' PAGE JAMAIS CHARGÉE EN 60 s'}`);
  server.close();
};
