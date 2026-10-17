// Calls into the app's native plugins (iPhone/Android). The app doesn't bundle
// @capacitor/core, so window.Capacitor is the bare native bridge: it may not
// have registerPlugin, but it always has nativePromise. Returns null on the
// website, or if the plugin isn't in this build.
export function nativePlugin(name) {
  const cap = window.Capacitor;
  if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return null;
  // The native side lists its plugins in PluginHeaders (cap.Plugins stays empty without @capacitor/core).
  if (Array.isArray(cap.PluginHeaders) && !cap.PluginHeaders.some(h => h.name === name)) return null;
  if (typeof cap.nativePromise === 'function') {
    return new Proxy({}, { get: (_, method) => options => cap.nativePromise(name, String(method), options || {}) });
  }
  if (typeof cap.registerPlugin === 'function') return cap.registerPlugin(name);
  return null;
}
