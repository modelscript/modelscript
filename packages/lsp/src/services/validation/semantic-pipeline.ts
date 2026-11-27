// SPDX-License-Identifier: AGPL-3.0-or-later

import { injectPredefinedTypes } from "@modelscript/modelica/factory";
import { QueryEngine, type SymbolIndex, type UnifiedWorkspace } from "@modelscript/runtime";
import { Connection, Diagnostic, DiagnosticSeverity } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { LSPBridge, PositionIndex } from "../../lsp-bridge.js";
import type { LanguagePlugin } from "../../registry/LanguageRegistry.js";
import { computeTreeEdit } from "../../utils/ast-utils.js";
import {
  deduplicateAllDiagnostics,
  SemanticDiagnosticLineIndex,
  tryDeduplicateOrMergeSemanticDiagnostic,
} from "../diagnostic-dedup.js";
import type { DocumentManager } from "../document-manager.js";
import type { ParserService } from "../parser-service.js";
import { hasWorkspaceLinter, runWorkspaceLinterForDocument } from "../workspace-linter-dispatch.js";
import type { WorkspaceManager } from "../workspace-manager.js";
import {
  asValidationEngineOps,
  type DiagnosticsFilterConfig,
  type LanguageDefIndexingLike,
} from "./polyglot-validator.js";
import type {
  EngineLintDiagnosticLike,
  PolyglotTreeLike,
  SharedContextWorkspaceBridge,
  ValidationQueryEngine,
  WasmLintDiagnostic,
} from "./text-helpers.js";

interface ValidationTreeLike {
  rootNode?: {
    hasError?: boolean | (() => boolean);
  };
}

export interface UnifiedSemanticPipelineParams {
  uri: string;
  text: string;
  tree: unknown;
  editRanges?: Array<{ startOffset: number; endOffset: number }> | undefined;
  baseDiagnostics: Diagnostic[];
  wasmLintDiags?: WasmLintDiagnostic[] | undefined;
  revisionAtStart: number | null;
  plugin?: LanguagePlugin | undefined;
  langId: string;
  textDocument?: TextDocument | undefined;
  isSave?: boolean | undefined;
}

export interface FinalizeCrossLanguageParams {
  uri: string;
  effectiveUri?: string | undefined;
  text: string;
  langId: string;
  tree?: PolyglotTreeLike | null | undefined;
  textDocument?: TextDocument | undefined;
  diagnostics: Diagnostic[];
  hasSyntaxErrors?: boolean | undefined;
  changedIds?: Set<number> | null | undefined;
  structuralChangedIds?: Set<number> | null | undefined;
  changedNames?: Set<string> | null | undefined;
  skipSend?: boolean | undefined;
  skipCascade?: boolean | undefined;
  contentChanged?: boolean | undefined;
  isStale?: (() => boolean) | undefined;
}

