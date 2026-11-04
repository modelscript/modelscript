// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { createContext, useContext, useEffect, useState } from "react";

export type Theme = "dark" | "light";

export interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  isOverridden: boolean;
  clearThemeOverride: () => void;
}

const STORAGE_KEY = "ms-theme";

export function getSystemPreferredTheme(): Theme {
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return "dark";
}

export function getStoredThemeOverride(): Theme | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") {
      return stored;
    }
  } catch {
    // Ignore storage read errors
  }
  return null;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  toggleTheme: () => {},
  setTheme: () => {},
  isOverridden: false,
  clearThemeOverride: () => {},
});

export const useTheme = () => useContext(ThemeContext);

export function hydrateDisplayAccessibilityPreferences(targetRoot?: HTMLElement): void {
  try {
    if (typeof localStorage === "undefined") return;
    const raw = localStorage.getItem("modelscript_display_accessibility");
    if (!raw) return;
    const parsed = JSON.parse(raw) as {
      fontScale?: number;
      compactDensity?: boolean;
      reducedMotion?: boolean;
      highContrast?: boolean;
    };
    const root = targetRoot || (typeof document !== "undefined" ? document.documentElement : null);
    if (!root) return;
    if (parsed.fontScale === 90 || parsed.fontScale === 100 || parsed.fontScale === 110 || parsed.fontScale === 120) {
      root.style.fontSize = `${parsed.fontScale}%`;
      root.style.setProperty("--ui-font-scale", String(parsed.fontScale / 100));
    }
    if (parsed.compactDensity) root.setAttribute("data-density", "compact");
    if (parsed.reducedMotion) root.setAttribute("data-reduced-motion", "true");
    if (parsed.highContrast) root.setAttribute("data-high-contrast", "true");
  } catch {
    // Ignore storage parse errors
  }
}

export function applyThemeToDom(nextTheme: Theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (root.getAttribute("data-theme") !== nextTheme) {
    root.setAttribute("data-theme", nextTheme);
  }
  if (root.getAttribute("data-color-mode") !== nextTheme) {
    root.setAttribute("data-color-mode", nextTheme);
  }
  if (root.style.colorScheme !== nextTheme) {
    root.style.colorScheme = nextTheme;
  }
  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (metaThemeColor) {
    const targetColor = nextTheme === "dark" ? "#0a0f1c" : "#ffffff";
    if (metaThemeColor.getAttribute("content") !== targetColor) {
      metaThemeColor.setAttribute("content", targetColor);
    }
  }
}

export function ThemeContextProvider({ children }: { children: React.ReactNode }) {
  const [themeOverride, setThemeOverride] = useState<Theme | null>(() => getStoredThemeOverride());
  const [systemTheme, setSystemTheme] = useState<Theme>(() => getSystemPreferredTheme());

  const theme: Theme = themeOverride ?? systemTheme;

  useEffect(() => {
    applyThemeToDom(theme);
  }, [theme]);

  useEffect(() => {
    hydrateDisplayAccessibilityPreferences();
  }, []);

  // Listen to OS / user agent prefers-color-scheme changes
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      setSystemTheme(e.matches ? "dark" : "light");
    };
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", handleChange);
      return () => media.removeEventListener("change", handleChange);
    }
    const legacyMedia = media as unknown as {
      addListener?: (h: (e: MediaQueryListEvent | MediaQueryList) => void) => void;
      removeListener?: (h: (e: MediaQueryListEvent | MediaQueryList) => void) => void;
    };
    if (typeof legacyMedia.addListener === "function") {
      legacyMedia.addListener(handleChange);
      return () => legacyMedia.removeListener?.(handleChange);
    }
    return undefined;
  }, []);

  // Listen to multi-tab storage synchronization
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        if (e.newValue === "light" || e.newValue === "dark") {
          setThemeOverride(e.newValue);
        } else if (!e.newValue) {
          setThemeOverride(null);
        }
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const changeThemeWithTransition = React.useCallback((newTheme: Theme) => {
    if (typeof document !== "undefined") {
      const root = document.documentElement;
      root.classList.add("theme-transitioning");
      applyThemeToDom(newTheme);
      const cleanup = () => {
        root.classList.remove("theme-transitioning");
      };
      if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(cleanup);
        });
      } else if (typeof window !== "undefined") {
        window.setTimeout(cleanup, 32);
      }
    }
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(STORAGE_KEY, newTheme);
      }
    } catch {
      // Ignore storage write errors
    }
    setThemeOverride(newTheme);
  }, []);

  const clearThemeOverride = React.useCallback(() => {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Ignore storage write errors
    }
    const targetTheme = getSystemPreferredTheme();
    if (typeof document !== "undefined") {
      const root = document.documentElement;
      root.classList.add("theme-transitioning");
      applyThemeToDom(targetTheme);
      const cleanup = () => {
        root.classList.remove("theme-transitioning");
      };
      if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(cleanup);
        });
      } else if (typeof window !== "undefined") {
        window.setTimeout(cleanup, 32);
      }
    }
    setThemeOverride(null);
  }, []);

  const toggleTheme = React.useCallback(() => {
    const currentAttr = typeof document !== "undefined" ? document.documentElement.getAttribute("data-theme") : null;
    const currentTheme: Theme = currentAttr === "light" || currentAttr === "dark" ? currentAttr : theme;
    changeThemeWithTransition(currentTheme === "dark" ? "light" : "dark");
  }, [theme, changeThemeWithTransition]);

  const contextValue = React.useMemo(
    () => ({
      theme,
      toggleTheme,
      setTheme: changeThemeWithTransition,
      isOverridden: themeOverride !== null,
      clearThemeOverride,
    }),
    [theme, toggleTheme, changeThemeWithTransition, themeOverride, clearThemeOverride],
  );

  return React.createElement(ThemeContext.Provider, { value: contextValue }, children);
}
