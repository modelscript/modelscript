// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Monaco } from "@monaco-editor/react";
import { registerAllModelscriptLanguages } from "../workbench/util/monaco-lsp-adapter";

export const MONACO_THEME_DARK = "vscode-dark-plus";
export const MONACO_THEME_LIGHT = "vscode-light-plus";

let themesDefined = false;

/**
 * Exact official VS Code Dark+ rules from:
 * - theme-defaults/themes/dark_vs.json
 * - theme-defaults/themes/dark_plus.json
 * without custom overrides.
 */
const OFFICIAL_DARK_PLUS_THEME: import("monaco-editor").editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: false,
  rules: [
    { token: "", foreground: "D4D4D4", background: "1E1E1E" },
    { token: "emphasis", fontStyle: "italic" },
    { token: "strong", fontStyle: "bold" },
    { token: "header", foreground: "000080" },
    { token: "comment", foreground: "6A9955" },
    { token: "constant.language", foreground: "569CD6" },
    { token: "constant.numeric", foreground: "B5CEA8" },
    { token: "number", foreground: "B5CEA8" },
    { token: "number.float", foreground: "B5CEA8" },
    { token: "number.hex", foreground: "B5CEA8" },
    { token: "constant.regexp", foreground: "646695" },
    { token: "constant.character", foreground: "569CD6" },
    { token: "constant.character.escape", foreground: "D7BA7D" },
    { token: "constant", foreground: "4FC1FF" },
    { token: "entity.name.tag", foreground: "569CD6" },
    { token: "tag", foreground: "569CD6" },
    { token: "entity.other.attribute-name", foreground: "9CDCFE" },
    { token: "attribute.name", foreground: "9CDCFE" },
    { token: "attribute.value", foreground: "CE9178" },
    { token: "invalid", foreground: "F44747" },
    { token: "markup.underline", fontStyle: "underline" },
    { token: "markup.bold", fontStyle: "bold", foreground: "569CD6" },
    { token: "markup.heading", fontStyle: "bold", foreground: "569CD6" },
    { token: "markup.italic", fontStyle: "italic", foreground: "C586C0" },
    { token: "markup.strikethrough", fontStyle: "strikethrough" },
    { token: "markup.inserted", foreground: "B5CEA8" },
    { token: "markup.deleted", foreground: "CE9178" },
    { token: "markup.changed", foreground: "569CD6" },
    { token: "punctuation.definition.tag", foreground: "808080" },
    { token: "delimiter.html", foreground: "808080" },
    { token: "delimiter.xml", foreground: "808080" },
    { token: "storage", foreground: "569CD6" },
    { token: "storage.type", foreground: "569CD6" },
    { token: "storage.modifier", foreground: "569CD6" },
    { token: "string", foreground: "CE9178" },
    { token: "string.tag", foreground: "CE9178" },
    { token: "string.value", foreground: "CE9178" },
    { token: "string.regexp", foreground: "D16969" },
    { token: "regexp", foreground: "D16969" },
    { token: "string.key.json", foreground: "9CDCFE" },
    { token: "string.value.json", foreground: "CE9178" },
    { token: "key", foreground: "9CDCFE" },
    { token: "keyword", foreground: "569CD6" },
    { token: "keyword.control", foreground: "C586C0" },
    { token: "keyword.flow", foreground: "C586C0" },
    { token: "keyword.operator", foreground: "D4D4D4" },
    { token: "keyword.other.unit", foreground: "B5CEA8" },
    { token: "operator", foreground: "D4D4D4" },
    { token: "delimiter", foreground: "D4D4D4" },
    { token: "entity.name.function", foreground: "DCDCAA" },
    { token: "support.function", foreground: "DCDCAA" },
    { token: "function", foreground: "DCDCAA" },
    { token: "identifier.function", foreground: "DCDCAA" },
    { token: "method", foreground: "DCDCAA" },
    { token: "predefined", foreground: "DCDCAA" },
    { token: "support.class", foreground: "4EC9B0" },
    { token: "support.type", foreground: "4EC9B0" },
    { token: "entity.name.type", foreground: "4EC9B0" },
    { token: "entity.name.namespace", foreground: "4EC9B0" },
    { token: "entity.name.class", foreground: "4EC9B0" },
    { token: "type", foreground: "4EC9B0" },
    { token: "type.identifier", foreground: "4EC9B0" },
    { token: "class", foreground: "4EC9B0" },
    { token: "struct", foreground: "4EC9B0" },
    { token: "interface", foreground: "4EC9B0" },
    { token: "enum", foreground: "4EC9B0" },
    { token: "namespace", foreground: "4EC9B0" },
    { token: "variable", foreground: "9CDCFE" },
    { token: "variable.language", foreground: "569CD6" },
    { token: "variable.predefined", foreground: "4FC1FF" },
    { token: "variable.parameter", foreground: "9CDCFE" },
    { token: "parameter", foreground: "9CDCFE" },
    { token: "property", foreground: "9CDCFE" },
    { token: "variable.other.constant", foreground: "4FC1FF" },
    { token: "variable.other.enummember", foreground: "4FC1FF" },
    { token: "enumMember", foreground: "4FC1FF" },
    { token: "entity.name.label", foreground: "C8C8C8" },
  ],
  colors: {
    "editor.background": "#1E1E1E",
    "editor.foreground": "#D4D4D4",
    "editor.inactiveSelectionBackground": "#3A3D41",
    "editorIndentGuide.background1": "#404040",
    "editorIndentGuide.activeBackground1": "#707070",
    "editor.selectionHighlightBackground": "#ADD6FF26",
  },
};

/**
 * Exact official VS Code Light+ rules from:
 * - theme-defaults/themes/light_vs.json
 * - theme-defaults/themes/light_plus.json
 * without custom overrides.
 */
