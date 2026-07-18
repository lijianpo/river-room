import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  envDir: '../..',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['poker-chip.svg'],
      manifest: {
        name: 'River Room 德州牌室',
        short_name: 'River Room',
        description: '多人联机德州扑克与 AI 牌友',
        theme_color: '#07130f',
        background_color: '#050b09',
        display: 'standalone',
        orientation: 'any',
        icons: [
          { src: '/poker-chip.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/poker-chip.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api\//, /^\/socket\.io\//],
        runtimeCaching: [],
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 5174,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: false },
      '/media': { target: 'http://localhost:3001', changeOrigin: false },
      '/socket.io': { target: 'http://localhost:3001', changeOrigin: false, ws: true },
    },
  },
});
