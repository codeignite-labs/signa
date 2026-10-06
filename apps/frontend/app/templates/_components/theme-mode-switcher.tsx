"use client"

import { useEffect, useLayoutEffect, useSyncExternalStore } from "react"

import { ThemeSwitcher } from "@/components/kibo-ui/theme-switcher"

type ThemeMode = "light" | "dark" | "system"

const storageKey = "signa.theme"
const themeChangeEvent = "signa.theme.changed"

export function ThemeModeSwitcher() {
  const theme = useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    getServerThemeSnapshot
  )

  useLayoutEffect(() => {
    applyTheme(getThemeSnapshot())
  }, [theme])

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")

    function handleSystemThemeChange() {
      if (getThemeSnapshot() === "system") {
        applyTheme("system")
      }
    }

    mediaQuery.addEventListener("change", handleSystemThemeChange)

    return () => {
      mediaQuery.removeEventListener("change", handleSystemThemeChange)
    }
  }, [])

  function handleThemeChange(nextTheme: ThemeMode) {
    window.localStorage.setItem(storageKey, nextTheme)
    window.dispatchEvent(new Event(themeChangeEvent))
  }

  return <ThemeSwitcher onChange={handleThemeChange} value={theme} />
}

function subscribeToTheme(onStoreChange: () => void): () => void {
  window.addEventListener("storage", onStoreChange)
  window.addEventListener(themeChangeEvent, onStoreChange)

  return () => {
    window.removeEventListener("storage", onStoreChange)
    window.removeEventListener(themeChangeEvent, onStoreChange)
  }
}

function getThemeSnapshot(): ThemeMode {
  try {
    const storedTheme = window.localStorage.getItem(storageKey)
    return isThemeMode(storedTheme) ? storedTheme : "system"
  } catch {
    return "system"
  }
}

function getServerThemeSnapshot(): ThemeMode {
  return "system"
}

function isThemeMode(value: string | null): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system"
}

function applyTheme(theme: ThemeMode) {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
  const dark = theme === "dark" || (theme === "system" && prefersDark)

  document.documentElement.classList.toggle("dark", dark)
}
