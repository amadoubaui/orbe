// Tests d'interface d'Orbe : Playwright pilote le vrai navigateur avec de
// vraies entrées (clics, frappes, glisser-déposer) et lit le résultat dans la
// barre latérale.
//   node scripts/test-ui.js            tous les groupes
//   node scripts/test-ui.js glisser    seulement les groupes dont le nom contient « glisser »
//
// Chaque groupe (fichier NN-nom.js) démarre un navigateur neuf sur un profil
// temporaire. Une vérification précédée de « BOGUE: » décrit un défaut connu de
// l'application : son échec est signalé mais ne fait pas échouer la suite.
const fs = require('fs');
const path = require('path');
const { lancer, delai } = require('./harness');

const FOCUS = process.env.ORBE_UI_FOCUS === '1';
const total = { ok: 0, ko: 0, bogues: 0, corriges: 0, ignores: 0 };
const echecs = [];
const bogues = [];

const court = (err) => String((err && err.message) || err).split('\n')[0].slice(0, 300);

function rapport(groupe, ctx) {
  const essai = async (fn) => {
    if (ctx.bloque) throw new Error('application bloquée par une vérification précédente');
    await delai(Promise.resolve().then(fn), 40000, 'vérification');
  };
  const t = {
    // Vérification normale : son échec fait échouer la suite.
    async verifier(nom, fn) {
      try {
        await essai(fn);
        total.ok += 1;
        console.log(`  ✓ ${nom}`);
        return true;
      } catch (err) {
        total.ko += 1;
        echecs.push(`${groupe} › ${nom}`);
        console.log(`  ✗ ${nom} — ${court(err)}`);
        return false;
      }
    },
    // Défaut connu de l'application (à corriger dans src/) : l'échec est attendu.
    async bogue(nom, fn) {
      try {
        await essai(fn);
        total.corriges += 1;
        console.log(`  ✓ BOGUE corrigé ? ${nom} (la vérification passe : retirer le marqueur)`);
        return true;
      } catch (err) {
        total.bogues += 1;
        bogues.push(`${groupe} › ${nom}`);
        console.log(`  ⚠ BOGUE: ${nom} — ${court(err)}`);
        return false;
      }
    },
    ignorer(nom, raison) {
      total.ignores += 1;
      console.log(`  – ignoré : ${nom} (${raison})`);
    },
    // Vérifications qui lisent le focus natif : la fenêtre doit être au premier
    // plan, ce qui prend le clavier. Uniquement avec ORBE_UI_FOCUS=1.
    avecFocus(mode, nom, fn) {
      if (!FOCUS) return t.ignorer(nom, 'ORBE_UI_FOCUS=1 requis : lit le focus clavier natif');
      return t[mode](nom, fn);
    },
  };
  return t;
}

async function main() {
  const filtres = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const fichiers = fs.readdirSync(__dirname)
    .filter((f) => /^\d\d-.*\.js$/.test(f))
    .filter((f) => !filtres.length || filtres.some((x) => f.includes(x)))
    .sort();
  console.log('\nOrbe — tests d’interface (Playwright, vraies entrées souris et clavier)');
  if (!FOCUS) console.log('Fenêtre de test ouverte sans prendre le clavier (ORBE_UI_FOCUS=1 pour les vérifications de focus).');

  for (const f of fichiers) {
    const groupe = require(path.join(__dirname, f));
    console.log(`\n${groupe.nom}`);
    let ctx = null;
    try {
      ctx = await delai(lancer(), 45000, 'lancement du navigateur');
      await groupe.test(ctx, rapport(groupe.nom, ctx));
    } catch (err) {
      total.ko += 1;
      echecs.push(`${groupe.nom} › (groupe interrompu)`);
      console.log(`  ✗ groupe interrompu — ${court(err)}`);
    } finally {
      if (ctx) await ctx.fermer();
    }
  }

  const n = total.ok + total.ko;
  console.log(`\n${total.ok}/${n} vérifications réussies`
    + (total.bogues ? `, ${total.bogues} bogue(s) connu(s)` : '')
    + (total.corriges ? `, ${total.corriges} bogue(s) apparemment corrigé(s)` : '')
    + (total.ignores ? `, ${total.ignores} ignorée(s)` : ''));
  if (bogues.length) console.log('\nBogues connus :\n' + bogues.map((b) => '  ⚠ ' + b).join('\n'));
  if (echecs.length) console.log('\nÉchecs :\n' + echecs.map((b) => '  ✗ ' + b).join('\n'));
  console.log('');
  process.exit(total.ko ? 1 : 0);
}

main().catch((err) => { console.error('\nÉCHEC', err); process.exit(1); });
