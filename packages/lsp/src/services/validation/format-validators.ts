// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseXmlSync } from "@modelscript/dsl/xml";
import { QueryEngine, type SyntaxNode } from "@modelscript/runtime";
import { type Connection, type Diagnostic, DiagnosticSeverity } from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { LSPBridge, PositionIndex } from "../../lsp-bridge.js";
import type { LanguagePlugin } from "../../registry/LanguageRegistry.js";
import { computeTreeEdit, isLargeXmlForWasm, isWasmTreeActiveInFacade } from "../../utils/ast-utils.js";
import type { DocumentManager } from "../document-manager.js";
import type { ParserService } from "../parser-service.js";
import type { WorkspaceManager } from "../workspace-manager.js";
import {
  measureSyntaxTokenLength,
  type PolyglotTreeLike,
  splitLinesPreserve,
  type WasmLintDiagnostic,
} from "./text-helpers.js";

export interface FormatValidatorsContext {
  connection: Connection;
  documentManager: DocumentManager;
  parserService: ParserService;
  workspaceManager: WorkspaceManager;
  documentLSPBridges: Map<string, LSPBridge>;
  lastIndexedText: Map<string, string>;
  lastScadOwnDiagnostics: Map<string, { text: string; diagnostics: Diagnostic[] }>;
  lastStepOwnDiagnostics: Map<string, { text: string; diagnostics: Diagnostic[] }>;
  inFlightStepValidations: Map<string, { text: string; promise: Promise<void> }>;
  showInformationalBadges: boolean;
  collectSyntaxErrors: (
    rootNode: unknown,
    textDocument: TextDocument,
    plugin?: LanguagePlugin,
  ) => { syntaxDiags: Diagnostic[]; wasmLintDiags: WasmLintDiagnostic[] };
  finalizeCustomDocument: (
    textDocument: TextDocument,
    langId: string,
    diagnostics: Diagnostic[],
    prevIndexedText?: string,
  ) => Promise<void>;
  finalizeCrossLanguageValidation: (params: {
    uri: string;
    effectiveUri?: string | undefined;
    text: string;
    langId: string;
    tree?: PolyglotTreeLike | null | undefined;
    textDocument?: TextDocument | undefined;
    diagnostics: Diagnostic[];
    hasSyntaxErrors?: boolean | undefined;
    contentChanged?: boolean | undefined;
  }) => Promise<unknown>;
  indexNativeDslDocument: (uri: string, text: string, langId: string, languageDef?: unknown) => boolean;
  syncWorkspaceStateAfterIndex: (uri: string) => void;
  sendProjectTreeChanged: (uri?: string) => void;
}

interface IncrementalTreeLike {
  rootNode?: unknown;
  edit?: (e: unknown) => void;
  delete?: () => void;
}

interface ErrorWalkNode {
  hasError?: boolean | (() => boolean);
  isMissing?: boolean;
  type?: string;
  startOffset?: number;
  startIndex?: number;
  endOffset?: number;
  endIndex?: number;
  children?: ErrorWalkNode[];
}

function getErrorInfo(err: unknown): { message: string; stack?: string | undefined } {
  if (err instanceof Error) return { message: err.message, stack: err.stack };
  if (err && typeof err === "object" && "message" in err) {
    const o = err as { message?: unknown; stack?: unknown };
    return {
      message: typeof o.message === "string" ? o.message : String(err),
      stack: typeof o.stack === "string" ? o.stack : undefined,
    };
  }
  return { message: String(err) };
}

/**
 * Computes a safe 0-based end character on the given line when `endColumn` is not provided,
 * clamping to the XML tag name (`<tagName`) or identifier token at `(line, col)` so squiggles
 * never spill across whitespace into attributes.
 */
export function computeTokenEndCharacterImpl(text: string, lineZero: number, colZero: number): number {
  const lineText = splitLinesPreserve(text)[lineZero] ?? "";
  let startCol = Math.max(0, Math.min(colZero, lineText.length));
  while (startCol < lineText.length && (lineText[startCol] === " " || lineText[startCol] === "\t")) {
    startCol++;
  }
  const tokenLen = measureSyntaxTokenLength(lineText, startCol);
  if (tokenLen > 0) {
    return startCol + tokenLen;
  }
  return Math.min(lineText.length, startCol + 1);
}

/**
 * Incrementally parses a WASM CST tree when a prior tree is cached and still active in the facade.
 */
