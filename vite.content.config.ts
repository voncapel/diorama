import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const target = process.env['DIORAMA_TARGET'] === 'background' ? 'background' : 'content';

const ENTRIES = {
  content: resolve(__dirname, 'src/content/index.ts'),
  background: resolve(__dirname, 'src/background/index.ts'),
} as const;

/**
 * Flat, unhashed IIFE bundles. MV3 loads `content.js` via executeScript and
 * `background.js` as the service worker, so neither may be code-split.
 */
export default defineConfig({
  plugins: [react()],
  publicDir: false,
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env['NODE_ENV'] || 'production'),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'esnext',
    minify: false,
    lib: {
      entry: ENTRIES[target],
      formats: ['iife'],
      name: target === 'background' ? 'DioramaBackground' : 'DioramaContent',
      fileName: () => `${target}.js`,
    },
    rollupOptions: {
      output: { extend: true, inlineDynamicImports: true },
    },
  },
});
