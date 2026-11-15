import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2020',
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        // three.js changes rarely: a separate chunk stays cached when only app code is updated.
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
        }
      }
    },
    chunkSizeWarningLimit: 700
  }
});