export function parseIncrementalWasmTreeImpl(
  ctx: Pick<FormatValidatorsContext, "documentManager" | "parserService">,
  uri: string,
  langId: string,
  text: string,
  plugin?: LanguagePlugin,
): IncrementalTreeLike | null {
  if (isLargeXmlForWasm(uri, text, plugin)) return null;
  const wasmParser = plugin?.parser ?? ctx.parserService?.getParser?.(langId);
  if (!wasmParser || typeof wasmParser.parse !== "function") return null;

  const cached = ctx.documentManager.documentTrees.get(uri);
  const cachedTree = cached?.tree as IncrementalTreeLike | undefined;

  if (cached?.text === text && cachedTree?.rootNode && typeof cachedTree.edit === "function") {
    return cachedTree;
  }

  try {
    if (cachedTree && cached?.text && cached.text !== text && typeof cachedTree.edit === "function") {
      const activeFacade = (plugin?.facade ?? ctx.parserService.getFacade(langId)) as
        { lastAstRoot?: number } | undefined;
      if (!activeFacade || isWasmTreeActiveInFacade(cachedTree, activeFacade, uri)) {
        const edit = computeTreeEdit(cached.text, text);
        cachedTree.edit(edit as never);
        const nextTree = wasmParser.parse(text, cachedTree, edit.startIndex, edit.oldEndIndex, edit.newEndIndex, uri);
        if (nextTree && nextTree !== cachedTree) {
          cachedTree.delete?.();
        }
        return (nextTree as IncrementalTreeLike | null | undefined) ?? null;
      }
    }
    const freshTree = wasmParser.parse(text, null, 0, 0, 0, uri);
    if (cachedTree && cachedTree !== freshTree) {
      cachedTree.delete?.();
    }
    return (freshTree as IncrementalTreeLike | null | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * Validates an OpenSCAD (`.scad`) document using the SCAD WASM parser, CST linter, and digital thread CAD bounds checks.
 */
export async function validateScadDocumentImpl(
  ctx: Pick<
    FormatValidatorsContext,
    | "connection"
    | "documentManager"
    | "parserService"
    | "workspaceManager"
    | "lastIndexedText"
    | "lastScadOwnDiagnostics"
    | "showInformationalBadges"
    | "collectSyntaxErrors"
    | "finalizeCustomDocument"
  >,
  textDocument: TextDocument,
  plugin?: LanguagePlugin,
): Promise<void> {
  const text = textDocument.getText();
  const prevIndexedText = ctx.lastIndexedText.get(textDocument.uri);
  const existingTreeEntry = ctx.documentManager.documentTrees.get(textDocument.uri);
  const cachedScad = ctx.lastScadOwnDiagnostics.get(textDocument.uri);
  if (cachedScad && cachedScad.text === text && prevIndexedText === text && existingTreeEntry?.text === text) {
    await ctx.finalizeCustomDocument(textDocument, "scad", [...cachedScad.diagnostics], text);
    return;
  }
  const scadDiagnostics: Diagnostic[] = [];
  let scadValidationFailed = false;

  try {
    ctx.connection.console.info(`[scad] Validating ${textDocument.uri} (${text.length} chars)`);
    ctx.lastIndexedText.set(textDocument.uri, text);
    await ctx.parserService?.ensureLanguageParserLoaded?.("scad");
    const { getScadParser, lintScadCst, validateScadDigitalThreadAndBounds } = await import("@modelscript/scad");
    let scadTreeRoot: SyntaxNode | null = null;
    const parser = plugin?.parser ?? ctx.parserService?.getParser?.("scad") ?? (await getScadParser());
    if (parser) {
      const tree = parser.parse(text);
      if (tree?.rootNode) {
        const rootNode = tree.rootNode as SyntaxNode;
        scadTreeRoot = rootNode;
        ctx.documentManager.documentTrees.set(textDocument.uri, {
          text,
          tree,
          classCache: new Map(),
        });
        const { syntaxDiags } = ctx.collectSyntaxErrors(rootNode, textDocument, plugin);
        scadDiagnostics.push(...syntaxDiags);

        if (syntaxDiags.length === 0) {
          const semanticDiags = lintScadCst(rootNode as Parameters<typeof lintScadCst>[0], text, {
            uri: textDocument.uri,
            workspace: ctx.workspaceManager.unifiedWorkspace,
          });
          for (const d of semanticDiags) {
            scadDiagnostics.push({
              severity:
                d.severity === "error"
                  ? DiagnosticSeverity.Error
                  : d.severity === "info"
                    ? DiagnosticSeverity.Information
                    : DiagnosticSeverity.Warning,
              range: {
                start: textDocument.positionAt(d.startOffset),
                end: textDocument.positionAt(d.endOffset),
              },
              code: d.code,
              message: d.message,
              source: "scad",
            });
          }
        }
      }
    }

    scadDiagnostics.push(
      ...(validateScadDigitalThreadAndBounds(
        text,
        scadTreeRoot,
        (off) => textDocument.positionAt(off),
        ctx.showInformationalBadges,
      ) as Diagnostic[]),
    );
  } catch (e: unknown) {
    scadValidationFailed = true;
    ctx.connection.console.warn(`[scad] Validation failed for ${textDocument.uri}: ${getErrorInfo(e).message}`);
  }

  const latestDoc = ctx.documentManager?.documents?.get(textDocument.uri);
  if (!scadValidationFailed && (!latestDoc || latestDoc.version === textDocument.version)) {
    ctx.lastScadOwnDiagnostics.set(textDocument.uri, { text, diagnostics: [...scadDiagnostics] });
  }
  await ctx.finalizeCustomDocument(textDocument, "scad", scadDiagnostics, prevIndexedText);
}

/**
 * Registers a JavaScript/TypeScript sidecar file as a synthetic class instance in the workspace.
 */
export function validateSidecarDocumentImpl(
  ctx: Pick<FormatValidatorsContext, "connection" | "parserService" | "workspaceManager" | "sendProjectTreeChanged">,
  textDocument: TextDocument,
): void {
  const context = ctx.parserService.sharedContext;
  if (!context) return;
  const text = textDocument.getText();
  const filename = textDocument.uri.split("/").pop();
  const name = filename
    ? filename.endsWith(".ts") || filename.endsWith(".js")
      ? filename.slice(0, -3)
      : filename
    : "";
  const entity = {
    isClassInstance: true,
    jsSource: text,
    name,
    context,
    uri: textDocument.uri,
    instantiate() {},
  };
  entity.instantiate();
  ctx.workspaceManager.workspaceInstances.set(textDocument.uri, [entity]);
  ctx.workspaceManager.documentInstances.set(textDocument.uri, [entity]);
  ctx.workspaceManager.documentContexts.set(textDocument.uri, context);
  ctx.connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: [] });
  ctx.sendProjectTreeChanged();
}

/**
 * Parses, lints, and indexes a PSCAD (`.pscx`, `.pslx`, `.pswx`, `.psmx`) power systems document.
 */
export async function validatePscadDocumentImpl(
  ctx: Pick<
    FormatValidatorsContext,
    | "connection"
    | "documentManager"
    | "parserService"
    | "collectSyntaxErrors"
    | "indexNativeDslDocument"
    | "sendProjectTreeChanged"
    | "finalizeCustomDocument"
  >,
  textDocument: TextDocument,
  plugin?: LanguagePlugin,
): Promise<void> {
  const text = textDocument.getText();
  const pscadDiagnostics: Diagnostic[] = [];

  try {
    ctx.connection.console.info(`[pscad] Validating ${textDocument.uri} (${text.length} chars)`);
    await ctx.parserService?.ensureLanguageParserLoaded?.("pscad");
    const { pscadLanguage, validatePscadDocumentCore } = await import("@modelscript/pscad");
    const workspaceDocs =
      typeof ctx.documentManager?.documents?.all === "function"
        ? ctx.documentManager.documents.all().map((doc) => ({ uri: doc.uri, text: doc.getText() }))
        : [];
    const wasmTree = parseIncrementalWasmTreeImpl(ctx, textDocument.uri, "pscad", text, plugin);
    const syntaxLines = new Set<number>();
    if (wasmTree?.rootNode) {
      const { syntaxDiags } = ctx.collectSyntaxErrors(wasmTree.rootNode, textDocument, plugin);
      for (const d of syntaxDiags) {
        syntaxLines.add(d.range.start.line);
        pscadDiagnostics.push({ ...d, source: "pscad" });
      }
    }
    const { project, diagnostics: coreDiags } = validatePscadDocumentCore(text, {
      uri: textDocument.uri,
      wasmTree,
      syntaxLines,
      workspaceDocs,
      positionAt: (off) => textDocument.positionAt(off),
      computeTokenEndCharacter: (src, line, col) => computeTokenEndCharacterImpl(src, line, col),
    });
    pscadDiagnostics.push(...(coreDiags as Diagnostic[]));

    if (wasmTree?.rootNode) {
      (wasmTree.rootNode as { data?: unknown }).data = project;
      ctx.documentManager.documentTrees.set(textDocument.uri, {
        text,
        tree: wasmTree as unknown as Parameters<typeof ctx.documentManager.documentTrees.set>[1]["tree"],
        classCache: new Map(),
      });
    } else {
      ctx.documentManager.documentTrees.set(textDocument.uri, {
        text,
        tree: { rootNode: { text, data: project } },
        classCache: new Map(),
      });
    }

    // Index symbols for Library Tree panel and navigation
    if (ctx.indexNativeDslDocument(textDocument.uri, text, "pscad", pscadLanguage)) {
      ctx.sendProjectTreeChanged();
    }
  } catch (err: unknown) {
    const errMsg = getErrorInfo(err).message;
    ctx.connection.console.error(`[pscad] Error validating PSCAD document ${textDocument.uri}: ${errMsg}`);
    const xmlErrors = parseXmlSync(text).errors;
    if (xmlErrors.length > 0) {
      for (const xmlErr of xmlErrors) {
        pscadDiagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: {
            start: textDocument.positionAt(xmlErr.start),
            end: textDocument.positionAt(Math.max(xmlErr.start + 1, xmlErr.end)),
          },
          code: xmlErr.code ?? "XML-PARSE-ERROR",
          message: xmlErr.message || "XML syntax error",
          source: "pscad",
        });
      }
    } else if (pscadDiagnostics.length === 0) {
      pscadDiagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        message: `PSCAD Parse Error: ${errMsg}`,
        source: "pscad",
      });
    }
  }

  await ctx.finalizeCustomDocument(textDocument, "pscad", pscadDiagnostics);
}

