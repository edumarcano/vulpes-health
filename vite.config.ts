import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { publicAuthConfig } from './shared/auth.js';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { securityHeadersForSupabase } from './server/http/security.js';
import { apiProxy, localLogger } from './scripts/local-proxy.js';
import { pwaShell } from './scripts/pwa.js';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_SUPABASE_');
  const auth = publicAuthConfig(
    env.VITE_SUPABASE_URL,
    env.VITE_SUPABASE_PUBLISHABLE_KEY,
  );
  const headers = securityHeadersForSupabase(auth?.url);
  return {
    customLogger: localLogger,
    plugins: [react(), tailwindcss(), pwaShell()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      headers: {
        ...headers,
        'Content-Security-Policy': headers['Content-Security-Policy']
          .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
          .replace(
            "connect-src 'self'",
            "connect-src 'self' ws://127.0.0.1:5173",
          ),
      },
      proxy: { '/api': apiProxy },
    },
    preview: { headers, proxy: { '/api': apiProxy } },
    build: { sourcemap: false },
  };
});
