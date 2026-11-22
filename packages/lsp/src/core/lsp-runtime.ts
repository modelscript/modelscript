// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language-agnostic LSP runtime core (`@modelscript/lsp/core`).
 *
 * Designed to run seamlessly in BOTH:
 *   1. Single-language dev playground mode (`scripts/tools/language-playground.ts`)
 *      with 1 dynamically loaded `LanguagePlugin` and zero imports of other languages.
 *   2. Multi-language production mode (`browserServerMain.ts` / `nodeServerMain.ts`)
 *      with all registered `LanguagePlugin`s in a shared `LanguageRegistry`.
 *
 * IMPORTANT: This module MUST NOT statically import any `@modelscript/<lang>` package.
 */

import type { LanguageOptions } from "@modelscript/dsl";
import {
  collectArenaExprDeps,
  DAEBuilder,
  EqKind,
  initBltWasm,
  performBltTransformationArena,
  Variability,
} from "@modelscript/runtime";
import { TextDocument } from "vscode-languageserver-textdocument";
import { LanguageRegistry, type LanguagePlugin } from "../registry/LanguageRegistry.js";
import { printArenaExpression } from "../utils/arena-utils.js";

export interface LspRuntimePosition {
  line: number;
  character: number;
}

export interface LspRuntimeRange {
  start: LspRuntimePosition;
  end: LspRuntimePosition;
}

export interface LspRuntimeDiagnostic {
  range: LspRuntimeRange;
  severity?: number | undefined;
  code?: string | number | undefined;
  source?: string | undefined;
  message: string;
}

export interface BuildLanguagePluginOptions {
  id: string;
  name: string;
  extensions: string[];
  languageDef?: LanguageOptions | undefined;
  lspModule?: Record<string, unknown> | null | undefined;
  parser?: { parse: (input: string) => { rootNode: unknown } } | undefined;
  facade?:
    | {
        loadSource?: (text: string) => void;
        getDiagnostics?: (rootPtr: number, a?: number, b?: number, text?: string) => unknown[];
      }
    | undefined;
}

export interface LspRuntimeOptions {
  registry?: LanguageRegistry | undefined;
  plugins?: LanguagePlugin[] | undefined;
}

export interface LspRequestEnvelope {
  method: string;
  params?: Record<string, unknown> | undefined;
  /** Optional inline text & URI convenience fields for stateless HTTP requests */
  code?: string | undefined;
  documentUri?: string | undefined;
}

export interface LspResponseEnvelope {
  handled: boolean;
  result?: unknown;
  note?: string | undefined;
  error?: string | undefined;
}

interface ManagedDocEntry {
  doc: TextDocument;
  tree?: { rootNode: unknown } | undefined;
  languageId: string;
}

export const PLAYGROUND_SEMANTIC_TOKEN_TYPES = [
  "keyword",
  "type",
  "class",
  "variable",
  "parameter",
  "function",
  "string",
  "number",
  "operator",
  "comment",
  "namespace",
  "enumMember",
] as const;

function positionFromOffset(text: string, offset: number): LspRuntimePosition {
  const clamped = Math.max(0, Math.min(offset, text.length));
  let line = 0;
  let lastNl = -1;
  for (let i = 0; i < clamped; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lastNl = i;
    }
  }
  return { line, character: clamped - lastNl - 1 };
}

function offsetFromPosition(doc: TextDocument, pos: LspRuntimePosition): number {
  return doc.offsetAt({ line: Math.max(0, pos.line), character: Math.max(0, pos.character) });
}

function normalizeDiagnostic(raw: unknown, defaultSource: string): LspRuntimeDiagnostic | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const rangeObj = d["range"] as
    { start?: { line?: number; character?: number }; end?: { line?: number; character?: number } } | undefined;
  const startLine =
    rangeObj?.start?.line ?? (typeof d["line"] === "number" ? Math.max(0, (d["line"] as number) - 1) : 0);
  const startChar = rangeObj?.start?.character ?? (typeof d["column"] === "number" ? (d["column"] as number) : 0);
  const endLine = rangeObj?.end?.line ?? startLine;
  const endChar = rangeObj?.end?.character ?? startChar + 1;

  let severity = 2;
  if (typeof d["severity"] === "number") {
    severity = d["severity"] as number;
  } else if (d["severity"] === "error") {
    severity = 1;
  } else if (d["severity"] === "warning") {
    severity = 2;
  } else if (d["severity"] === "info" || d["severity"] === "information") {
    severity = 3;
  } else if (d["severity"] === "hint") {
    severity = 4;
  }

  return {
    range: {
      start: { line: startLine, character: startChar },
      end: { line: endLine, character: Math.max(endChar, startLine === endLine ? startChar + 1 : endChar) },
    },
    severity,
    code: typeof d["code"] === "string" || typeof d["code"] === "number" ? (d["code"] as string | number) : undefined,
    source: typeof d["source"] === "string" ? (d["source"] as string) : defaultSource,
    message: typeof d["message"] === "string" ? (d["message"] as string) : String(d["message"] ?? ""),
  };
}

function extractCstSyntaxErrors(rootNode: unknown, sourceName: string): LspRuntimeDiagnostic[] {
  const diags: LspRuntimeDiagnostic[] = [];
  const stack: unknown[] = [rootNode];
  let safety = 0;

  while (stack.length > 0 && safety < 25_000 && diags.length < 100) {
    safety++;
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    const n = node as {
      type?: string;
      isError?: boolean;
      isMissing?: boolean;
      text?: string;
      startPosition?: { row: number; column: number };
      endPosition?: { row: number; column: number };
      children?: unknown[];
    };
    if (n.isError || n.isMissing) {
      const sp = n.startPosition ?? { row: 0, column: 0 };
      const ep = n.endPosition ?? { row: sp.row, column: sp.column + 1 };
      const snippet = typeof n.text === "string" ? n.text.replace(/\s+/g, " ").trim().slice(0, 40) : "";
      diags.push({
        range: {
          start: { line: sp.row, character: sp.column },
          end: { line: ep.row, character: Math.max(ep.column, sp.row === ep.row ? sp.column + 1 : ep.column) },
        },
        severity: 1,
        code: n.isMissing ? "parse-missing" : "parse-error",
        source: `${sourceName}-parser`,
        message: n.isMissing
          ? `Missing expected syntax token '${n.type ?? "token"}'`
          : `Syntax error near '${snippet || n.type || "unexpected token"}'`,
      });
      continue;
    }
    if (Array.isArray(n.children)) {
      for (let i = n.children.length - 1; i >= 0; i--) {
        stack.push(n.children[i]);
      }
    }
  }

  return diags;
}

