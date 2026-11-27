// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseXmlSync } from "@modelscript/dsl/xml";
import { runModelicaFastStaticLints } from "@modelscript/modelica";
import { injectPredefinedTypes } from "@modelscript/modelica/factory";
import { QueryEngine, type SymbolIndex, type WorkspaceCstTree } from "@modelscript/runtime";
import { runSysML2FastStaticLints } from "@modelscript/sysml2";
import { Connection, Diagnostic, DiagnosticSeverity, Range } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { LSPBridge, PositionIndex } from "../../lsp-bridge.js";
import { globalLanguageRegistry, type LanguagePlugin } from "../../registry/LanguageRegistry.js";
import {
  computeTreeEdit,
  isLargeXmlForWasm,
  isWasmTreeActiveInFacade,
  parseXmlFallbackTree,
  type XmlFallbackTree,
} from "../../utils/ast-utils.js";
import type { DocumentManager } from "../document-manager.js";
import type { ParserService } from "../parser-service.js";
import type { WorkspaceManager } from "../workspace-manager.js";
import { type PolyglotTreeLike, splitLinesPreserve } from "./text-helpers.js";

export type StoredDocumentTree = NonNullable<ReturnType<DocumentManager["documentTrees"]["get"]>>["tree"];

export interface DiagnosticsFilterConfig {
  enabled?: boolean | undefined;
  maxProblems?: number | undefined;
  maxNumberOfProblems?: number | undefined;
  disabledRules?: string[] | undefined;
  crossDomainDrift?: "error" | "warning" | "information" | "off" | undefined;
  formalVerificationOnSave?: boolean | undefined;
  daeSingularityCheck?: boolean | undefined;
  showInformationalBadges?: boolean | undefined;
}

export interface ValidationEngineOps {
  disposeDocument?: (uri: string) => void;
  swapIndex?: (index: SymbolIndex, changedIds: Set<number>, structuralChangedIds?: Set<number>) => void;
  updateIndex?: (index: SymbolIndex) => void;
  updateTree?: (treeWrapper: unknown) => void;
}

export interface IncrementalTreeLike {
  rootPtr?: number;
  rootNode?: { id?: number; tree?: { facade?: unknown } };
  facade?: unknown;
  edit?: (e: unknown) => void;
}

export interface LanguageDefIndexingLike {
  indexing?: {
    indexFile?: unknown;
  };
}

export interface WorkspaceIndexFileOps {
  indexFile?: (uri: string, text: string) => void;
  addFile?: (uri: string, text: string) => void;
}

export interface RawPluginDiagnosticLike {
  range?: Range;
  startOffset?: number;
  endOffset?: number;
  line?: number;
  column?: number;
  col?: number;
  endLine?: number;
  endColumn?: number;
  endCol?: number;
  severity?: number | string;
  code?: string | number;
  id?: string | number;
  message?: string;
  source?: string;
}

export function asIncrementalTree(tree: unknown): IncrementalTreeLike | null {
  return tree && typeof tree === "object" ? (tree as IncrementalTreeLike) : null;
}

export function asValidationEngineOps(engine: unknown): ValidationEngineOps | null {
  return engine && typeof engine === "object" ? (engine as ValidationEngineOps) : null;
}

export function asWorkspaceIndexFileOps(idx: unknown): WorkspaceIndexFileOps | null {
  return idx && typeof idx === "object" ? (idx as WorkspaceIndexFileOps) : null;
}

export function parseFullWithUri(
  parser: { parse(input: string, ...args: unknown[]): unknown },
  text: string,
  uri: string,
): StoredDocumentTree | undefined {
  return parser.parse(text, null, 0, 0, 0, uri) as StoredDocumentTree | undefined;
}

const NATIVE_XML_WASM_LANGS = new Set([
  "autosar",
  "cellml",
  "dicom-rt",
  "febio",
  "igtl",
  "jsbsim",
  "lps",
  "magicdraw",
  "opendrive",
  "openscenario",
  "opensim",
  "oscal",
  "plcopen",
  "pscad",
  "reqif",
  "sbml",
  "sbol",
  "sedml",
  "simulink",
  "ssp",
  "three-mf",
  "urdf",
]);

