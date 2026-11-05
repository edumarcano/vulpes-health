import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

// Public assets are enumerated at build time. No runtime URL becomes a cache key.
export function pwaShell(): Plugin {
  return {
    name: 'vulpes-static-shell',
    apply: 'build',
    generateBundle(_options, bundle) {
      const publicAssets = [
        '/offline.html',
        '/offline.css',
        '/manifest.webmanifest',
        '/icons/favicon-32.png',
        '/icons/apple-touch-icon.png',
        '/icons/vulpes-192.png',
        '/icons/vulpes-512.png',
        '/icons/vulpes-maskable-1024.png',
        '/brand/vulpes-horizontal.png',
        '/brand/vulpes-reversed.png',
      ];
      const assets = [
        ...Object.keys(bundle)
          .filter((name) => /^assets\/[\w.-]+\.(?:js|css)$/.test(name))
          .map((name) => '/' + name),
        ...publicAssets,
      ];
      const hash = createHash('sha256').update(JSON.stringify(assets));
      for (const asset of publicAssets)
        hash.update(readFileSync('public' + asset));
      const version = hash.digest('hex').slice(0, 16);
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: staticWorker(assets, version),
      });
    },
  };
}

export function staticWorker(
  assets: readonly string[],
  version: string,
): string {
  return `const CACHE = ${JSON.stringify('vulpes-static-' + version)};
const ASSETS = ${JSON.stringify(assets)};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});
// New versions wait for existing tabs to close; never interrupt an active run.
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('vulpes-static-') && key !== CACHE).map(key => caches.delete(key)))));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || request.headers.has('authorization')) return;
  if (!url.search && ASSETS.includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(url.pathname)) || fetch(request)));
  } else if (request.mode === 'navigate' && /^\\/(?:ask|goals|data|settings)(?:\\/|$)/.test(url.pathname)) {
    event.respondWith(fetch(request).catch(() => caches.open(CACHE).then(cache => cache.match('/offline.html'))));
  }
});
`;
}