interface RawWasmDiag {
  code?: string | number;
  message?: string;
  severity?: string | number;
  startOffset?: number;
  endOffset?: number;
  extraStartOffset?: number;
  extraEndOffset?: number;
  extraText?: string;
  range?: LspRuntimeRange;
}

function severityToLspNumber(sev: unknown, defaultSeverity = 1): number {
  if (typeof sev === "number") return sev;
  if (sev === "error") return 1;
  if (sev === "warning") return 2;
  if (sev === "info" || sev === "information") return 3;
  if (sev === "hint") return 4;
  return defaultSeverity;
}

function extractWasmFacadeDiagnostics(
  doc: TextDocument,
  tree: { rootNode: unknown; facade?: unknown; rootPtr?: number } | undefined,
  plugin: LanguagePlugin,
): { diagnostics: LspRuntimeDiagnostic[]; hasSyntaxErrors: boolean; usedFacade: boolean } {
  const diagnostics: LspRuntimeDiagnostic[] = [];
  if (!tree?.rootNode) return { diagnostics, hasSyntaxErrors: false, usedFacade: false };

  const facade = (plugin.facade ?? tree.facade) as
    | {
        loadSource?: (text: string) => void;
        getDiagnostics?: (rootPtr: number, a?: number, b?: number, text?: string) => unknown[];
      }
    | undefined;
  if (!facade || typeof facade.getDiagnostics !== "function") {
    return { diagnostics, hasSyntaxErrors: false, usedFacade: false };
  }

  const rootNode = tree.rootNode as { id?: number; ptr?: number; tree?: { rootPtr?: number } };
  const rootPtr = rootNode.id ?? rootNode.ptr ?? rootNode.tree?.rootPtr ?? tree.rootPtr ?? 0;
  if (!rootPtr) {
    return { diagnostics, hasSyntaxErrors: false, usedFacade: false };
  }

  const text = doc.getText();
  let wasmDiags: unknown[];
  try {
    if (text && typeof facade.loadSource === "function") {
      facade.loadSource(text);
    }
    const raw = facade.getDiagnostics(rootPtr, 0, 0, text);
    wasmDiags = Array.isArray(raw) ? raw : [];
  } catch {
    return { diagnostics, hasSyntaxErrors: false, usedFacade: false };
  }

  const pluginLints = plugin.languageDef?.lints as
    | Record<
        string,
        {
          code?: string | number;
          severity?: string | number;
          message?: string | ((target: { text: string }, extra: { text: string }) => string);
        }
      >
    | undefined;
  const pluginErrorCodes = (plugin.languageDef as { errorCodes?: Record<string | number, unknown> } | undefined)
    ?.errorCodes as
    | Record<
        string | number,
        {
          code?: string | number;
          rule?: string;
          severity?: string | number;
          message?: string | ((param: string) => string);
        }
      >
    | undefined;

  let hasSyntaxErrors = false;

  for (const item of wasmDiags) {
    if (!item || typeof item !== "object") continue;
    const d = item as RawWasmDiag;
    const startOff = d.startOffset;
    const endOff = d.endOffset;

    let range = d.range;
    if (startOff !== undefined && endOff !== undefined) {
      range = {
        start: doc.positionAt(Math.max(0, startOff)),
        end: doc.positionAt(Math.max(0, endOff)),
      };
    }
    if (!range) continue;

    if (range.start.line === range.end.line && range.start.character === range.end.character) {
      range = {
        start: range.start,
        end: { line: range.start.line, character: range.start.character + 1 },
      };
    }

    const code = d.code;
    const isSyntax = !code || code === "ERROR" || code === 1001 || code === 1002;
    if (isSyntax) hasSyntaxErrors = true;

    const tokenText =
      startOff !== undefined && endOff !== undefined && endOff > startOff ? text.slice(startOff, endOff).trim() : "";
    const extraText =
      typeof d.extraText === "string"
        ? d.extraText
        : d.extraStartOffset !== undefined && d.extraEndOffset !== undefined && d.extraEndOffset > d.extraStartOffset
          ? text.slice(d.extraStartOffset, d.extraEndOffset).trim()
          : "";

    let matchedLint:
      | {
          code?: string | number;
          severity?: string | number;
          message?: string | ((target: { text: string }, extra: { text: string }) => string);
        }
      | undefined;
    if (pluginLints && code !== undefined) {
      for (const lint of Object.values(pluginLints)) {
        if (lint && (lint.code === code || String(lint.code) === String(code))) {
          matchedLint = lint;
          break;
        }
      }
    }

    let matchedErrorCode:
      | {
          code?: string | number;
          rule?: string;
          severity?: string | number;
          message?: string | ((param: string) => string);
        }
      | undefined;
    if (pluginErrorCodes && code !== undefined) {
      matchedErrorCode =
        pluginErrorCodes[code] ??
        Object.values(pluginErrorCodes).find((ec) => ec && (ec.code === code || String(ec.code) === String(code)));
    }

    let message = typeof d.message === "string" ? d.message : "";
    if (
      !message ||
      message.startsWith("Linter Rule ") ||
      message.startsWith("Linter rule ") ||
      (!isSyntax && message.startsWith("Syntax Error"))
    ) {
      if (matchedLint?.message) {
        try {
          message =
            typeof matchedLint.message === "function"
              ? matchedLint.message({ text: tokenText }, { text: extraText })
              : matchedLint.message;
        } catch {
          // fallback below
        }
      }
      if (
        (!message || message.startsWith("Linter Rule ") || message.startsWith("Linter rule ")) &&
        matchedErrorCode?.message
      ) {
        try {
          const formatted =
            typeof matchedErrorCode.message === "function"
              ? matchedErrorCode.message(tokenText)
              : matchedErrorCode.message;
          if (formatted && !formatted.includes("undefined")) {
            message = formatted;
          }
        } catch {
          // fallback below
        }
      }
      if (!message) {
        message = isSyntax ? "Syntax error" : `Lint rule ${String(code ?? "unknown")}`;
      }
    }

    const severity = isSyntax
      ? 1
      : severityToLspNumber(matchedLint?.severity ?? matchedErrorCode?.severity ?? d.severity, 2);

    diagnostics.push({
      range,
      severity,
      code: isSyntax ? (code ?? "parse-error") : code,
      source: isSyntax ? `${plugin.id}-parser` : `${plugin.id}-lint`,
      message,
    });
  }

  return { diagnostics, hasSyntaxErrors, usedFacade: true };
}

