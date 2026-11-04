// SPDX-License-Identifier: AGPL-3.0-or-later

import { DARK_TOKENS, LIGHT_TOKENS } from "@modelscript/design-tokens/runtime";
import type { Monaco } from "@monaco-editor/react";

export const MONACO_THEME_DARK = "modelscript-dark";
export const MONACO_THEME_LIGHT = "modelscript-light";

let themesDefined = false;

/**
 * Defines custom ModelScript engineering themes on the Monaco editor instance
 * to match the app's obsidian dark canvas (#0a0f1c) and crisp white light canvas.
 */
export function ensureMonacoThemesDefined(monaco: Monaco | typeof import("monaco-editor")): void {
  if (themesDefined || !monaco?.editor?.defineTheme) return;

  // ── Dark Theme (Obsidian Precision) ──────────────────────────
  monaco.editor.defineTheme(MONACO_THEME_DARK, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "", foreground: "e2e8f0", background: "0a0f1c" },
      { token: "keyword", foreground: "22d3ee", fontStyle: "bold" },
      { token: "type", foreground: "38bdf8" },
      { token: "string", foreground: "34d399" },
      { token: "number", foreground: "fbbf24" },
      { token: "comment", foreground: "64748b", fontStyle: "italic" },
      { token: "delimiter", foreground: "94a3b8" },
      { token: "operator", foreground: "22d3ee" },
      { token: "identifier", foreground: "e2e8f0" },
    ],
    colors: {
      "editor.background": DARK_TOKENS.bg,
      "editor.foreground": DARK_TOKENS.textPrimary,
      "editor.lineHighlightBackground": "#0f1626",
      "editor.selectionBackground": "rgba(34, 211, 238, 0.22)",
      "editor.inactiveSelectionBackground": "rgba(34, 211, 238, 0.12)",
      "editorCursor.foreground": DARK_TOKENS.brandHover,
      "editorWhitespace.foreground": "rgba(148, 163, 184, 0.2)",
      "editorIndentGuide.background": "rgba(148, 163, 184, 0.12)",
      "editorIndentGuide.activeBackground": "rgba(34, 211, 238, 0.35)",
      "editorLineNumber.foreground": DARK_TOKENS.textMuted,
      "editorLineNumber.activeForeground": DARK_TOKENS.textPrimary,
      "editorGutter.background": DARK_TOKENS.bg,
    },
  });

  // ── Light Theme (Swiss Instrument) ────────────────────────────
  monaco.editor.defineTheme(MONACO_THEME_LIGHT, {
    base: "vs",
    inherit: true,
    rules: [
      { token: "", foreground: "0f172a", background: "ffffff" },
      { token: "keyword", foreground: "0e7490", fontStyle: "bold" },
      { token: "type", foreground: "0369a1" },
      { token: "string", foreground: "047857" },
      { token: "number", foreground: "b45309" },
      { token: "comment", foreground: "64748b", fontStyle: "italic" },
      { token: "delimiter", foreground: "475569" },
      { token: "operator", foreground: "0e7490" },
      { token: "identifier", foreground: "0f172a" },
    ],
    colors: {
      "editor.background": LIGHT_TOKENS.bg,
      "editor.foreground": LIGHT_TOKENS.textPrimary,
      "editor.lineHighlightBackground": "#f8fafc",
      "editor.selectionBackground": "rgba(8, 145, 178, 0.18)",
      "editor.inactiveSelectionBackground": "rgba(8, 145, 178, 0.1)",
      "editorCursor.foreground": LIGHT_TOKENS.brand,
      "editorWhitespace.foreground": "rgba(15, 23, 42, 0.15)",
      "editorIndentGuide.background": "rgba(15, 23, 42, 0.1)",
      "editorIndentGuide.activeBackground": "rgba(8, 145, 178, 0.4)",
      "editorLineNumber.foreground": LIGHT_TOKENS.textMuted,
      "editorLineNumber.activeForeground": LIGHT_TOKENS.textPrimary,
      "editorGutter.background": LIGHT_TOKENS.bg,
    },
  });

  themesDefined = true;
}

/**
 * Returns the appropriate Monaco theme name for the given app theme mode.
 */
export function getMonacoThemeName(theme: "dark" | "light" | string): string {
  return theme === "dark" || theme === "vs-dark" || theme === MONACO_THEME_DARK
    ? MONACO_THEME_DARK
    : MONACO_THEME_LIGHT;
}
