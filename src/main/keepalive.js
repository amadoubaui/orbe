// Sites qui restent vivants : messageries, courrier, agendas, musique, documents
// en cours d'édition. Comme dans Arc (`keepaliveAllowList`), leurs onglets ne sont
// pas endormis d'office après un temps sans être affichés, ni pour libérer de la
// mémoire : on y attend des messages, une alerte, la suite d'un morceau.
// La limite en nombre choisie par l'utilisateur (« maxLiveTabs ») reste respectée.
//
// Une règle : un nom d'hôte (lui-même ou ses sous-domaines si `sub`), et au besoin
// le début du chemin. La comparaison porte sur l'adresse analysée, jamais sur un
// texte trouvé n'importe où dans l'adresse.
const RULES = [
  { host: 'twitter.com', sub: true }, { host: 'x.com' },
  { host: 'app.slack.com', path: '/client' },
  { host: 'mail.google.com', path: '/mail' },
  { host: 'calendar.google.com', path: '/calendar' },
  { host: 'notion.so', sub: true }, { host: 'app.notion.com' },
  { host: 'dropbox.com', sub: true },
  { host: 'aws.amazon.com', sub: true },
  { host: 'open.spotify.com' },
  { host: 'linear.app' },
  { host: 'instagram.com', sub: true },
  { host: 'messenger.com', sub: true },
  { host: 'facebook.com', sub: true },
  { host: 'web.whatsapp.com' },
  { host: 'sentry.io', sub: true },
  { host: 'figma.com', sub: true, path: '/file/' }, { host: 'figma.com', sub: true, path: '/design/' },
  { host: 'docs.google.com', path: '/document' },
  { host: 'docs.google.com', path: '/presentation' },
  { host: 'docs.google.com', path: '/spreadsheets' },
  { host: 'outlook.live.com', path: '/mail' }, { host: 'outlook.live.com', path: '/calendar' },
  { host: 'outlook.office.com', path: '/mail' }, { host: 'outlook.office.com', path: '/calendar' },
  { host: 'teams.microsoft.com' },
  { host: 'discord.com', path: '/channels' },
  { host: 'web.telegram.org' },
  { host: 'music.youtube.com' },
  { host: 'music.apple.com' },
  { host: 'deezer.com', sub: true },
];

function matches(url) {
  let u;
  try { u = new URL(String(url)); } catch { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  return RULES.some((r) => (host === r.host || (r.sub && host.endsWith('.' + r.host))) && (!r.path || u.pathname.startsWith(r.path)));
}

module.exports = { matches, RULES };