const BUILTIN_TYPE_NAMES = new Set(["Real", "Integer", "Boolean", "String", "Natural"]);

function encodeCstSemanticTokens(rootNode: unknown, source: string, plugin?: LanguagePlugin): number[] {
  const rawTokens: { line: number; char: number; len: number; typeIdx: number; mod: number }[] = [];
  const stack: { node: unknown; parentType: string; grandParentType: string }[] = [
    { node: rootNode, parentType: "", grandParentType: "" },
  ];
  const monarch = (plugin?.languageDef as { monarch?: { typeKeywords?: string[]; keywords?: string[] } } | undefined)
    ?.monarch;
  const typeKwSet = new Set<string>(monarch?.typeKeywords ?? Array.from(BUILTIN_TYPE_NAMES));
  const kwSet = new Set<string>(monarch?.keywords ?? []);
  let safety = 0;

  while (stack.length > 0 && safety < 25_000) {
    safety++;
    const { node, parentType, grandParentType } = stack.pop()!;
    if (!node || typeof node !== "object") continue;
    const n = node as {
      type?: string;
      isNamed?: boolean;
      startIndex?: number;
      endIndex?: number;
      startPosition?: { row: number; column: number };
      children?: unknown[];
    };
    const nodeType = n.type ?? "";
    const kids = n.children;

    if (!kids || kids.length === 0) {
      const start = n.startIndex ?? -1;
      const end = n.endIndex ?? -1;
      if (start >= 0 && end > start && end <= source.length) {
        const text = source.slice(start, end);
        if (text.includes("\n")) continue; // single-line semantic tokens only
        const t = nodeType.toLowerCase();
        const p = parentType.toLowerCase();
        const gp = grandParentType.toLowerCase();
        let typeIdx = -1;
        let mod = 0;

        // 0:keyword, 1:type, 2:class, 3:variable, 4:parameter, 5:function,
        // 6:string, 7:number, 8:operator, 9:comment, 10:namespace, 11:enumMember
        if (t.includes("comment") || p.includes("comment")) {
          typeIdx = 9;
        } else if (t.includes("string") || t.includes("char") || t.includes("quoted") || p.includes("string")) {
          typeIdx = 6;
        } else if (t.includes("number") || t.includes("float") || t.includes("int") || t === "real") {
          typeIdx = 7;
        } else if (t.includes("type_name") || t === "type" || typeKwSet.has(text)) {
          typeIdx = 1;
        } else if (kwSet.has(text) || (!n.isNamed && /^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(text))) {
          typeIdx = 0;
        } else if (t === "ident" || t === "identifier") {
          if (p.includes("package") || gp.includes("package")) {
            typeIdx = 10;
            mod = 1;
          } else if (p.includes("function_call") || gp.includes("function_call") || p.includes("call")) {
            typeIdx = 5;
          } else if (p.includes("class") || gp.includes("class_definition") || p.includes("long_class_specifier")) {
            typeIdx = 2;
            mod = 1;
          } else if (p.includes("type_specifier") || gp.includes("type_specifier")) {
            typeIdx = 1;
          } else if (p.includes("parameter") || gp.includes("parameter")) {
            typeIdx = 4;
          } else {
            typeIdx = 3;
          }
        } else if (t.includes("attr_name") || t.includes("property") || t.includes("field")) {
          typeIdx = 4;
        } else if (t.includes("func") || t.includes("method") || t.includes("call")) {
          typeIdx = 5;
        } else if (!n.isNamed && /^[^a-zA-Z0-9_\s{}()[\].,;:]+$/.test(text)) {
          typeIdx = 8;
        }

        if (typeIdx >= 0) {
          const pos = n.startPosition
            ? { line: n.startPosition.row, character: n.startPosition.column }
            : positionFromOffset(source, start);
          rawTokens.push({ line: pos.line, char: pos.character, len: end - start, typeIdx, mod });
        }
      }
      continue;
    }

    for (let i = kids.length - 1; i >= 0; i--) {
      stack.push({ node: kids[i], parentType: nodeType, grandParentType: parentType });
    }
  }

  rawTokens.sort((a, b) => (a.line !== b.line ? a.line - b.line : a.char - b.char));

  const data: number[] = [];
  let prevLine = 0;
  let prevChar = 0;
  for (const tok of rawTokens) {
    const deltaLine = tok.line - prevLine;
    const deltaStart = deltaLine === 0 ? tok.char - prevChar : tok.char;
    if (deltaLine < 0 || deltaStart < 0 || tok.len <= 0) continue;
    data.push(deltaLine, deltaStart, tok.len, tok.typeIdx, tok.mod);
    prevLine = tok.line;
    prevChar = tok.char;
  }
  return data;
}

export interface RuntimeBltAnalysisData {
  className?: string | undefined;
  status: "balanced" | "underdetermined" | "overdetermined" | "empty";
  unknowns: string[];
  states: string[];
  equations: { index: number; text: string; line?: number | undefined }[];
  incidence: boolean[][];
  matching: number[];
  blocks: {
    blockIndex: number;
    equationIndices: number[];
    variables: string[];
    isAlgebraicLoop: boolean;
    isSolved: boolean;
  }[];
}

