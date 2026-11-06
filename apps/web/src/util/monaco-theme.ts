// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Monaco } from "@monaco-editor/react";

export const MONACO_THEME_DARK = "vs-dark";
export const MONACO_THEME_LIGHT = "vs";

let themesDefined = false;

/**
 * Ensures Monaco editor uses the standard default VS Code themes ("vs-dark" and "vs").
 * Registers aliases for backward compatibility without overriding syntax token colors or font weights.
 */
export function ensureMonacoThemesDefined(monaco: Monaco | typeof import("monaco-editor")): void {
  if (themesDefined || !monaco?.editor?.defineTheme) return;

  try {
    monaco.editor.defineTheme("modelscript-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: {},
    });

    monaco.editor.defineTheme("modelscript-light", {
      base: "vs",
      inherit: true,
      rules: [],
      colors: {},
    });
  } catch {
    // Ignore if themes cannot be defined
  }

  themesDefined = true;
}

/**
 * Returns the standard VS Code Monaco theme name for the given app theme mode.
 */
export function getMonacoThemeName(theme: "dark" | "light" | string): string {
  return theme === "dark" || theme === "vs-dark" || theme === "modelscript-dark" ? "vs-dark" : "vs";
}
