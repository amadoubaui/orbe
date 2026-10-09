// Lecteurs miniatures de la barre latérale : un par onglet qui joue du son hors
// de vue (plusieurs à la fois, le plus récent en haut).
//
// Ce que la page annonce — titre, artiste, pochette (`navigator.mediaSession`),
// position et durée de son élément <audio>/<video> — est lu par une question
// posée à la page (`INFO`) : tout y est tenu pour hostile. Les textes sont bornés
// et ne voyagent que comme du texte (la coque les pose par `textContent`) ; la
// pochette n'est acceptée qu'en http(s) ou `data:image`, téléchargée dans la
// session de la page elle-même (ses témoins, son profil, son bloqueur), bornée
// en poids, puis redessinée en petit par Orbe : la coque ne reçoit jamais
// l'adresse de la page, seulement l'image recodée.
//
// Précédent / suivant : ce sont les gestionnaires que la page a elle-même
// déclarés (`mediaSession.setActionHandler`), retenus par src/preload/media.js.
const path = require('path');
const { nativeImage } = require('electron');

const PRELOAD = path.join(__dirname, '../preload/media.js');
const LIMITS = {
  players: 4, // lecteurs affichés à la fois
  text: 160, // titre, artiste (caractères)
  url: 2048, // adresse d'une pochette
  dataUrl: 400 * 1024, // pochette donnée en data:image (caractères)
  bytes: 2 * 1024 * 1024, // pochette téléchargée (octets)
  art: 96, // côté de la pochette envoyée à la coque (px)
  poll: 1000, // période de la question posée aux pages (ms)
  step: 15, // saut avant / arrière (s)
  drift: 1.5, // écart de position (s) au-delà duquel la coque est recalée
};
const ACTIONS = new Set(['toggle', 'prev', 'next', 'back', 'forward', 'seek', 'close', 'mute', 'open', 'volume']);
const attached = new WeakSet();

// Élément qui compte dans la page : celui qui joue, sinon le dernier entamé.
const PICK = `const all = [...document.querySelectorAll('video, audio')];
  const m = all.find((x) => !x.paused && !x.ended) || all.filter((x) => x.currentTime > 0).sort((a, b) => b.currentTime - a.currentTime)[0] || all[0] || null;`;
const INFO = `(() => { try {
  ${PICK}
  const ms = navigator.mediaSession;
  const md = ms && ms.metadata;
  let art = '';
  try {
    const list = md && md.artwork ? [...md.artwork] : [];
    const size = (a) => parseInt(String(a.sizes || '').split('x')[0], 10) || 0;
    const best = list.filter((a) => size(a) >= 96).sort((a, b) => size(a) - size(b))[0] || list[list.length - 1];
    if (best) art = String(best.src || '');
  } catch {}
  let acts = [];
  try { acts = ms && ms.__orbeActions ? [...ms.__orbeActions.keys()].map(String) : []; } catch {}
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
  return {
    has: !!m, paused: m ? !!m.paused : true, t: m ? num(m.currentTime) : 0, d: m ? num(m.duration) : 0, v: m && typeof m.volume === 'number' ? m.volume : 1,
    title: md ? String(md.title || '') : '', artist: md ? String(md.artist || '') : '', art, acts,
  };
} catch { return null; } })()`;
const TOGGLE = `(() => { ${PICK} if (m) { if (m.paused) m.play().catch(() => {}); else m.pause(); } return !!m && !m.paused; })()`;
const seekCode = (expr) => `(() => { ${PICK} if (!m || !isFinite(m.duration)) return false; m.currentTime = Math.max(0, Math.min(m.duration, ${expr})); return true; })()`;
// Volume de l'onglet : Electron n'offre que le muet. Le réglage est donc celui des
// lecteurs de la page (tous ses <audio>/<video>), comme le ferait son propre curseur.
const volumeCode = (v) => `(() => { let n = 0; document.querySelectorAll('video, audio').forEach((x) => { try { x.volume = ${v}; n += 1; } catch {} }); return n > 0; })()`;
const actCode = (name) => `(() => { try { const h = navigator.mediaSession.__orbeActions.get(${JSON.stringify(name)}); if (typeof h !== 'function') return false; h({ action: ${JSON.stringify(name)} }); return true; } catch { return false; } })()`;

const text = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ' ').trim().slice(0, LIMITS.text) : '');
const num = (v, max = 360000) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(v, max) : 0);

// Pochette annoncée par la page : acceptable ?
function artworkKind(src) {
  if (typeof src !== 'string' || !src) return '';
  if (/^data:image\/(png|jpeg|webp|gif);base64,/i.test(src)) return src.length <= LIMITS.dataUrl ? 'data' : '';
  if (src.length > LIMITS.url) return '';
  try { return /^https?:$/.test(new URL(src).protocol) ? 'http' : ''; } catch { return ''; }
}

