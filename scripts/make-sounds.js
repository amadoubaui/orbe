#!/usr/bin/env node
// Fabrique les sons d'Orbe (originaux, synthétisés ici : aucun fichier tiers).
//   node scripts/make-sounds.js  -> src/renderer/sons/capture.wav
const fs = require('fs');
const path = require('path');

const RATE = 44100;

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(Math.max(-1, Math.min(1, v)) * 32767 | 0, i * 2));
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(RATE, 24); head.writeUInt32LE(RATE * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

// Capture : deux petits clics secs (obturateur) suivis d'une note douce qui s'éteint.
function capture() {
  const n = Math.round(RATE * 0.42);
  const out = new Float32Array(n);
  let seed = 7;
  const noise = () => { seed = (seed * 16807) % 2147483647; return seed / 1073741823 - 1; };
  let low = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const click = (at) => { const d = t - at; return d < 0 ? 0 : Math.exp(-d * 420); };
    low += (noise() - low) * 0.55;
    const shutter = low * (click(0) * 0.5 + click(0.055) * 0.38);
    const tone = t > 0.06 ? Math.sin(2 * Math.PI * 880 * t) * Math.exp(-(t - 0.06) * 16) * 0.16 + Math.sin(2 * Math.PI * 1320 * t) * Math.exp(-(t - 0.06) * 22) * 0.07 : 0;
    out[i] = shutter + tone;
  }
  return wav([...out]);
}

const dir = path.join(__dirname, '..', 'src', 'renderer', 'sons');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'capture.wav'), capture());
console.log('Sons écrits dans ' + dir);
