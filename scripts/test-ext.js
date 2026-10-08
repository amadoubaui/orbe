#!/usr/bin/env node
// Lance les tests de la couche d'API des extensions dans le vrai navigateur.
//   node scripts/test-ext.js           extension d'essai, sans réseau (tests/ext-api.js)
//   node scripts/test-ext.js reelles   vraies extensions du Chrome Web Store (tests/ext-reelles.js)
const { spawn } = require('child_process');
const path = require('path');
const { ensure, root } = require('./dev');

const scenario = process.argv[2] === 'reelles' ? 'ext-reelles.js' : 'ext-api.js';
const child = spawn(process.execPath, [ensure(), root, '--selftest'], {
  stdio: 'inherit',
  env: { ...process.env, ORBE_SCENARIO: path.join(root, 'tests', scenario) },
});
child.on('exit', (code) => process.exit(code == null ? 1 : code));
