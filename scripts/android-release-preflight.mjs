import { existsSync, readFileSync } from 'node:fs';

const errors = [];
const warnings = [];
const config = JSON.parse(readFileSync('capacitor.config.json', 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const gradle = readFileSync('android/app/build.gradle', 'utf8');
const assetlinks = JSON.parse(readFileSync('public/.well-known/assetlinks.json', 'utf8'));

if (config.server?.url) errors.push('Remove capacitor.config.json server.url so the release bundles public/.');
if (!pkg.dependencies?.['@capacitor/push-notifications']) errors.push('Install @capacitor/push-notifications.');
if (!existsSync('android/app/google-services.json')) errors.push('Add android/app/google-services.json from the Firebase Android app.');

const signingVars = ['ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD'];
for (const name of signingVars) if (!process.env[name]) errors.push(`Set ${name}.`);
if (!process.env.ANDROID_KEYSTORE_PATH && !existsSync('android/upload.jks')) {
  errors.push('Set ANDROID_KEYSTORE_PATH or place the upload key at android/upload.jks.');
}
if (!process.env.RC_PLAY_BILLING_KEY) warnings.push('RC_PLAY_BILLING_KEY is unset; Play billing will be unavailable in this bundle.');

const versionName = gradle.match(/versionName\s+"([^"]+)"/)?.[1];
if (!versionName) errors.push('Could not read Android versionName.');
// versionCode is derived at build time: max(git commit count, floor) — see
// derivedVersionCode in android/app/build.gradle. Guard both halves here.
const versionFloor = Number(gradle.match(/def floor = (\d+)/)?.[1]);
const hasDerivation = /rev-list/.test(gradle)
  && /versionCode\s+derivedVersionCode/.test(gradle);
if (!hasDerivation || !Number.isInteger(versionFloor)) {
  errors.push('versionCode must stay auto-derived: derivedVersionCode = max(commit count, def floor = <last uploaded>).');
}

const fingerprint = String(process.env.ANDROID_APP_LINK_SHA256 || '').trim().toUpperCase();
if (!fingerprint) {
  errors.push('Set ANDROID_APP_LINK_SHA256 to the Play App Signing SHA-256 fingerprint.');
} else {
  const configured = assetlinks.some(entry => entry?.target?.package_name === 'app.bricksvault'
    && entry.target.sha256_cert_fingerprints?.includes(fingerprint));
  if (!configured) errors.push('Run npm run android:assetlinks before release; the Play signing fingerprint is not published.');
}

console.log(`Android release ${versionName || '?'} (versionCode = max(commit count, ${Number.isInteger(versionFloor) ? versionFloor : '?'}) = derived at build time)`);
for (const warning of warnings) console.warn(`WARN: ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}
console.log('Android release preflight passed.');