export interface PolyglotValidatorContext {
  connection: Connection;
  documentManager: DocumentManager;
  workspaceManager: WorkspaceManager;
  parserService: ParserService;
  lastIndexedText: Map<string, string>;
  documentRevisions: Map<string, number>;
  documentLSPBridges: Map<string, LSPBridge>;
  clearRevalidationTimer(): void;
  withWasmParserLock<T>(fn: () => T): Promise<T>;
  computeTokenEndCharacter(text: string, lineZero: number, colZero: number): number;
  parseIncrementalWasmTree(uri: string, langId: string, text: string, plugin?: LanguagePlugin): unknown | null;
  indexNativeDslDocument(uri: string, text: string, langId: string, languageDef?: unknown): boolean;
  createDefaultQueryEngine(langId: string, unifiedIndex: SymbolIndex, cstTreeWrapper: unknown): QueryEngine;
  syncWorkspaceStateAfterIndex(
    effectiveUri?: string,
    changedIds?: Set<number> | null,
    structuralChangedIds?: Set<number> | null,
    changedNames?: Set<string> | null,
  ): void;
  populateClassWrappers(
    effectiveUri: string,
    uri: string,
    unifiedIndex: SymbolIndex,
    engine: QueryEngine,
    context: unknown,
  ): void;
  finalizeCrossLanguageValidation(params: {
    uri: string;
    effectiveUri?: string | undefined;
    text: string;
    langId: string;
    tree?: PolyglotTreeLike | null | undefined;
    textDocument?: TextDocument | undefined;
    diagnostics: Diagnostic[];
    hasSyntaxErrors?: boolean | undefined;
    contentChanged?: boolean | undefined;
    isStale?: (() => boolean) | undefined;
  }): Promise<Diagnostic[]>;
}

/**
 * Applies user diagnostic configuration (`disabledRules`, `crossDomainDrift`, and `maxProblems` / `maxNumberOfProblems`).
 */
export function applyDiagnosticFiltersImpl(
  diagnosticsConfig: DiagnosticsFilterConfig,
  diagnostics: Diagnostic[],
): Diagnostic[] {
  const disabledRaw = diagnosticsConfig.disabledRules;
  const disabledSet =
    Array.isArray(disabledRaw) && disabledRaw.length > 0
      ? new Set(disabledRaw.map((r) => String(r).trim().toLowerCase()).filter(Boolean))
      : null;
  const driftMode = diagnosticsConfig.crossDomainDrift;
  const isDriftDiag = (d: Diagnostic): boolean => {
    const c = String(d.code ?? "").toUpperCase();
    return (
      c === "M5104" ||
      c === "THREAD_DIVERGENCE" ||
      c === "POLYGLOT_TWIN_DRIFT" ||
      c === "X7001" ||
      c === "X7002" ||
      c === "X7003" ||
      c === "X7004" ||
      c === "X7005" ||
      d.source === "modelscript-drift-checker"
    );
  };

  let filtered = diagnostics;
  if (disabledSet || driftMode) {
    filtered = [];
    for (const d of diagnostics) {
      if (disabledSet) {
        const codeStr = d.code !== undefined ? String(d.code).toLowerCase() : "";
        const mCodeStr = typeof d.code === "number" ? `m${d.code}` : "";
        const dataRule =
          typeof (d.data as { rule?: unknown } | undefined)?.rule === "string"
            ? String((d.data as { rule: string }).rule).toLowerCase()
            : "";
        if (
          (codeStr && disabledSet.has(codeStr)) ||
          (mCodeStr && disabledSet.has(mCodeStr)) ||
          (dataRule && disabledSet.has(dataRule))
        ) {
          continue;
        }
      }
      if (driftMode && isDriftDiag(d)) {
        if (driftMode === "off") continue;
        const mappedSev =
          driftMode === "error"
            ? DiagnosticSeverity.Error
            : driftMode === "information"
              ? DiagnosticSeverity.Information
              : DiagnosticSeverity.Warning;
        filtered.push(d.severity === mappedSev ? d : { ...d, severity: mappedSev });
        continue;
      }
      filtered.push(d);
    }
  }

  const rawMax = diagnosticsConfig.maxProblems ?? diagnosticsConfig.maxNumberOfProblems;
  const limit = typeof rawMax === "number" && rawMax > 0 ? Math.floor(rawMax) : 1000;
  const capped = filtered.length > limit ? filtered.slice(0, limit) : filtered;
  return capped.map((d) => {
    if (d.codeDescription || d.code === undefined || d.code === null || d.code === "") return d;
    const codeStr = typeof d.code === "number" ? `M${d.code}` : String(d.code);
    if (
      /^(M\d{4}|S\d{4}|X\d{4}|THREAD_[A-Z_]+|POLYGLOT_TWIN_DRIFT|division_by_zero|div_by_zero|math_domain|array_out_of_bounds)$/i.test(
        codeStr,
      )
    ) {
      return {
        ...d,
        codeDescription: { href: `https://modelscript.org/docs/diagnostics#${encodeURIComponent(codeStr)}` },
      };
    }
    return d;
  });
}

