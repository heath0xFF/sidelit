import { defineConfig } from 'vite';
export default defineConfig({ publicDir: false, define: { 'process.env.NODE_ENV': '"production"' }, build: {
  outDir: 'public/preview-runtime', emptyOutDir: true,
  lib: { entry: 'src/preview-runtime.tsx', name: 'SidelitMDX', formats: ['iife'], fileName: () => 'runtime.js' },
  minify: true,
} });
