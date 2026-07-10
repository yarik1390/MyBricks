import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const file = resolve('public/.well-known/assetlinks.json');
const supplied = process.argv[2] || process.env.ANDROID_APP_LINK_SHA256 || '';
const fingerprints = supplied.split(',').map(value => value.trim().toUpperCase()).filter(Boolean);
const validFingerprint = /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/;

if (!fingerprints.length) {
  if (process.argv.includes('--check')) {
    throw new Error('ANDROID_APP_LINK_SHA256 is required for a Play release');
  }
  console.warn('ANDROID_APP_LINK_SHA256 is unset; keeping the existing App Link fingerprints.');
  process.exit(0);
}
for (const fingerprint of fingerprints) {
  if (!validFingerprint.test(fingerprint)) throw new Error(`Invalid SHA-256 fingerprint: ${fingerprint}`);
}

const document = JSON.parse(await readFile(file, 'utf8'));
const androidTarget = document.find(entry => entry?.target?.package_name === 'app.bricksvault');
if (!androidTarget) throw new Error('assetlinks.json has no app.bricksvault target');
const existing = Array.isArray(androidTarget.target.sha256_cert_fingerprints)
  ? androidTarget.target.sha256_cert_fingerprints
  : [];
androidTarget.target.sha256_cert_fingerprints = [...new Set([...existing, ...fingerprints])];
await writeFile(file, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
console.log(`Configured ${androidTarget.target.sha256_cert_fingerprints.length} Android App Link fingerprint(s).`);
