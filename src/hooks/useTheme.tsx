import * as React from 'react'

type Theme = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'rankpilot:theme'

function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'system') delete root.dataset.theme
  else root.dataset.theme = theme
}

export function useTheme() {
  const [theme, setThemeState] = React.useState<Theme>(() => (localStorage.getItem(STORAGE_KEY) as Theme) || 'system')

  React.useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const setTheme = React.useCallback((next: Theme) => {
    localStorage.setItem(STORAGE_KEY, next)
    setThemeState(next)
  }, [])

  return { theme, setTheme }
}
