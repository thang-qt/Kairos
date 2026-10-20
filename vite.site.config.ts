import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The landing page reuses the web app's renderer and theme tokens, so it is
// built from this repo rather than kept as a separate site.
export default defineConfig({
  root: 'site',
  base: './',
  // Shares the app's fonts and icons.
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      // MessageItem needs only render preferences, not the app's persisted store.
      {
        find: '@/app/preferences/app-preferences',
        replacement: fileURLToPath(
          new URL('./site/site-preferences.ts', import.meta.url),
        ),
      },
      {
        find: '@',
        replacement: fileURLToPath(new URL('./src', import.meta.url)),
      },
    ],
  },
  build: {
    outDir: '../dist/site',
    emptyOutDir: true,
  },
})
