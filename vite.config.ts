import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { securityHeaders } from './server/http/security.js';
import { apiProxy, localLogger } from './scripts/local-proxy.js';

export default defineConfig({
  customLogger: localLogger,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    headers: {
      ...securityHeaders,
      'Content-Security-Policy': securityHeaders['Content-Security-Policy']
        .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
        .replace("connect-src 'self'", "connect-src 'self' ws://127.0.0.1:5173"),
    },
    proxy: { '/api': apiProxy },
  },
  preview: { headers: securityHeaders, proxy: { '/api': apiProxy } },
  build: { sourcemap: false },
});