/**
 * Normalizes raw diagnostic records returned by custom plugin validators or `lint_*` action handlers
 * into well-formed LSP `Diagnostic` objects with trimmed ranges and mapped severities.
 */
export function normalizePluginDiagnostics(
  rawDiags: unknown,
  sourceId: string,
  text: string,
  textDocument: TextDocument,
  computeTokenEndCharacter: (text: string, lineZero: number, colZero: number) => number,
): Diagnostic[] {
  if (!Array.isArray(rawDiags)) return [];
  const lines = splitLinesPreserve(text);
  return (rawDiags as RawPluginDiagnosticLike[]).map((d) => {
    let range = d.range;
    const skipLeadingWs = (lineZero: number, colZero: number): number => {
      const lt = lines[lineZero] ?? "";
      let c = Math.max(0, Math.min(colZero, lt.length));
      while (c < lt.length && (lt[c] === " " || lt[c] === "\t")) {
        c++;
      }
      return c < lt.length ? c : Math.max(0, Math.min(colZero, lt.length));
    };
    if (!range) {
      if (typeof d.startOffset === "number" && typeof d.endOffset === "number") {
        const rawStart = textDocument.positionAt(d.startOffset);
        const rawEnd = textDocument.positionAt(Math.max(d.startOffset + 1, d.endOffset));
        if (rawStart.line === rawEnd.line) {
          const sChar = skipLeadingWs(rawStart.line, rawStart.character);
          const lt = lines[rawStart.line] ?? "";
          let eChar = Math.min(Math.max(sChar + 1, rawEnd.character), lt.length);
          while (eChar > sChar + 1 && (lt[eChar - 1] === " " || lt[eChar - 1] === "\t")) {
            eChar--;
          }
          range = {
            start: { line: rawStart.line, character: sChar },
            end: { line: rawEnd.line, character: eChar },
          };
        } else {
          range = { start: rawStart, end: rawEnd };
        }
      } else {
        const line = Math.min(Math.max(0, (d.line ?? 1) - 1), Math.max(0, lines.length - 1));
        const rawCol = Math.max(0, (d.column ?? d.col ?? 1) - 1);
        const col = skipLeadingWs(line, rawCol);
        const endLine = Math.min(Math.max(line, (d.endLine ?? d.line ?? 1) - 1), Math.max(0, lines.length - 1));
        const explicitEndCol1 = d.endColumn ?? d.endCol;
        const endLineText = lines[endLine] ?? "";
        const endCol =
          endLine === line
            ? explicitEndCol1 !== undefined
              ? Math.min(Math.max(col + 1, explicitEndCol1 - 1), Math.max(col + 1, endLineText.length))
              : computeTokenEndCharacter(text, line, col)
            : Math.min(Math.max(0, (explicitEndCol1 ?? 1) - 1), endLineText.length);
        range = {
          start: { line, character: col },
          end: { line: endLine, character: endCol },
        };
      }
    } else if (range.start && range.end && range.start.line === range.end.line) {
      const lineZero = Math.min(Math.max(0, range.start.line), Math.max(0, lines.length - 1));
      const lt = lines[lineZero] ?? "";
      let sChar = Math.max(0, Math.min(range.start.character ?? 0, lt.length));
      if (sChar === 0) {
        sChar = skipLeadingWs(lineZero, 0);
      }
      let eChar = Math.min(Math.max(sChar + 1, range.end.character ?? sChar + 1), Math.max(sChar + 1, lt.length));
      while (eChar > sChar + 1 && (lt[eChar - 1] === " " || lt[eChar - 1] === "\t")) {
        eChar--;
      }
      range = {
        start: { line: lineZero, character: sChar },
        end: { line: lineZero, character: eChar },
      };
    }
    let severity: DiagnosticSeverity = DiagnosticSeverity.Warning;
    if (d.severity === 1 || d.severity === "error" || d.severity === DiagnosticSeverity.Error) {
      severity = DiagnosticSeverity.Error;
    } else if (d.severity === 3 || d.severity === "info" || d.severity === "information") {
      severity = DiagnosticSeverity.Information;
    } else if (d.severity === 4 || d.severity === "hint") {
      severity = DiagnosticSeverity.Hint;
    }
    const diagCode = d.code ?? d.id;
    return {
      severity,
      range,
      ...(diagCode !== undefined ? { code: diagCode } : {}),
      message: d.message ?? "Diagnostic warning",
      source: d.source ?? sourceId,
    };
  });
}

