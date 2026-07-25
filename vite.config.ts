import { URL, fileURLToPath } from 'node:url'

import { tanstackRouter } from '@tanstack/router-plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { configDefaults, defineConfig } from 'vitest/config'
import { VitePWA } from 'vite-plugin-pwa'
import viteTsConfigPaths from 'vite-tsconfig-paths'

const config = defineConfig({
  build: {
    outDir: 'internal/server/static',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      routesDirectory: './src/routes',
      generatedRouteTree: './src/routeTree.gen.ts',
      routeFileIgnorePattern: '.(test|spec).(ts|tsx)$',
    }),
    viteTsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tailwindcss(),
    viteReact(),
    VitePWA({
      strategies: 'generateSW',
      registerType: 'prompt',
      injectRegister: 'script-defer',
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,json,txt,png,jpg,jpeg,svg,woff2}'],
        globIgnores: [
          '**/assets/KaTeX_*',
          '**/assets/code-block-*',
          '**/assets/mermaid-*',
        ],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern:
              /\/assets\/(?:KaTeX_|code-block-|mermaid-)[^/]+\.(?:css|js|ttf|woff|woff2)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'kairos-rich-rendering-v1',
              cacheableResponse: {
                statuses: [0, 200],
              },
              expiration: {
                maxAgeSeconds: 60 * 60 * 24 * 30,
                maxEntries: 80,
              },
            },
          },
        ],
      },
    }),
  ],
  test: {
    exclude: [...configDefaults.exclude, '**/.direnv/**'],
  },
})

export default config
