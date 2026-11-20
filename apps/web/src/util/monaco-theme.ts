// SPDX-License-Identifier: AGPL-3.0-or-later

import { registerAllModelscriptLanguages } from "@modelscript/editor/workbench/util/monaco-lsp-adapter";
import type { Monaco } from "@monaco-editor/react";

export const MONACO_THEME_DARK = "vscode-dark-plus";
export const MONACO_THEME_LIGHT = "vscode-light-plus";

let themesDefined = false;

/**
 * Ensures Monaco editor defines official VS Code Dark+ ("vscode-dark-plus") and
 * Light+ ("vscode-light-plus") themes and registers all ModelScript polyglot
 * engineering language Monarch tokenizers.
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
    monaco.editor.defineTheme(MONACO_THEME_DARK, {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "6A9955" },
        { token: "keyword", foreground: "569CD6" },
        { token: "keyword.control", foreground: "C586C0" },
        { token: "storage", foreground: "569CD6" },
        { token: "modifier", foreground: "569CD6" },
        { token: "type", foreground: "4EC9B0" },
        { token: "type.identifier", foreground: "4EC9B0" },
        { token: "class", foreground: "4EC9B0" },
        { token: "struct", foreground: "4EC9B0" },
        { token: "interface", foreground: "4EC9B0" },
        { token: "enum", foreground: "4EC9B0" },
        { token: "namespace", foreground: "4EC9B0" },
        { token: "function", foreground: "DCDCAA" },
        { token: "identifier.function", foreground: "DCDCAA" },
        { token: "method", foreground: "DCDCAA" },
        { token: "variable", foreground: "9CDCFE" },
        { token: "parameter", foreground: "9CDCFE" },
        { token: "property", foreground: "9CDCFE" },
        { token: "string", foreground: "CE9178" },
        { token: "number", foreground: "B5CEA8" },
        { token: "constant", foreground: "4FC1FF" },
        { token: "annotation", foreground: "DCDCAA" },
        { token: "attribute", foreground: "9CDCFE" },
        { token: "operator", foreground: "D4D4D4" },
        { token: "delimiter", foreground: "D4D4D4" },
      ],
      colors: {
        "editor.background": "#1E1E1E",
        "editor.foreground": "#D4D4D4",
        "editorGutter.background": "#1E1E1E",
        "editorLineNumber.foreground": "#858585",
        "editorLineNumber.activeForeground": "#C6C6C6",
        "editorCursor.foreground": "#AEAFAD",
        "editor.selectionBackground": "#264F78",
        "editor.inactiveSelectionBackground": "#3A3D41",
        "editor.lineHighlightBackground": "#2A2D2E",
        "editorIndentGuide.background1": "#404040",
        "editorIndentGuide.activeBackground1": "#707070",
      },
    });

    monaco.editor.defineTheme(MONACO_THEME_LIGHT, {
      base: "vs",
      inherit: true,
      rules: [
        { token: "comment", foreground: "008000" },
        { token: "keyword", foreground: "0000FF" },
        { token: "keyword.control", foreground: "AF00DB" },
        { token: "storage", foreground: "0000FF" },
        { token: "modifier", foreground: "0000FF" },
        { token: "type", foreground: "267F99" },
        { token: "type.identifier", foreground: "267F99" },
        { token: "class", foreground: "267F99" },
        { token: "struct", foreground: "267F99" },
        { token: "interface", foreground: "267F99" },
        { token: "enum", foreground: "267F99" },
        { token: "namespace", foreground: "267F99" },
        { token: "function", foreground: "795E26" },
        { token: "identifier.function", foreground: "795E26" },
        { token: "method", foreground: "795E26" },
        { token: "variable", foreground: "001080" },
        { token: "parameter", foreground: "001080" },
        { token: "property", foreground: "001080" },
        { token: "string", foreground: "A31515" },
        { token: "number", foreground: "098658" },
        { token: "constant", foreground: "0070C1" },
        { token: "annotation", foreground: "795E26" },
        { token: "attribute", foreground: "001080" },
        { token: "operator", foreground: "000000" },
        { token: "delimiter", foreground: "000000" },
      ],
      colors: {
        "editor.background": "#FFFFFF",
        "editor.foreground": "#000000",
        "editorGutter.background": "#FFFFFF",
        "editorLineNumber.foreground": "#237893",
        "editorLineNumber.activeForeground": "#0B216F",
        "editorCursor.foreground": "#000000",
        "editor.selectionBackground": "#ADD6FF",
        "editor.inactiveSelectionBackground": "#E5EBF1",
        "editor.lineHighlightBackground": "#F3F3F3",
        "editorIndentGuide.background1": "#D3D3D3",
        "editorIndentGuide.activeBackground1": "#939393",
      },
    });
  } catch {
    // Ignore if themes cannot be defined
  }

  themesDefined = true;
}

/**
 * Returns the VS Code Dark+ / Light+ Monaco theme name for the given app theme mode.
 */
export function getMonacoThemeName(theme: "dark" | "light" | string): string {
  return theme === "dark" || theme === "vs-dark" || theme === "modelscript-dark" || theme === MONACO_THEME_DARK
    ? MONACO_THEME_DARK
    : MONACO_THEME_LIGHT;
}
