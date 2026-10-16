;(() => {
  try {
    const themeModes = ['light', 'dark', 'system']
    const themePalettes = [
      'default',
      'harvest',
      'mist',
      'canopy',
      'ember',
      'tide',
    ]
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
      updateThemeColorMeta()
    }

    function updateThemeColorMeta() {
      const styles = getComputedStyle(root)
      const lightSurface = styles
        .getPropertyValue('--theme-light-surface')
        .trim()
      const darkSurface = styles.getPropertyValue('--theme-dark-surface').trim()
      const currentSurface = styles.getPropertyValue('--theme-surface').trim()

      document
        .querySelector('[data-theme-color-mode="light"]')
        ?.setAttribute('content', lightSurface)
      document
        .querySelector('[data-theme-color-mode="dark"]')
        ?.setAttribute('content', darkSurface)
      document
        .querySelector('[data-theme-color-mode="current"]')
        ?.setAttribute('content', currentSurface)
    }

    apply()
    media.addEventListener('change', () => {
      const { themeMode } = readSettings()
      if (themeMode === 'system') {
        apply()
      }
    })
  } catch {}
})()