let bltWasmInitPromise: Promise<void> | null = null;
async function ensureBltWasmInitialized(): Promise<void> {
  if (!bltWasmInitPromise) {
    bltWasmInitPromise = initBltWasm().catch((err) => {
      bltWasmInitPromise = null;
      throw err;
    });
  }
  await bltWasmInitPromise;
}

function isDaeArenaLike(val: unknown): val is DAEBuilder {
  return Boolean(
    val &&
    typeof val === "object" &&
    typeof (val as DAEBuilder).getVarName === "function" &&
    typeof (val as DAEBuilder).getEqKind === "function" &&
    typeof (val as DAEBuilder).varCount === "number" &&
    typeof (val as DAEBuilder).eqCount === "number",
  );
}

async function computeBltAnalysisDataFromArena(arena: DAEBuilder, className?: string): Promise<RuntimeBltAnalysisData> {
  await ensureBltWasmInitialized();

  const unknowns: string[] = [];
  const varToCol = new Map<number, number>();
  for (let i = 0; i < arena.varCount; i++) {
    if (arena.isVarRemoved(i)) continue;
    const v = arena.getVarVariability(i);
    if (v === Variability.Continuous || v === Variability.Discrete) {
      varToCol.set(i, unknowns.length);
      unknowns.push(arena.getVarName(i));
    }
  }

  const eqIndices: number[] = [];
  const eqIndexToRow = new Map<number, number>();
  const equations: { index: number; text: string }[] = [];
  const incidence: boolean[][] = [];
  const stateSet = new Set<string>();

  for (let i = 0; i < arena.eqCount; i++) {
    if (arena.getEqKind(i) !== EqKind.Simple) continue;
    const lhs = arena.getEqLhs(i);
    const rhs = arena.getEqRhs(i);
    const lhsStr = printArenaExpression(arena, lhs);
    const rhsStr = printArenaExpression(arena, rhs);

    const allDeps = new Set<number>();
    const nonDerDeps = new Set<number>();
    collectArenaExprDeps(arena, lhs, allDeps, false);
    collectArenaExprDeps(arena, rhs, allDeps, false);
    collectArenaExprDeps(arena, lhs, nonDerDeps, true);
    collectArenaExprDeps(arena, rhs, nonDerDeps, true);

    const row = new Array<boolean>(unknowns.length).fill(false);
    for (const vIdx of allDeps) {
      const col = varToCol.get(vIdx);
      if (col !== undefined) row[col] = true;
      if (!nonDerDeps.has(vIdx)) {
        stateSet.add(arena.getVarName(vIdx));
      }
    }

    eqIndexToRow.set(i, eqIndices.length);
    eqIndices.push(i);
    equations.push({ index: equations.length, text: `${lhsStr} = ${rhsStr}` });
    incidence.push(row);
  }

  if (equations.length === 0 && unknowns.length === 0) {
    return {
      className,
      status: "empty",
      unknowns: [],
      states: [],
      equations: [],
      incidence: [],
      matching: [],
      blocks: [],
    };
  }

  const { blocks: arenaBlocks } = performBltTransformationArena(arena, stateSet.size > 0 ? stateSet : undefined);
  const matching = new Array<number>(equations.length).fill(-1);
  const blocks: RuntimeBltAnalysisData["blocks"] = [];

  for (let b = 0; b < arenaBlocks.length; b++) {
    const blk = arenaBlocks[b]!;
    const rowIndices: number[] = [];
    for (let k = 0; k < blk.eqIdxs.length; k++) {
      const r = eqIndexToRow.get(blk.eqIdxs[k]!);
      if (r !== undefined) {
        rowIndices.push(r);
        const vIdx = blk.vars[k];
        const col = vIdx !== undefined ? varToCol.get(vIdx) : undefined;
        if (col !== undefined) matching[r] = col;
      }
    }
    if (rowIndices.length === 0) continue;
    const varNames = blk.vars.map((vIdx) => arena.getVarName(vIdx));
    blocks.push({
      blockIndex: blocks.length + 1,
      equationIndices: rowIndices,
      variables: varNames,
      isAlgebraicLoop: rowIndices.length > 1,
      isSolved: rowIndices.every((r) => matching[r] !== -1),
    });
  }

  const status: RuntimeBltAnalysisData["status"] =
    equations.length === unknowns.length
      ? "balanced"
      : equations.length < unknowns.length
        ? "underdetermined"
        : "overdetermined";

  return {
    className,
    status,
    unknowns,
    states: Array.from(stateSet),
    equations,
    incidence,
    matching,
    blocks,
  };
}

/**
 * Adapts a language's `language.ts` definition + optional `src/lsp.ts` exports into
 * a canonical `LanguagePlugin` without requiring any centralized registration file.
 */
