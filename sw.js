/* Bump the version whenever any cached file changes before publishing. */
'use strict';
const CACHE = 'metronomi-v20';
const FILES = [
  './', './index.html', './styles.css', './config.js', './app.js',
  './manifest.webmanifest', './assets/icon.svg', './assets/icon-180.png',
  './assets/icon-192.png', './assets/icon-512.png',
  './assets/tick-1s.wav', './assets/tick-5s.wav', './assets/tick-15s.wav',
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)));
  // A new version waits until old app windows close, preventing mixed versions.
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('metronomi-') && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type !== 'CHECK_OFFLINE') return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const entries = await Promise.all(FILES.map(file => cache.match(file)));
    event.ports[0]?.postMessage({ ready: entries.every(Boolean) });
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cached = await (await caches.open(CACHE)).match(request.url);
    if (!cached) return fetch(request);
    // Safari requests byte ranges when playing media. Serve ranges from the
    // fully cached recording so audio remains seekable and playable offline.
    const range = request.headers.get('Range');
    if (!range || !new URL(request.url).pathname.endsWith('.wav')) return cached;
    const bytes = await cached.arrayBuffer();
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    const headers = new Headers(cached.headers);
    headers.set('Accept-Ranges', 'bytes');
    let start = 0, end = bytes.byteLength - 1;
    if (match && (match[1] || match[2])) {
      if (!match[1]) start = Math.max(0, bytes.byteLength - Number(match[2]));
      else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
    } else return cached; // Ignore unsupported multiple ranges as a full 200 response.
    if (start > end || start >= bytes.byteLength) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${bytes.byteLength}` } });
    }
    headers.set('Content-Range', `bytes ${start}-${end}/${bytes.byteLength}`);
    headers.set('Content-Length', String(end - start + 1));
    return new Response(bytes.slice(start, end + 1), { status: 206, headers });
  })());
});
