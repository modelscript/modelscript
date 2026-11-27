// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArenaQueryFlattener } from "@modelscript/modelica";
import { DAEBuilder, type WorkspaceCstTree } from "@modelscript/runtime";
import type { Connection, TextDocumentChangeEvent, TextDocuments } from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";
import { parseTreeWithXmlGuard } from "../utils/ast-utils.js";
import type { CadMetricsService } from "./cad-metrics-service.js";
import type { DiagramService } from "./diagram-service.js";
import type { DocumentManager } from "./document-manager.js";
import type { ParserService } from "./parser-service.js";
import { deduplicateAllDiagnostics, type ValidationService } from "./validation-service.js";
import type { WorkspaceManager } from "./workspace-manager.js";

/**
 * Minimal class instance descriptor required to flatten a class into a DAE arena.
 */
export interface FlattenableClassInstanceLike {
  id: number;
  name?: string | undefined;
  compositeName?: string | undefined;
}

/**
 * Flatten a class instance using the arena-native pipeline.
 *
 * @param workspaceManager - Workspace manager providing the active Modelica query engine.
 * @param classInstance - Resolved class instance descriptor containing a symbol `id` and `name`.
 * @param _context - Optional legacy context parameter (unused in arena-native mode).
 * @returns Populated `DAEBuilder` arena containing flattened variables and equations.
 */
export function flattenArenaFromInstance(
  workspaceManager: WorkspaceManager,
  classInstance: FlattenableClassInstanceLike,
  _context?: unknown,
): DAEBuilder {
  const className = classInstance.compositeName || classInstance.name;
  if (!className) throw new Error("Class instance has no name");

  if (!workspaceManager.globalModelicaQueryEngine) throw new Error("Query engine not initialized");
  const flattener = new ArenaQueryFlattener(workspaceManager.globalModelicaQueryEngine.toQueryDB());
  const arena = flattener.flatten(classInstance.id);
  if (!arena) throw new Error(`Failed to flatten class '${className}'`);
  return arena as unknown as DAEBuilder;
}

/**
 * Creates a bound `flattenArenaFromInstance` function for a specific `WorkspaceManager`.
 */
export function createFlattenArenaFromInstance(
  workspaceManager: WorkspaceManager,
): (classInstance: FlattenableClassInstanceLike, _context?: unknown) => DAEBuilder {
  return (classInstance, context) => flattenArenaFromInstance(workspaceManager, classInstance, context);
}

/**
 * Computes an unsigned 32-bit DJB2 hash for cache key generation.
 */
export function simpleHash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

/**
 * Returns true when two language identifiers are cross-domain peers whose open
 * documents should be re-validated when a peer document closes.
 */
export function isCrossDomainPeer(langA: string, langB: string): boolean {
  return (
    (langA === "modelica" && (langB === "sysml2" || langB === "sysml")) ||
    ((langA === "sysml2" || langA === "sysml") && langB === "modelica") ||
    (langA === "psse" && langB === "pscad") ||
    (langA === "pscad" && langB === "psse")
  );
}

/**
 * Per-URI debounce timer maps and syntax error count tracker shared between
 * `onDidChangeContent` and `onDidClose` handlers.
 */
export interface DocumentLifecycleTimers {
  activeSemanticTimers: Map<string, ReturnType<typeof setTimeout>>;
  activeShortDebounceTimers: Map<string, ReturnType<typeof setTimeout>>;
  activeSyntaxDebounceTimers: Map<string, ReturnType<typeof setTimeout>>;
  lastSyntaxErrorsCount: Map<string, number>;
}

/**
 * Allocates fresh per-URI debounce timer maps for a server instance.
 */
export function createDocumentLifecycleTimers(): DocumentLifecycleTimers {
  return {
    activeSemanticTimers: new Map<string, ReturnType<typeof setTimeout>>(),
    activeShortDebounceTimers: new Map<string, ReturnType<typeof setTimeout>>(),
    activeSyntaxDebounceTimers: new Map<string, ReturnType<typeof setTimeout>>(),
    lastSyntaxErrorsCount: new Map<string, number>(),
  };
}

/**
 * Dependencies required by the debounced `onDidChangeContent` handler.
 */
export interface OnDidChangeContentDeps {
  connection: Pick<Connection, "console" | "sendDiagnostics">;
  documents: Pick<TextDocuments<TextDocument>, "get">;
  documentManager: DocumentManager;
  workspaceManager: WorkspaceManager;
  parserService: ParserService;
  validationService: ValidationService;
  timers: DocumentLifecycleTimers;
  /** Tier 3 full semantic validation debounce in milliseconds (e.g. 250 browser, 180 node). */
  debounceMs: number;
}

