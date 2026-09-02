import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Vite config — web admin console.
 * - binds 0.0.0.0 so the live preview can reach it
 * - proxies /api/* → the Flower Market API (sandbox :4000) so the browser never
 *   calls localhost directly (preview-host-safe)
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true, // live-preview host varies per sandbox; dev-only
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:4000',
        changeOrigin: true,
      },
      // Uploaded media lives on the API server's local storage; the browser
      // must not call localhost directly, so proxy /media/local → API too.
      '/media/local': {
        target: process.env.VITE_API_TARGET || 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
