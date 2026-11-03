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

export function ThemeContextProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem("ms-theme");
    return stored === "light" ? "light" : "dark";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("ms-theme", theme);
  }, [theme]);

  useEffect(() => {
    hydrateDisplayAccessibilityPreferences();
  }, []);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  return React.createElement(ThemeContext.Provider, { value: { theme, toggleTheme, setTheme } }, children);
}