export interface SemanticPipelineContext {
  connection: Connection;
  documentManager: DocumentManager;
  workspaceManager: WorkspaceManager;
  parserService: ParserService;
  diagnosticsConfig: DiagnosticsFilterConfig;
  lastSemanticDiagnostics: Map<string, Diagnostic[]>;
  lastIndexedText: Map<string, string>;
  documentLSPBridges: Map<string, LSPBridge>;
  documentRevisions: Map<string, number>;
  documentViewports: Map<string, { startOffset: number; endOffset: number }>;
  verificationDiagnosticsByUri: Map<string, Diagnostic[]>;
  reasonerDiagnosticsByUri: Map<string, Diagnostic[]>;
  digitalThreadDiagnosticsByUri: Map<string, Diagnostic[]>;
  isCascadeRevalidationActive(): boolean;
  clearRevalidationTimer(): void;
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
  convertWasmLintDiagnostics(
    wasmDiags: WasmLintDiagnostic[],
    textDocument?: TextDocument,
    plugin?: LanguagePlugin,
    text?: string,
    bridge?: LSPBridge,
  ): Diagnostic[];
  reconcileCrossLanguageWasmDiagnostics(
    wasmDiags: Diagnostic[],
    unifiedIndex: SymbolIndex,
    engine: ValidationQueryEngine | null | undefined,
    engineDiags: Array<{
      code?: string | number | undefined;
      startOffset?: number | undefined;
      endOffset?: number | undefined;
    }> | null,
    effectiveUri: string,
    langId: string,
    text: string,
    textDocument?: TextDocument,
    plugin?: LanguagePlugin,
  ): Diagnostic[];
  applyDiagnosticFilters(diagnostics: Diagnostic[]): Diagnostic[];
  sendProjectTreeChanged(uri?: string): void;
  postValidateOwl2(
    effectiveUri: string,
    tree: PolyglotTreeLike | null | undefined,
    text: string,
    diagnostics: Diagnostic[],
  ): Promise<void>;
  postValidateSysml2(effectiveUri: string, diagnostics: Diagnostic[]): void;
  checkAutoVerify(effectiveUri: string): void;
  postValidateModelicaAbstractInterpretation(
    effectiveUri: string,
    textDocument: TextDocument,
    diagnostics: Diagnostic[],
  ): Promise<void>;
  postValidateModelicaDaeReachability(
    effectiveUri: string,
    textDocument: TextDocument,
    diagnostics: Diagnostic[],
  ): Promise<void>;
  postValidateModelicaReasoner(effectiveUri: string, diagnostics: Diagnostic[]): void;
  postValidatePolyglotReasoner(effectiveUri: string, langId: string, diagnostics: Diagnostic[]): void;
  postValidatePolyglotDrift(effectiveUri: string, langId: string, diagnostics: Diagnostic[]): void;
  collectLiveTggCorrespondenceDiagnostics(params: {
    effectiveUri: string;
    langId: string;
    text: string;
    tree: PolyglotTreeLike | null | undefined;
    textDocument?: TextDocument | undefined;
    diagnostics: Diagnostic[];
  }): void;
  collectThreadDiagnostics(uri: string, textDocument?: TextDocument): Diagnostic[];
  collectDroneSimulationParityDiagnostics(
    uri: string,
    langId: string,
    text: string,
    textDocument: TextDocument | undefined,
    diagnostics: Diagnostic[],
  ): void;
  scheduleCrossLanguageRevalidation(sourceEffectiveUri: string): void;
}

/**
 * Synchronizes all registered Salsa QueryEngines and Modelica's external UnifiedWorkspace
 * attachment after any document in any language is indexed or re-indexed.
 */
export function syncWorkspaceStateAfterIndexImpl(
  workspaceManager: WorkspaceManager,
  parserService: ParserService,
  effectiveUri?: string,
  changedIds?: Set<number> | null,
  structuralChangedIds?: Set<number> | null,
  changedNames?: Set<string> | null,
): void {
  const uw = workspaceManager?.unifiedWorkspace as
    | (UnifiedWorkspace & {
        updateQueryEngines?: (
          uri?: string,
          changedIds?: Set<number>,
          structuralChangedIds?: Set<number>,
          changedNames?: Set<string>,
        ) => void;
      })
    | undefined;
  if (uw && typeof uw.updateQueryEngines === "function") {
    try {
      uw.updateQueryEngines(
        effectiveUri,
        changedIds ?? undefined,
        structuralChangedIds ?? undefined,
        changedNames ?? undefined,
      );
    } catch {
      // Best-effort query engine refresh
    }
  }
  const sharedContext = parserService?.sharedContext as SharedContextWorkspaceBridge | undefined;
  if (sharedContext && uw) {
    try {
      if (typeof sharedContext.attachExternalUnifiedWorkspace === "function") {
        if (sharedContext.__attachedExternalUw !== uw) {
          sharedContext.attachExternalUnifiedWorkspace(uw);
          sharedContext.__attachedExternalUw = uw;
        } else if (typeof sharedContext.syncExternalWorkspace === "function") {
          sharedContext.syncExternalWorkspace();
        }
      } else if (typeof sharedContext.syncExternalWorkspace === "function") {
        sharedContext.syncExternalWorkspace();
      }
    } catch {
      // Non-fatal if context lacks foreign workspace support
    }
  }
}

