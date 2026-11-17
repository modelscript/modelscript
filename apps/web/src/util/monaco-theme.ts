// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Monaco } from "@monaco-editor/react";
import { registerAllModelscriptLanguages } from "../components/morsel/util/monaco-lsp-adapter";

export const MONACO_THEME_DARK = "modelscript-dark";
export const MONACO_THEME_LIGHT = "modelscript-light";

let themesDefined = false;

/**
 * Ensures Monaco editor uses the ModelScript dark theme ("modelscript-dark", aligned
 * with @modelscript/design-tokens Zinc surfaces and Cyan/Teal/Indigo accents) and
 * registers all ModelScript polyglot engineering language Monarch tokenizers.
 */
export function ensureMonacoThemesDefined(monaco: Monaco | typeof import("monaco-editor")): void {
  if (!monaco) return;

  try {
    registerAllModelscriptLanguages(monaco as any);
  } catch {
    // Ignore language registration errors in test environments
  }

  if (themesDefined || !monaco?.editor?.defineTheme) return;

  try {
    monaco.editor.defineTheme("modelscript-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "71717a", fontStyle: "italic" },
        { token: "keyword", foreground: "818cf8" },
        { token: "keyword.control", foreground: "c084fc" },
        { token: "type", foreground: "22d3ee" },
        { token: "type.identifier", foreground: "22d3ee" },
        { token: "string", foreground: "34d399" },
        { token: "number", foreground: "fbbf24" },
        { token: "constant", foreground: "fbbf24" },
        { token: "function", foreground: "38bdf8" },
        { token: "identifier.function", foreground: "38bdf8" },
        { token: "annotation", foreground: "2dd4bf" },
        { token: "attribute", foreground: "2dd4bf" },
        { token: "operator", foreground: "a1a1aa" },
        { token: "delimiter", foreground: "a1a1aa" },
        { token: "variable", foreground: "f4f4f5" },
      ],
      colors: {
        "editor.background": "#18181b",
        "editor.foreground": "#f4f4f5",
        "editorGutter.background": "#18181b",
        "editorLineNumber.foreground": "#52525b",
        "editorLineNumber.activeForeground": "#a1a1aa",
        "editorCursor.foreground": "#22d3ee",
        "editor.lineHighlightBackground": "#ffffff08",
        "editor.lineHighlightBorder": "#ffffff00",
        "editor.selectionBackground": "#0891b23d",
        "editor.inactiveSelectionBackground": "#0891b220",
        "editor.selectionHighlightBackground": "#22d3ee1a",
        "editor.wordHighlightBackground": "#22d3ee18",
        "editor.findMatchBackground": "#0891b259",
        "editor.findMatchHighlightBackground": "#22d3ee29",
        "editorBracketMatch.background": "#22d3ee22",
        "editorBracketMatch.border": "#22d3ee80",
        "editorIndentGuide.background1": "#27272a",
        "editorIndentGuide.activeBackground1": "#3f3f46",
        "editorWidget.background": "#1e1e22",
        "editorWidget.border": "#3f3f46",
        "editorSuggestWidget.background": "#1e1e22",
        "editorSuggestWidget.border": "#3f3f46",
        "editorSuggestWidget.selectedBackground": "#0891b238",
        "editorHoverWidget.background": "#1e1e22",
        "editorHoverWidget.border": "#3f3f46",
        "scrollbarSlider.background": "#ffffff18",
        "scrollbarSlider.hoverBackground": "#ffffff28",
        "scrollbarSlider.activeBackground": "#22d3ee44",
      },
    });

    monaco.editor.defineTheme("modelscript-light", {
      base: "vs",
      inherit: true,
      rules: [
        { token: "comment", foreground: "64748b", fontStyle: "italic" },
        { token: "keyword", foreground: "4f46e5" },
        { token: "keyword.control", foreground: "7c3aed" },
        { token: "type", foreground: "0e7490" },
        { token: "type.identifier", foreground: "0e7490" },
        { token: "string", foreground: "047857" },
        { token: "number", foreground: "b45309" },
        { token: "constant", foreground: "b45309" },
        { token: "function", foreground: "0369a1" },
        { token: "identifier.function", foreground: "0369a1" },
        { token: "annotation", foreground: "0d9488" },
        { token: "attribute", foreground: "0d9488" },
        { token: "operator", foreground: "475569" },
        { token: "delimiter", foreground: "475569" },
        { token: "variable", foreground: "0f172a" },
      ],
      colors: {
        "editor.background": "#ffffff",
        "editor.foreground": "#0f172a",
        "editorGutter.background": "#ffffff",
        "editorLineNumber.foreground": "#94a3b8",
        "editorLineNumber.activeForeground": "#475569",
        "editorCursor.foreground": "#0e7490",
        "editor.lineHighlightBackground": "#f8fafc",
        "editor.lineHighlightBorder": "#00000000",
        "editor.selectionBackground": "#0891b224",
        "editor.inactiveSelectionBackground": "#0891b214",
        "editor.selectionHighlightBackground": "#06b6d41a",
        "editor.wordHighlightBackground": "#06b6d418",
        "editor.findMatchBackground": "#0891b238",
        "editor.findMatchHighlightBackground": "#06b6d422",
        "editorBracketMatch.background": "#0891b218",
        "editorBracketMatch.border": "#0891b266",
        "editorIndentGuide.background1": "#e2e8f0",
        "editorIndentGuide.activeBackground1": "#cbd5e1",
        "editorWidget.background": "#ffffff",
        "editorWidget.border": "#cbd5e1",
        "editorSuggestWidget.background": "#ffffff",
        "editorSuggestWidget.border": "#cbd5e1",
        "editorSuggestWidget.selectedBackground": "#0891b218",
        "editorHoverWidget.background": "#ffffff",
        "editorHoverWidget.border": "#cbd5e1",
        "scrollbarSlider.background": "#0f172a18",
        "scrollbarSlider.hoverBackground": "#0f172a28",
        "scrollbarSlider.activeBackground": "#0e749044",
      },
    });
  } catch {
    // Ignore if themes cannot be defined
  }

  themesDefined = true;
}

/**
 * Returns the ModelScript Monaco theme name for the given app theme mode.
 */
export function getMonacoThemeName(theme: "dark" | "light" | string): string {
  return theme === "dark" || theme === "vs-dark" || theme === "modelscript-dark"
    ? MONACO_THEME_DARK
    : MONACO_THEME_LIGHT;
}
