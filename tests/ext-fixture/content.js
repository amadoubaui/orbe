// Script de contenu : se signale au service worker et répond aux messages.
chrome.runtime.sendMessage({ type: 'hello' }).then((r) => { document.documentElement.dataset.orbeTab = String(r && r.tab); }).catch(() => {});
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg === 'titre') reply(document.title);
});
