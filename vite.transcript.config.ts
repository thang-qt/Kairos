import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      // The shared code renderer needs only this hook, not the app's persisted store.
      {
        find: '@/app/preferences/app-preferences',
        replacement: fileURLToPath(
          new URL('./src/transcript/theme.ts', import.meta.url),
        ),
      },
      {
        find: '@',
        replacement: fileURLToPath(new URL('./src', import.meta.url)),
      },
    ],
  },
  build: {
    outDir: 'android/app/src/main/assets/transcript',
    emptyOutDir: true,
    rollupOptions: { input: 'transcript.html' },
  },
})