export function buildLanguagePluginFromModule(opts: BuildLanguagePluginOptions): LanguagePlugin {
  const lspMod = opts.lspModule ?? {};

  // Explicit factory escape hatch: if the language exports `createLspPlugin()`, use it directly.
  if (typeof lspMod["createLspPlugin"] === "function") {
    const created = (lspMod["createLspPlugin"] as (o: BuildLanguagePluginOptions) => LanguagePlugin)(opts);
    if (created && created.id) {
      if (!created.parser && opts.parser) created.parser = opts.parser;
      if (!created.facade && opts.facade) created.facade = opts.facade;
      if (!created.languageDef && opts.languageDef) created.languageDef = opts.languageDef;
      return created;
    }
  }

  const fns = Object.entries(lspMod).filter(([, v]) => typeof v === "function") as [
    string,
    (...args: unknown[]) => unknown,
  ][];

  const findFn = (pred: (name: string) => boolean) => fns.find(([name]) => pred(name))?.[1];

  const validateFn = findFn(
    (n) => /^validate[A-Z]/.test(n) || /^get[A-Z].*Diagnostics$/.test(n) || n === "validate" || n === "getDiagnostics",
  );
  const symbolsFn = findFn((n) => /DocumentSymbols$/.test(n) || n === "getDocumentSymbols");
  const hoverFn = findFn((n) => /^get[A-Z].*Hover$/.test(n) || n === "getHover");
  const completeFn = findFn((n) => /^get[A-Z].*Completions$/.test(n) || n === "getCompletions");
  const definitionFn = findFn((n) => /^get[A-Z].*Definition/.test(n) || n === "getDefinition");
  const referencesFn = findFn((n) => /^get[A-Z].*References$/.test(n) || n === "getReferences");
  const foldingFn = findFn((n) => /^get[A-Z].*FoldingRanges$/.test(n) || n === "getFoldingRanges");
  const inlayFn = findFn((n) => /^get[A-Z].*InlayHints$/.test(n) || n === "getInlayHints");
  const codeActionsFn = findFn(
    (n) => /^get[A-Z].*(CodeActions|QuickFixes)$/.test(n) || n === "getCodeActions" || n === "getQuickFixes",
  );
  const analyzeBltFn = findFn((n) => n === "analyzeBlt" || /^analyze[A-Z].*Blt$/.test(n));
  const toDaeFn = findFn((n) => /^lower[A-Z].*ToDae$/.test(n) || n === "toDae");
  const getDiagramDataFn = findFn((n) => n === "getDiagramData" || /^get[A-Z].*DiagramData$/.test(n));
  const applyDiagramEditsFn = findFn((n) => n === "applyDiagramEdits" || /^apply[A-Z].*DiagramEdits$/.test(n));
  const getComponentPropertiesFn = findFn(
    (n) => n === "getComponentProperties" || /^get[A-Z].*ComponentProperties$/.test(n),
  );
  const executeActionFn = findFn((n) => /^execute[A-Z].*Action$/.test(n) || n === "executeAction");

  const customHandlers: NonNullable<LanguagePlugin["customHandlers"]> = {};

  if (validateFn) {
    customHandlers.validate = async (doc: TextDocument) => {
      const res = await validateFn(doc.getText(), doc.uri);
      return Array.isArray(res) ? res : [];
    };
  }

  if (symbolsFn) {
    customHandlers.symbols = (_tree: unknown, text?: string, uri?: string) => {
      const res = symbolsFn(text ?? "", uri ?? `file:///model${opts.extensions[0] ?? ""}`);
      return Array.isArray(res) ? res : [];
    };
  }

  if (hoverFn) {
    customHandlers.hover = (offset: number, text: string, uri?: string) => {
      const pos = positionFromOffset(text, offset);
      return hoverFn(text, pos, uri) ?? null;
    };
  }

  if (completeFn) {
    customHandlers.complete = (offset: number, text: string, uri?: string) => {
      const pos = positionFromOffset(text, offset);
      const res = completeFn(text, pos, uri);
      return Array.isArray(res) ? res : [];
    };
  }

  if (definitionFn) {
    customHandlers.definition = (offset: number, text: string, uri?: string) => {
      const pos = positionFromOffset(text, offset);
      return definitionFn(text, pos, uri) ?? null;
    };
  }

  if (referencesFn) {
    customHandlers.references = (offset: number, text: string, uri?: string) => {
      const pos = positionFromOffset(text, offset);
      const res = referencesFn(text, pos, uri);
      return Array.isArray(res) ? res : [];
    };
  }

  if (foldingFn) {
    customHandlers.folding = (_tree: unknown, text?: string, uri?: string) => {
      const res = foldingFn(text ?? "", uri);
      return Array.isArray(res) ? res : [];
    };
  }

  if (inlayFn) {
    customHandlers.inlayHints = async (doc: TextDocument, range?: unknown) => {
      const res = await inlayFn(doc.getText(), range, doc.uri);
      return Array.isArray(res) ? res : [];
    };
  }

  if (codeActionsFn) {
    customHandlers.codeActions = async (doc: TextDocument, range: unknown, diagnostics: unknown[]) => {
      const res = await codeActionsFn(doc.getText(), diagnostics, range, doc.uri);
      return Array.isArray(res) ? res : [];
    };
  }

  const langActions = ((
    opts.languageDef as { actions?: Array<{ id?: string; execute?: (...args: unknown[]) => unknown }> } | undefined
  )?.actions ?? []) as Array<{ id?: string; execute?: (ctx: unknown, params?: unknown) => unknown }>;
  const bltAction = langActions.find((a) => a?.id === "analyze_blt" || a?.id === "toDae");

  if (analyzeBltFn || toDaeFn || bltAction?.execute) {
    customHandlers.analyzeBlt = async (doc: TextDocument) => {
      const text = doc.getText();
      if (analyzeBltFn) {
        const res = await Promise.resolve(analyzeBltFn(text, doc.uri));
        if (isDaeArenaLike(res)) return await computeBltAnalysisDataFromArena(res);
        if (res && typeof res === "object") return res;
      }
      if (toDaeFn) {
        const res = await Promise.resolve(toDaeFn(text, doc.uri));
        if (isDaeArenaLike(res)) return await computeBltAnalysisDataFromArena(res);
      }
      if (bltAction?.execute) {
        const res = await Promise.resolve(bltAction.execute({ documentText: text, documentUri: doc.uri }, {}));
        if (isDaeArenaLike(res)) return await computeBltAnalysisDataFromArena(res);
        if (res && typeof res === "object" && "blocks" in res && "incidence" in res) return res;
      }
      return null;
    };
  }

  if (getDiagramDataFn) {
    customHandlers.getDiagramData = (doc: TextDocument, params?: unknown) =>
      getDiagramDataFn(doc.getText(), params, doc.uri);
  }
  if (applyDiagramEditsFn) {
    customHandlers.applyDiagramEdits = (doc: TextDocument, params?: unknown) =>
      applyDiagramEditsFn(doc.getText(), params, doc.uri);
  }
  if (getComponentPropertiesFn) {
    customHandlers.getComponentProperties = (doc: TextDocument, params?: unknown) =>
      getComponentPropertiesFn(doc.getText(), params, doc.uri);
  }

  const handlers: Record<string, (context: unknown, params: unknown) => Promise<unknown> | unknown> = {};
  if (executeActionFn) {
    handlers["workspace/executeCommand"] = async (ctx: unknown, params: unknown) => {
      const p = (params && typeof params === "object" ? params : {}) as Record<string, unknown>;
      const c = (ctx && typeof ctx === "object" ? ctx : {}) as { code?: string; documentUri?: string };
      const actionName =
        typeof p["command"] === "string" ? p["command"] : typeof p["action"] === "string" ? p["action"] : "";
      return await executeActionFn(actionName, { code: c.code ?? "", content: c.code ?? "", uri: c.documentUri, ...p });
    };
  }

  const optionalHandlerMappings: Array<[string, (name: string) => boolean]> = [
    ["modelscript/simulate", (n) => n === "simulate" || /^simulate[A-Z]/.test(n)],
    ["modelscript/flatten", (n) => n === "flatten" || /^flatten[A-Z]/.test(n)],
    ["modelscript/verifyAll", (n) => n === "verifyAll" || /^verify[A-Z].*All$/.test(n)],
    ["modelscript/getLibraryTree", (n) => n === "getLibraryTree" || /^get[A-Z].*LibraryTree$/.test(n)],
    ["modelscript/getMountedLibraries", (n) => n === "getMountedLibraries" || /^get[A-Z].*MountedLibraries$/.test(n)],
    ["modelscript/searchClasses", (n) => n === "searchClasses" || /^search[A-Z].*Classes$/.test(n)],
    ["modelscript/listClasses", (n) => n === "listClasses" || /^list[A-Z].*Classes$/.test(n)],
    ["modelscript/getClassSource", (n) => n === "getClassSource" || /^get[A-Z].*ClassSource$/.test(n)],
    ["modelscript/getClassIcon", (n) => n === "getClassIcon" || /^get[A-Z].*ClassIcon$/.test(n)],
    ["modelscript/getComponentCatalog", (n) => n === "getComponentCatalog" || /^get[A-Z].*ComponentCatalog$/.test(n)],
    ["modelscript/getCadComponents", (n) => n === "getCadComponents" || /^get[A-Z].*CadComponents$/.test(n)],
  ];

  for (const [rpcMethod, pred] of optionalHandlerMappings) {
    const fn = findFn(pred);
    if (fn) {
      handlers[rpcMethod] = async (ctx: unknown, params: unknown) => {
        const c = (ctx && typeof ctx === "object" ? ctx : {}) as { code?: string; documentUri?: string };
        return await fn(c.code ?? "", params, c.documentUri);
      };
    }
  }

  const semanticTokensFn = findFn((n) => n === "getSemanticTokens" || /^get[A-Z].*SemanticTokens$/.test(n));
  if (semanticTokensFn) {
    customHandlers.semanticTokens = async (doc: TextDocument, tree?: unknown) => {
      const res = await semanticTokensFn(doc.getText(), tree, doc.uri);
      return Array.isArray(res) ? res : [];
    };
  }

  return {
    id: opts.id,
    name: opts.name,
    extensions: opts.extensions,
    languageDef: opts.languageDef,
    parser: opts.parser,
    facade: opts.facade,
    customHandlers,
    handlers: Object.keys(handlers).length > 0 ? handlers : undefined,
    actionHandlers: executeActionFn
      ? {
          __default__: async (ctx: unknown, inputs: unknown) => {
            const inp = (inputs && typeof inputs === "object" ? inputs : {}) as Record<string, unknown>;
            const c = (ctx && typeof ctx === "object" ? ctx : {}) as {
              code?: string;
              documentUri?: string;
              action?: string;
            };
            return await executeActionFn(c.action ?? "", {
              code: c.code ?? "",
              content: c.code ?? "",
              uri: c.documentUri,
              ...inp,
            });
          },
        }
      : undefined,
  };
}

