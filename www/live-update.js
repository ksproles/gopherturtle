// Live updates for the iPhone and Android apps. Every push publishes the
// latest web code (screens, features, fixes) to Firebase Hosting; the app
// checks for it, downloads it in the background, and switches to it the next
// time it's reopened. If an update fails to start, the plugin goes back to the
// last version that worked. Native changes (new plugins, permissions, icons)
// still need an App Store build: live/latest.json says which app version an
// update needs (see live-update.json).
import { nativePlugin } from './native.js';

const MANIFEST_URL = 'https://gopher-turtle.web.app/live/latest.json';
const CHECK_EVERY = 30 * 60 * 1000;

// null on the website, which updates itself
let plugin;
function updater() {
  if (plugin === undefined) plugin = nativePlugin('CapacitorUpdater');
  return plugin;
}

// Tells the plugin this version started fine, so it keeps it.
export async function confirmAppReady() {
  const u = updater();
  if (!u) return;
  try { await u.notifyAppReady(); } catch (e) { console.warn('Live update: notifyAppReady failed', e); }
}

// "1.10" >= "1.9"
function versionAtLeast(have, need) {
  const a = String(have).split('.').map(Number);
  const b = String(need).split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0, y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return true;
}

let lastCheck = 0;
let checking = false;
export async function checkForUpdate() {
  const u = updater();
  if (!u || checking || Date.now() - lastCheck < CHECK_EVERY) return;
  checking = true;
  lastCheck = Date.now();
  try {
    const res = await fetch(`${MANIFEST_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const latest = await res.json();
    if (!latest.version || !latest.url) return;
    const { bundle, native } = await u.current();
    if (bundle && bundle.version === latest.version) return; // already running it
    if (latest.minNative && !versionAtLeast(native, latest.minNative)) return; // needs a newer app build
    const { bundles } = await u.list();
    let next = bundles.find(b => b.version === latest.version && b.status === 'success');
    if (!next) next = await u.download({ url: latest.url, version: latest.version, checksum: latest.checksum });
    await u.next({ id: next.id }); // switches over the next time the app is reopened
  } catch (e) {
    console.warn('Live update check failed', e);
  } finally {
    checking = false;
  }
}

// Check on launch and whenever the app comes back to the front (at most every 30 minutes).
export function startLiveUpdates() {
  try {
    if (!updater()) return;
  } catch (e) {
    console.warn('Live updates unavailable', e);
    return;
  }
  confirmAppReady();
  checkForUpdate();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate();
  });
}