/**
 * Validates an ISO 10303-21 STEP document (`.step`, `.stp`, `.p21`) for syntax, entity reference integrity, and schema arity.
 */
export async function validateStepDocumentImpl(
  ctx: Pick<
    FormatValidatorsContext,
    | "connection"
    | "documentManager"
    | "parserService"
    | "workspaceManager"
    | "documentLSPBridges"
    | "lastIndexedText"
    | "lastStepOwnDiagnostics"
    | "inFlightStepValidations"
    | "syncWorkspaceStateAfterIndex"
    | "finalizeCrossLanguageValidation"
  >,
  textDocument: TextDocument,
  plugin?: LanguagePlugin,
): Promise<void> {
  const text = textDocument.getText();
  const isLargeStep = text.length > 262_144;
  const stepParser = isLargeStep ? undefined : (plugin?.parser ?? ctx.parserService.getParser("step"));
  const existingTreeEntry = ctx.documentManager.documentTrees.get(textDocument.uri);
  const cachedStep = ctx.lastStepOwnDiagnostics.get(textDocument.uri);
  if (
    cachedStep &&
    cachedStep.text === text &&
    ctx.lastIndexedText.get(textDocument.uri) === text &&
    (isLargeStep || !stepParser || existingTreeEntry?.text === text)
  ) {
    await ctx.finalizeCrossLanguageValidation({
      uri: textDocument.uri,
      effectiveUri: textDocument.uri,
      text,
      langId: "step",
      tree: existingTreeEntry?.tree && "edit" in existingTreeEntry.tree ? existingTreeEntry.tree : undefined,
      textDocument,
      diagnostics: [...cachedStep.diagnostics],
      hasSyntaxErrors: cachedStep.diagnostics.some((d) => d.severity === DiagnosticSeverity.Error),
      contentChanged: false,
    });
    return;
  }

  const inflight = ctx.inFlightStepValidations.get(textDocument.uri);
  if (inflight && inflight.text === text) {
    await inflight.promise;
    return;
  }

  const run = async (): Promise<void> => {
    const buffer = new TextEncoder().encode(text);
    const stepDiagnostics: Diagnostic[] = [];
    try {
      ctx.connection.console.info(`[step] Validating ${textDocument.uri} (${text.length} chars)`);
      let tree: { rootNode?: ErrorWalkNode } | undefined;
      if (existingTreeEntry && existingTreeEntry.text === text && existingTreeEntry.tree) {
        tree = existingTreeEntry.tree as unknown as { rootNode?: ErrorWalkNode };
      } else if (stepParser) {
        const parsed = stepParser.parse(text);
        if (parsed) {
          tree = parsed as unknown as { rootNode?: ErrorWalkNode };
          ctx.documentManager.documentTrees.set(textDocument.uri, {
            text,
            tree: parsed,
            classCache: new Map(),
          });
        }
      }

      const { indexStepDocument } = await import("@modelscript/step");
      const serverDistBase = ctx.parserService?.getServerDistBase?.() || undefined;
      await indexStepDocument(
        ctx.workspaceManager.unifiedWorkspace,
        textDocument.uri,
        buffer,
        serverDistBase ? { serverDistBase } : undefined,
      );

      const unifiedIndex = ctx.workspaceManager.unifiedWorkspace.getIndex();
      if (ctx.workspaceManager.globalModelicaQueryEngine) {
        ctx.workspaceManager.globalModelicaQueryEngine.updateIndex(unifiedIndex);
      }
      if (ctx.workspaceManager.globalSysML2QueryEngine) {
        ctx.workspaceManager.globalSysML2QueryEngine.updateIndex(unifiedIndex);
      }

      let engine = ctx.workspaceManager.getQueryEngine("step");
      if (!engine) {
        engine = new QueryEngine(unifiedIndex, {} as unknown as ConstructorParameters<typeof QueryEngine>[1]);
        ctx.workspaceManager.setQueryEngine("step", engine);
      } else {
        engine.updateIndex(unifiedIndex);
      }
      ctx.syncWorkspaceStateAfterIndex(textDocument.uri);
      const bridge = new LSPBridge(unifiedIndex, engine, new PositionIndex(text), textDocument.uri, {
        documentLSPBridges: ctx.documentLSPBridges,
        documents: ctx.documentManager.documents,
        sharedFs: ctx.parserService?.sharedContext?.fs ?? ctx.documentManager?.sharedContext?.fs,
      });
      ctx.documentLSPBridges.set(textDocument.uri, bridge);

      if (tree) {
        const collectErrors = (node: ErrorWalkNode | undefined) => {
          if (!node) return;
          if (typeof node.hasError === "function" ? !node.hasError() : node.hasError === false) return;
          if (node.isMissing || node.type === "ERROR") {
            const startOff = typeof node.startOffset === "number" ? node.startOffset : (node.startIndex ?? 0);
            const endOff = typeof node.endOffset === "number" ? node.endOffset : (node.endIndex ?? startOff);
            const range = bridge["positions"].rangeFromOffsets(startOff, endOff);
            stepDiagnostics.push({
              severity: DiagnosticSeverity.Error,
              range,
              message: node.isMissing ? "Missing syntax element" : "Syntax error",
              source: "step",
            });
          }
          const children = node.children || [];
          for (let i = 0; i < children.length; i++) {
            collectErrors(children[i]);
          }
        };
        collectErrors(tree.rootNode);
      }
    } catch (e: unknown) {
      const info = getErrorInfo(e);
      ctx.connection.console.error(
        `[step] Error in STEP pipeline for ${textDocument.uri}: ${info.message}\n${info.stack ?? ""}`,
      );
    }

    const { validateStepReferencesAndSchema } = await import("@modelscript/step");
    stepDiagnostics.push(
      ...(validateStepReferencesAndSchema(text, (off) => textDocument.positionAt(off)) as Diagnostic[]),
    );

    const contentChanged = ctx.lastIndexedText.get(textDocument.uri) !== text;
    ctx.lastIndexedText.set(textDocument.uri, text);
    ctx.lastStepOwnDiagnostics.set(textDocument.uri, { text, diagnostics: [...stepDiagnostics] });
    const storedStepTree = ctx.documentManager.documentTrees.get(textDocument.uri)?.tree;
    await ctx.finalizeCrossLanguageValidation({
      uri: textDocument.uri,
      effectiveUri: textDocument.uri,
      text,
      langId: "step",
      tree: storedStepTree && "edit" in storedStepTree ? storedStepTree : undefined,
      textDocument,
      diagnostics: stepDiagnostics,
      hasSyntaxErrors: stepDiagnostics.some((d) => d.severity === DiagnosticSeverity.Error),
      contentChanged,
    });
  };

  const promise = run().finally(() => {
    const current = ctx.inFlightStepValidations.get(textDocument.uri);
    if (current?.promise === promise) {
      ctx.inFlightStepValidations.delete(textDocument.uri);
    }
  });
  ctx.inFlightStepValidations.set(textDocument.uri, { text, promise });
  await promise;
}
