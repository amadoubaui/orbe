// Lecteurs miniatures de la barre latérale : un par onglet qui joue hors de vue.
// Chargé avant shell.js, qui appelle `renderPlayers(liste)` à chaque état.
//
// Tout ce qui vient de la page (titre, artiste) est posé par `textContent` ; la
// pochette est une image recodée par le processus principal (src/main/media.js).
// Mouvements : transformations et opacité seulement — le titre trop long défile,
// la barre d'avancement s'étire, les commandes remplacent le titre au survol.
(() => {
  const act = (id, name, value) => O.send('mediaAct', { id, act: name, value });
  const svg = (name) => `<svg class="i"><use href="#i-${name}"/></svg>`;
  const cards = new Map(); // id -> élément
  const FINE = { dead: 14, per: 34 }; // recherche fine : au-delà de `dead` px au-dessus, la vitesse est divisée par 1 + d / `per`

  function button(cls, iconName, key, onClick) {
    const b = document.createElement('button');
    b.className = cls;
    b.innerHTML = svg(iconName); // noms d'icônes fixes, écrits ici
    b.title = t(key);
    b.dataset.key = key;
    b.onclick = (e) => { e.stopPropagation(); onClick(); };
    return b;
  }

  function build(p) {
    const el = document.createElement('div');
    el.className = 'mp';
    el.dataset.id = p.id;
    const open = document.createElement('button');
    open.className = 'mp-open';
    open.title = t('media.open');
    open.onclick = () => act(p.id, 'open');
    const art = document.createElement('span');
    art.className = 'mp-art';
    const text = document.createElement('span');
    text.className = 'mp-text';
    const title = document.createElement('span');
    title.className = 'mp-title';
    const inner = document.createElement('span');
    title.appendChild(inner);
    const sub = document.createElement('span');
    sub.className = 'mp-sub';
    text.append(title, sub);
    open.append(art, text);
    const ctl = document.createElement('div');
    ctl.className = 'mp-ctl';
    const prev = button('ib mp-prev', 'prev', 'media.prev', () => act(p.id, 'prev'));
    const back = button('ib mp-back', 'back15', 'media.back', () => act(p.id, 'back'));
    const fwd = button('ib mp-fwd', 'fwd15', 'media.forward', () => act(p.id, 'forward'));
    const next = button('ib mp-next', 'next', 'media.next', () => act(p.id, 'next'));
    const mute = button('ib mp-mute', 'sound', 'media.mute', () => act(p.id, 'mute'));
    ctl.append(prev, back, fwd, next, mute);
    const play = button('ib mp-play', 'pause', 'media.pause', () => act(p.id, 'toggle'));
    const x = button('mp-x', 'x', 'media.close', () => act(p.id, 'close'));
    const bar = document.createElement('div');
    bar.className = 'mp-bar';
    const fill = document.createElement('i');
    bar.appendChild(fill);
    el.append(open, ctl, play, x, bar);
    el._ = { art, title, inner, sub, prev, back, fwd, next, mute, play, bar, fill };
    scrub(el, bar);
    return el;
  }

  // Barre d'avancement : glisser pour chercher ; plus le pointeur monte au-dessus
  // de la barre, plus la recherche est fine.
  function scrub(el, bar) {
    let s = null;
    const ratio = (e) => { const r = bar.getBoundingClientRect(); return { r, v: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) }; };
    bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !el._p || !el._p.duration) return;
      const { r, v } = ratio(e);
      s = { v, x: e.clientX, top: r.top, width: r.width };
      bar.setPointerCapture(e.pointerId);
      el.classList.add('scrub');
      show(el, v);
      e.preventDefault();
    });
    bar.addEventListener('pointermove', (e) => {
      if (!s) return;
      const up = Math.max(0, s.top - e.clientY - FINE.dead);
      const speed = 1 / (1 + up / FINE.per);
      s.v = Math.max(0, Math.min(1, s.v + ((e.clientX - s.x) / s.width) * speed));
      s.x = e.clientX;
      el.dataset.fine = speed < 1 ? speed.toFixed(2) : '';
      el.classList.toggle('fine', speed < 1);
      show(el, s.v);
    });
    const end = (e) => {
      if (!s) return;
      const v = s.v;
      s = null;
      el.classList.remove('scrub', 'fine');
      if (e.type === 'pointerup' && el._p && el._p.duration) {
        el._p = { ...el._p, position: v * el._p.duration };
        progress(el, el._p, true);
        act(el.dataset.id, 'seek', el._p.position);
      } else progress(el, el._p, true);
    };
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
  }

  function show(el, v) {
    el._.fill.style.transition = 'none';
    el._.fill.style.transform = `scaleX(${v.toFixed(4)})`;
  }

  // Avancement : posé à la position connue, puis étiré d'un seul trait jusqu'à la
  // fin, à la vitesse de la lecture. Le processus principal ne renvoie une
  // position que si elle s'écarte de celle-ci : rien n'est recalculé entre-temps.
  function progress(el, p, force) {
    if (el.classList.contains('scrub')) return;
    const f = el._.fill;
    const has = !!(p && p.duration);
    if (el._.bar.hidden === has) el._.bar.hidden = !has;
    if (!has) { el._prog = null; return; }
    const g = el._prog;
    const now = performance.now();
    if (!force && g && g.playing === !!p.playing && Math.abs(g.duration - p.duration) < 0.5
      && Math.abs(p.position - Math.min(p.duration, g.position + (g.playing ? (now - g.at) / 1000 : 0))) < 1.5) return;
    el._prog = { position: p.position, duration: p.duration, playing: !!p.playing, at: now };
    f.style.transition = 'none';
    f.style.transform = `scaleX(${Math.min(1, p.position / p.duration).toFixed(4)})`;
    if (!p.playing) return;
    void f.offsetWidth; // la position de départ est validée avant l'étirement
    f.style.transition = `transform ${Math.max(0, p.duration - p.position).toFixed(2)}s linear`;
    f.style.transform = 'scaleX(1)';
  }

  // Titre plus long que sa place : il défile (aller-retour), sauf mouvement réduit.
  function marquee(el) {
    const { title, inner } = el._;
    requestAnimationFrame(() => {
      const over = Math.ceil(inner.scrollWidth - title.clientWidth);
      if (over > 4) {
        title.style.setProperty('--shift', -over + 'px');
        title.style.setProperty('--run', Math.round(4000 + over * 45) + 'ms');
        title.classList.add('run');
      } else title.classList.remove('run');
    });
  }

  function fill(el, p) {
    const _ = el._;
    el._p = p;
    const artKey = p.art || p.favicon || guessIcon(p.url) || '';
    if (el._art !== artKey) {
      el._art = artKey;
      _.art.textContent = '';
      _.art.classList.toggle('cover', !!p.art);
      const img = faviconEl(artKey, p.title);
      _.art.appendChild(img);
    }
    if (el._title !== p.title) {
      el._title = p.title;
      _.inner.textContent = p.title;
      _.title.classList.remove('run');
      marquee(el);
    }
    // Rien n'est réécrit qui n'ait changé : un état reçu ne coûte aucune mise en page.
    const key = [p.sub, p.playing, p.muted, p.prev, p.next, p.seek].join('\u0001');
    if (el._key !== key) {
      el._key = key;
      _.sub.textContent = p.sub || '';
      _.sub.hidden = !p.sub;
      el.classList.toggle('playing', !!p.playing);
      _.play.firstChild.firstChild.setAttribute('href', p.playing ? '#i-pause' : '#i-play');
      _.play.title = t(p.playing ? 'media.pause' : 'media.play');
      _.mute.firstChild.firstChild.setAttribute('href', p.muted ? '#i-mute' : '#i-sound');
      _.mute.title = t(p.muted ? 'media.unmute' : 'media.mute');
      _.prev.hidden = !p.prev;
      _.next.hidden = !p.next;
      _.back.hidden = !p.seek;
      _.fwd.hidden = !p.seek;
    }
    progress(el, p);
  }

  window.renderPlayers = (list) => {
    const host = document.getElementById('media');
    const keep = new Set(list.map((p) => p.id));
    for (const [id, el] of cards) {
      if (keep.has(id)) continue;
      cards.delete(id);
      // Le lecteur s'efface sur place avant de laisser sa place.
      el.classList.add('out');
      const gone = () => { el.remove(); host.hidden = !host.children.length; };
      el.addEventListener('animationend', gone, { once: true });
      setTimeout(gone, 400);
    }
    list.forEach((p, i) => {
      let el = cards.get(p.id);
      if (!el) { el = build(p); cards.set(p.id, el); }
      fill(el, p);
      const at = [...host.children].filter((c) => !c.classList.contains('out'))[i];
      if (at !== el) host.insertBefore(el, at || null);
    });
    const hide = !list.length && !host.children.length;
    if (list.length ? host.hidden : hide && !host.hidden) host.hidden = !list.length;
  };
})();