// Image recodée en petit, ou '' si ce n'en est pas une.
function shrink(img) {
  try {
    if (!img || img.isEmpty()) return '';
    const { width, height } = img.getSize();
    if (!width || !height || width > 8192 || height > 8192) return '';
    const side = LIMITS.art * 2; // écrans à forte densité
    const small = width > side || height > side ? img.resize(width >= height ? { width: side, quality: 'good' } : { height: side, quality: 'good' }) : img;
    return 'data:image/png;base64,' + small.toPNG().toString('base64');
  } catch { return ''; }
}

// Va chercher la pochette dans la session de la page. Rend une data:image/png, ou ''.
async function loadArtwork(ses, src) {
  const kind = artworkKind(src);
  if (kind === 'data') return shrink(nativeImage.createFromDataURL(src));
  if (kind !== 'http') return '';
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await ses.fetch(src, { signal: ctl.signal, credentials: 'omit', redirect: 'follow' });
      if (!res.ok || !/^image\//i.test(res.headers.get('content-type') || '')) return '';
      if (Number(res.headers.get('content-length') || 0) > LIMITS.bytes) return '';
      const chunks = [];
      let total = 0;
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > LIMITS.bytes) { ctl.abort(); return ''; }
        chunks.push(Buffer.from(value));
      }
      return shrink(nativeImage.createFromBuffer(Buffer.concat(chunks)));
    } finally { clearTimeout(timer); }
  } catch { return ''; }
}

// Réponse de la page, remise au propre. Rien n'en sort qui ne soit borné et typé.
function clean(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const acts = Array.isArray(r.acts) ? r.acts.filter((a) => typeof a === 'string').slice(0, 16) : [];
  const d = num(r.d);
  return {
    has: r.has === true,
    paused: r.paused !== false,
    position: Math.min(num(r.t), d || 360000),
    duration: d,
    volume: typeof r.v === 'number' && r.v >= 0 && r.v <= 1 ? Math.round(r.v * 100) / 100 : 1,
    track: text(r.title),
    artist: text(r.artist),
    artSrc: artworkKind(r.art) ? r.art : '',
    prev: acts.includes('previoustrack'),
    next: acts.includes('nexttrack'),
  };
}

function players(w) {
  if (!w.players) w.players = [];
  return w.players;
}