/**
 * Runs a plugin's `customHandlers.validate` hook, enriches non-native XML documents with
 * `parseXmlSync` syntax errors, caches the document tree, updates the workspace index, and
 * finalizes cross-language validation. Returns `true` if handled (or failed/stale).
 */
export async function validateCustomPluginDocumentImpl(
  ctx: PolyglotValidatorContext,
  textDocument: TextDocument,
  text: string,
  plugin: LanguagePlugin,
): Promise<boolean> {
  const validateFn = plugin.customHandlers?.validate;
  if (!validateFn) return false;
  const uri = textDocument.uri;
  const revisionAtStart = ctx.documentRevisions.get(uri) ?? null;
  const isStale = () => revisionAtStart !== null && (ctx.documentRevisions.get(uri) ?? 0) !== revisionAtStart;
  try {
    await ctx.parserService?.ensureLanguageParserLoaded?.(plugin.id);
    if (isStale()) return true;
    const existingCached = ctx.documentManager.documentTrees.get(uri);
    const wasmTree = ctx.parseIncrementalWasmTree(uri, plugin.id, text, plugin);
    const res = await (validateFn as (d: TextDocument, t?: unknown) => unknown)(textDocument, wasmTree ?? undefined);
    if (isStale()) return true;
    if (Array.isArray(res)) {
      const diags = normalizePluginDiagnostics(res, plugin.id, text, textDocument, (t, l, c) =>
        ctx.computeTokenEndCharacter(t, l, c),
      );
      const head = text
        .slice(0, 512)
        .replace(/^\uFEFF/, "")
        .trimStart();
      const isXmlDoc =
        head.startsWith("<?xml") ||
        /^<!DOCTYPE\b/i.test(head) ||
        (head.startsWith("<") &&
          (/\.(xml|reqif|reqifz|mdzip|mdxml|xmi|urdf|sdf|xacro|sbml|cellml|sedml|arxml|osim|aml|plcopen|xodr|xosc|qif|sbol|3mf|feb|scl|scd|icd|cid|pscx|owx|rdf)$/i.test(
            uri,
          ) ||
            Boolean((plugin.languageDef as { grammar?: { xmlRules?: unknown } } | undefined)?.grammar?.xmlRules)));
      const usesNativeXmlWasm = NATIVE_XML_WASM_LANGS.has(plugin.id) && text.length <= 2 * 1024 * 1024;
      if (isXmlDoc && !usesNativeXmlWasm) {
        const xmlDoc = parseXmlSync(text);
        if (xmlDoc.errors.length > 0) {
          const hasNonZeroSyntaxDiag = diags.some(
            (d) =>
              d.severity === DiagnosticSeverity.Error &&
              (d.range.start.line > 0 || d.range.start.character > 0) &&
              (d.code === "REQIF-PARSE-ERROR" || String(d.code ?? "").startsWith("XML-")),
          );
          if (!hasNonZeroSyntaxDiag) {
            const filtered = diags.filter(
              (d) =>
                !(
                  d.severity === DiagnosticSeverity.Error &&
                  d.range.start.line === 0 &&
                  d.range.start.character === 0 &&
                  /parse|syntax|xml/i.test(d.message)
                ),
            );
            diags.length = 0;
            diags.push(...filtered);
            for (const err of xmlDoc.errors) {
              diags.push({
                range: {
                  start: textDocument.positionAt(err.start),
                  end: textDocument.positionAt(Math.max(err.start + 1, err.end)),
                },
                severity: DiagnosticSeverity.Error,
                code: err.code ?? "XML-PARSE-ERROR",
                source: plugin.id,
                message: err.message || "XML syntax error",
              });
            }
          }
        }
      }
      const docTree = (wasmTree ?? { rootNode: { text } }) as StoredDocumentTree;
      ctx.documentManager.documentTrees.set(uri, {
        text,
        tree: docTree,
        classCache: existingCached?.classCache ?? new Map(),
      });
      const contentChanged = ctx.lastIndexedText.get(uri) !== text;
      if ((plugin.languageDef as LanguageDefIndexingLike | undefined)?.indexing?.indexFile) {
        ctx.indexNativeDslDocument(uri, text, plugin.id, plugin.languageDef);
      } else if (plugin.workspaceIndex) {
        try {
          const idxLike = asWorkspaceIndexFileOps(plugin.workspaceIndex);
          if (typeof idxLike?.indexFile === "function") {
            idxLike.indexFile(uri, text);
          } else if (typeof idxLike?.addFile === "function") {
            idxLike.addFile(uri, text);
          }
        } catch (indexErr: unknown) {
          const msg = indexErr instanceof Error ? indexErr.message : String(indexErr);
          ctx.connection.console.warn(`[validate] Failed to index ${uri} in plugin workspace: ${msg}`);
        }
      }
      ctx.lastIndexedText.set(uri, text);
      await ctx.finalizeCrossLanguageValidation({
        uri,
        effectiveUri: uri,
        text,
        langId: plugin.id,
        tree: docTree as unknown as PolyglotTreeLike,
        textDocument,
        diagnostics: diags,
        hasSyntaxErrors: diags.some((d) => d.severity === DiagnosticSeverity.Error),
        contentChanged,
        isStale,
      });
      return true;
    }
    return false;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    ctx.connection.console.error(`[validate] Custom validation handler failed for ${uri}: ${msg}`);
    return true;
  }
}

