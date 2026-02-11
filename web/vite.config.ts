import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  root: 'client',
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  server: {
    port: 4001,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        configure: (proxy) => {
          proxy.on('error', () => { /* backend restarting, ignore */ });
        },
      },
      '/ws': {
        target: 'ws://localhost:4000',
        ws: true,
        configure: (proxy) => {
          proxy.on('error', () => { /* backend restarting, ignore */ });
        },
      },
      '/avatars': {
        target: 'http://localhost:4000',
        configure: (proxy) => {
          proxy.on('error', () => { /* backend restarting, ignore */ });
        },
      },
    },
  },
});
