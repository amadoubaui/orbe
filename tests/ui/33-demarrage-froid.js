// Démarrage à froid : au lancement réel de l'application, la page de l'onglet
// restauré doit commencer à charger d'elle-même. Constaté sur l'application
// réelle : la demande de navigation initiale échoue (ERR_FAILED, rejetée et
// avalée) pendant que les extensions du profil se chargent dans sa session ;
// seul un rechargement la fait démarrer. Le rejeu dans la même instance
// (groupe 32) ne reproduit pas le défaut : il faut un vrai premier lancement
// sur un profil déjà rempli, d'où les deux lancements successifs sur le même
// dossier de données.
//
// Une extension est installée dans le profil avant le second lancement : c'est
// son chargement dans la session qui fait échouer la première navigation. La
// page servie est lente à répondre, comme un vrai site (la navigation est donc
// encore en vol quand l'extension arrive).
//
// Deux lancements successifs sur le même profil peuvent dépasser la limite de
// 40 s imposée à une vérification : la préparation et le second lancement sont
// donc hors vérification, seule l'observation du chargement y reste.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { lancer } = require('./harness');
const extensions = require('../../src/main/extensions');

// Installe une extension minimale dans le dossier de données du profil, comme
// le ferait un utilisateur : dossier versionné + state.json.
function installerExtension(userData) {
  const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pub = publicKey.export({ type: 'spki', format: 'der' });
  const id = extensions.idFromPublicKey(pub);
  const version = '1.0.0';
  const dir = path.join(userData, 'Extensions', id, version);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    manifest_version: 3,
    name: 'Orbe — essai de démarrage',
    version,
    key: pub.toString('base64'),
    background: { service_worker: 'sw.js' },
    content_scripts: [{ matches: ['http://127.0.0.1/*'], js: ['content.js'], run_at: 'document_start' }],
  }));
  fs.writeFileSync(path.join(dir, 'sw.js'), '// rien\n');
  fs.writeFileSync(path.join(dir, 'content.js'), '// rien\n');
  fs.writeFileSync(path.join(userData, 'Extensions', 'state.json'), JSON.stringify({
    version: 1,
    extensions: { [id]: { enabled: true, current: version, installedAt: Date.now() } },
  }));
}

module.exports = {
  nom: 'Démarrage à froid : l’onglet restauré charge sans rechargement',
  async test(ctx, t) {
    const url = ctx.url('/lent?ms=800');
    let froid = null;
    try {
      // Première phase : une session à restaurer, mémorisée dans ce profil.
      // L'Espace reçoit un profil distinct : sa session `persist:` ne sera
      // créée qu'au lancement suivant, juste avant la première navigation —
      // c'est la configuration du défaut constaté sur l'application réelle.
      await t.verifier('la session à restaurer est préparée', async () => {
        await ctx.principal(({ w, store }, adresse) => {
          const profil = 'profil-froid';
          store.state.profiles.push({ id: profil, name: 'Profil froid' });
          w.space.profileId = profil;
          const tab = w.createTab(adresse);
          w.activeBySpace[w.space.id] = tab.id;
          w.remember();
          store.flush();
          return tab.id;
        }, url);
      });

      // Ferme l'application seule : le profil et les pages locales restent.
      await ctx.arreter();

      // Extension installée : son chargement dans la session, au lancement
      // suivant, tombe en pleine première navigation.
      installerExtension(ctx.userData);

      // Second lancement, à froid, sur le même profil : la fenêtre restaurée
      // doit charger son onglet actif sans aucune intervention.
      froid = await lancer({ userData: ctx.userData, serveur: ctx.serveur });

      await t.verifier('la page restaurée commence à charger au lancement', async () => {
        await froid.jusqua(() => froid.principal(({ w }) => w.activeId), 'onglet restauré actif', 10000);
        await froid.jusqua(() => froid.principal(({ w }) => w.activeRt), 'vue restaurée présente', 10000);

        // Attend que la navigation démarre vraiment (adresse ou chargement).
        const debut = Date.now();
        let vu = null;
        while (Date.now() - debut < 8000) {
          vu = await froid.principal(({ w }) => {
            const rt = w.activeRt;
            if (!rt) return null;
            return { url: rt.wc.getURL(), chargement: rt.wc.isLoading(), principal: rt.wc.isLoadingMainFrame() };
          });
          if (vu && (vu.url || vu.chargement)) break;
          await froid.sleep(100);
        }
        if (!vu || (!vu.url && !vu.chargement)) {
          throw new Error('la vue restaurée n’a jamais commencé à charger : ' + JSON.stringify(vu));
        }
        await froid.attendreOnglet('/lent?ms=800');
      });
    } finally {
      if (froid) await froid.fermer().catch(() => {});
    }
  },
};
