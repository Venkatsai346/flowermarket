import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Storefront — the customer-facing app (Phase 6.4 / P2).
 *
 * Runs on a different port from the console so both can be developed side by
 * side. In production it is served for every `{slug}.{root}` hostname and for
 * verified custom domains; the app itself is tenant-agnostic and learns who it
 * is from `GET /domains/bootstrap`, which the API resolves from the Host.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 5174,
    allowedHosts: true, // the preview/storefront host varies; dev-only
    proxy: {
      // NOTE: no `changeOrigin` here — deliberately. The Host header IS the
      // store's identity (`<slug>.localhost` in dev, subdomains/custom domains
      // in prod), and rewriting it to the backend's address would collapse
      // every storefront to the fallback tenant.
      '/api': { target: process.env.VITE_API_TARGET || 'http://localhost:4000' },
      '/media/local': { target: process.env.VITE_API_TARGET || 'http://localhost:4000' },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/lucide-react')) return 'lucide';
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react-router') || id.includes('node_modules/react/')) return 'react';
          return undefined;
        },
      },
    },
  },
});
