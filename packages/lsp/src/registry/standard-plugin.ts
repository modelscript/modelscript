// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  CodeLens,
  CompletionItem,
  CompletionItemKind,
  Diagnostic,
  Disposable,
  Hover,
  Position,
  Range,
} from "vscode-languageserver";
import {
  globalLanguageRegistry,
  type LanguageDefLike,
  type LanguagePlugin,
  type PluginActionHandler,
  type PluginCustomHandlers,
  type PluginDocumentLike,
  type PluginDocumentSymbolLike,
  type PluginProtocolHandler,
  type WorkspaceIndexLike,
} from "./LanguageRegistry.js";

export type DocInput = PluginDocumentLike | null | undefined;
export type TreeWrapperInput =
  string | { text?: string; rootNode?: { text?: string }; uri?: string } | null | undefined;

export type HoverLike = {
  contents:
    | string
    | { kind: string; value: string }
    | { language: string; value: string }
    | Array<string | { language: string; value: string }>;
  range?: Range | undefined;
};

export type CompletionItemLike = {
  label: string;
  kind?: number | undefined;
  detail?: string | undefined;
  documentation?: string | { kind: "markdown" | "plaintext"; value: string } | undefined;
  insertText?: string | undefined;
  insertTextFormat?: number | undefined;
  sortText?: string | undefined;
  filterText?: string | undefined;
};

export type CodeLensLike = {
  range: Range;
  command?: { title: string; command: string; arguments?: unknown[] | undefined } | undefined;
  data?: unknown;
};

export function docText(doc: DocInput): string {
  return typeof doc === "string" ? doc : typeof doc?.getText === "function" ? doc.getText() : String(doc ?? "");
}

export function docUri(doc: DocInput): string {
  return typeof doc === "object" && doc !== null && typeof doc.uri === "string" ? doc.uri : "";
}

export function docOffsetAt(doc: DocInput, position: Position): number {
  return typeof doc === "object" && doc !== null && typeof doc.offsetAt === "function" ? doc.offsetAt(position) : 0;
}

export function toHover(h: HoverLike | string | null | undefined): Hover | null {
  if (!h) return null;
  if (typeof h === "string") {
    return { contents: { kind: "markdown", value: h } };
  }
  const contents =
    typeof h.contents === "object" && !Array.isArray(h.contents) && "kind" in h.contents
      ? {
          kind: (h.contents.kind === "plaintext" ? "plaintext" : "markdown") as "plaintext" | "markdown",
          value: h.contents.value,
        }
      : h.contents;
  return h.range !== undefined ? { contents, range: h.range } : { contents };
}

export function toCodeLenses(lenses: ReadonlyArray<CodeLensLike>): CodeLens[] {
  return lenses.map((lens) => {
    const out: CodeLens = { range: lens.range };
    if (lens.command !== undefined) {
      out.command =
        lens.command.arguments !== undefined
          ? { title: lens.command.title, command: lens.command.command, arguments: lens.command.arguments }
          : { title: lens.command.title, command: lens.command.command };
    }
    if (lens.data !== undefined) out.data = lens.data;
    return out;
  });
}

export function toCompletionItems(items: ReadonlyArray<CompletionItemLike>): CompletionItem[] {
  return items.map((item) => {
    const out: CompletionItem = { label: item.label };
    if (item.kind !== undefined) out.kind = item.kind as CompletionItemKind;
    if (item.detail !== undefined) out.detail = item.detail;
    if (item.documentation !== undefined) out.documentation = item.documentation;
    if (item.insertText !== undefined) out.insertText = item.insertText;
    if (item.insertTextFormat !== undefined) out.insertTextFormat = item.insertTextFormat as 1 | 2;
    if (item.sortText !== undefined) out.sortText = item.sortText;
    if (item.filterText !== undefined) out.filterText = item.filterText;
    return out;
  });
}

export function toFoldingKind(kind?: string): "comment" | "imports" | "region" | undefined {
  return kind === "comment" || kind === "imports" || kind === "region" ? kind : undefined;
}

export function treeText(treeWrapper: TreeWrapperInput, fallbackText?: string): string {
  if (typeof treeWrapper === "string") return treeWrapper;
  return treeWrapper?.text ?? treeWrapper?.rootNode?.text ?? fallbackText ?? "";
}

export function offsetToPos(text: string, offset: number): { line: number; character: number } {
  const lines = text.slice(0, offset).split("\n");
  return { line: lines.length - 1, character: lines[lines.length - 1]!.length };
}

export interface StandardPluginSpec {
  id: string;
  name: string;
  extensions: string[];
  languageDef: unknown;
  symbols?: (text: string) => unknown;
  hoverPos?: (text: string, pos: { line: number; character: number }) => unknown;
  hoverOffset?: (text: string, offset: number) => unknown;
  validate?: (text: string) => unknown;
  validateWithTree?: { bivarianceHack(text: string, cstTree?: unknown): unknown }["bivarianceHack"];
  customHandlers?: PluginCustomHandlers;
  actionHandlers?: Record<string, PluginActionHandler>;
  extractTheoryConstraints?: LanguagePlugin["extractTheoryConstraints"];
  workspaceIndex?: WorkspaceIndexLike;
  handlers?: Record<string, PluginProtocolHandler>;
  disposables?: Disposable[];
}

export function registerStandardPlugin(spec: StandardPluginSpec): void {
  const customHandlers: PluginCustomHandlers = {};
  if (spec.symbols) {
    const fn = spec.symbols;
    customHandlers.symbols = (treeWrapper: TreeWrapperInput, text?: string) =>
      fn(treeText(treeWrapper, text)) as PluginDocumentSymbolLike[];
  }
  if (spec.hoverPos) {
    const fn = spec.hoverPos;
    customHandlers.hover = (offset: number, text: string) =>
      toHover(fn(text, offsetToPos(text, offset)) as HoverLike | null | undefined);
  } else if (spec.hoverOffset) {
    const fn = spec.hoverOffset;
    customHandlers.hover = (offset: number, text: string) => toHover(fn(text, offset) as HoverLike | null | undefined);
  }
  if (spec.validateWithTree) {
    const fn = spec.validateWithTree;
    customHandlers.validate = (doc: DocInput, cstTree?: unknown) =>
      fn(docText(doc), cstTree) as Diagnostic[] | readonly unknown[];
  } else if (spec.validate) {
    const fn = spec.validate;
    customHandlers.validate = (doc: DocInput) => fn(docText(doc)) as Diagnostic[] | readonly unknown[];
  }
  if (spec.customHandlers) {
    Object.assign(customHandlers, spec.customHandlers);
  }
  globalLanguageRegistry.register({
    id: spec.id,
    name: spec.name,
    extensions: spec.extensions,
    languageDef: spec.languageDef as LanguageDefLike | undefined,
    ...(spec.workspaceIndex !== undefined ? { workspaceIndex: spec.workspaceIndex } : {}),
    ...(spec.handlers !== undefined ? { handlers: spec.handlers } : {}),
    ...(spec.extractTheoryConstraints !== undefined ? { extractTheoryConstraints: spec.extractTheoryConstraints } : {}),
    ...(Object.keys(customHandlers).length > 0 ? { customHandlers } : {}),
    ...(spec.actionHandlers !== undefined ? { actionHandlers: spec.actionHandlers } : {}),
    disposables: spec.disposables ?? [],
  });
}