export interface LspRuntime {
  readonly registry: LanguageRegistry;
  registerPlugin: (plugin: LanguagePlugin) => void;
  setParser: (
    langId: string,
    parser: { parse: (input: string) => { rootNode: unknown } },
    facade?: BuildLanguagePluginOptions["facade"],
  ) => void;
  upsertDocument: (uri: string, text: string, version?: number, languageId?: string) => ManagedDocEntry;
  closeDocument: (uri: string) => void;
  handleRequest: (req: LspRequestEnvelope) => Promise<LspResponseEnvelope>;
}

/**
 * Creates a lightweight, transport-independent LSP runtime backed by a `LanguageRegistry`.
 * Works identically for 1 language (playground) or N languages (production).
 */
export function createLspRuntime(options: LspRuntimeOptions = {}): LspRuntime {
  const registry = options.registry ?? new LanguageRegistry();
  const docs = new Map<string, ManagedDocEntry>();

  if (options.plugins) {
    for (const plugin of options.plugins) {
      registry.register(plugin);
    }
  }

  const resolvePlugin = (uri: string, languageId?: string): LanguagePlugin | undefined => {
    if (languageId) {
      const byId = registry.getPluginById(languageId);
      if (byId) return byId;
    }
    const byUri = registry.getPluginForUri(uri);
    if (byUri) return byUri;
    const all = registry.getAllPlugins();
    return all.length === 1 ? all[0] : undefined;
  };

  const upsertDocument = (uri: string, text: string, version = 1, languageId?: string): ManagedDocEntry => {
    const plugin = resolvePlugin(uri, languageId);
    const resolvedLangId = plugin?.id ?? languageId ?? "plaintext";
    const doc = TextDocument.create(uri, resolvedLangId, version, text);
    let tree: { rootNode: unknown } | undefined;
    if (plugin?.parser && typeof plugin.parser.parse === "function") {
      try {
        tree = plugin.parser.parse(text);
      } catch {
        tree = undefined;
      }
    }
    const entry: ManagedDocEntry = { doc, tree, languageId: resolvedLangId };
    docs.set(uri, entry);
    return entry;
  };

  const ensureDoc = (req: LspRequestEnvelope): { entry: ManagedDocEntry; plugin: LanguagePlugin | undefined } => {
    const p = req.params ?? {};
    const td =
      (p["textDocument"] as { uri?: string; text?: string; version?: number; languageId?: string } | undefined) ?? {};
    const paramUri = typeof p["uri"] === "string" ? (p["uri"] as string) : undefined;
    const uri = td.uri || paramUri || req.documentUri || "file:///playground.txt";
    const inlineText =
      typeof req.code === "string"
        ? req.code
        : typeof td.text === "string"
          ? td.text
          : typeof p["documentText"] === "string"
            ? (p["documentText"] as string)
            : undefined;

    let entry = docs.get(uri);
    if (inlineText !== undefined && (!entry || entry.doc.getText() !== inlineText)) {
      entry = upsertDocument(uri, inlineText, (entry?.doc.version ?? 0) + 1, td.languageId);
    } else if (!entry) {
      entry = upsertDocument(uri, "", 1, td.languageId);
    }
    const plugin = resolvePlugin(uri, entry.languageId);
    return { entry, plugin };
  };

  const handleRequest = async (req: LspRequestEnvelope): Promise<LspResponseEnvelope> => {
    const { method, params = {} } = req;

    try {
      if (method === "textDocument/didOpen") {
        const td =
          (params["textDocument"] as
            { uri?: string; text?: string; version?: number; languageId?: string } | undefined) ?? {};
        if (td.uri && typeof td.text === "string") {
          upsertDocument(td.uri, td.text, td.version ?? 1, td.languageId);
        }
        return { handled: true, result: null };
      }

      if (method === "textDocument/didChange") {
        const td = (params["textDocument"] as { uri?: string; version?: number } | undefined) ?? {};
        const changes = params["contentChanges"] as Array<{ text?: string }> | undefined;
        const nextText = changes?.[changes.length - 1]?.text;
        if (td.uri && typeof nextText === "string") {
          upsertDocument(td.uri, nextText, td.version ?? 1);
        }
        return { handled: true, result: null };
      }

      if (method === "textDocument/didClose") {
        const td = (params["textDocument"] as { uri?: string } | undefined) ?? {};
        if (td.uri) docs.delete(td.uri);
        return { handled: true, result: null };
      }

      const { entry, plugin } = ensureDoc(req);
      if (!plugin) {
        return { handled: false, note: `No registered LanguagePlugin for ${entry.doc.uri}` };
      }

      const text = entry.doc.getText();
      const ch = plugin.customHandlers;

      if (method === "textDocument/diagnostic" || method === "modelscript/validate") {
        const diagnostics: LspRuntimeDiagnostic[] = [];
        const seen = new Set<string>();
        const pushUnique = (d: LspRuntimeDiagnostic) => {
          const key = `${d.range.start.line}:${d.range.start.character}:${String(d.code ?? "")}:${d.message}`;
          if (seen.has(key)) return;
          seen.add(key);
          diagnostics.push(d);
        };

        if (entry.tree?.rootNode) {
          const facadeResult = extractWasmFacadeDiagnostics(entry.doc, entry.tree, plugin);
          for (const d of facadeResult.diagnostics) pushUnique(d);

          const rootNode = entry.tree.rootNode as { hasError?: boolean | (() => boolean) };
          const rootHasError =
            typeof rootNode.hasError === "function" ? rootNode.hasError() : Boolean(rootNode.hasError);
          if (!facadeResult.usedFacade || (rootHasError && !facadeResult.hasSyntaxErrors)) {
            for (const d of extractCstSyntaxErrors(entry.tree.rootNode, plugin.id)) {
              pushUnique(d);
            }
          }
        }
        if (ch?.validate) {
          const customDiags = await ch.validate(entry.doc);
          if (Array.isArray(customDiags)) {
            for (const raw of customDiags) {
              const norm = normalizeDiagnostic(raw, plugin.id);
              if (norm) pushUnique(norm);
            }
          }
        }
        return { handled: true, result: diagnostics };
      }

      if (method === "textDocument/documentSymbol") {
        if (!ch?.symbols) return { handled: true, result: [] };
        const result = await Promise.resolve(ch.symbols(entry.tree, text, entry.doc.uri));
        return { handled: true, result: Array.isArray(result) ? result : [] };
      }

      if (method === "textDocument/hover") {
        if (!ch?.hover) return { handled: true, result: null };
        const pos = (params["position"] as LspRuntimePosition | undefined) ?? { line: 0, character: 0 };
        const offset = offsetFromPosition(entry.doc, pos);
        const result = await Promise.resolve(ch.hover(offset, text, entry.doc.uri));
        return { handled: true, result: result ?? null };
      }

      if (method === "textDocument/completion") {
        if (!ch?.complete) return { handled: true, result: [] };
        const pos = (params["position"] as LspRuntimePosition | undefined) ?? { line: 0, character: 0 };
        const offset = offsetFromPosition(entry.doc, pos);
        const result = await Promise.resolve(ch.complete(offset, text, entry.doc.uri));
        return { handled: true, result: Array.isArray(result) ? result : [] };
      }

      if (method === "textDocument/definition") {
        if (!ch?.definition) return { handled: true, result: null };
        const pos = (params["position"] as LspRuntimePosition | undefined) ?? { line: 0, character: 0 };
        const offset = offsetFromPosition(entry.doc, pos);
        const result = await Promise.resolve(ch.definition(offset, text, entry.doc.uri));
        return { handled: true, result: result ?? null };
      }

      if (method === "textDocument/references") {
        if (!ch?.references) return { handled: true, result: [] };
        const pos = (params["position"] as LspRuntimePosition | undefined) ?? { line: 0, character: 0 };
        const offset = offsetFromPosition(entry.doc, pos);
        const result = await Promise.resolve(ch.references(offset, text, entry.doc.uri));
        return { handled: true, result: Array.isArray(result) ? result : [] };
      }

      if (method === "textDocument/foldingRange") {
        if (!ch?.folding) return { handled: true, result: [] };
        const result = await Promise.resolve(ch.folding(entry.tree, text, entry.doc.uri));
        return { handled: true, result: Array.isArray(result) ? result : [] };
      }

      if (method === "textDocument/inlayHint") {
        if (!ch?.inlayHints) return { handled: true, result: [] };
        const result = await ch.inlayHints(entry.doc, params["range"]);
        return { handled: true, result: Array.isArray(result) ? result : [] };
      }

      if (method === "textDocument/codeAction") {
        if (!ch?.codeActions) return { handled: true, result: [] };
        const ctx = (params["context"] as { diagnostics?: unknown[] } | undefined) ?? {};
        const result = await ch.codeActions(entry.doc, params["range"], ctx.diagnostics ?? []);
        return { handled: true, result: Array.isArray(result) ? result : [] };
      }

      if (method === "textDocument/codeLens") {
        if (!ch?.codeLens) return { handled: true, result: [] };
        const result = await (ch.codeLens as (doc: TextDocument, ctx?: unknown) => unknown)(entry.doc, {
          uri: entry.doc.uri,
          text: entry.doc.getText(),
          headerRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          flags: {},
        });
        return { handled: true, result: Array.isArray(result) ? result : [] };
      }

      if (method === "textDocument/formatting") {
        if (!ch?.format) return { handled: true, result: [] };
        const result = await ch.format(entry.doc, params["options"]);
        return { handled: true, result: Array.isArray(result) ? result : [] };
      }

      if (method === "textDocument/signatureHelp") {
        if (!ch?.signatureHelp) return { handled: true, result: null };
        const pos = (params["position"] as LspRuntimePosition | undefined) ?? { line: 0, character: 0 };
        const result = await ch.signatureHelp(entry.doc, pos);
        return { handled: true, result: result ?? null };
      }

      if (method === "textDocument/semanticTokens/full") {
        if (ch?.semanticTokens) {
          const data = await ch.semanticTokens(entry.doc, entry.tree);
          return { handled: true, result: { data: Array.isArray(data) ? data : [] } };
        }
        const treeAny = entry.tree as { getSemanticTokens?: () => Uint32Array | number[] } | undefined;
        if (typeof treeAny?.getSemanticTokens === "function") {
          try {
            const raw = treeAny.getSemanticTokens();
            if (raw && raw.length >= 5) {
              return { handled: true, result: { data: Array.from(raw) } };
            }
          } catch {
            // fall through to CST encoder
          }
        }
        if (entry.tree?.rootNode) {
          const data = encodeCstSemanticTokens(entry.tree.rootNode, text, plugin);
          return { handled: true, result: { data } };
        }
        return { handled: true, result: { data: [] } };
      }

      if (method === "modelscript/analyzeBlt") {
        if (ch?.analyzeBlt) {
          const raw = await Promise.resolve(ch.analyzeBlt(entry.doc));
          const data = isDaeArenaLike(raw) ? await computeBltAnalysisDataFromArena(raw) : raw;
          return { handled: true, result: { supported: true, data: data ?? null } };
        }
        const directBlt = plugin.handlers?.["modelscript/analyzeBlt"];
        if (directBlt) {
          const data = await directBlt(
            { code: text, documentUri: entry.doc.uri, doc: entry.doc, tree: entry.tree },
            params,
          );
          return { handled: true, result: { supported: true, data: data ?? null } };
        }
        return { handled: true, result: { supported: false, data: null } };
      }

      if (method === "modelscript/getDiagramData" || method === "modelscript/diagram.getData") {
        if (ch?.getDiagramData) {
          const data = await Promise.resolve(ch.getDiagramData(entry.doc, params));
          return { handled: true, result: data ?? null };
        }
      }

      if (method === "modelscript/applyDiagramEdits" || method === "modelscript/diagram.applyEdits") {
        if (ch?.applyDiagramEdits) {
          const data = await Promise.resolve(ch.applyDiagramEdits(entry.doc, params));
          return { handled: true, result: data ?? null };
        }
      }

      if (method === "modelscript/getComponentProperties" || method === "modelscript/diagram.getComponentProperties") {
        if (ch?.getComponentProperties) {
          const data = await Promise.resolve(ch.getComponentProperties(entry.doc, params));
          return { handled: true, result: data ?? null };
        }
      }

      // Custom plugin handlers & actionHandlers
      const directHandler = plugin.handlers?.[method];
      if (directHandler) {
        const result = await directHandler(
          { code: text, documentUri: entry.doc.uri, doc: entry.doc, tree: entry.tree },
          params,
        );
        return { handled: true, result };
      }

      const suffix = method.split("/").pop() || method;
      const actionHandler = plugin.actionHandlers?.[suffix] ?? plugin.actionHandlers?.["__default__"];
      if (actionHandler) {
        const result = await actionHandler(
          { code: text, documentUri: entry.doc.uri, doc: entry.doc, tree: entry.tree, action: suffix },
          params,
        );
        return { handled: true, result };
      }

      return { handled: false, note: `Unhandled LSP method '${method}' for language '${plugin.id}'` };
    } catch (err) {
      return { handled: false, error: err instanceof Error ? err.message : String(err) };
    }
  };

  return {
    registry,
    registerPlugin: (plugin: LanguagePlugin) => registry.register(plugin),
    setParser: (
      langId: string,
      parser: { parse: (input: string) => { rootNode: unknown } },
      facade?: BuildLanguagePluginOptions["facade"],
    ) => {
      const existing = registry.getPluginById(langId);
      if (existing) {
        existing.parser = parser;
        if (facade !== undefined) existing.facade = facade;
        for (const [uri, entry] of docs.entries()) {
          if (entry.languageId === langId) {
            upsertDocument(uri, entry.doc.getText(), entry.doc.version + 1, langId);
          }
        }
      }
    },
    upsertDocument,
    closeDocument: (uri: string) => {
      docs.delete(uri);
    },
    handleRequest,
  };
}
