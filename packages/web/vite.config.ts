import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API_TARGET = process.env.API_TARGET ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
