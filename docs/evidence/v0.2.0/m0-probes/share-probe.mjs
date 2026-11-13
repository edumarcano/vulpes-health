/* global console, Buffer, URL, navigator, document, DataTransfer, File, indexedDB, crypto, caches, FormData, fetch, process */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';

// Disposable mechanism probe. It never imports Vulpes or sends data to its API.
const worker = `
const openDB = () => new Promise((resolve, reject) => {
  const r = indexedDB.open('m0-handoff', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('files');
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});
self.addEventListener('install', e => e.waitUntil((async () => {
  await (await caches.open('public-only')).add('/offline.html');
  await self.skipWaiting();
})()));
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (new URL(e.request.url).pathname !== '/receive' || e.request.method !== 'POST') return;
  e.respondWith((async () => {
    try {
      const form = await e.request.formData();
      const files = form.getAll('files');
      if (files.length !== 1 || !(files[0] instanceof File) || files[0].size === 0)
        return new Response('Share unavailable', { status: 400, headers: { 'Cache-Control': 'no-store', 'X-M0-Worker': 'yes' } });
      const id = crypto.randomUUID();
      const db = await openDB();
      try {
        const body = await files[0].arrayBuffer();
        await new Promise((resolve, reject) => {
          const tx = db.transaction('files', 'readwrite');
          tx.objectStore('files').add({ body, expires: Date.now() + 900000, state: 'received_unbound' }, id);
          tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
        });
      } finally { db.close(); }
      return new Response(null, { status: 303, headers: { Location: '/receipt?ref=' + id, 'Cache-Control': 'no-store', 'X-M0-Worker': 'yes' } });
    } catch {
      return new Response('Share unavailable', { status: 400, headers: { 'Cache-Control': 'no-store', 'X-M0-Worker': 'yes' } });
    }
  })());
});`;
const pageHTML = `<!doctype html><html><head><link rel="manifest" href="/manifest.json"></head><body>Isolated synthetic M0 probe</body></html>`;
let serverPosts = 0;
const server = createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'POST') {
    serverPosts++;
    req.resume();
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    res.end('Share unavailable');
  } else if (req.url === '/sw.js') {
    res.writeHead(200, {
      'Content-Type': 'text/javascript',
      'Service-Worker-Allowed': '/',
    });
    res.end(worker);
  } else if (req.url === '/manifest.json') {
    res.writeHead(200, { 'Content-Type': 'application/manifest+json' });
    res.end(
      JSON.stringify({
        name: 'M0 synthetic probe',
        start_url: '/',
        display: 'standalone',
        share_target: {
          action: '/receive',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: { files: [{ name: 'files', accept: ['text/csv', '.csv'] }] },
        },
      }),
    );
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(pageHTML);
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext();
  const external = [];
  context.on('request', (request) => {
    if (!request.url().startsWith(origin + '/'))
      external.push(new URL(request.url()).origin);
  });
  const page = await context.newPage();
  await page.goto(origin);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', resolve, {
          once: true,
        }),
      );
  });
  const csv =
    'Date,Time,Weight(lb),Remarks\r\n2026.09.01,08:00:00,150,"Synthetic, only"\r\n';
  await Promise.all([
    page.waitForURL('**/receipt?ref=*'),
    page.evaluate((text) => {
      const form = document.createElement('form');
      form.action = '/receive';
      form.method = 'POST';
      form.enctype = 'multipart/form-data';
      const input = document.createElement('input');
      input.type = 'file';
      input.name = 'files';
      const data = new DataTransfer();
      data.items.add(new File([text], 'synthetic.csv', { type: 'text/csv' }));
      input.files = data.files;
      form.append(input);
      document.body.append(form);
      form.requestSubmit();
    }, csv),
  ]);
  const reference = new URL(page.url()).searchParams.get('ref');
  assert.match(reference, /^[a-f0-9-]{36}$/);
  assert.equal(serverPosts, 0, 'Active worker must intercept the file POST.');
  const result = await page.evaluate(async (ref) => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('m0-handoff', 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const claim = (id) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction('files', 'readwrite');
        const store = tx.objectStore('files');
        const r = store.get(id);
        let value = null;
        r.onsuccess = () => {
          const row = r.result;
          store.delete(id);
          if (row && row.expires > Date.now()) value = row.body;
        };
        tx.oncomplete = () => resolve(value);
        tx.onabort = () => reject(tx.error);
      });
    const put = (id, expires) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction('files', 'readwrite');
        tx.objectStore('files').put(
          {
            body: new Uint8Array([1]).buffer,
            expires,
            state: 'received_unbound',
          },
          id,
        );
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error);
      });
    const body = await claim(ref);
    const second = await claim(ref);
    await put('expired-synthetic', Date.now() - 1);
    const expired = await claim('expired-synthetic');
    await put('cancelled-synthetic', Date.now() + 900000);
    await new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').delete('cancelled-synthetic');
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
    const cancelled = await claim('cancelled-synthetic');
    const remaining = await new Promise((resolve) => {
      const r = db.transaction('files').objectStore('files').count();
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    const hash = [
      ...new Uint8Array(await crypto.subtle.digest('SHA-256', body)),
    ]
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('');
    const cachePaths = [];
    for (const key of await caches.keys())
      for (const request of await (await caches.open(key)).keys())
        cachePaths.push(new URL(request.url).pathname);
    const rejected = [];
    for (const variant of ['missing', 'multiple', 'text']) {
      const form = new FormData();
      if (variant === 'multiple') {
        form.append('files', new File(['x'], 'a.csv'));
        form.append('files', new File(['y'], 'b.csv'));
      }
      if (variant === 'text') form.append('files', 'private synthetic text');
      const response = await fetch('/receive', { method: 'POST', body: form });
      rejected.push({
        variant,
        status: response.status,
        cacheControl: response.headers.get('Cache-Control'),
        worker: response.headers.get('X-M0-Worker'),
        body: await response.text(),
      });
    }
    return {
      hash,
      bytes: body.byteLength,
      second,
      expired,
      cancelled,
      remaining,
      cachePaths,
      rejected,
    };
  }, reference);
  assert.equal(result.hash, createHash('sha256').update(csv).digest('hex'));
  assert.equal(result.bytes, Buffer.byteLength(csv));
  for (const key of ['second', 'expired', 'cancelled'])
    assert.equal(result[key], null);
  assert.equal(result.remaining, 0);
  assert.deepEqual(result.cachePaths, ['/offline.html']);
  assert.equal(serverPosts, 0);
  for (const rejection of result.rejected) {
    assert.equal(rejection.status, 400);
    assert.equal(rejection.cacheControl, 'no-store');
    assert.equal(rejection.worker, 'yes');
    assert.equal(rejection.body, 'Share unavailable');
  }
  const fallbackContext = await browser.newContext({ serviceWorkers: 'block' });
  const fallback = await fallbackContext.newPage();
  await fallback.goto(origin);
  const unavailable = await fallback.evaluate(async () => {
    const form = new FormData();
    form.append(
      'files',
      new File(['Synthetic private bytes'], 'synthetic.csv', {
        type: 'text/csv',
      }),
    );
    const r = await fetch('/receive', { method: 'POST', body: form });
    return {
      status: r.status,
      cacheControl: r.headers.get('Cache-Control'),
      body: await r.text(),
      databases: (await indexedDB.databases()).length,
      caches: (await caches.keys()).length,
    };
  });
  assert.deepEqual(unavailable, {
    status: 503,
    cacheControl: 'no-store',
    body: 'Share unavailable',
    databases: 0,
    caches: 0,
  });
  assert.equal(serverPosts, 1);
  assert.deepEqual(external, []);
  await fallbackContext.close();
  await context.close();
  console.log(
    JSON.stringify(
      {
        artifact: 'm0_share_mechanics',
        schemaVersion: 1,
        synthetic: true,
        status: 'passed',
        browser: 'Chrome ' + browser.version(),
        platform: process.platform,
        fileBytes: result.bytes,
        fileSHA256: result.hash,
        workerIntercepted: true,
        singleClaim: true,
        expiryOnRead: true,
        cancellationCleanup: true,
        remainingHandoffs: result.remaining,
        publicCachePaths: result.cachePaths,
        invalidAttachmentsRejected: result.rejected.map((x) => x.variant),
        workerUnavailable: {
          status: unavailable.status,
          persisted: false,
          bodyEcho: false,
        },
        externalRequests: external.length,
        applicationUploads: 0,
        commits: 0,
        evidenceBoundary:
          'Desktop multipart navigation and worker/IndexedDB mechanics only; no installation, Android/RENPHO share sheet, authentication, account isolation, update/race, or AT-09 acceptance.',
      },
      null,
      2,
    ),
  );
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
