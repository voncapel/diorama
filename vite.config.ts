import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Studio build: studio.html entry + public/ copy (manifest, icons).
export default defineConfig({
  plugins: [react()],
  publicDir: 'public',
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
    rollupOptions: {
      input: {
        studio: resolve(__dirname, 'studio.html'),
        loading: resolve(__dirname, 'loading.html'),
      },
    },
  },
});