const OFFICIAL_LIGHT_PLUS_THEME: import("monaco-editor").editor.IStandaloneThemeData = {
  base: "vs",
  inherit: false,
  rules: [
    { token: "", foreground: "000000", background: "FFFFFF" },
    { token: "emphasis", fontStyle: "italic" },
    { token: "strong", fontStyle: "bold" },
    { token: "header", foreground: "000080" },
    { token: "comment", foreground: "008000" },
    { token: "constant.language", foreground: "0000FF" },
    { token: "constant.numeric", foreground: "098658" },
    { token: "number", foreground: "098658" },
    { token: "number.float", foreground: "098658" },
    { token: "number.hex", foreground: "098658" },
    { token: "constant.regexp", foreground: "811F3F" },
    { token: "constant.character", foreground: "0000FF" },
    { token: "constant.character.escape", foreground: "EE0000" },
    { token: "constant", foreground: "0070C1" },
    { token: "entity.name.tag", foreground: "800000" },
    { token: "tag", foreground: "800000" },
    { token: "entity.other.attribute-name", foreground: "E50000" },
    { token: "attribute.name", foreground: "E50000" },
    { token: "attribute.value", foreground: "0451A5" },
    { token: "invalid", foreground: "CD3131" },
    { token: "markup.underline", fontStyle: "underline" },
    { token: "markup.bold", fontStyle: "bold", foreground: "000080" },
    { token: "markup.heading", fontStyle: "bold", foreground: "800000" },
    { token: "markup.italic", fontStyle: "italic", foreground: "800080" },
    { token: "markup.strikethrough", fontStyle: "strikethrough" },
    { token: "markup.inserted", foreground: "098658" },
    { token: "markup.deleted", foreground: "A31515" },
    { token: "markup.changed", foreground: "0451A5" },
    { token: "punctuation.definition.tag", foreground: "800000" },
    { token: "delimiter.html", foreground: "383838" },
    { token: "delimiter.xml", foreground: "0000FF" },
    { token: "storage", foreground: "0000FF" },
    { token: "storage.type", foreground: "0000FF" },
    { token: "storage.modifier", foreground: "0000FF" },
    { token: "string", foreground: "A31515" },
    { token: "string.tag", foreground: "A31515" },
    { token: "string.value", foreground: "A31515" },
    { token: "string.regexp", foreground: "811F3F" },
    { token: "regexp", foreground: "811F3F" },
    { token: "string.key.json", foreground: "A31515" },
    { token: "string.value.json", foreground: "0451A5" },
    { token: "key", foreground: "863B00" },
    { token: "keyword", foreground: "0000FF" },
    { token: "keyword.control", foreground: "AF00DB" },
    { token: "keyword.flow", foreground: "AF00DB" },
    { token: "keyword.operator", foreground: "000000" },
    { token: "keyword.other.unit", foreground: "098658" },
    { token: "operator", foreground: "000000" },
    { token: "delimiter", foreground: "000000" },
    { token: "entity.name.function", foreground: "795E26" },
    { token: "support.function", foreground: "795E26" },
    { token: "function", foreground: "795E26" },
    { token: "identifier.function", foreground: "795E26" },
    { token: "method", foreground: "795E26" },
    { token: "predefined", foreground: "795E26" },
    { token: "support.class", foreground: "267F99" },
    { token: "support.type", foreground: "267F99" },
    { token: "entity.name.type", foreground: "267F99" },
    { token: "entity.name.namespace", foreground: "267F99" },
    { token: "entity.name.class", foreground: "267F99" },
    { token: "type", foreground: "267F99" },
    { token: "type.identifier", foreground: "267F99" },
    { token: "class", foreground: "267F99" },
    { token: "struct", foreground: "267F99" },
    { token: "interface", foreground: "267F99" },
    { token: "enum", foreground: "267F99" },
    { token: "namespace", foreground: "267F99" },
    { token: "variable", foreground: "001080" },
    { token: "variable.language", foreground: "0000FF" },
    { token: "variable.predefined", foreground: "0070C1" },
    { token: "variable.parameter", foreground: "001080" },
    { token: "parameter", foreground: "001080" },
    { token: "property", foreground: "001080" },
    { token: "variable.other.constant", foreground: "0070C1" },
    { token: "variable.other.enummember", foreground: "0070C1" },
    { token: "enumMember", foreground: "0070C1" },
    { token: "entity.name.label", foreground: "000000" },
  ],
  colors: {
    "editor.background": "#FFFFFF",
    "editor.foreground": "#000000",
    "editor.inactiveSelectionBackground": "#E5EBF1",
    "editorIndentGuide.background1": "#D3D3D3",
    "editorIndentGuide.activeBackground1": "#939393",
    "editor.selectionHighlightBackground": "#ADD6FF80",
  },
};

/**
 * Ensures Monaco editor defines official VS Code Dark+ ("vscode-dark-plus") and
 * Light+ ("vscode-light-plus") themes and registers all ModelScript polyglot
 * engineering language Monarch tokenizers.
 */
export function ensureMonacoThemesDefined(monaco: Monaco | typeof import("monaco-editor")): void {
  if (!monaco) return;

  try {
    registerAllModelscriptLanguages(monaco as unknown as Parameters<typeof registerAllModelscriptLanguages>[0]);
  } catch {
    // Ignore language registration errors in test environments
  }

  if (themesDefined || !monaco?.editor?.defineTheme) return;

  try {
    monaco.editor.defineTheme(MONACO_THEME_DARK, OFFICIAL_DARK_PLUS_THEME);
    monaco.editor.defineTheme(MONACO_THEME_LIGHT, OFFICIAL_LIGHT_PLUS_THEME);
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
