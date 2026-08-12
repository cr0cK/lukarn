import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { legacyCss } from './tools/legacy-css';

const API_TARGET = process.env.API_TARGET ?? 'http://localhost:8080';

export default defineConfig({
  // `legacyCss` last: it reworks what Tailwind produced.
  plugins: [react(), tailwindcss(), legacyCss()],
  server: {
    port: 5173,
    // In development the front end is served by Vite: API calls and the
    // OAuth callback are forwarded to Fastify so session cookies stay on a
    // single origin.
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // The same engine targeted by `legacyCss`: without this, esbuild lets
    // `?.` and `??` through, absent before Chromium 80, and the page stays
    // blank instead of rendering badly.
    target: 'chrome79',
    // CSS, though, isn't left to esbuild: `legacyCss` lowers it afterwards
    // with Lightning CSS, which can do so without giving up on `@layer`.
    cssTarget: 'chrome111',
    rollupOptions: {
      output: {
        // Separates React from application code: the vendor changes rarely and
        // stays cached in the browser across deployments.
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
        },
      },
    },
  },
});
