import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Keep the (large) Monaco editor in its own chunk so the main app
        // bundle stays small and Monaco is cached independently.
        manualChunks(id) {
          if (id.includes('node_modules/monaco-editor')) return 'monaco';
          return null;
        },
      },
    },
    // Monaco is intentionally large and lazy-loaded; raise the warning limit so
    // it doesn't flag the (expected) monaco chunk.
    chunkSizeWarningLimit: 5000,
  },
})
