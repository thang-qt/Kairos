import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import appCss from '../styles.css?url'

const themeScript = `
(() => {
  try {
    const themeModes = ['light', 'dark', 'system']
    const themePalettes = ['default', 'harvest', 'mist', 'canopy', 'ember', 'tide']
    const paletteClassNames = [
      'theme-default',
      'theme-harvest',
      'theme-mist',
      'theme-canopy',
      'theme-ember',
      'theme-tide',
    ]
    const legacyPaletteMap = {
      gruvbox: 'harvest',
      catppuccin: 'mist',
      everforest: 'canopy',
    }
    function readSettings() {
      const stored = localStorage.getItem('chat-settings')
      let themeMode = 'system'
      let themePalette = 'default'
      if (stored) {
        const parsed = JSON.parse(stored)
        const settings = parsed?.state?.settings
        const storedThemeMode = settings?.themeMode ?? settings?.theme
        const storedThemePalette =
          legacyPaletteMap[settings?.themePalette] ?? settings?.themePalette
        if (themeModes.includes(storedThemeMode)) {
          themeMode = storedThemeMode
        }
        if (themePalettes.includes(storedThemePalette)) {
          themePalette = storedThemePalette
        }
      }
      return { themeMode, themePalette }
    }
    const root = document.documentElement
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const { themeMode, themePalette } = readSettings()
      root.classList.remove('light', 'dark', 'system', ...paletteClassNames)
      root.classList.add(themeMode, 'theme-' + themePalette)
      if (themeMode === 'system' && media.matches) {
        root.classList.add('dark')
      }
    }
    apply()
    media.addEventListener('change', () => {
      const { themeMode } = readSettings()
      if (themeMode === 'system') apply()
    })
  } catch {}
})()
`

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Kairos',
      },
      {
        name: 'description',
        content: 'A focused AI chat app.',
      },
      {
        property: 'og:image',
        content: '/cover.jpg',
      },
      {
        property: 'og:image:type',
        content: 'image/jpeg',
      },
      {
        name: 'twitter:card',
        content: 'summary_large_image',
      },
      {
        name: 'twitter:image',
        content: '/cover.jpg',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
      {
        rel: 'icon',
        type: 'image/svg+xml',
        href: '/favicon.svg',
      },
    ],
  }),

  shellComponent: RootDocument,
  component: RootLayout,
  notFoundComponent: RootNotFound,
})

const queryClient = new QueryClient()

function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <HeadContent />
      </head>
      <body>
        <div className="root">{children}</div>
        <Scripts />
      </body>
    </html>
  )
}

function RootNotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-6">
      <p className="text-pretty text-sm text-primary-700">Page not found.</p>
    </div>
  )
}