/**
 * Dependencies required by the `onDidClose` cleanup handler.
 */
export interface OnDidCloseDeps {
  connection: Pick<Connection, "sendDiagnostics">;
  documents: Pick<TextDocuments<TextDocument>, "all">;
  documentManager: DocumentManager;
  workspaceManager: WorkspaceManager;
  parserService: ParserService;
  validationService: ValidationService;
  diagramService: DiagramService;
  cadMetricsService: CadMetricsService;
  timers: DocumentLifecycleTimers;
}

/**
 * Combined dependencies for registering both `onDidChangeContent` and `onDidClose`.
 */
export interface DocumentLifecycleDeps
  extends Omit<OnDidChangeContentDeps, "connection" | "documents">, Omit<OnDidCloseDeps, "connection" | "documents"> {
  connection: Pick<Connection, "console" | "sendDiagnostics">;
  documents: Pick<TextDocuments<TextDocument>, "get" | "all" | "onDidChangeContent" | "onDidClose">;
}

/**
 * Creates the 3-tier incremental `onDidChangeContent` handler shared by the browser
 * and Node.js language server entrypoints.
 */
export function createOnDidChangeContentHandler(
  deps: OnDidChangeContentDeps,
): (change: TextDocumentChangeEvent<TextDocument>) => void {
  const {
    connection,
    documents,
    documentManager,
    workspaceManager,
    parserService,
    validationService,
    timers,
    debounceMs,
  } = deps;
  const { activeSemanticTimers, activeShortDebounceTimers, activeSyntaxDebounceTimers, lastSyntaxErrorsCount } = timers;

  return (change: TextDocumentChangeEvent<TextDocument>): void => {
    const tKeypressStart = performance.now();
    const uri = change.document.uri;
    validationService.verificationDiagnosticsByUri.delete(uri);
    validationService.verificationResultsByUri.delete(uri);
    validationService.lastAutoVerifiedText.delete(uri);

    // Invalidate digital thread slots associated with this URI
    const threadEntries = workspaceManager.getThreadsForUri(uri);
    for (const entry of threadEntries) {
      workspaceManager.hypergraph.markStale(entry.slot);
    }
    validationService.scheduleDigitalThreadValidation(uri);

    // Bump revision — any in-flight deferred semantic work for an older revision
    // will check this and bail out before doing expensive linting.
    const currentRevision = (validationService.documentRevisions.get(uri) ?? 0) + 1;
    validationService.documentRevisions.set(uri, currentRevision);

    // Cancel any pending semantic analysis for this URI
    const semanticTimer = activeSemanticTimers.get(uri);
    if (semanticTimer) {
      clearTimeout(semanticTimer);
      activeSemanticTimers.delete(uri);
    }

    // Cancel any pending cross-file revalidation to prevent cascading
    // semantic analyses during rapid editing.
    if (validationService.revalidationTimer) {
      clearTimeout(validationService.revalidationTimer);
      validationService.revalidationTimer = null;
    }

    // Cancel active Tier 1 syntax, Tier 2, and Tier 3 timers for this URI
    const existingSyntaxTimer = activeSyntaxDebounceTimers.get(uri);
    if (existingSyntaxTimer) {
      clearTimeout(existingSyntaxTimer);
      activeSyntaxDebounceTimers.delete(uri);
    }

    const existingTier2 = activeShortDebounceTimers.get(uri);
    if (existingTier2) {
      clearTimeout(existingTier2);
      activeShortDebounceTimers.delete(uri);
    }

    const existingTier3 = validationService.activeValidationTimers.get(uri);
    if (existingTier3) {
      clearTimeout(existingTier3);
      validationService.activeValidationTimers.delete(uri);
    }

    // === TIER 1: Keystroke (0ms) — Fast WASM GLR Incremental Parse + Syntax Errors ===
    const plugin = globalLanguageRegistry.getPluginForUri(uri);
    const isCfd = plugin?.id === "cfd" || /\.(cfg|cfgt|su2|cfd)$/i.test(uri);
    const isFea = plugin?.id === "fea" || /\.(inp|inpt|bdf|fea)$/i.test(uri);
    const isLargeStep =
      (plugin?.id === "step" || /\.(step|stp|p21)$/i.test(uri)) && change.document.getText().length > 32_768;
    const hasCustomValidator = Boolean(plugin?.customHandlers?.validate);
    if (isCfd || isFea || isLargeStep || hasCustomValidator) {
      activeSyntaxDebounceTimers.set(
        uri,
        setTimeout(
          async () => {
            activeSyntaxDebounceTimers.delete(uri);
            if ((validationService.documentRevisions.get(uri) ?? 0) !== currentRevision) return;
            const latestDoc = documents.get(uri);
            await validationService.validateTextDocument(latestDoc ?? change.document);
          },
          hasCustomValidator ? 60 : 100,
        ),
      );
      return;
    }
    const parser =
      plugin?.parser ??
      parserService.getParserForUri(uri) ??
      ((uri.endsWith(".mo") || uri.endsWith(".mos") || uri.endsWith(".msim")) && parserService.isParserReady("modelica")
        ? parserService.getParser("modelica")
        : undefined);

    if (parser && !validationService.isWasmParserBusy()) {
      try {
        const text = change.document.getText();
        const oldCached = documentManager.documentTrees.get(uri);
        const tree = parseTreeWithXmlGuard({
          uri,
          text,
          plugin,
          parser,
          oldCached,
          onIncrementalEdit: (edit) => validationService.adjustDiagnostics(uri, edit),
        });

        if (tree) {
          if (oldCached?.tree && oldCached.tree !== tree) {
            oldCached.tree.delete?.();
          }
          const classCache = oldCached && oldCached.text === text ? oldCached.classCache : new Map<string, unknown>();
          documentManager.documentTrees.set(uri, { text, tree, classCache });
          const wsTree = tree as unknown as WorkspaceCstTree;
          workspaceManager.unifiedWorkspace.setDocumentTree(uri, wsTree);
          const uDoc = workspaceManager.unifiedWorkspace.getDocument(uri);
          if (uDoc) {
            uDoc.text = text;
            uDoc.tree = wsTree;
          }
          const { syntaxDiags, wasmLintDiags } = validationService.collectSyntaxErrors(
            tree.rootNode,
            change.document,
            plugin,
          );
          const wasmLspDiags = validationService
            .convertWasmLintDiagnostics(wasmLintDiags, change.document, plugin, text)
            .filter((d) => {
              const codeStr = String(d.code ?? "").toLowerCase();
              return (
                codeStr !== "2002" &&
                codeStr !== "2003" &&
                codeStr !== "m2002" &&
                codeStr !== "m2003" &&
                codeStr !== "variable-not-found" &&
                codeStr !== "class-not-found"
              );
            });
          const fastDiags = deduplicateAllDiagnostics([...syntaxDiags, ...wasmLspDiags]);
          const lastCount = lastSyntaxErrorsCount.get(uri) ?? 0;

          // Surface fast syntax and WASM CST lint errors: clear immediately when 0, debounce by 40ms when editing
          if (fastDiags.length === 0 && lastCount > 0) {
            lastSyntaxErrorsCount.set(uri, 0);
            const cachedSemantic = validationService.applyDiagnosticFilters(
              (validationService.lastSemanticDiagnostics.get(uri) || []).filter(
                (d) =>
                  d.source !== "sysml2-verifier" && (typeof d.code !== "number" || d.code < 1000 || d.code >= 6000),
              ),
            );
            validationService.lastSemanticDiagnostics.set(uri, cachedSemantic);
            connection.sendDiagnostics({ uri, diagnostics: cachedSemantic });
          } else if (fastDiags.length > 0) {
            activeSyntaxDebounceTimers.set(
              uri,
              setTimeout(() => {
                activeSyntaxDebounceTimers.delete(uri);
                if ((validationService.documentRevisions.get(uri) ?? 0) !== currentRevision) return;
                lastSyntaxErrorsCount.set(uri, fastDiags.length);
                const cachedSemantic = (validationService.lastSemanticDiagnostics.get(uri) || []).filter(
                  (d) =>
                    d.source !== "sysml2-verifier" && (typeof d.code !== "number" || d.code < 1000 || d.code >= 6000),
                );
                const allDiags = validationService.applyDiagnosticFilters(
                  deduplicateAllDiagnostics([...fastDiags, ...cachedSemantic]),
                );
                validationService.lastSemanticDiagnostics.set(uri, allDiags);
                connection.sendDiagnostics({ uri, diagnostics: allDiags });
              }, 40),
            );
          }
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        connection.console.warn(`[instant-parse] Error for ${uri}: ${msg}`);
      }
    }

    const tKeypressEnd = performance.now();
    if (tKeypressEnd - tKeypressStart > 15) {
      connection.console.info(`[perf][keypress] Synchronous Tier 1: ${(tKeypressEnd - tKeypressStart).toFixed(2)}ms`);
    }

    // === TIER 2: Short Debounce (~60ms) — Local File Index, QueryEngine Swap & Outline Update ===
    activeShortDebounceTimers.set(
      uri,
      setTimeout(() => {
        activeShortDebounceTimers.delete(uri);
        if ((validationService.documentRevisions.get(uri) ?? 0) !== currentRevision) return;

        void validationService.syncDocumentForDiagram(uri).then((didSync) => {
          if (didSync && (validationService.documentRevisions.get(uri) ?? 0) === currentRevision) {
            validationService.sendProjectTreeChanged(uri);
          }
        });
      }, 60),
    );

    // === TIER 3: Longer Debounce — Salsa QueryEngine, Declarative Lints & Semantic Diagnostics ===
    validationService.activeValidationTimers.set(
      uri,
      setTimeout(async () => {
        validationService.activeValidationTimers.delete(uri);
        // Wait for any in-flight validation to finish before starting a new one.
        const inflight = validationService.activeValidationPromises.get(uri);
        if (inflight) {
          try {
            await Promise.race([inflight, new Promise((r) => setTimeout(r, 1000))]);
          } catch {
            // Previous validation failure is already handled; proceed to re-validate current revision.
          }
        }
        // Re-check staleness: if another edit arrived while we waited, bail out.
        if ((validationService.documentRevisions.get(uri) ?? 0) !== currentRevision) {
          return;
        }
        const doc = documents.get(uri);
        if (doc) await validationService.validateTextDocument(doc);
      }, debounceMs),
    );
  };
}

/**
 * Creates the `onDidClose` document cleanup handler shared by the browser
 * and Node.js language server entrypoints.
 */
export function createOnDidCloseHandler(deps: OnDidCloseDeps): (event: TextDocumentChangeEvent<TextDocument>) => void {
  const {
    connection,
    documents,
    documentManager,
    workspaceManager,
    parserService,
    validationService,
    diagramService,
    cadMetricsService,
    timers,
  } = deps;
  const { activeSemanticTimers, activeShortDebounceTimers, activeSyntaxDebounceTimers, lastSyntaxErrorsCount } = timers;

  return (event: TextDocumentChangeEvent<TextDocument>): void => {
    const uri = event.document.uri;
    const closedLangId = (
      event.document.languageId ||
      globalLanguageRegistry.getPluginForUri(uri)?.id ||
      ""
    ).toLowerCase();
    const linkedThreadUris = new Set<string>();
    for (const entry of workspaceManager.getThreadsForUri(uri)) {
      for (const aligned of workspaceManager.findAlignedElementsBySlot(entry.slot)) {
        if (aligned.uri && aligned.uri !== uri) linkedThreadUris.add(aligned.uri);
      }
    }
    const semanticTimer = activeSemanticTimers.get(uri);
    if (semanticTimer) {
      clearTimeout(semanticTimer);
      activeSemanticTimers.delete(uri);
    }
    const syntaxTimer = activeSyntaxDebounceTimers.get(uri);
    if (syntaxTimer) {
      clearTimeout(syntaxTimer);
      activeSyntaxDebounceTimers.delete(uri);
    }
    const shortTimer = activeShortDebounceTimers.get(uri);
    if (shortTimer) {
      clearTimeout(shortTimer);
      activeShortDebounceTimers.delete(uri);
    }
    lastSyntaxErrorsCount.delete(uri);
    validationService.disposeDocument(uri);
    workspaceManager.disposeDocument(uri);
    diagramService.deleteCacheForUri(uri);
    cadMetricsService.disposeDocument(uri);
    const normUri = uri.replace(/^file:\/\/\/+/, "file:///");
    const oneSlashUri = uri.replace(/^file:\/\/\/+/, "file:/");
    for (const u of new Set([uri, normUri, oneSlashUri])) {
      const oldTree = documentManager.documentTrees.get(u);
      if (oldTree) {
        oldTree.tree?.facade?.removeDocument?.(u);
        oldTree.tree?.delete?.();
        documentManager.documentTrees.delete(u);
      }
    }
    if (closedLangId) {
      parserService.getFacade(closedLangId)?.removeDocument?.(uri);
    }
    connection.sendDiagnostics({ uri, diagnostics: [] });

    // Re-validate only remaining open documents that share the closed language or are linked via digital threads
    for (const doc of documents.all()) {
      const docLangId = (doc.languageId || globalLanguageRegistry.getPluginForUri(doc.uri)?.id || "").toLowerCase();
      if (
        linkedThreadUris.has(doc.uri) ||
        (closedLangId && (docLangId === closedLangId || isCrossDomainPeer(closedLangId, docLangId)))
      ) {
        validationService.validateTextDocument(doc).catch(() => {});
      }
    }
  };
}

/**
 * Wires both `documents.onDidChangeContent` and `documents.onDidClose` using the shared
 * lifecycle handlers.
 */
export function registerDocumentLifecycleHandlers(deps: DocumentLifecycleDeps): void {
  deps.documents.onDidChangeContent(createOnDidChangeContentHandler(deps));
  deps.documents.onDidClose(createOnDidCloseHandler(deps));
}
