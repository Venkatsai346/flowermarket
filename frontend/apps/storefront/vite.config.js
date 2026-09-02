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
      '/api': { target: process.env.VITE_API_TARGET || 'http://localhost:4000', changeOrigin: true },
      '/media/local': { target: process.env.VITE_API_TARGET || 'http://localhost:4000', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
