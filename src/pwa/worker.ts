import { HANDOFF_PROTOCOL, SHARE_ACTION } from '../../shared/import-handoff';
import { sweepImports } from '../lib/import-handoff';
import { receiveShareRequest } from './receive-share';

declare const __VULPES_PUBLIC_ASSETS__: string[];
declare const __VULPES_CACHE_VERSION__: string;
const worker = self as unknown as ServiceWorkerGlobalScope;
const assets = __VULPES_PUBLIC_ASSETS__;
const cacheName = 'vulpes-static-' + __VULPES_CACHE_VERSION__;
worker.addEventListener('install', (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(assets)));
});
worker.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter(
                (key) => key.startsWith('vulpes-static-') && key !== cacheName,
              )
              .map((key) => caches.delete(key)),
          ),
        ),
      sweepImports().catch(() => undefined),
    ]),
  );
});
worker.addEventListener('message', (event) => {
  if (event.data?.type === 'vulpes-import-protocol')
    event.ports[0]?.postMessage({ protocol: HANDOFF_PROTOCOL });
});
worker.addEventListener('fetch', (event) => {
  const request = event.request,
    url = new URL(request.url);
  if (url.origin !== worker.location.origin) return;
  if (url.pathname === SHARE_ACTION) {
    event.respondWith(receiveShareRequest(request));
    return;
  }
  if (request.method !== 'GET' || request.headers.has('authorization')) return;
  if (!url.search && assets.includes(url.pathname)) {
    event.respondWith(
      caches
        .open(cacheName)
        .then(
          async (cache) => (await cache.match(url.pathname)) || fetch(request),
        ),
    );
  } else if (
    request.mode === 'navigate' &&
    /^\/(?:ask|goals|data|settings)(?:\/|$)/.test(url.pathname)
  ) {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(cacheName);
        return (await cache.match(
          url.pathname === '/data/import'
            ? '/share-offline.html'
            : '/offline.html',
        ))!;
      }),
    );
  }
});