function make(env) {
  const { live, pushAll } = env;
  let timer = null;

  const rtOf = (id) => { const rt = live.get(id); return rt && !rt.wc.isDestroyed() ? rt : null; };

  function tick() {
    let any = false;
    for (const w of env.windows()) {
      for (const id of players(w)) { any = true; refresh(w, id); }
    }
    if (!any) { clearInterval(timer); timer = null; }
  }
  function watch() {
    if (!timer) { timer = setInterval(tick, LIMITS.poll); if (timer.unref) timer.unref(); }
  }

  // Interroge la page de l'onglet ; pousse l'état s'il a changé.
  async function refresh(w, id) {
    const rt = rtOf(id);
    if (!rt || rt.mediaBusy) return null;
    rt.mediaBusy = true;
    let raw = null;
    try { raw = await Promise.race([rt.wc.executeJavaScript(INFO), new Promise((r) => setTimeout(() => r(null), 3000))]); } catch {}
    rt.mediaBusy = false;
    if (rt.wc.isDestroyed()) return null;
    const info = clean(raw);
    const before = rt.media || {};
    const art = info.artSrc === before.artSrc ? before.art || '' : '';
    // La position n'est renvoyée à la coque que si elle s'écarte de celle qu'elle
    // déduit seule (lecture à vitesse normale depuis le dernier envoi) : pas
    // d'état poussé à chaque seconde de lecture.
    const now = Date.now();
    const expected = before.at ? before.position + (before.paused ? 0 : (now - before.at) / 1000) : -1;
    const drift = !info.duration || Math.abs(info.position - (info.duration ? Math.min(expected, info.duration) : expected)) > LIMITS.drift;
    const changed = drift || ['has', 'paused', 'track', 'artist', 'prev', 'next', 'volume'].some((k) => before[k] !== info[k]) || Math.round(before.duration || 0) !== Math.round(info.duration);
    rt.media = changed ? { ...info, art, at: now } : { ...info, art, position: before.position, at: before.at };
    if (info.has) rt.playing = !info.paused;
    if (info.artSrc && info.artSrc !== before.artSrc) {
      const src = info.artSrc;
      loadArtwork(rt.wc.session, src).then((data) => {
        if (rt.wc.isDestroyed() || !rt.media || rt.media.artSrc !== src) return;
        rt.media.art = data;
        if (data) pushAll();
      });
    }
    if (changed && (info.has || before.has)) pushAll();
    return rt.media;
  }

  // L'onglet `id` joue hors de vue : il reçoit un lecteur (en tête).
  function add(w, id) {
    const list = players(w);
    const i = list.indexOf(id);
    if (i === 0) return;
    if (i > 0) list.splice(i, 1);
    list.unshift(id);
    if (list.length > LIMITS.players) list.length = LIMITS.players;
    watch();
    refresh(w, id);
  }
  function drop(w, id) {
    const list = players(w);
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1);
  }

  // Lecteurs à montrer : onglets encore là, vivants, hors de vue.
  function payload(w, settings) {
    const list = players(w);
    const visible = w.visibleIds();
    for (const id of [...list]) if (!rtOf(id) || !w.data.tabs[id] || visible.includes(id)) drop(w, id);
    if (settings.mediaControls === false) return [];
    return list.map((id) => {
      const rt = rtOf(id);
      const tab = w.data.tabs[id];
      const m = rt.media || {};
      const title = tab.customTitle || tab.title || env.strip(tab.url);
      return {
        id,
        title: m.track || title,
        sub: m.track ? (m.artist || title) : '',
        url: tab.url,
        favicon: tab.favicon || '',
        art: m.art || '',
        playing: m.has ? !m.paused : rt.wc.isCurrentlyAudible() || (!!rt.playing && !tab.muted),
        muted: !!tab.muted,
        volume: m.has && typeof m.volume === 'number' ? m.volume : 1,
        position: Math.min(m.duration || 360000, (m.position || 0) + (m.has && !m.paused && m.at ? (Date.now() - m.at) / 1000 : 0)),
        duration: m.duration || 0,
        prev: !!m.prev,
        next: !!m.next,
        seek: !!m.duration,
      };
    });
  }

  // Geste sur un lecteur. `a` vient de la coque : tout y est vérifié.
  function act(w, a) {
    if (!a || typeof a !== 'object' || !ACTIONS.has(a.act)) return false;
    const id = typeof a.id === 'string' ? a.id : players(w)[0];
    if (!players(w).includes(id)) return false;
    const rt = rtOf(id);
    if (!rt) return false;
    const run = (code) => rt.wc.executeJavaScript(code, true).then((r) => { refresh(w, id); return r; }, () => false);
    switch (a.act) {
      case 'open': return w.activate(id);
      case 'mute': return w.toggleMute(id);
      case 'close':
        // La croix : le son s'arrête, le lecteur s'en va ; l'onglet reste.
        rt.playing = false;
        rt.wc.executeJavaScript(`document.querySelectorAll('video, audio').forEach((x) => { try { x.pause(); } catch {} })`, true).catch(() => {});
        drop(w, id);
        pushAll();
        return true;
      case 'toggle':
        rt.playing = !rt.playing;
        if (rt.media) { const m = rt.media; if (!m.paused && m.at) m.position = Math.min(m.duration || 360000, m.position + (Date.now() - m.at) / 1000); m.at = Date.now(); m.paused = !rt.playing; }
        pushAll();
        return run(TOGGLE);
      case 'prev': return run(actCode('previoustrack'));
      case 'next': return run(actCode('nexttrack'));
      case 'back': return run(seekCode(`m.currentTime - ${LIMITS.step}`));
      case 'forward': return run(seekCode(`m.currentTime + ${LIMITS.step}`));
      case 'seek': {
        const to = Number(a.value);
        if (!Number.isFinite(to) || to < 0) return false;
        if (rt.media) { rt.media.position = Math.min(to, rt.media.duration || to); rt.media.at = Date.now(); }
        return run(seekCode(String(Math.min(to, 360000))));
      }
      case 'volume': {
        const v = Number(a.value);
        if (typeof a.value !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) return false;
        const to = Math.round(v * 100) / 100;
        if (rt.media) rt.media.volume = to;
        return run(volumeCode(String(to)));
      }
      default: return false;
    }
  }

  return { add, drop, payload, act, refresh, players, stop: () => { clearInterval(timer); timer = null; } };
}

// Script qui retient les gestionnaires `mediaSession` des pages (par session).
function attach(ses) {
  if (!ses || attached.has(ses)) return;
  attached.add(ses);
  ses.registerPreloadScript({ type: 'frame', filePath: PRELOAD, id: 'orbe-media' });
}

module.exports = { make, attach, clean, artworkKind, loadArtwork, shrink, LIMITS, INFO };