/**
 * Collects multi-file / workspace-graph diagnostics for languages with a registered
 * `lint<Lang>Workspace` analyzer across all open and cached workspace documents.
 */
export async function collectWorkspaceLinterDiagnosticsImpl(
  connection: Connection,
  documentManager: DocumentManager,
  effectiveUri: string,
  langId: string,
  text: string,
  diagnostics: Diagnostic[],
): Promise<void> {
  if (!hasWorkspaceLinter(langId)) return;
  try {
    const workspaceDocs: Record<string, string> = {};
    if (documentManager?.documentTrees) {
      for (const [docUri, entry] of documentManager.documentTrees.entries()) {
        if (typeof entry?.text === "string") {
          workspaceDocs[docUri] = entry.text;
        }
      }
    }
    if (documentManager?.documents && typeof documentManager.documents.all === "function") {
      for (const doc of documentManager.documents.all()) {
        workspaceDocs[doc.uri] = doc.getText();
      }
    }
    workspaceDocs[effectiveUri] = text;

    await runWorkspaceLinterForDocument(langId, workspaceDocs, effectiveUri, diagnostics);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    connection?.console?.warn?.(`[validate] Workspace linter failed for ${effectiveUri} (${langId}): ${msg}`);
  }
}

/**
 * Shared cross-language finalizer invoked by both the unified GLR/Salsa pipeline and all
 * standalone format validators (PSSE, PSCAD, STEP, Easy5, ROCETS, SCAD, FEA, CFD, etc.).
 */
export async function finalizeCrossLanguageValidationImpl(
  ctx: SemanticPipelineContext,
  params: FinalizeCrossLanguageParams,
): Promise<Diagnostic[]> {
  const {
    uri,
    effectiveUri = uri,
    text,
    langId,
    tree,
    textDocument,
    diagnostics,
    hasSyntaxErrors = false,
    changedIds,
    structuralChangedIds,
    changedNames,
    skipSend = false,
    skipCascade = false,
    contentChanged = false,
    isStale,
  } = params;

  ctx.syncWorkspaceStateAfterIndex(effectiveUri, changedIds, structuralChangedIds, changedNames);

  if (
    (contentChanged || (langId !== "step" && text.length <= 262_144)) &&
    typeof ctx.workspaceManager?.discoverThreadsForDocument === "function"
  ) {
    try {
      ctx.workspaceManager.discoverThreadsForDocument(effectiveUri, text, langId, tree);
    } catch {
      // Non-fatal on partial buffers
    }
  }

  if (!hasSyntaxErrors) {
    ctx.postValidatePolyglotDrift(effectiveUri, langId, diagnostics);
    ctx.collectLiveTggCorrespondenceDiagnostics({
      effectiveUri,
      langId,
      text,
      tree,
      textDocument,
      diagnostics,
    });
  }

  const threadDiags = ctx.collectThreadDiagnostics(effectiveUri, textDocument);
  if (threadDiags.length > 0) {
    diagnostics.push(...threadDiags);
  }

  ctx.collectDroneSimulationParityDiagnostics(uri, langId, text, textDocument, diagnostics);

  await collectWorkspaceLinterDiagnosticsImpl(
    ctx.connection,
    ctx.documentManager,
    effectiveUri,
    langId,
    text,
    diagnostics,
  );

  if (isStale?.()) return diagnostics;

  const finalDiags = ctx.applyDiagnosticFilters(deduplicateAllDiagnostics(diagnostics));

  if (!skipSend) {
    ctx.lastSemanticDiagnostics.set(uri, finalDiags);
    if (effectiveUri !== uri) {
      ctx.lastSemanticDiagnostics.set(effectiveUri, finalDiags);
    }
    ctx.connection.sendDiagnostics({ uri, diagnostics: finalDiags });
    ctx.sendProjectTreeChanged(uri);
  }

  if (!skipCascade && contentChanged && !ctx.isCascadeRevalidationActive()) {
    ctx.scheduleCrossLanguageRevalidation(effectiveUri);
  }

  return finalDiags;
}

