// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { createContext, useContext, useEffect, useState } from "react";

export type Theme = "dark" | "light";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  toggleTheme: () => {},
  setTheme: () => {},
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

function applyThemeToDom(nextTheme: Theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (root.getAttribute("data-theme") !== nextTheme) {
    root.setAttribute("data-theme", nextTheme);
  }
  if (root.style.colorScheme !== nextTheme) {
    root.style.colorScheme = nextTheme;
  }
}

export function ThemeContextProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem("ms-theme");
    return stored === "light" ? "light" : "dark";
  });

  useEffect(() => {
    applyThemeToDom(theme);
    try {
      localStorage.setItem("ms-theme", theme);
    } catch {
      // Ignore storage write errors
    }
  }, [theme]);

  useEffect(() => {
    hydrateDisplayAccessibilityPreferences();
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
        localStorage.setItem("ms-theme", newTheme);
      }
    } catch {
      // Ignore storage write errors
    }
    setThemeState(newTheme);
  }, []);

  const toggleTheme = React.useCallback(() => {
    const currentAttr = typeof document !== "undefined" ? document.documentElement.getAttribute("data-theme") : null;
    const currentTheme: Theme = currentAttr === "light" || currentAttr === "dark" ? currentAttr : theme;
    changeThemeWithTransition(currentTheme === "dark" ? "light" : "dark");
  }, [theme, changeThemeWithTransition]);

  const contextValue = React.useMemo(
    () => ({ theme, toggleTheme, setTheme: changeThemeWithTransition }),
    [theme, toggleTheme, changeThemeWithTransition],
  );

  return React.createElement(ThemeContext.Provider, { value: contextValue }, children);
}