/**
 * Fallback validator for parser-less languages exposing a `lint_*` action handler.
 * Returns `true` if the action handler ran and finalized validation.
 */
export async function validateActionLintDocumentImpl(
  ctx: PolyglotValidatorContext,
  textDocument: TextDocument,
  text: string,
  plugin: LanguagePlugin | undefined,
): Promise<boolean> {
  if (!plugin?.actionHandlers) return false;
  const lintKey = Object.keys(plugin.actionHandlers).find((k) => k.startsWith("lint_"));
  if (!lintKey || typeof plugin.actionHandlers[lintKey] !== "function") return false;
  const uri = textDocument.uri;
  try {
    const rawDiags = await plugin.actionHandlers[lintKey]({ documentText: text, uri }, { documentText: text, uri });
    const diags = normalizePluginDiagnostics(rawDiags, plugin.id, text, textDocument, (t, l, c) =>
      ctx.computeTokenEndCharacter(t, l, c),
    );
    const docTree = { rootNode: { text } };
    ctx.documentManager.documentTrees.set(uri, {
      text,
      tree: docTree,
      classCache: new Map(),
    });
    const contentChanged = ctx.lastIndexedText.get(uri) !== text;
    const wsIdx = plugin.workspaceIndex ?? ctx.workspaceManager.getWorkspaceIndex(plugin.id);
    if ((plugin.languageDef as LanguageDefIndexingLike | undefined)?.indexing?.indexFile) {
      ctx.indexNativeDslDocument(uri, text, plugin.id, plugin.languageDef);
    } else if (wsIdx) {
      try {
        const idxLike = asWorkspaceIndexFileOps(wsIdx);
        if (typeof idxLike?.indexFile === "function") {
          idxLike.indexFile(uri, text);
        } else if (typeof idxLike?.addFile === "function") {
          idxLike.addFile(uri, text);
        }
      } catch (wsErr: unknown) {
        const msg = wsErr instanceof Error ? wsErr.message : String(wsErr);
        ctx.connection.console.warn(`[validate] Failed to index ${uri} in workspace: ${msg}`);
      }
    }
    ctx.lastIndexedText.set(uri, text);
    await ctx.finalizeCrossLanguageValidation({
      uri,
      effectiveUri: uri,
      text,
      langId: plugin.id,
      tree: docTree as unknown as PolyglotTreeLike,
      textDocument,
      diagnostics: diags,
      hasSyntaxErrors: diags.some((d) => d.severity === DiagnosticSeverity.Error),
      contentChanged,
    });
    return true;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    ctx.connection.console.error(`[validate] Action lint handler ${lintKey} failed for ${uri}: ${msg}`);
    return false;
  }
}