/**
 * Executes the 8-stage asynchronous semantic validation pipeline:
 * 1. Incremental symbol re-indexing
 * 2. Cross-file revalidation scheduling
 * 3. Unified workspace index & Salsa `QueryEngine` update
 * 4. Preflight cache hydration
 * 5. WASM CST lints & Salsa query lints
 * 6. Domain post-validation hooks (OWL2 reasoner, SysML v2 verification, Modelica abstract interpretation & DAE reachability)
 * 7. Class instance wrapper population for tree views
 * 8. Diagnostic deduplication and delivery
 */
export async function runUnifiedSemanticPipelineImpl(
  ctx: SemanticPipelineContext,
  params: UnifiedSemanticPipelineParams,
): Promise<void> {
  const {
    uri,
    text,
    tree,
    editRanges,
    baseDiagnostics,
    wasmLintDiags,
    revisionAtStart,
    plugin,
    langId,
    textDocument,
    isSave,
  } = params;
  const newSemanticDiagnostics: Diagnostic[] = [];
  const treeLike = tree as ValidationTreeLike;

  const isStale = () => {
    if (revisionAtStart !== null && (ctx.documentRevisions.get(uri) ?? 0) !== revisionAtStart) return true;
    return false;
  };
  const YIELD_BUDGET_MS = 12;
  let lastYieldAt = performance.now();
  const yieldToEventLoop = () => new Promise<void>((r) => setTimeout(r, 0));
  const yieldAndCheckStale = async () => {
    if (isStale()) return true;
    const now = performance.now();
    if (now - lastYieldAt >= YIELD_BUDGET_MS) {
      await yieldToEventLoop();
      lastYieldAt = performance.now();
      return isStale();
    }
    return false;
  };

  try {
    const t0 = performance.now();
    void t0;
    const effectiveUri = uri.startsWith("modelscript-lib://global")
      ? "file://" + uri.substring("modelscript-lib://global".length)
      : uri;

    // ── Step 1: Re-index ─────────────────────────────────────────────────
    const wsIndex = plugin?.workspaceIndex ?? ctx.workspaceManager.getWorkspaceIndex(langId);
    const textChanged = ctx.lastIndexedText.get(effectiveUri) !== text;
    let changedIds: Set<number> | null = null;
    let changedNames: Set<string> | null = null;
    let structuralChangedIds: Set<number> | null = null;

    if (wsIndex) {
      if (textChanged) {
        let actualEditRanges: { startOffset: number; endOffset: number; delta?: number }[] | undefined = editRanges;
        let totalDelta = actualEditRanges ? actualEditRanges.reduce((acc, r) => acc + (r.delta ?? 0), 0) : 0;
        if (!actualEditRanges) {
          const lastText = ctx.lastIndexedText.get(effectiveUri);
          if (lastText) {
            const edit = computeTreeEdit(lastText, text);
            const maxEnd = Math.max(edit.oldEndIndex, edit.newEndIndex);
            totalDelta = edit.newEndIndex - edit.oldEndIndex;
            actualEditRanges = [
              {
                startOffset: edit.startIndex,
                endOffset: maxEnd,
                delta: totalDelta,
              },
            ];
          }
        }

        if (typeof wsIndex.has === "function") {
          if (wsIndex.has(effectiveUri)) {
            wsIndex.reindexDocument?.(effectiveUri, () => treeLike.rootNode as never, actualEditRanges, totalDelta);
          } else {
            wsIndex.register?.(effectiveUri, () => treeLike.rootNode as never);
          }
          wsIndex.getFileIndex?.(effectiveUri);
        }
        ctx.workspaceManager.workspaceInstances.delete(uri);
        ctx.workspaceManager.workspaceInstances.delete(effectiveUri);
        ctx.workspaceManager.documentInstances.delete(uri);
        ctx.workspaceManager.documentInstances.delete(effectiveUri);
        ctx.lastIndexedText.set(effectiveUri, text);
        const activeEngine = asValidationEngineOps(plugin?.queryEngine ?? ctx.workspaceManager.getQueryEngine(langId));
        if (activeEngine && typeof activeEngine.disposeDocument === "function") {
          activeEngine.disposeDocument(effectiveUri);
          activeEngine.disposeDocument(uri);
          const effNorm = effectiveUri.replace(/^([a-z0-9+-]+):\/{0,3}/i, "$1:///");
          activeEngine.disposeDocument(effNorm);
        }
      }

      const changedIdsObj = (
        typeof wsIndex.takeGlobalChangedIds === "function" ? wsIndex.takeGlobalChangedIds() : null
      ) as { changedIds: Set<number> | null; structuralChangedIds?: Set<number> | null } | null;
      changedIds = changedIdsObj ? changedIdsObj.changedIds : null;
      structuralChangedIds = changedIdsObj?.structuralChangedIds ?? null;
      changedNames = typeof wsIndex.takeGlobalChangedNames === "function" ? wsIndex.takeGlobalChangedNames() : null;
    } else if (textChanged && (plugin?.languageDef as LanguageDefIndexingLike | undefined)?.indexing?.indexFile) {
      ctx.indexNativeDslDocument(effectiveUri, text, plugin?.id ?? langId, plugin?.languageDef);
      ctx.workspaceManager.workspaceInstances.delete(uri);
      ctx.workspaceManager.workspaceInstances.delete(effectiveUri);
      ctx.workspaceManager.documentInstances.delete(uri);
      ctx.workspaceManager.documentInstances.delete(effectiveUri);
      ctx.lastIndexedText.set(effectiveUri, text);
    }

    if (isStale()) return;

    // ── Step 2: Cross-File Dependency State Prep ──────────────────────────
    ctx.clearRevalidationTimer();

    // ── Step 3: Unified Index & QueryEngine Update ───────────────────────
    const unifiedIndex = ctx.workspaceManager.unifiedWorkspace.getIndex();
    const cstTreeWrapper = ctx.parserService.getSharedCstTreeWrapper();

    let engine = plugin?.queryEngine ?? ctx.workspaceManager.getQueryEngine(langId);
    if (!engine) {
      engine = ctx.createDefaultQueryEngine(langId, unifiedIndex, cstTreeWrapper);
      if (engine) {
        ctx.workspaceManager.setQueryEngine(langId, engine);
      }
    } else {
      if (plugin?.queryEngine && !ctx.workspaceManager.getQueryEngine(langId)) {
        ctx.workspaceManager.setQueryEngine(langId, engine);
      }
      if (langId === "modelica") {
        injectPredefinedTypes(unifiedIndex);
      }
      const engineOps = asValidationEngineOps(engine);
      if (changedIds && typeof engineOps?.swapIndex === "function") {
        engineOps.swapIndex(unifiedIndex, changedIds, structuralChangedIds || undefined);
      } else if (textChanged && typeof engineOps?.updateIndex === "function") {
        engineOps.updateIndex(unifiedIndex);
      }
      if (typeof engineOps?.updateTree === "function") {
        engineOps.updateTree(cstTreeWrapper);
      }
    }

    ctx.syncWorkspaceStateAfterIndex(effectiveUri, changedIds, structuralChangedIds, changedNames);

    // Sync parser sharedContext if Modelica
    const context = ctx.parserService.sharedContext;
    if (context && langId === "modelica") {
      if (typeof context.setQueryEngine === "function") context.setQueryEngine(engine);
      else context.queryEngine = engine;
      if (typeof context.setWorkspaceIndex === "function") context.setWorkspaceIndex(wsIndex);
      else context.workspaceIndex = wsIndex;
    }

    // Create / update LSP bridge
    const currentDoc = ctx.documentManager.documents.get(uri);
    const currentText = currentDoc ? currentDoc.getText() : text;
    const bridge = new LSPBridge(unifiedIndex, engine, new PositionIndex(currentText), uri, {
      documentLSPBridges: ctx.documentLSPBridges,
      documents: ctx.documentManager.documents,
      sharedFs: ctx.parserService?.sharedContext?.fs ?? ctx.documentManager?.sharedContext?.fs,
    });
    ctx.documentLSPBridges.set(uri, bridge);

    // Populate class wrappers immediately so diagram edit handlers always see up-to-date CST nodes
    if (textChanged || !ctx.workspaceManager.documentInstances.get(uri)?.length) {
      ctx.populateClassWrappers(effectiveUri, uri, unifiedIndex, engine, context);
    }

    await yieldToEventLoop();
    if (isStale()) return;

    // ── Step 4: Preflight Cache Hydration ────────────────────────────────
    const resourceSymbolIds = unifiedIndex.symbolsByResource?.get(effectiveUri);
    const docSymbolCount = resourceSymbolIds ? resourceSymbolIds.length : 0;
    const isWorkspaceFile = !!ctx.documentManager.documents.get(uri);

    const vEngine = engine as ValidationQueryEngine | null | undefined;
    if (
      vEngine &&
      resourceSymbolIds &&
      resourceSymbolIds.length > 0 &&
      vEngine.preflight &&
      !isWorkspaceFile &&
      docSymbolCount < 2000
    ) {
      try {
        await vEngine.preflight(resourceSymbolIds, ["resolve", "members", "type_check"]);
      } catch {
        // Best-effort
      }
    }

    // ── Step 5: Declarative & CST Lints ────────────────────────────────────
    const rootHasErr = treeLike.rootNode?.hasError;
    const hasError = typeof rootHasErr === "function" ? rootHasErr() : Boolean(rootHasErr);
    const hasSyntaxErrors = baseDiagnostics.length > 0 || hasError;

    if (hasSyntaxErrors) {
      const cachedSemantic = ctx.lastSemanticDiagnostics.get(uri) || [];
      newSemanticDiagnostics.push(...cachedSemantic);
    }

    // 5a. WASM Linear Memory CST Linter diagnostics (pre-collected synchronously in collectSyntaxErrors)
    let pendingWasmDiags: Diagnostic[] = [];
    if (!hasSyntaxErrors && wasmLintDiags && wasmLintDiags.length > 0) {
      try {
        pendingWasmDiags = ctx.convertWasmLintDiagnostics(
          wasmLintDiags,
          currentDoc ?? textDocument,
          plugin,
          currentText,
          bridge,
        );
      } catch (e: unknown) {
        ctx.connection.console.warn(
          `[runUnifiedSemanticPipeline] CST linter error for ${uri}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    // 5b. Salsa QueryEngine symbol lints
    const skipHeavyLints = (!isWorkspaceFile && docSymbolCount > 1000) || hasSyntaxErrors;
    let capturedEngineDiags: EngineLintDiagnosticLike[] = [];
    const semanticLineIndex = new SemanticDiagnosticLineIndex(newSemanticDiagnostics);
    if (!skipHeavyLints && vEngine && typeof vEngine.runAllLintsAsync === "function") {
      const viewportRange = ctx.documentViewports.get(uri) ?? undefined;
      let engineDiags: EngineLintDiagnosticLike[];
      if (typeof vEngine.setCancellationChecker === "function") {
        vEngine.setCancellationChecker(isStale, 64);
      }
      try {
        engineDiags = await vEngine.runAllLintsAsync(effectiveUri, yieldAndCheckStale, viewportRange);
      } finally {
        if (typeof vEngine.setCancellationChecker === "function") {
          vEngine.setCancellationChecker(null);
        }
      }
      if (isStale()) return;
      capturedEngineDiags = Array.isArray(engineDiags) ? engineDiags : [];

      const posIdx = bridge.positions ?? ctx.documentManager.getLineIndexForDoc(uri);
      for (const d of capturedEngineDiags) {
        const startOff = d.startOffset;
        const endOff = d.endOffset;
        const start = posIdx?.charOffsetToPosition?.(startOff) ?? { line: 0, character: 0 };
        const end = posIdx?.charOffsetToPosition?.(endOff) ?? start;
        let severity: DiagnosticSeverity = DiagnosticSeverity.Warning;
        if (d.severity === "error") severity = DiagnosticSeverity.Error;
        if (d.severity === "info") severity = DiagnosticSeverity.Information;

        const diagCode = d.code ?? d.lintName;
        const incomingDiag: Diagnostic = {
          severity,
          range: { start, end },
          message: d.message,
          source: plugin?.name ? plugin.name.toLowerCase() : "modelscript",
          ...(diagCode !== undefined ? { code: diagCode } : {}),
        };

        const isDuplicate = tryDeduplicateOrMergeSemanticDiagnostic(
          newSemanticDiagnostics,
          incomingDiag,
          plugin,
          semanticLineIndex,
        );

        if (!isDuplicate) {
          newSemanticDiagnostics.push(incomingDiag);
          semanticLineIndex.add(incomingDiag);
        }
      }
    }

    // Reconcile single-file WASM CST M2002/M2003 lints with multi-file & cross-language resolution
    if (pendingWasmDiags.length > 0) {
      const reconciledWasm = ctx.reconcileCrossLanguageWasmDiagnostics(
        pendingWasmDiags,
        unifiedIndex,
        engine,
        capturedEngineDiags,
        effectiveUri,
        langId,
        currentText,
        currentDoc ?? textDocument,
        plugin,
      );
      for (const wd of reconciledWasm) {
        if (!tryDeduplicateOrMergeSemanticDiagnostic(newSemanticDiagnostics, wd, plugin, semanticLineIndex)) {
          newSemanticDiagnostics.push(wd);
          semanticLineIndex.add(wd);
        }
      }
    }

    // Stream core compiler lints immediately before running heavier post-validation hooks
    if (isStale()) return;
    const earlyDiags = ctx.applyDiagnosticFilters(
      deduplicateAllDiagnostics([...baseDiagnostics, ...newSemanticDiagnostics]),
    );
    ctx.connection.sendDiagnostics({ uri, diagnostics: earlyDiags });
    ctx.sendProjectTreeChanged(uri);

    // ── Step 6: Domain Post-Validation Hooks ──────────────────────────────
    if (plugin?.customHandlers?.postValidate && textDocument) {
      await plugin.customHandlers.postValidate(textDocument, context, newSemanticDiagnostics);
    } else {
      if (langId === "owl2" && !hasSyntaxErrors) {
        await ctx.postValidateOwl2(
          effectiveUri,
          tree as PolyglotTreeLike | null | undefined,
          text,
          newSemanticDiagnostics,
        );
      } else if (langId === "sysml2" || langId === "sysml") {
        if (!hasSyntaxErrors) {
          ctx.postValidateSysml2(effectiveUri, newSemanticDiagnostics);
        }
        ctx.checkAutoVerify(effectiveUri);
      } else if (langId === "modelica" && !hasSyntaxErrors && textDocument) {
        const deferFormalToSave = Boolean(ctx.diagnosticsConfig.formalVerificationOnSave) && !isSave;
        if (!deferFormalToSave) {
          await ctx.postValidateModelicaAbstractInterpretation(effectiveUri, textDocument, newSemanticDiagnostics);
          if (ctx.diagnosticsConfig.daeSingularityCheck !== false) {
            await ctx.postValidateModelicaDaeReachability(effectiveUri, textDocument, newSemanticDiagnostics);
          }
        }
        ctx.postValidateModelicaReasoner(effectiveUri, newSemanticDiagnostics);
      } else if (!hasSyntaxErrors) {
        ctx.postValidatePolyglotReasoner(effectiveUri, langId, newSemanticDiagnostics);
      }
    }

    const vDiags = ctx.verificationDiagnosticsByUri.get(uri) ?? ctx.verificationDiagnosticsByUri.get(effectiveUri);
    if (vDiags) {
      newSemanticDiagnostics.push(...vDiags);
    }

    const rDiags = ctx.reasonerDiagnosticsByUri.get(uri) ?? ctx.reasonerDiagnosticsByUri.get(effectiveUri);
    if (rDiags && rDiags.length > 0) {
      for (const rd of rDiags) {
        if (
          !newSemanticDiagnostics.some(
            (d) =>
              d.range.start.line === rd.range.start.line &&
              d.range.start.character === rd.range.start.character &&
              d.message === rd.message,
          )
        ) {
          newSemanticDiagnostics.push(rd);
        }
      }
    }

    const dtDiags = ctx.digitalThreadDiagnosticsByUri.get(uri) ?? ctx.digitalThreadDiagnosticsByUri.get(effectiveUri);
    if (dtDiags && dtDiags.length > 0) {
      newSemanticDiagnostics.push(...dtDiags);
    }

    // ── Step 7: Populate Class / Symbol Wrappers for Trees ───────────────
    if (!ctx.workspaceManager.documentInstances.get(uri)?.length) {
      ctx.populateClassWrappers(effectiveUri, uri, unifiedIndex, engine, context);
    }

    // ── Step 8: Finalize Cross-Language Links, Deliver Diagnostics, & Cascade ──
    if (isStale()) return;
    const finalSemanticDiags = await finalizeCrossLanguageValidationImpl(ctx, {
      uri,
      effectiveUri,
      text,
      langId,
      tree: tree as PolyglotTreeLike | null | undefined,
      textDocument: currentDoc ?? textDocument,
      diagnostics: newSemanticDiagnostics,
      hasSyntaxErrors,
      changedIds,
      structuralChangedIds,
      changedNames,
      skipSend: true,
      skipCascade: true,
      isStale,
    });
    if (isStale()) return;
    ctx.lastSemanticDiagnostics.set(uri, finalSemanticDiags);
    const rawDiagnostics = [...baseDiagnostics, ...finalSemanticDiags];
    const diagnostics = ctx.applyDiagnosticFilters(deduplicateAllDiagnostics(rawDiagnostics));
    const unchangedFromEarly =
      diagnostics.length === earlyDiags.length &&
      diagnostics.every((d, i) => {
        const early = earlyDiags[i];
        return (
          early !== undefined &&
          d.message === early.message &&
          d.code === early.code &&
          d.range.start.line === early.range.start.line &&
          d.range.start.character === early.range.start.character
        );
      });
    if (!unchangedFromEarly) {
      ctx.connection.sendDiagnostics({ uri, diagnostics });
      ctx.sendProjectTreeChanged(uri);
    }

    if ((textChanged || (changedNames && changedNames.size > 0)) && !ctx.isCascadeRevalidationActive()) {
      ctx.scheduleCrossLanguageRevalidation(effectiveUri);
    }
  } catch (e: unknown) {
    const errObj = e instanceof Error ? e : null;
    const errName =
      errObj?.name ?? (typeof e === "object" && e && "name" in e ? String((e as { name?: unknown }).name) : "");
    const errMsg = errObj?.message ?? String(e);
    if (errName === "QueryCancelledError" || errMsg === "Query computation was cancelled") {
      return;
    }
    ctx.connection.console.error(`[runUnifiedSemanticPipeline] Error for ${uri}: ${errMsg}\n${errObj?.stack ?? ""}`);
    if (!isStale()) {
      const rawDiagnostics = [...baseDiagnostics, ...newSemanticDiagnostics];
      const diagnostics = ctx.applyDiagnosticFilters(deduplicateAllDiagnostics(rawDiagnostics));
      ctx.connection.sendDiagnostics({ uri, diagnostics });
      ctx.sendProjectTreeChanged(uri);
    }
  }
}
