import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

// Public assets are enumerated at build time. No runtime URL becomes a cache key.
export function pwaShell(): Plugin {
  return {
    name: 'vulpes-static-shell',
    apply: 'build',
    config() {
      const publicAssets = [
        '/offline.html',
        '/offline.css',
        '/share-offline.html',
        '/manifest.webmanifest',
        '/icons/favicon-32.png',
        '/icons/apple-touch-icon.png',
        '/icons/vulpes-192.png',
        '/icons/vulpes-512.png',
        '/icons/vulpes-maskable-1024.png',
        '/brand/vulpes-horizontal.png',
        '/brand/vulpes-reversed.png',
      ];
      const assets = publicAssets;
      const hash = createHash('sha256').update(JSON.stringify(assets));
      for (const asset of publicAssets)
        hash.update(readFileSync('public' + asset));
      const version = hash.digest('hex').slice(0, 16);
      return {
        define: {
          __VULPES_PUBLIC_ASSETS__: JSON.stringify(assets),
          __VULPES_CACHE_VERSION__: JSON.stringify(version),
        },
      };
    },
    buildStart() {
      this.emitFile({
        type: 'chunk',
        id: resolve('src/pwa/worker.ts'),
        fileName: 'sw.js',
      });
    },
  };
}