/**
 * Runs zero-allocation fast static lints for Modelica and SysML v2 documents so
 * immediate diagnostics are published on keystroke before the async semantic pipeline completes.
 */
export function collectFastStaticDiagnostics(
  isModelica: boolean,
  langId: string,
  uri: string,
  text: string,
): Diagnostic[] {
  const fastStaticDiags: Diagnostic[] = [];
  const mapSev = (s: string): DiagnosticSeverity =>
    s === "error"
      ? DiagnosticSeverity.Error
      : s === "warning"
        ? DiagnosticSeverity.Warning
        : s === "info"
          ? DiagnosticSeverity.Information
          : DiagnosticSeverity.Hint;
  if (isModelica) {
    for (const fd of runModelicaFastStaticLints(text)) {
      fastStaticDiags.push({
        severity: mapSev(fd.severity),
        range: Range.create(0, 0, 0, 1),
        code: `M${fd.code}`,
        source: "modelscript-fast-static",
        message: fd.message,
      });
    }
  } else if (langId === "sysml2" || langId === "sysml" || /\.(sysml|kerml)($|\?|#)/i.test(uri)) {
    for (const fd of runSysML2FastStaticLints(text)) {
      fastStaticDiags.push({
        severity: mapSev(fd.severity),
        range: Range.create(0, 0, 0, 1),
        code: `S${fd.code}`,
        source: "modelscript-fast-static",
        message: fd.message,
      });
    }
  }
  return fastStaticDiags;
}

/**
 * Synchronously parses, indexes, and populates class wrappers for `uri` so diagram handlers
 * always operate on an up-to-date CST and symbol table.
 */
export async function syncDocumentForDiagramImpl(
  ctx: PolyglotValidatorContext,
  uri: string,
  explicitText?: string,
): Promise<boolean> {
  const effectiveUri = uri.startsWith("modelscript-lib://global")
    ? "file://" + uri.substring("modelscript-lib://global".length)
    : uri;
  const doc = ctx.documentManager.documents.get(uri) ?? ctx.documentManager.documents.get(effectiveUri);
  const text = explicitText ?? doc?.getText();
  if (!text) return false;
  const plugin = globalLanguageRegistry.getPluginForUri(uri);
  const langId =
    plugin?.id ??
    (doc?.languageId || (uri.endsWith(".mo") || uri.endsWith(".mos") || uri.endsWith(".msim") ? "modelica" : "sysml2"));
  const isModelica = langId === "modelica";

  let cached = ctx.documentManager.documentTrees.get(uri) ?? ctx.documentManager.documentTrees.get(effectiveUri);
  if (!cached?.tree || cached.text !== text) {
    await ctx.parserService.ensureLanguageParserLoaded(doc?.languageId || uri);
    const parser =
      plugin?.parser ??
      ctx.parserService.getParserForUri(uri) ??
      (isModelica && ctx.parserService.isParserReady("modelica") ? ctx.parserService.getParser("modelica") : undefined);
    let processedText = text;
    if (plugin?.preprocessText) {
      processedText = plugin.preprocessText(text);
    }

    const tree = await ctx.withWasmParserLock<StoredDocumentTree | undefined>(() => {
      if (isLargeXmlForWasm(uri, processedText, plugin)) {
        return cached?.text === text && (cached?.tree as XmlFallbackTree | undefined)?.__isXmlCstFallback
          ? cached.tree
          : parseXmlFallbackTree(processedText);
      }
      const oldTree = asIncrementalTree(cached?.tree);
      const activeFacade = (plugin?.facade ??
        oldTree?.facade ??
        oldTree?.rootNode?.tree?.facade ??
        ctx.parserService.facade) as { lastAstRoot?: number; loadSource?: (text: string) => void } | undefined;
      const isOldTreeActiveInWasm = isWasmTreeActiveInFacade(cached?.tree, activeFacade, uri);

      if (cached?.tree && cached.text !== text && isOldTreeActiveInWasm && parser) {
        const edit = computeTreeEdit(cached.text, text);
        if (typeof oldTree?.edit === "function") {
          oldTree.edit(edit as never);
        }
        return parser.parse(processedText, cached.tree, edit.startIndex, edit.oldEndIndex, edit.newEndIndex, uri) as
          StoredDocumentTree | undefined;
      }
      if (parser) {
        return parseFullWithUri(parser, processedText, uri);
      }
      if (ctx.parserService.sharedContext && isModelica) {
        return ctx.parserService.sharedContext.parse(".mo", processedText) as StoredDocumentTree | undefined;
      }
      return undefined;
    });

    if (tree) {
      if (cached?.tree && cached.tree !== tree) {
        cached.tree.delete?.();
      }
      const normUri = uri.replace(/^([a-z0-9+-]+):\/{0,3}/i, "$1:///");
      const oneSlashUri = uri.replace(/^([a-z0-9+-]+):\/{0,3}/i, "$1:/");
      const docEntry = {
        text,
        tree,
        classCache: cached?.classCache ?? new Map(),
      };
      ctx.documentManager.documentTrees.set(uri, docEntry);
      ctx.documentManager.documentTrees.set(normUri, docEntry);
      ctx.documentManager.documentTrees.set(oneSlashUri, docEntry);
      cached = docEntry;
    }
  }

  if (!cached?.tree) return false;

  const normUri = uri.replace(/^([a-z0-9+-]+):\/{0,3}/i, "$1:///");
  const oneSlashUri = uri.replace(/^([a-z0-9+-]+):\/{0,3}/i, "$1:/");
  if (ctx.workspaceManager.unifiedWorkspace) {
    const wsTree = cached.tree as unknown as WorkspaceCstTree;
    ctx.workspaceManager.unifiedWorkspace.setDocumentTree(uri, wsTree);
    ctx.workspaceManager.unifiedWorkspace.setDocumentTree(normUri, wsTree);
    ctx.workspaceManager.unifiedWorkspace.setDocumentTree(oneSlashUri, wsTree);
    const uDoc =
      ctx.workspaceManager.unifiedWorkspace.getDocument(uri) ??
      ctx.workspaceManager.unifiedWorkspace.getDocument(normUri) ??
      ctx.workspaceManager.unifiedWorkspace.getDocument(oneSlashUri);
    if (uDoc) {
      uDoc.text = text;
      uDoc.tree = wsTree;
    }
  }

  const prevIndexedText = ctx.lastIndexedText.get(effectiveUri) ?? ctx.lastIndexedText.get(uri);
  const hasInstances = Boolean(
    ctx.workspaceManager.documentInstances.get(uri)?.length ||
    ctx.workspaceManager.documentInstances.get(effectiveUri)?.length,
  );
  if (prevIndexedText === text && hasInstances) {
    return false;
  }

  const wsIndex = plugin?.workspaceIndex ?? ctx.workspaceManager.getWorkspaceIndex(langId);
  let changedIds: Set<number> | null = null;
  let changedNames: Set<string> | null = null;
  let structuralChangedIds: Set<number> | null = null;

  if (wsIndex) {
    if (prevIndexedText !== text) {
      let actualEditRanges: { startOffset: number; endOffset: number }[] | undefined;
      let totalDelta = 0;
      if (prevIndexedText !== undefined) {
        const edit = computeTreeEdit(prevIndexedText, text);
        actualEditRanges = [
          {
            startOffset: edit.startIndex,
            endOffset: Math.max(edit.oldEndIndex, edit.newEndIndex),
          },
        ];
        totalDelta = edit.newEndIndex - edit.oldEndIndex;
      }
      if (typeof wsIndex.has === "function") {
        if (wsIndex.has(effectiveUri)) {
          wsIndex.reindexDocument?.(effectiveUri, () => cached?.tree?.rootNode ?? null, actualEditRanges, totalDelta);
        } else {
          wsIndex.register?.(effectiveUri, () => cached?.tree?.rootNode ?? null);
        }
        wsIndex.getFileIndex?.(effectiveUri);
      }
      const wsInstances = ctx.workspaceManager.workspaceInstances;
      if (wsInstances) {
        for (const key of wsInstances.keys()) {
          if (key.startsWith(effectiveUri + "#")) {
            wsInstances.delete(key);
          }
        }
      }
      ctx.workspaceManager.workspaceInstances.delete(uri);
      ctx.workspaceManager.workspaceInstances.delete(effectiveUri);
      ctx.workspaceManager.documentInstances.delete(uri);
      ctx.workspaceManager.documentInstances.delete(effectiveUri);
      ctx.lastIndexedText.set(effectiveUri, text);
      ctx.lastIndexedText.set(uri, text);
    }

    const changedIdsObj = (
      typeof wsIndex.takeGlobalChangedIds === "function" ? wsIndex.takeGlobalChangedIds() : null
    ) as { changedIds: Set<number> | null; structuralChangedIds?: Set<number> | null } | null;
    changedIds = changedIdsObj ? changedIdsObj.changedIds : null;
    structuralChangedIds = changedIdsObj?.structuralChangedIds ?? null;
    changedNames = typeof wsIndex.takeGlobalChangedNames === "function" ? wsIndex.takeGlobalChangedNames() : null;

    if (prevIndexedText !== text && !changedIds) {
      const activeEngine = asValidationEngineOps(plugin?.queryEngine ?? ctx.workspaceManager.getQueryEngine(langId));
      if (activeEngine && typeof activeEngine.disposeDocument === "function") {
        activeEngine.disposeDocument(effectiveUri);
        if (uri !== effectiveUri) activeEngine.disposeDocument(uri);
        if (normUri !== effectiveUri && normUri !== uri) activeEngine.disposeDocument(normUri);
      }
    }
  }

  ctx.clearRevalidationTimer();

  const unifiedIndex = ctx.workspaceManager.unifiedWorkspace.getIndex();
  const cstTreeWrapper = ctx.parserService.getSharedCstTreeWrapper();

  let engine = plugin?.queryEngine ?? ctx.workspaceManager.getQueryEngine(langId);
  if (!engine) {
    engine = ctx.createDefaultQueryEngine(langId, unifiedIndex, cstTreeWrapper);
    if (engine) {
      ctx.workspaceManager.setQueryEngine(langId, engine);
    }
  } else {
    if (langId === "modelica") {
      injectPredefinedTypes(unifiedIndex);
    }
    const engineOps = asValidationEngineOps(engine);
    if (changedIds && typeof engineOps?.swapIndex === "function") {
      engineOps.swapIndex(unifiedIndex, changedIds, structuralChangedIds || undefined);
    } else if (prevIndexedText !== text && typeof engineOps?.updateIndex === "function") {
      engineOps.updateIndex(unifiedIndex);
    }
    if (typeof engineOps?.updateTree === "function") {
      engineOps.updateTree(cstTreeWrapper);
    }
  }

  ctx.syncWorkspaceStateAfterIndex(effectiveUri, changedIds, structuralChangedIds, changedNames);

  const context = ctx.parserService.sharedContext;
  if (context && langId === "modelica") {
    if (typeof context.setQueryEngine === "function") context.setQueryEngine(engine);
    else context.queryEngine = engine;
    if (typeof context.setWorkspaceIndex === "function") context.setWorkspaceIndex(wsIndex);
    else context.workspaceIndex = wsIndex;
  }

  const bridge = new LSPBridge(unifiedIndex, engine, new PositionIndex(text), uri, {
    documentLSPBridges: ctx.documentLSPBridges,
    documents: ctx.documentManager.documents,
    sharedFs: ctx.parserService?.sharedContext?.fs ?? ctx.documentManager?.sharedContext?.fs,
  });
  ctx.documentLSPBridges.set(uri, bridge);

  ctx.populateClassWrappers(effectiveUri, uri, unifiedIndex, engine, context);
  return true;
}
