import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { legacyCss } from './tools/legacy-css';

const API_TARGET = process.env.API_TARGET ?? 'http://localhost:8080';

export default defineConfig({
  // `legacyCss` en dernier : il retravaille ce que Tailwind a produit.
  plugins: [react(), tailwindcss(), legacyCss()],
  server: {
    port: 5173,
    // En développement le front est servi par Vite : les appels API et le
    // callback OAuth sont renvoyés vers Fastify pour que les cookies de session
    // restent sur une seule origine.
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // Le même moteur que celui visé par `legacyCss` : sans ça esbuild laisse
    // passer `?.` et `??`, absents avant Chromium 80, et la page reste blanche
    // au lieu de mal s'afficher.
    target: 'chrome79',
    // La CSS, elle, n'est pas confiée à esbuild : `legacyCss` l'abaisse ensuite
    // avec Lightning CSS, qui sait le faire sans renoncer devant `@layer`.
    cssTarget: 'chrome111',
    rollupOptions: {
      output: {
        // Sépare React du code applicatif : le vendor change rarement et reste
        // en cache navigateur d'un déploiement à l'autre.
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
        },
      },
    },
  },
});
