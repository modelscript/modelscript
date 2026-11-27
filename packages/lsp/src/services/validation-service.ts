// SPDX-License-Identifier: AGPL-3.0-or-later

// ts-check
import { Connection, Diagnostic, DiagnosticSeverity } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { DocumentManager } from "./document-manager.js";
import { ParserService } from "./parser-service.js";
import { WorkspaceManager } from "./workspace-manager.js";

import { clearIconCache } from "@modelscript/modelica/diagram";
import { createModelicaQueryEngine } from "@modelscript/modelica/factory";
import { createOWL2QueryEngine } from "@modelscript/owl2/factory";
import {
  ExprKind,
  PolyglotTransformer,
  QueryEngine,
  type SymbolIndex,
  type UnifiedWorkspace,
  type WorkspaceCstTree,
} from "@modelscript/runtime";
import { createSysML2QueryEngine } from "@modelscript/sysml2/factory";
import { LSPBridge } from "../lsp-bridge.js";
import {
  computeTreeEdit,
  isLargeXmlForWasm,
  isWasmTreeActiveInFacade,
  parseXmlFallbackTree,
  type XmlFallbackTree,
} from "../utils/ast-utils.js";
import { LspWorkDoneProgressReporter } from "../utils/progress-reporter.js";
import { ReasonerService } from "./reasoner-service.js";

import { globalLanguageRegistry, type LanguagePlugin } from "../registry/LanguageRegistry.js";
import {
  deduplicateAllDiagnostics,
  extractCanonicalErrorInfo,
  SemanticDiagnosticLineIndex,
  tryDeduplicateOrMergeSemanticDiagnostic,
} from "./diagnostic-dedup.js";
import { loadPolyglotCoordinatorProviders } from "./polyglot-coordinator-loader.js";
import {
  collectDroneSimulationParityDiagnosticsImpl,
  collectLiveTggCorrespondenceDiagnosticsImpl,
  reconcileCrossLanguageWasmDiagnosticsImpl,
} from "./validation/cross-language-reconciliation.js";
import {
  collectThreadDiagnosticsImpl,
  type DigitalThreadValidationContext,
  mergeDigitalThreadDiagnosticsImpl,
  runLiveDigitalThreadValidationImpl,
} from "./validation/digital-thread-validation.js";
import {
  computeTokenEndCharacterImpl,
  type FormatValidatorsContext,
  parseIncrementalWasmTreeImpl,
  validatePscadDocumentImpl,
  validateScadDocumentImpl,
  validateSidecarDocumentImpl,
  validateStepDocumentImpl,
} from "./validation/format-validators.js";
import {
  type DaeVerificationEntryLike,
  emitVerificationStatusImpl,
  type ModelicaVerificationContext,
  populateClassWrappersImpl,
  postValidateModelicaAbstractInterpretationImpl,
  postValidateModelicaDaeReachabilityImpl,
  type ProofResultEntryLike,
  runVerificationForUriImpl,
  type VerificationResultLike,
} from "./validation/modelica-verification.js";
import {
  applyDiagnosticFiltersImpl,
  asIncrementalTree,
  collectFastStaticDiagnostics,
  type DiagnosticsFilterConfig,
  parseFullWithUri,
  type PolyglotValidatorContext,
  type StoredDocumentTree,
  syncDocumentForDiagramImpl,
  validateActionLintDocumentImpl,
  validateCustomPluginDocumentImpl,
} from "./validation/polyglot-validator.js";
import {
  findDeclarationLocationImpl,
  findRangeForIriImpl,
  postValidateModelicaReasonerImpl,
  postValidateOwl2Impl,
  postValidatePolyglotDriftImpl,
  postValidatePolyglotReasonerImpl,
  postValidateSysml2Impl,
  type ReasonerConsistencyLike,
  type ReasonerDiagnosticsContext,
  routeReasonerDiagnosticsImpl,
} from "./validation/reasoner-diagnostics.js";
import {
  type FinalizeCrossLanguageParams,
  finalizeCrossLanguageValidationImpl,
  runUnifiedSemanticPipelineImpl,
  type SemanticPipelineContext,
  syncWorkspaceStateAfterIndexImpl,
  type UnifiedSemanticPipelineParams,
} from "./validation/semantic-pipeline.js";
import {
  collectSyntaxErrorsFromRoot,
  convertWasmLintDiagnosticsToLsp,
  type SyntaxCollectionContext,
} from "./validation/syntax-and-wasm-diagnostics.js";
import {
  type PolyglotTreeLike,
  type ValidationQueryEngine,
  type WasmLintDiagnostic,
} from "./validation/text-helpers.js";

export {
  deduplicateAllDiagnostics,
  extractCanonicalErrorInfo,
  SemanticDiagnosticLineIndex,
  tryDeduplicateOrMergeSemanticDiagnostic,
};
export type { WasmLintDiagnostic };

interface Owl2StoreDisposableLike {
  setAxioms?: (key: string, axioms: unknown[]) => unknown;
  clearAxioms?: (key: string) => void;
  _axiomsBySource?: Map<string, unknown>;
}

function asOwl2StoreDisposable(store: unknown): Owl2StoreDisposableLike | null {
  return store && typeof store === "object" ? (store as Owl2StoreDisposableLike) : null;
}

/**
 * Orchestrates multi-language syntax validation, Salsa semantic analysis, CST/query linting,
 * formal verification (abstract interpretation, DAE reachability, OWL2 tableau reasoning),
 * and digital thread cross-domain consistency checks across open workspace documents.
 */
export class ValidationService {
  // Instance state (previously module-level variables in browserServerMain.ts)
  /** Cached semantic diagnostics per document URI, preserved across fast keystroke syntax checks. */
  public lastSemanticDiagnostics = new Map<string, Diagnostic[]>();
  /** Last source text indexed into the workspace symbol table per normalized URI. */
  public lastIndexedText = new Map<string, string>();
  /** Cached per-file STEP diagnostics keyed by URI so unchanged large STEP buffers skip duplicate GLR/OCCT passes. */
  private lastStepOwnDiagnostics = new Map<string, { text: string; diagnostics: Diagnostic[] }>();
  /** Cached per-file SCAD diagnostics keyed by URI so unchanged SCAD buffers skip duplicate WASM/CST passes during cascades. */
  private lastScadOwnDiagnostics = new Map<string, { text: string; diagnostics: Diagnostic[] }>();
  /** In-flight STEP validation promises keyed by URI to coalesce concurrent duplicate runs on identical text. */
  private inFlightStepValidations = new Map<string, { text: string; promise: Promise<void> }>();
  /** Active `LSPBridge` instances keyed by document URI for hover, definition, and completion queries. */
  public documentLSPBridges = new Map<string, LSPBridge>();
  /** In-flight asynchronous semantic validation promises keyed by document URI. */
  public activeValidationPromises = new Map<string, Promise<void>>();
  /** Monotonically increasing edit revision counters per document URI for staleness cancellation. */
  public documentRevisions = new Map<string, number>();
  /** Debounce timers for Tier 3 semantic validation per document URI. */
  public activeValidationTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Debounce timer for cross-file revalidation when exported symbol names change. */
  public revalidationTimer: ReturnType<typeof setTimeout> | null = null;
  /** Re-entrancy guard preventing cyclical cascading validation across cross-language dependents. */
  private isCascadeRevalidationActive = false;
  /** Tracks URIs currently undergoing dependent revalidation to break cycles cleanly. */
  private revalidatingUris = new Set<string>();
  /** Per-language cached `PolyglotTransformer` instances for live TGG conformance checking. */
  private tggTransformerCache = new Map<string, PolyglotTransformer>();
  /** Debounce timer for SysML v2 verification triggers. */
  public verificationTimer: ReturnType<typeof setTimeout> | null = null;
  /** Active AbortController for SysML v2 requirement verification execution. */
  public activeVerification: AbortController | null = null;
  /** Project library dependencies declared in workspace configuration. */
  public declaredDependencies: Array<{ name: string; version: string }> = [];
  /** Set of `<name>@<version>` identifiers for dependencies that have finished loading. */
  public loadedDependencies = new Set<string>();

  /** Cached SysML v2 requirement verification diagnostics per document URI. */
  public verificationDiagnosticsByUri = new Map<string, Diagnostic[]>();
  /** Cached requirement verification case results per document URI. */
  public verificationResultsByUri = new Map<string, VerificationResultLike[]>();
  /** Explicit standard-pack activation overrides keyed by normalized package name. */
  private activeStandardOverrides?: ReadonlyMap<string, boolean> | undefined;

  public setStandardOverrides(overrides: ReadonlyMap<string, boolean> | undefined): void {
    this.activeStandardOverrides = overrides;
  }

  private extractArenaStringParams(
    arena:
      | {
          varCount?: number;
          isVarRemoved?(i: number): boolean;
          getVarName?(i: number): string | undefined;
          getVarBindingExpr?(i: number): number | undefined;
          getExprKind?(id: number): number | undefined;
          getExprData1?(id: number): number;
          interner?: { resolve?(id: number): string | undefined };
        }
      | null
      | undefined,
  ): Map<string, string> {
    const out = new Map<string, string>();
    if (!arena || typeof arena.varCount !== "number") return out;
    for (let i = 0; i < arena.varCount; i++) {
      if (arena.isVarRemoved?.(i)) continue;
      const vName = arena.getVarName?.(i);
      const bindExpr = arena.getVarBindingExpr?.(i);
      if (
        vName &&
        bindExpr !== undefined &&
        bindExpr >= 0 &&
        arena.getExprKind?.(bindExpr) === ExprKind.StringLiteral
      ) {
        const s = arena.interner?.resolve?.(arena.getExprData1?.(bindExpr >>> 0) ?? 0);
        if (s !== undefined) out.set(vName, s);
      }
    }
    return out;
  }
  /** Cached Modelica algorithm abstract interpretation proof results per URI and function name. */
  public modelicaProofResultsByUri = new Map<string, Map<string, ProofResultEntryLike>>();
  /** Cached Modelica DAE reachability and BLT verification results per URI and class name. */
  public modelicaDaeVerificationResultsByUri = new Map<string, Map<string, DaeVerificationEntryLike>>();
  /** Cached polyglot DAE reachability and BLT verification results per URI and model/class name. */
  public daeVerificationResultsByUri = new Map<string, Map<string, DaeVerificationEntryLike>>();
  /** Cached OWL2 / ontological description logic reasoner diagnostics per document URI. */
  public reasonerDiagnosticsByUri = new Map<string, Diagnostic[]>();
  /** Cached polyglot digital thread diagnostics merged across verifyAll runs per document URI. */
  public digitalThreadDiagnosticsByUri = new Map<string, Diagnostic[]>();
  /** Tracks last document text auto-verified by SysML v2 checkAutoVerify to prevent infinite re-verification loops. */
  public lastAutoVerifiedText = new Map<string, string>();
  /** Debounce timer for workspace/codeLens/refresh notifications after async proof/verification updates. */
  private codeLensRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  /** Active WASM parser lock depth so Tier 1 keystroke parses can avoid clobbering an in-flight Tier 3 parse. */
  private wasmParserLockCount = 0;

  /** Cached parsed SysML v2 requirements per URI+text so Modelica edits do not re-parse unchanged SysML files. */
  private parsedSysmlReqsCache = new Map<string, { text: string; reqs: unknown[] }>();
  /** Short-TTL cache for async sibling directory scans in runLiveDigitalThreadValidation. */
  private siblingDirCache = new Map<string, { ts: number; files: Array<{ uri: string; content: string }> }>();
  /** Last evaluated digital thread input fingerprint to avoid redundant coordinator runs on unchanged content. */
  private lastDigitalThreadFingerprint = "";

  public isWasmParserBusy(): boolean {
    return this.wasmParserLockCount > 0;
  }

  public requestCodeLensRefresh(delayMs = 150): void {
    if (typeof this.connection?.sendRequest !== "function") return;
    if (this.codeLensRefreshTimer) clearTimeout(this.codeLensRefreshTimer);
    this.codeLensRefreshTimer = setTimeout(() => {
      this.codeLensRefreshTimer = null;
      this.connection.sendRequest("workspace/codeLens/refresh").catch(() => {});
    }, delayMs);
  }

  /**
   * Publishes a lightweight `modelscript/verificationStatus` notification summarizing formal proof
   * counts and per-declaration gutter markers for `uri`.
   */
  public emitVerificationStatus(uri: string): void {
    emitVerificationStatusImpl(this.getVerificationContext(), uri);
  }

  /**
   * Returns true once all declared project library dependencies have been loaded into the workspace.
   */
  get dependenciesReady(): boolean {
    return this.declaredDependencies.every((dep) => this.loadedDependencies.has(`${dep.name}@${dep.version}`));
  }

  private clearDiagramCacheCallback?: (() => void) | undefined;
  private projectTreeChangedTimer: ReturnType<typeof setTimeout> | null = null;
  private projectTreeChangedPending = false;

  /** Registers a callback to invalidate diagram caches when dependencies finish loading. */
  public setClearDiagramCache(fn: () => void): void {
    this.clearDiagramCacheCallback = fn;
  }

  /**
   * Marks a project dependency (`name@version`) as loaded and triggers full re-validation
   * of all open documents once all declared dependencies are ready.
   */
  markDependencyLoaded(name: string, version: string): void {
    this.loadedDependencies.add(`${name}@${version}`);
    if (this.dependenciesReady) {
      this.clearDiagramCacheCallback?.();
      clearIconCache();
      if (this.documentManager?.documents) {
        const isModelicaDep = name === "Modelica";
        const isSysmlDep = name === "SysML";
        for (const doc of this.documentManager.documents.all()) {
          const langId = (doc.languageId || "").toLowerCase();
          if (isModelicaDep && langId !== "modelica" && langId !== "modelscript" && !/\.(mo|msx)$/i.test(doc.uri)) {
            continue;
          }
          if (isSysmlDep && langId !== "sysml2" && langId !== "sysml" && !/\.(sysml|kerml)$/i.test(doc.uri)) {
            continue;
          }
          if (langId === "step" || /\.(step|stp|p21|scad|qif)$/i.test(doc.uri)) {
            continue;
          }
          const eff = doc.uri.startsWith("modelscript-lib://global")
            ? "file://" + doc.uri.substring("modelscript-lib://global".length)
            : doc.uri;
          this.lastIndexedText.delete(doc.uri);
          this.lastIndexedText.delete(eff);
          this.lastSemanticDiagnostics.delete(doc.uri);
          this.lastSemanticDiagnostics.delete(eff);
          this.validateTextDocument(doc);
        }
      }
      this.sendProjectTreeChanged();
    }
  }

  /**
   * Per-document viewport byte ranges, updated by `modelscript/visibleRanges` notifications.
   * When set, linting and reference resolution prioritize symbols within this range.
   */
  public documentViewports = new Map<string, { startOffset: number; endOffset: number }>();

  /** Shared ontological description logic reasoner service for cross-domain consistency checking. */
  public reasonerService: ReasonerService;

  /**
   * Creates a new `ValidationService` and subscribes to digital thread hypergraph change events.
   */
  constructor(
    private connection: Connection,
    private documentManager: DocumentManager,
    private workspaceManager: WorkspaceManager,
    public parserService: ParserService,
  ) {
    this.reasonerService = new ReasonerService(connection, workspaceManager);
    const hg: unknown = this.workspaceManager?.hypergraph;
    if (hg && typeof hg === "object" && "addListener" in hg && typeof hg.addListener === "function") {
      (hg.addListener as (cb: (event: unknown) => void) => void)((event: unknown) => {
        try {
          this.connection.sendNotification("modelscript/threadStatusChanged", event);
        } catch {
          // ignore notification failure
        }
      });
    }
  }

  /**
   * Tracks the last document text for which `modelscript/projectTreeChanged` was emitted,
   * preventing duplicate notifications from Tier 2 (60ms) and Tier 3 (180ms) for the same edit.
   */
  public lastNotifiedProjectTreeText = new Map<string, string>();

  /**
   * Sends a throttled `modelscript/projectTreeChanged` notification to the client
   * (leading-edge immediate fire followed by a 100ms trailing-edge cooldown).
   */
  public sendProjectTreeChanged(uri?: string): void {
    if (uri) {
      const effectiveUri = uri.startsWith("modelscript-lib://global")
        ? "file://" + uri.substring("modelscript-lib://global".length)
        : uri;
      const currentText =
        this.lastIndexedText.get(effectiveUri) ??
        this.lastIndexedText.get(uri) ??
        this.documentManager?.documents?.get(uri)?.getText();
      if (currentText !== undefined) {
        if (this.lastNotifiedProjectTreeText.get(effectiveUri) === currentText) {
          return;
        }
        this.lastNotifiedProjectTreeText.set(effectiveUri, currentText);
        this.lastNotifiedProjectTreeText.set(uri, currentText);
      }
    }
    if (typeof this.connection?.sendNotification !== "function") return;
    if (this.projectTreeChangedTimer) {
      this.projectTreeChangedPending = true;
      return;
    }
    this.connection.sendNotification("modelscript/projectTreeChanged");
    this.projectTreeChangedTimer = setTimeout(() => {
      this.projectTreeChangedTimer = null;
      if (this.projectTreeChangedPending) {
        this.projectTreeChangedPending = false;
        this.connection?.sendNotification?.("modelscript/projectTreeChanged");
      }
    }, 100);
  }

  /**
   * Adjusts line/column positions of cached semantic diagnostics during keystrokes,
   * preventing squiggles from displaying on wrong lines before asynchronous re-validation completes.
   */
  public adjustDiagnostics(
    uri: string,
    edit: {
      startPosition: { row: number; column: number };
      oldEndPosition: { row: number; column: number };
      newEndPosition: { row: number; column: number };
    },
  ): void {
    const cached = this.lastSemanticDiagnostics.get(uri);
    if (!cached || cached.length === 0) return;

    const startRow = edit.startPosition.row;
    const oldEndRow = edit.oldEndPosition.row;
    const newEndRow = edit.newEndPosition.row;
    const rowDelta = newEndRow - oldEndRow;
    const colDelta = edit.newEndPosition.column - edit.oldEndPosition.column;

    const adjusted: Diagnostic[] = [];
    for (const d of cached) {
      // 1. Diagnostic completely before the edit range — unaffected
      if (d.range.end.line < startRow) {
        adjusted.push(d);
        continue;
      }

      // 2. Diagnostic strictly after the edit range — shift rows
      if (d.range.start.line > oldEndRow) {
        adjusted.push({
          ...d,
          range: {
            start: { line: d.range.start.line + rowDelta, character: d.range.start.character },
            end: { line: d.range.end.line + rowDelta, character: d.range.end.character },
          },
        });
        continue;
      }

      // 3. Single-line edit on the same line as diagnostic
      if (startRow === oldEndRow && rowDelta === 0 && d.range.start.line === startRow) {
        if (d.range.start.character >= edit.oldEndPosition.column) {
          // Diagnostic is to the right of the edit point — shift columns
          adjusted.push({
            ...d,
            range: {
              start: { line: d.range.start.line, character: Math.max(0, d.range.start.character + colDelta) },
              end: { line: d.range.end.line, character: Math.max(0, d.range.end.character + colDelta) },
            },
          });
        } else if (d.range.end.character <= edit.startPosition.column) {
          // Diagnostic is to the left of the edit point — unaffected
          adjusted.push(d);
        }
        // If it intersects the edited token, drop it until revalidation completes
      }
    }

    this.lastSemanticDiagnostics.set(uri, adjusted);
  }

  /**
   * Purges cached state, diagnostics, revisions, and timers when a document is closed.
   */
  public disposeDocument(uri: string): void {
    const eff = uri.startsWith("modelscript-lib://global")
      ? "file://" + uri.substring("modelscript-lib://global".length)
      : uri;
    this.lastSemanticDiagnostics.delete(uri);
    this.lastSemanticDiagnostics.delete(eff);
    this.lastIndexedText.delete(uri);
    this.lastIndexedText.delete(eff);
    this.documentLSPBridges.delete(uri);
    this.documentLSPBridges.delete(eff);
    this.lastStepOwnDiagnostics.delete(uri);
    this.lastStepOwnDiagnostics.delete(eff);
    this.lastScadOwnDiagnostics.delete(uri);
    this.lastScadOwnDiagnostics.delete(eff);
    this.inFlightStepValidations.delete(uri);
    this.inFlightStepValidations.delete(eff);
    this.lastNotifiedProjectTreeText.delete(uri);
    this.lastNotifiedProjectTreeText.delete(eff);
    this.documentRevisions.delete(uri);
    this.documentRevisions.delete(eff);
    this.documentViewports.delete(uri);
    this.documentViewports.delete(eff);
    const timer = this.activeValidationTimers.get(uri);
    if (timer) {
      clearTimeout(timer);
      this.activeValidationTimers.delete(uri);
    }
    this.activeValidationPromises.delete(uri);
    this.activeValidationPromises.delete(eff);

    // Clean up reasoner and formal verification result caches
    this.verificationDiagnosticsByUri.delete(uri);
    this.verificationDiagnosticsByUri.delete(eff);
    this.verificationResultsByUri.delete(uri);
    this.verificationResultsByUri.delete(eff);
    this.modelicaProofResultsByUri.delete(uri);
    this.modelicaProofResultsByUri.delete(eff);
    this.modelicaDaeVerificationResultsByUri.delete(uri);
    this.modelicaDaeVerificationResultsByUri.delete(eff);
    this.daeVerificationResultsByUri.delete(uri);
    this.daeVerificationResultsByUri.delete(eff);
    for (const key of Array.from(this.daeVerificationCache.keys())) {
      if (key === uri || key === eff || key.startsWith(`${uri}#`) || key.startsWith(`${eff}#`)) {
        this.daeVerificationCache.delete(key);
      }
    }
    this.reasonerDiagnosticsByUri.delete(uri);
    this.reasonerDiagnosticsByUri.delete(eff);
    this.digitalThreadDiagnosticsByUri.delete(uri);
    this.digitalThreadDiagnosticsByUri.delete(eff);
    this.lastAutoVerifiedText.delete(uri);
    this.lastAutoVerifiedText.delete(eff);
    this.parsedSysmlReqsCache.delete(uri);
    this.parsedSysmlReqsCache.delete(eff);

    // Retract registered axioms from owl2Store and update reasoner
    const store = asOwl2StoreDisposable(this.workspaceManager?.unifiedWorkspace?.owl2Store);
    if (store && typeof store.setAxioms === "function") {
      const keysToClear: string[] = [];
      if (store._axiomsBySource instanceof Map) {
        for (const k of store._axiomsBySource.keys()) {
          if (k === uri || k === eff || k.endsWith(`:${uri}`) || k.endsWith(`:${eff}`)) {
            keysToClear.push(k);
          }
        }
      } else {
        keysToClear.push(uri, eff);
      }

      for (const k of keysToClear) {
        const delta = store.setAxioms(k, []);
        if (typeof store.clearAxioms === "function") {
          store.clearAxioms(k);
        }
        if (delta && this.reasonerService?.updateAndReason) {
          this.reasonerService.updateAndReason(
            new Map(),
            delta as Parameters<typeof this.reasonerService.updateAndReason>[1],
          );
        }
      }
    }
  }

  /**
   * Mutex lock serializing WASM parser linear memory access and immediate
   * syntax/lint extraction across concurrent document validations.
   */
  private wasmParserMutex: Promise<void> = Promise.resolve();

  /**
   * Raw WASM linear-memory linter diagnostic captured during initial CST parsing.
   */
  public static readonly WASM_LINT_SCHEMA = true;

  /**
   * Collect syntax errors and lint diagnostics from the WASM parser.
   *
   * IMPORTANT: This is called synchronously right after parsing, while the WASM
   * input buffer still contains this document's text. The returned `wasmLintDiags`
   * must be captured here because the async semantic pipeline (Step 5a) cannot
   * safely re-call `getDiagnostics` — by that time another document may have been
   * parsed, overwriting the WASM input buffer and causing the linter to read
   * garbled text at the old CST byte offsets.
   */
  public collectSyntaxErrors(
    rootNode: unknown,
    textDocument: TextDocument,
    plugin?: LanguagePlugin,
  ): { syntaxDiags: Diagnostic[]; wasmLintDiags: WasmLintDiagnostic[] } {
    return collectSyntaxErrorsFromRoot(
      {
        defaultModelicaFacade: this.parserService.facade as SyntaxCollectionContext["defaultModelicaFacade"],
        console: this.connection.console,
      },
      rootNode,
      textDocument,
      plugin,
    );
  }

  /**
   * Converts raw WASM GLR parser linter diagnostics into LSP `Diagnostic` instances,
   * calculating accurate source ranges, descriptive messages from error code definitions,
   * and compiler severity levels.
   */
  public convertWasmLintDiagnostics(
    wasmLintDiags: readonly WasmLintDiagnostic[],
    textDocument?:
      | TextDocument
      | {
          uri?: string;
          getText?(): string;
          languageId?: string;
          positionAt?(offset: number): { line: number; character: number };
        },
    plugin?: LanguagePlugin,
    currentText?: string,
    bridge?: unknown,
  ): Diagnostic[] {
    return convertWasmLintDiagnosticsToLsp(
      this.documentManager,
      wasmLintDiags,
      textDocument,
      plugin,
      currentText,
      bridge,
    );
  }

  /**
   * Immediately executes any pending debounced validation timer for `uri` and awaits in-flight validation.
   */
  public async flushValidation(uri: string): Promise<void> {
    const timer = this.activeValidationTimers.get(uri);
    if (timer) {
      clearTimeout(timer);
      this.activeValidationTimers.delete(uri);
      const doc = this.documentManager.documents.get(uri);
      if (doc) {
        await this.parserService.ensureLanguageParserLoaded(doc.languageId || uri);
        await this.validateTextDocument(doc);
      }
    }
    const pending = this.activeValidationPromises.get(uri);
    if (pending) {
      await pending;
    }
    const doc = this.documentManager.documents.get(uri);
    if (doc) {
      const normUri = uri.replace(/^([a-z0-9+-]+):\/{1,3}/i, "$1:///");
      const indexedText = this.lastIndexedText.get(uri) ?? this.lastIndexedText.get(normUri);
      if (indexedText !== doc.getText()) {
        await this.parserService.ensureLanguageParserLoaded(doc.languageId || uri);
        await this.validateTextDocument(doc);
        const inflight = this.activeValidationPromises.get(uri);
        if (inflight) await inflight;
      }
    }
  }

  /**
   * Synchronizes the incremental WASM CST, `WorkspaceIndex`, Salsa `QueryEngine`, and class wrappers
   * for `uri` without running heavy background lints, abstract interpretation, or DAE reachability.
   *
   * Used by `DiagramService` (`getDiagramData`, `applyEdits`) and Tier 2 short debounce so diagram
   * operations and outline trees see up-to-date AST and class instances in ~1–2ms.
   */
  private getPolyglotValidatorContext(): PolyglotValidatorContext {
    return {
      connection: this.connection,
      documentManager: this.documentManager,
      workspaceManager: this.workspaceManager,
      parserService: this.parserService,
      lastIndexedText: this.lastIndexedText,
      documentRevisions: this.documentRevisions,
      documentLSPBridges: this.documentLSPBridges,
      clearRevalidationTimer: () => {
        if (this.revalidationTimer) {
          clearTimeout(this.revalidationTimer);
          this.revalidationTimer = null;
        }
      },
      withWasmParserLock: async <T>(fn: () => T): Promise<T> => {
        let releaseLock: () => void = () => {};
        const currentLock = this.wasmParserMutex;
        this.wasmParserMutex = new Promise<void>((resolve) => {
          releaseLock = resolve;
        });
        await currentLock;
        try {
          return fn();
        } finally {
          releaseLock();
        }
      },
      computeTokenEndCharacter: (t, l, c) => this.computeTokenEndCharacter(t, l, c),
      parseIncrementalWasmTree: (u, l, t, p) => this.parseIncrementalWasmTree(u, l, t, p),
      indexNativeDslDocument: (u, t, l, d) => this.indexNativeDslDocument(u, t, l, d),
      createDefaultQueryEngine: (l, idx, cst) => this.createDefaultQueryEngine(l, idx, cst),
      syncWorkspaceStateAfterIndex: (e, c, s, n) => this.syncWorkspaceStateAfterIndex(e, c, s, n),
      populateClassWrappers: (e, u, idx, eng, c) => this.populateClassWrappers(e, u, idx, eng, c),
      finalizeCrossLanguageValidation: (p) => this.finalizeCrossLanguageValidation(p),
    };
  }

  private getSemanticPipelineContext(): SemanticPipelineContext {
    return {
      connection: this.connection,
      documentManager: this.documentManager,
      workspaceManager: this.workspaceManager,
      parserService: this.parserService,
      diagnosticsConfig: this.diagnosticsConfig,
      lastSemanticDiagnostics: this.lastSemanticDiagnostics,
      lastIndexedText: this.lastIndexedText,
      documentLSPBridges: this.documentLSPBridges,
      documentRevisions: this.documentRevisions,
      documentViewports: this.documentViewports,
      verificationDiagnosticsByUri: this.verificationDiagnosticsByUri,
      reasonerDiagnosticsByUri: this.reasonerDiagnosticsByUri,
      digitalThreadDiagnosticsByUri: this.digitalThreadDiagnosticsByUri,
      isCascadeRevalidationActive: () => this.isCascadeRevalidationActive,
      clearRevalidationTimer: () => {
        if (this.revalidationTimer) {
          clearTimeout(this.revalidationTimer);
          this.revalidationTimer = null;
        }
      },
      indexNativeDslDocument: (u, t, l, d) => this.indexNativeDslDocument(u, t, l, d),
      createDefaultQueryEngine: (l, idx, cst) => this.createDefaultQueryEngine(l, idx, cst),
      syncWorkspaceStateAfterIndex: (e, c, s, n) => this.syncWorkspaceStateAfterIndex(e, c, s, n),
      populateClassWrappers: (e, u, idx, eng, c) => this.populateClassWrappers(e, u, idx, eng, c),
      convertWasmLintDiagnostics: (w, d, p, t, b) => this.convertWasmLintDiagnostics(w, d, p, t, b),
      reconcileCrossLanguageWasmDiagnostics: (w, idx, eng, ed, eUri, l, t, td, p) =>
        this.reconcileCrossLanguageWasmDiagnostics(w, idx, eng, ed, eUri, l, t, td, p),
      applyDiagnosticFilters: (d) => this.applyDiagnosticFilters(d),
      sendProjectTreeChanged: (u) => this.sendProjectTreeChanged(u),
      postValidateOwl2: (e, t, txt, d) => this.postValidateOwl2(e, t, txt, d),
      postValidateSysml2: (e, d) => this.postValidateSysml2(e, d),
      checkAutoVerify: (e) => this.checkAutoVerify(e),
      postValidateModelicaAbstractInterpretation: (e, td, d) =>
        this.postValidateModelicaAbstractInterpretation(e, td, d),
      postValidateModelicaDaeReachability: (e, td, d) => this.postValidateModelicaDaeReachability(e, td, d),
      postValidateModelicaReasoner: (e, d) => this.postValidateModelicaReasoner(e, d),
      postValidatePolyglotReasoner: (e, l, d) => this.postValidatePolyglotReasoner(e, l, d),
      postValidatePolyglotDrift: (e, l, d) => this.postValidatePolyglotDrift(e, l, d),
      collectLiveTggCorrespondenceDiagnostics: (p) => this.collectLiveTggCorrespondenceDiagnostics(p),
      collectThreadDiagnostics: (u, td) => this.collectThreadDiagnostics(u, td),
      collectDroneSimulationParityDiagnostics: (u, l, t, td, d) =>
        this.collectDroneSimulationParityDiagnostics(u, l, t, td, d),
      scheduleCrossLanguageRevalidation: (e) => this.scheduleCrossLanguageRevalidation(e),
    };
  }

  public async syncDocumentForDiagram(uri: string, explicitText?: string): Promise<boolean> {
    return syncDocumentForDiagramImpl(this.getPolyglotValidatorContext(), uri, explicitText);
  }

  /**
   * Indexes a document directly into `UnifiedWorkspace` using its declarative DSL `indexing.indexFile` hook,
   * registering `languageDef` on the fly if needed.
   */
  private indexNativeDslDocument(uri: string, text: string, langId: string, languageDef?: unknown): boolean {
    const uw = this.workspaceManager?.unifiedWorkspace;
    if (!uw || typeof uw.indexDocumentText !== "function") return false;
    const def = languageDef ?? globalLanguageRegistry.getPluginById(langId)?.languageDef;
    if (def && typeof uw.getLanguageDef === "function" && !uw.getLanguageDef(langId)) {
      uw.registerLanguageDef(langId, def as Parameters<typeof uw.registerLanguageDef>[1]);
    }
    if (typeof uw.getLanguageDef === "function" && !uw.getLanguageDef(langId) && !def) {
      return false;
    }
    try {
      const cachedTree = this.documentManager?.documentTrees?.get(uri)?.tree;
      uw.indexDocumentText(uri, text, langId, cachedTree as unknown as WorkspaceCstTree | undefined);
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.connection?.console?.warn?.(
        `[validate] Failed to index ${uri} via DSL UnifiedWorkspace (${langId}): ${msg}`,
      );
      return false;
    }
  }

  /**
   * Validates a `TextDocument` by routing to domain-specific validators (STEP, CFD, FEA, SCAD,
   * PSCAD, SSP, CSV, JS/TS sidecars) or running the uniform incremental WASM GLR parse and semantic pipeline.
   */
  public diagnosticsConfig: DiagnosticsFilterConfig = {};

  /**
   * Applies user diagnostic configuration (`disabledRules`, `crossDomainDrift`, and `maxProblems` / `maxNumberOfProblems`).
   */
  public applyDiagnosticFilters(diagnostics: Diagnostic[]): Diagnostic[] {
    return applyDiagnosticFiltersImpl(this.diagnosticsConfig, diagnostics);
  }

  public async validateTextDocument(
    textDocument: TextDocument,
    options?: { isSave?: boolean | undefined },
  ): Promise<void> {
    const uri = textDocument.uri;
    if (this.diagnosticsConfig.enabled === false) {
      this.connection.sendDiagnostics({ uri, diagnostics: [] });
      return;
    }

    const text = textDocument.getText();
    if (
      (uri.endsWith(".mo") && text.includes("uses")) ||
      ((uri.endsWith("/package.json") || uri.endsWith("/modelscript.json")) && text.includes("dependencies"))
    ) {
      void this.parserService.syncDocumentLibraryVersions?.(uri, text);
    }
    const plugin = globalLanguageRegistry.getPluginForLanguageIdOrUri(textDocument.languageId, uri, text);
    if (plugin && !globalLanguageRegistry.isLanguageEnabled(plugin.id)) {
      this.connection.sendDiagnostics({ uri, diagnostics: [] });
      return;
    }

    // 1. Check custom validation handler (e.g. for specialized formats)
    if (plugin?.customHandlers?.validate) {
      const handled = await validateCustomPluginDocumentImpl(
        this.getPolyglotValidatorContext(),
        textDocument,
        text,
        plugin,
      );
      if (handled) return;
    }

    // Handle Javascript/TypeScript sidecar files natively if no plugin customHandler
    if (uri.endsWith(".js") || uri.endsWith(".ts")) {
      this.validateSidecarDocument(textDocument);
      return;
    }

    // Handle STEP files natively if no plugin customHandler
    const isStep = textDocument.languageId === "step" || /\.(step|stp|p21)$/i.test(uri);
    if (isStep) {
      await this.validateStepDocument(textDocument, plugin);
      return;
    }

    const isScad = textDocument.languageId === "scad" || /\.scad$/i.test(uri);
    if (isScad) {
      await this.validateScadDocument(textDocument, plugin);
      return;
    }

    const isPscad = textDocument.languageId === "pscad" || /\.(pscx|pslx|pswx|psmx)$/i.test(uri);
    if (isPscad) {
      await this.validatePscadDocument(textDocument, plugin);
      return;
    }

    // 2. Uniform Parsing Pipeline
    const langId = plugin?.id ?? (textDocument.languageId || "modelica");
    const parser = plugin?.parser ?? this.parserService?.getParser?.(langId);

    const isModelica = langId === "modelica" || /\.(mo|mos|msim)($|\?|#)/i.test(uri);
    if (!parser && (!this.parserService?.sharedContext || !isModelica)) {
      const handled = await validateActionLintDocumentImpl(
        this.getPolyglotValidatorContext(),
        textDocument,
        text,
        plugin,
      );
      if (handled) return;
      this.connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: [] });
      return;
    }

    // Pre-process text if needed via plugin hook
    let processedText = text;
    if (plugin?.preprocessText) {
      processedText = plugin.preprocessText(text);
    }

    const oldCached = this.documentManager.documentTrees.get(uri);
    let tree: StoredDocumentTree | undefined;
    let editRanges: Array<{ startOffset: number; endOffset: number }> | undefined;
    let syntaxDiags: Diagnostic[] = [];
    let wasmLintDiags: WasmLintDiagnostic[] = [];

    // Acquire linear memory parser lock to ensure WASM text buffer isolation
    let releaseLock: () => void = () => {};
    const currentLock = this.wasmParserMutex;
    this.wasmParserMutex = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    await currentLock;
    this.wasmParserLockCount++;

    try {
      try {
        if (isLargeXmlForWasm(uri, processedText, plugin)) {
          tree =
            oldCached?.text === text && (oldCached?.tree as XmlFallbackTree | undefined)?.__isXmlCstFallback
              ? oldCached.tree
              : parseXmlFallbackTree(processedText);
        } else {
          const oldTree = asIncrementalTree(oldCached?.tree);
          const activeFacade = (plugin?.facade ??
            oldTree?.facade ??
            oldTree?.rootNode?.tree?.facade ??
            this.parserService.facade) as { lastAstRoot?: number; loadSource?: (text: string) => void } | undefined;
          const isOldTreeActiveInWasm = isWasmTreeActiveInFacade(oldCached?.tree, activeFacade, uri);

          if (oldCached && oldCached.text !== text && isOldTreeActiveInWasm) {
            const edit = computeTreeEdit(oldCached.text, text);
            if (typeof oldTree?.edit === "function") {
              oldTree.edit(edit as never);
            }
            if (parser) {
              tree = parser.parse(
                processedText,
                oldCached.tree as never,
                edit.startIndex,
                edit.oldEndIndex,
                edit.newEndIndex,
                uri,
              ) as StoredDocumentTree | undefined;
            } else if (this.parserService.sharedContext && isModelica) {
              tree = this.parserService.sharedContext.parse(".mo", processedText, oldCached.tree as never, {
                editStart: edit.startIndex,
                editOldEnd: edit.oldEndIndex,
                editNewEnd: edit.newEndIndex,
              }) as StoredDocumentTree | undefined;
            }
            editRanges = [
              {
                startOffset: edit.startIndex,
                endOffset: edit.newEndIndex,
              },
            ];
          } else if (oldCached && oldCached.text === text && isOldTreeActiveInWasm) {
            tree = oldCached.tree;
            if (activeFacade && typeof activeFacade.loadSource === "function") {
              activeFacade.loadSource(text);
            }
          } else {
            if (parser) {
              tree = parseFullWithUri(parser, processedText, uri);
            } else if (this.parserService.sharedContext && isModelica) {
              tree = this.parserService.sharedContext.parse(".mo", processedText) as StoredDocumentTree | undefined;
            }
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.connection.console.error(`[validate] Parser error for ${uri}: ${msg}`);
      }

      if (!tree) {
        this.connection.sendDiagnostics({ uri, diagnostics: [] });
        return;
      }

      if (oldCached?.tree && oldCached.tree !== tree) {
        oldCached.tree.delete?.();
      }
      const normUri = uri.replace(/^([a-z0-9+-]+):\/{0,3}/i, "$1:///");
      const oneSlashUri = uri.replace(/^([a-z0-9+-]+):\/{0,3}/i, "$1:/");
      const docEntry = {
        text,
        tree,
        classCache: oldCached?.classCache ?? new Map(),
      };
      this.documentManager.documentTrees.set(uri, docEntry);
      this.documentManager.documentTrees.set(normUri, docEntry);
      this.documentManager.documentTrees.set(oneSlashUri, docEntry);

      if (this.workspaceManager.unifiedWorkspace) {
        const wsTree = tree as unknown as WorkspaceCstTree;
        this.workspaceManager.unifiedWorkspace.setDocumentTree(uri, wsTree);
        this.workspaceManager.unifiedWorkspace.setDocumentTree(normUri, wsTree);
        this.workspaceManager.unifiedWorkspace.setDocumentTree(oneSlashUri, wsTree);
        const uDoc =
          this.workspaceManager.unifiedWorkspace.getDocument(uri) ??
          this.workspaceManager.unifiedWorkspace.getDocument(normUri) ??
          this.workspaceManager.unifiedWorkspace.getDocument(oneSlashUri);
        if (uDoc) {
          uDoc.text = text;
          uDoc.tree = wsTree;
        }
      }

      // 3. Collect syntax + lint diagnostics immediately (while WASM state is valid)
      const res = this.collectSyntaxErrors(tree.rootNode, textDocument, plugin);
      syntaxDiags = res.syntaxDiags;
      wasmLintDiags = res.wasmLintDiags;
    } finally {
      this.wasmParserLockCount = Math.max(0, this.wasmParserLockCount - 1);
      releaseLock();
    }
    const rawWasmLspDiags = this.convertWasmLintDiagnostics(wasmLintDiags, textDocument, plugin, text);
    const initialUnifiedIdx =
      typeof this.workspaceManager?.unifiedWorkspace?.getIndex === "function"
        ? this.workspaceManager.unifiedWorkspace.getIndex()
        : undefined;
    const initialEngine = plugin?.queryEngine ?? this.workspaceManager?.getQueryEngine?.(langId);
    const wasmLspDiags = initialUnifiedIdx
      ? this.reconcileCrossLanguageWasmDiagnostics(
          rawWasmLspDiags,
          initialUnifiedIdx,
          initialEngine,
          null,
          uri,
          langId,
          text,
          textDocument,
          plugin,
        )
      : rawWasmLspDiags;
    const fastStaticDiags = collectFastStaticDiagnostics(isModelica, langId, uri, text);
    const prevPublished = this.lastSemanticDiagnostics.get(uri);
    const cachedSemantic = (prevPublished || []).filter(
      (d) =>
        d.source !== "sysml2-verifier" &&
        d.source !== "modelscript-fast-static" &&
        (typeof d.code !== "number" || d.code < 1000 || d.code >= 6000),
    );
    const initialDiags = this.applyDiagnosticFilters(
      deduplicateAllDiagnostics([...syntaxDiags, ...wasmLspDiags, ...fastStaticDiags, ...cachedSemantic]),
    );
    const unchangedFromPrev =
      prevPublished !== undefined &&
      initialDiags.length === prevPublished.length &&
      initialDiags.every((d, i) => {
        const p = prevPublished[i];
        return (
          p !== undefined &&
          d.message === p.message &&
          d.code === p.code &&
          d.range.start.line === p.range.start.line &&
          d.range.start.character === p.range.start.character
        );
      });
    this.lastSemanticDiagnostics.set(uri, initialDiags);
    if (!unchangedFromPrev) {
      this.connection.sendDiagnostics({ uri, diagnostics: initialDiags });
    }

    // 4. Run Unified Semantic Pipeline
    const revisionAtStart = this.documentRevisions.get(uri) ?? 0;
    const promise = this.runUnifiedSemanticPipeline({
      uri,
      text,
      tree,
      editRanges,
      baseDiagnostics: syntaxDiags,
      wasmLintDiags,
      revisionAtStart,
      plugin,
      langId,
      textDocument,
      isSave: options?.isSave,
    }).catch((e) => {
      this.connection.console.error(`[runUnifiedSemanticPipeline] Failed for ${uri}: ${e?.message ?? e}`);
    });

    this.activeValidationPromises.set(uri, promise);
    promise.finally(() => {
      if (this.activeValidationPromises.get(uri) === promise) {
        this.activeValidationPromises.delete(uri);
      }
    });
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
  public async runUnifiedSemanticPipeline(params: UnifiedSemanticPipelineParams): Promise<void> {
    await runUnifiedSemanticPipelineImpl(this.getSemanticPipelineContext(), params);
  }

  /**
   * Evaluates digital thread alignments and multi-master conflicts for the given document URI,
   * returning LSP diagnostics for parameter drift or conflict slots.
   */
  public collectThreadDiagnostics(uri: string, textDocument?: TextDocument): Diagnostic[] {
    return collectThreadDiagnosticsImpl(
      { workspaceManager: this.workspaceManager, documentManager: this.documentManager },
      uri,
      textDocument,
    );
  }

  /**
   * Backward-compatible delegation for runSemanticPipeline.
   */
  public async runSemanticPipeline(
    uri: string,
    text: string,
    tree: unknown,
    editRanges: Array<{ startOffset: number; endOffset: number }> | undefined,
    baseDiagnostics: Diagnostic[],
    revisionAtStart: number | null,
    _context: unknown,
  ): Promise<void> {
    const plugin = globalLanguageRegistry.getPluginForUri(uri);
    await this.runUnifiedSemanticPipeline({
      uri,
      text,
      tree,
      editRanges,
      baseDiagnostics,
      revisionAtStart,
      plugin,
      langId: plugin?.id ?? "modelica",
    });
  }

  /**
   * Instantiates a Salsa `QueryEngine` for `langId` using the registered language plugin factory or global fallback.
   */
  private createDefaultQueryEngine(langId: string, unifiedIndex: SymbolIndex, cstTreeWrapper: unknown): QueryEngine {
    const rawNorm = langId.toLowerCase();
    const norm = rawNorm === "sysml" ? "sysml2" : rawNorm;
    const plugin = globalLanguageRegistry.getPluginById(norm) ?? globalLanguageRegistry.getPluginById(rawNorm);
    const altPlugin = norm === "sysml2" ? globalLanguageRegistry.getPluginById("sysml") : undefined;
    const factory =
      plugin?.createQueryEngine ??
      altPlugin?.createQueryEngine ??
      (norm === "modelica" ? createModelicaQueryEngine : undefined) ??
      (norm === "sysml2" ? createSysML2QueryEngine : undefined) ??
      (norm === "owl2" ? createOWL2QueryEngine : undefined);
    if (typeof factory === "function") {
      return (factory as (idx: SymbolIndex, cst: unknown) => QueryEngine)(unifiedIndex, cstTreeWrapper);
    }
    return new QueryEngine(unifiedIndex, new Map(), { tree: cstTreeWrapper as never });
  }

  /**
   * Synchronizes all registered Salsa QueryEngines and Modelica's external UnifiedWorkspace
   * attachment after any document in any language is indexed or re-indexed.
   */
  public syncWorkspaceStateAfterIndex(
    effectiveUri?: string,
    changedIds?: Set<number> | null,
    structuralChangedIds?: Set<number> | null,
    changedNames?: Set<string> | null,
  ): void {
    syncWorkspaceStateAfterIndexImpl(
      this.workspaceManager,
      this.parserService,
      effectiveUri,
      changedIds,
      structuralChangedIds,
      changedNames,
    );
  }

  private pendingCascadeUri: string | null = null;

  /**
   * Coalesces rapid multi-file opens/edits into a single asynchronous cross-language peer
   * revalidation pass so initial diagram/editor requests are never starved by O(N^2) cascades.
   */
  private scheduleCrossLanguageRevalidation(sourceEffectiveUri: string): void {
    if (this.isCascadeRevalidationActive) return;
    if (this.revalidationTimer) {
      clearTimeout(this.revalidationTimer);
    }
    this.pendingCascadeUri = sourceEffectiveUri;
    this.revalidationTimer = setTimeout(() => {
      this.revalidationTimer = null;
      const uri = this.pendingCascadeUri;
      this.pendingCascadeUri = null;
      if (uri) {
        void this.revalidateCrossLanguageDependents(uri);
      }
    }, 120);
  }

  /**
   * Immediately executes any debounced cross-language peer revalidation and awaits all in-flight validations.
   */
  public async flushPendingRevalidations(): Promise<void> {
    if (this.revalidationTimer) {
      clearTimeout(this.revalidationTimer);
      this.revalidationTimer = null;
    }
    const uri = this.pendingCascadeUri;
    this.pendingCascadeUri = null;
    if (uri) {
      await this.revalidateCrossLanguageDependents(uri);
    }
    const pending = Array.from(this.activeValidationPromises.values());
    if (pending.length > 0) {
      await Promise.allSettled(pending);
    }
  }

  /**
   * Re-validates open workspace peer documents immediately and boundedly whenever a document's
   * exported symbols or indexed contents change, without recursive re-entry loops.
   */
  private async revalidateCrossLanguageDependents(sourceEffectiveUri: string): Promise<void> {
    if (this.isCascadeRevalidationActive) return;
    if (!this.documentManager?.documents || typeof this.documentManager.documents.all !== "function") return;
    if (this.revalidationTimer) {
      clearTimeout(this.revalidationTimer);
      this.revalidationTimer = null;
    }

    const normUri = (u: string) =>
      (u.startsWith("modelscript-lib://global")
        ? "file://" + u.substring("modelscript-lib://global".length)
        : u
      ).replace(/^([a-z0-9+-]+):\/{0,3}/i, "$1:///");
    const sourceNorm = normUri(sourceEffectiveUri);

    const sourceDoc =
      this.documentManager.documents.get(sourceEffectiveUri) ??
      Array.from(this.documentManager.documents.all()).find((d) => normUri(d.uri) === sourceNorm);
    const sourceRevAtStart = sourceDoc ? (this.documentRevisions.get(sourceDoc.uri) ?? null) : null;
    const sourceVerAtStart = sourceDoc?.version ?? null;
    const isSourceSuperseded = (): boolean => {
      if (!sourceDoc) return false;
      if (sourceRevAtStart !== null && (this.documentRevisions.get(sourceDoc.uri) ?? 0) !== sourceRevAtStart) {
        return true;
      }
      const latest = this.documentManager.documents.get(sourceDoc.uri);
      return Boolean(latest && sourceVerAtStart !== null && latest.version !== sourceVerAtStart);
    };

    this.isCascadeRevalidationActive = true;
    try {
      const peers = Array.from(this.documentManager.documents.all());
      for (const peerDoc of peers) {
        if (isSourceSuperseded()) break;
        const peerNorm = normUri(peerDoc.uri);
        if (peerNorm === sourceNorm || this.revalidatingUris.has(peerNorm)) continue;
        this.revalidatingUris.add(peerNorm);
        try {
          await this.validateTextDocument(peerDoc);
          const pending = this.activeValidationPromises.get(peerDoc.uri);
          if (pending) {
            await pending;
          }
        } catch {
          // Non-fatal peer revalidation error
        } finally {
          this.revalidatingUris.delete(peerNorm);
        }
      }
    } finally {
      this.isCascadeRevalidationActive = false;
    }
  }

  /**
   * Reconciles single-file WASM CST lint diagnostics (`M2002`/`M2003`) against the multi-file,
   * cross-language `UnifiedWorkspace` and Salsa `QueryEngine` so resolved imported or foreign types,
   * ports, and variables never produce false single-file errors while genuine unresolved errors remain.
   */
  private reconcileCrossLanguageWasmDiagnostics(
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
  ): Diagnostic[] {
    return reconcileCrossLanguageWasmDiagnosticsImpl(
      wasmDiags,
      unifiedIndex,
      engine,
      engineDiags,
      effectiveUri,
      langId,
      text,
      textDocument,
      plugin,
    );
  }

  private getTggTransformer(langId: string): PolyglotTransformer | null {
    const norm = langId.toLowerCase();
    const cached = this.tggTransformerCache.get(norm);
    if (cached) return cached;

    const uw = this.workspaceManager?.unifiedWorkspace as
      (UnifiedWorkspace & { createPolyglotTransformer?: (lang: string) => PolyglotTransformer | null }) | undefined;
    let transformer: PolyglotTransformer | null = null;
    if (uw && typeof uw.createPolyglotTransformer === "function") {
      try {
        transformer = uw.createPolyglotTransformer(norm) ?? null;
      } catch {
        transformer = null;
      }
    }
    if (!transformer) {
      const plugin = globalLanguageRegistry.getPluginById(norm);
      if (plugin?.languageDef?.polyglot) {
        transformer = new PolyglotTransformer(
          plugin.languageDef.polyglot as unknown as ConstructorParameters<typeof PolyglotTransformer>[0],
        );
      }
    }
    if (transformer) {
      if (!this.tggTransformerCache.has(norm) && this.tggTransformerCache.size >= 64) {
        const oldest = this.tggTransformerCache.keys().next().value;
        if (oldest !== undefined) {
          this.tggTransformerCache.delete(oldest);
        }
      }
      this.tggTransformerCache.set(norm, transformer);
    }
    return transformer;
  }

  /**
   * Evaluates live read-only TGG structural correspondence diagnostics on `@twin` / `implements`
   * links in `effectiveUri`, reporting missing ports/components/type mismatches (`warning`) and
   * unresolved explicit twin targets (`error`).
   */
  private collectLiveTggCorrespondenceDiagnostics(params: {
    effectiveUri: string;
    langId: string;
    text: string;
    tree: PolyglotTreeLike | null | undefined;
    textDocument?: TextDocument | undefined;
    diagnostics: Diagnostic[];
  }): void {
    collectLiveTggCorrespondenceDiagnosticsImpl(
      {
        workspaceManager: this.workspaceManager,
        documentManager: this.documentManager,
        getTggTransformer: (l) => this.getTggTransformer(l),
      },
      params,
    );
  }

  private collectDroneSimulationParityDiagnostics(
    uri: string,
    langId: string,
    text: string,
    textDocument: TextDocument | undefined,
    diagnostics: Diagnostic[],
  ): void {
    collectDroneSimulationParityDiagnosticsImpl(
      this.workspaceManager,
      this.documentManager,
      uri,
      langId,
      text,
      textDocument,
      diagnostics,
    );
  }

  /**
   * Shared cross-language finalizer invoked by both the unified GLR/Salsa pipeline and all
   * standalone format validators (PSSE, PSCAD, STEP, Easy5, ROCETS, SCAD, FEA, CFD, etc.).
   * Ensures UnifiedWorkspace query engine sync, automatic thread discovery, TGG conformance checks,
   * digital-thread contradiction reporting, and bounded dependent revalidation run uniformly.
   */
  private async finalizeCrossLanguageValidation(params: FinalizeCrossLanguageParams): Promise<Diagnostic[]> {
    return finalizeCrossLanguageValidationImpl(this.getSemanticPipelineContext(), params);
  }

  private async finalizeCustomDocument(
    textDocument: TextDocument,
    langId: string,
    diagnostics: Diagnostic[],
    prevIndexedTextOverride?: string,
  ): Promise<void> {
    const isStale = (): boolean => {
      const latest = this.documentManager?.documents?.get(textDocument.uri);
      return Boolean(latest && latest.version !== textDocument.version);
    };
    if (isStale()) return;
    const text = textDocument.getText();
    const prevText =
      prevIndexedTextOverride !== undefined ? prevIndexedTextOverride : this.lastIndexedText.get(textDocument.uri);
    const contentChanged = prevText !== text;
    this.lastIndexedText.set(textDocument.uri, text);
    const storedTree = this.documentManager.documentTrees.get(textDocument.uri)?.tree;
    await this.finalizeCrossLanguageValidation({
      uri: textDocument.uri,
      effectiveUri: textDocument.uri,
      text,
      langId,
      tree: storedTree && "edit" in storedTree ? storedTree : undefined,
      textDocument,
      diagnostics,
      hasSyntaxErrors: diagnostics.some((d) => d.severity === DiagnosticSeverity.Error),
      contentChanged,
      isStale,
    });
  }

  /**
   * Validates an OpenSCAD (`.scad`) document using the SCAD WASM parser, CST linter, and digital thread CAD bounds checks.
   */
  private getFormatValidatorsContext(): FormatValidatorsContext {
    return {
      connection: this.connection,
      documentManager: this.documentManager,
      parserService: this.parserService,
      workspaceManager: this.workspaceManager,
      documentLSPBridges: this.documentLSPBridges,
      lastIndexedText: this.lastIndexedText,
      lastScadOwnDiagnostics: this.lastScadOwnDiagnostics,
      lastStepOwnDiagnostics: this.lastStepOwnDiagnostics,
      inFlightStepValidations: this.inFlightStepValidations,
      showInformationalBadges: this.diagnosticsConfig.showInformationalBadges !== false,
      collectSyntaxErrors: (rootNode, doc, plugin) => this.collectSyntaxErrors(rootNode, doc, plugin),
      finalizeCustomDocument: (doc, langId, diags, prev) => this.finalizeCustomDocument(doc, langId, diags, prev),
      finalizeCrossLanguageValidation: (params) => this.finalizeCrossLanguageValidation(params),
      indexNativeDslDocument: (uri, text, langId, languageDef) =>
        this.indexNativeDslDocument(uri, text, langId, languageDef),
      syncWorkspaceStateAfterIndex: (uri) => this.syncWorkspaceStateAfterIndex(uri),
      sendProjectTreeChanged: (uri) => this.sendProjectTreeChanged(uri),
    };
  }

  public async validateScadDocument(textDocument: TextDocument, plugin?: LanguagePlugin): Promise<void> {
    await validateScadDocumentImpl(this.getFormatValidatorsContext(), textDocument, plugin);
  }

  /**
   * Registers a JavaScript/TypeScript sidecar file as a synthetic class instance in the workspace.
   */
  private validateSidecarDocument(textDocument: TextDocument): void {
    validateSidecarDocumentImpl(this.getFormatValidatorsContext(), textDocument);
  }

  /**
   * Computes a safe 0-based end character on the given line when `endColumn` is not provided,
   * clamping to the XML tag name (`<tagName`) or identifier token at `(line, col)` so squiggles
   * never spill across whitespace into attributes.
   */
  private computeTokenEndCharacter(text: string, lineZero: number, colZero: number): number {
    return computeTokenEndCharacterImpl(text, lineZero, colZero);
  }

  private parseIncrementalWasmTree(uri: string, langId: string, text: string, plugin?: LanguagePlugin): unknown | null {
    return parseIncrementalWasmTreeImpl(this.getFormatValidatorsContext(), uri, langId, text, plugin);
  }

  /**
   * Parses, lints, and indexes a PSCAD (`.pscx`, `.pslx`, `.pswx`, `.psmx`) power systems document.
   */
  public async validatePscadDocument(textDocument: TextDocument, plugin?: LanguagePlugin): Promise<void> {
    await validatePscadDocumentImpl(this.getFormatValidatorsContext(), textDocument, plugin);
  }

  /**
   * Validates an ISO 10303-21 STEP document (`.step`, `.stp`, `.p21`) for syntax, entity reference integrity, and schema arity.
   */
  private async validateStepDocument(textDocument: TextDocument, plugin?: LanguagePlugin): Promise<void> {
    await validateStepDocumentImpl(this.getFormatValidatorsContext(), textDocument, plugin);
  }

  private getReasonerContext(): ReasonerDiagnosticsContext {
    return {
      connection: this.connection,
      documentManager: this.documentManager,
      parserService: this.parserService,
      workspaceManager: this.workspaceManager,
      reasonerService: this.reasonerService,
      reasonerDiagnosticsByUri: this.reasonerDiagnosticsByUri,
      lastSemanticDiagnostics: this.lastSemanticDiagnostics,
    };
  }

  /**
   * Runs OWL2 Functional Syntax linting, lowers CST axioms into the shared ontology store,
   * and executes tableau consistency reasoning.
   */
  private async postValidateOwl2(
    effectiveUri: string,
    tree: PolyglotTreeLike | null | undefined,
    text: string,
    diagnostics: Diagnostic[],
  ): Promise<void> {
    await postValidateOwl2Impl(this.getReasonerContext(), effectiveUri, tree, text, diagnostics);
  }

  /**
   * Updates the ontological reasoner after SysML v2 validation and routes any logical contradictions to affected documents.
   */
  private postValidateSysml2(effectiveUri: string, diagnostics: Diagnostic[]): void {
    postValidateSysml2Impl(this.getReasonerContext(), effectiveUri, diagnostics);
  }

  /**
   * Updates the ontological reasoner after Modelica validation when OWL2 axioms are present in the workspace.
   */
  private postValidateModelicaReasoner(effectiveUri: string, diagnostics: Diagnostic[]): void {
    postValidateModelicaReasonerImpl(this.getReasonerContext(), effectiveUri, diagnostics);
  }

  /**
   * Updates the ontological reasoner after polyglot document validation across any supported language.
   * Projects the file's SymbolIndex into BFO/IOF OWL2 axioms and triggers incremental reasoning.
   */
  private postValidatePolyglotReasoner(effectiveUri: string, langId: string, diagnostics: Diagnostic[]): void {
    postValidatePolyglotReasonerImpl(this.getReasonerContext(), effectiveUri, langId, diagnostics);
  }

  /**
   * Scans cross-language workspace indices for parameter drift and model divergence.
   * Emits M5104 diagnostics with clickable relatedInformation links to counterpart declarations.
   */
  private postValidatePolyglotDrift(effectiveUri: string, langId: string, diagnostics: Diagnostic[]): void {
    postValidatePolyglotDriftImpl(this.getReasonerContext(), effectiveUri, langId, diagnostics);
  }

  /**
   * Maps minimal conflict cores and unsat explanations from the description logic reasoner
   * back to source document ranges and publishes cross-document diagnostics.
   */
  public routeReasonerDiagnostics(
    currentUri: string,
    consistency: ReasonerConsistencyLike | null | undefined,
    currentSemanticDiagnostics: Diagnostic[],
    source: string,
  ): void {
    routeReasonerDiagnosticsImpl(
      this.getReasonerContext(),
      currentUri,
      consistency,
      currentSemanticDiagnostics,
      source,
    );
  }

  /**
   * Merges polyglot digital thread diagnostics into cached per-document diagnostics without
   * clobbering existing syntax/semantic lints, then pushes updated diagnostics to the client.
   */
  private getDigitalThreadContext(): DigitalThreadValidationContext {
    return {
      connection: this.connection,
      documentManager: this.documentManager,
      workspaceManager: this.workspaceManager,
      digitalThreadDiagnosticsByUri: this.digitalThreadDiagnosticsByUri,
      lastSemanticDiagnostics: this.lastSemanticDiagnostics,
      siblingDirCache: this.siblingDirCache,
      getLastDigitalThreadFingerprint: () => this.lastDigitalThreadFingerprint,
      setLastDigitalThreadFingerprint: (fp) => {
        this.lastDigitalThreadFingerprint = fp;
      },
      getIsDigitalThreadRunning: () => this.isDigitalThreadRunning,
      setIsDigitalThreadRunning: (running) => {
        this.isDigitalThreadRunning = running;
      },
      getPolyglotProviders: () => this.getPolyglotProviders(),
      applyDiagnosticFilters: (diags) => this.applyDiagnosticFilters(diags),
      requestCodeLensRefresh: (delayMs) => this.requestCodeLensRefresh(delayMs),
    };
  }

  public mergeDigitalThreadDiagnostics(diagsByUri: Map<string, Diagnostic[]>): void {
    mergeDigitalThreadDiagnosticsImpl(this.getDigitalThreadContext(), diagsByUri);
  }

  private digitalThreadTimer: ReturnType<typeof setTimeout> | null = null;
  private isDigitalThreadRunning = false;
  private polyglotProvidersPromise: Promise<Record<string, unknown>> | null = null;

  private getPolyglotProviders(): Promise<Record<string, unknown>> {
    if (!this.polyglotProvidersPromise) {
      this.polyglotProvidersPromise = loadPolyglotCoordinatorProviders();
    }
    return this.polyglotProvidersPromise;
  }

  /**
   * Schedules debounced cross-file digital thread validation on editor changes whenever the workspace
   * contains multiple languages or `@twin:` / `@port_map:` / `@mesh_source:` directives.
   */
  public scheduleDigitalThreadValidation(triggerUri: string, delayMs = 700): void {
    const openDocs = this.documentManager?.documents?.all?.() ?? [];
    if (openDocs.length < 2 && this.digitalThreadDiagnosticsByUri.size === 0) {
      const doc = this.documentManager?.documents?.get?.(triggerUri);
      const docText = doc?.getText?.() ?? "";
      const hasDirective =
        docText.includes("@twin:") ||
        docText.includes("@port_map:") ||
        docText.includes("@mesh_source:") ||
        docText.includes("annotation(twin");
      const unifiedWs = this.workspaceManager?.unifiedWorkspace as
        { getAllDocumentEntries?: () => Array<{ uri?: string; text?: string }> } | undefined;
      const indexedCount = unifiedWs?.getAllDocumentEntries ? unifiedWs.getAllDocumentEntries().length : 0;
      if (!hasDirective && indexedCount < 2) {
        return;
      }
    }
    if (this.digitalThreadTimer) {
      clearTimeout(this.digitalThreadTimer);
      this.digitalThreadTimer = null;
    }
    this.digitalThreadTimer = setTimeout(() => {
      this.digitalThreadTimer = null;
      void this.runLiveDigitalThreadValidation(triggerUri);
    }, delayMs);
  }

  /**
   * Runs live cross-file polyglot digital thread validation across open, indexed, and disk-sibling files,
   * updating `digitalThreadDiagnosticsByUri` without clobbering per-document diagnostics.
   */
  public async runLiveDigitalThreadValidation(triggerUri: string): Promise<void> {
    await runLiveDigitalThreadValidationImpl(this.getDigitalThreadContext(), triggerUri);
  }

  /**
   * Runs formal abstract interpretation over Modelica `algorithm` sections to prove absence of
   * runtime defects (division by zero, array out-of-bounds, uninitialized reads) or emit diagnostics.
   */
  public async postValidateModelicaAbstractInterpretation(
    effectiveUri: string,
    textDocument: TextDocument,
    diagnostics: Diagnostic[],
  ): Promise<void> {
    await postValidateModelicaAbstractInterpretationImpl(
      this.getVerificationContext(),
      effectiveUri,
      textDocument,
      diagnostics,
    );
  }

  /** Per-class DAE verification results keyed by `<uri>#<class>`; valid while the DAE fingerprint matches (K5). */
  private daeVerificationCache = new Map<string, { fingerprint: string; record: unknown }>();

  /** Wall-clock budget (ms) for keystroke-tier DAE verification of one document. Classes beyond it are left unverified. */
  public daeVerificationBudgetMs = process.env["TEST_TIMEOUT"] || process.env["CI"] ? 5000 : 150;

  /**
   * Flattens a Modelica class through the canonical arena pipeline
   * (`sharedContext.flattenArena` -> `ArenaQueryFlattener`). Returns `null` when flattening is
   * unavailable or fails; callers then report nothing instead of guessing from source text (K6).
   */
  protected flattenModelicaClassForVerification(name: string, symbolId: number, uri: string): unknown | null {
    const ctx = this.parserService?.sharedContext as
      { flattenArena?: (n: string, id: number, u: string, opts: { deadlineMs: number }) => unknown } | undefined;
    if (!ctx || typeof ctx.flattenArena !== "function") return null;
    try {
      return (
        ctx.flattenArena(name, symbolId, uri, {
          deadlineMs: Date.now() + Math.max(50, this.daeVerificationBudgetMs),
        }) ?? null
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.connection.console.debug?.(`[verification] Could not flatten '${name}' (${uri}): ${msg}`);
      return null;
    }
  }

  /**
   * Lists the model/block/class definitions of a document from the symbol index (no text scanning).
   */
  protected listModelicaClassesForUri(uri: string): Array<{
    name: string;
    symbolId: number;
    startOffset: number;
    endOffset: number;
  }> {
    const engine = (this.workspaceManager?.globalModelicaQueryEngine ??
      this.workspaceManager?.getQueryEngine?.("modelica")) as { index?: SymbolIndex } | undefined;
    const symbols = engine?.index?.symbols;
    if (!symbols) return [];
    const norm = (u: string | undefined) => (u ? u.replace(/^([a-z0-9+-]+):\/{1,3}/i, "$1:///") : "");
    const target = norm(uri);
    const out: Array<{
      name: string;
      symbolId: number;
      startOffset: number;
      endOffset: number;
    }> = [];
    for (const [id, entry] of symbols.entries()) {
      if (norm(entry.resourceId) !== target) continue;
      if (entry.kind !== "Class" && entry.kind !== "Def") continue;
      const classKind = (entry.metadata?.["classKind"] as string | undefined) ?? "class";
      if (classKind !== "model" && classKind !== "block" && classKind !== "class") continue;
      const startOff = entry.startOffset ?? 0;
      const endOff = entry.endOffset ?? 0;
      out.push({
        name: entry.name,
        symbolId: id,
        startOffset: startOff,
        endOffset: endOff,
      });
    }
    out.sort((a, b) => a.startOffset - b.startOffset);
    return out;
  }

  /**
   * Flattens Modelica classes in the document, performs BLT transformation, and runs
   * `DaeBltReachabilityEngine` and `HybridModeConsistencyVerifier` within `daeVerificationBudgetMs`.
   */
  public async postValidateModelicaDaeReachability(
    effectiveUri: string,
    textDocument: TextDocument,
    diagnostics: Diagnostic[],
  ): Promise<void> {
    await postValidateModelicaDaeReachabilityImpl(
      this.getVerificationContext(),
      effectiveUri,
      textDocument,
      diagnostics,
    );
  }

  /**
   * Checks if a SysML v2 document contains verification or analysis cases and schedules automatic verification.
   */
  private checkAutoVerify(effectiveUri: string): void {
    if (this.workspaceManager.unifiedWorkspace) {
      try {
        const doc = this.documentManager.documents.get(effectiveUri);
        const currentText = doc?.getText() ?? this.lastIndexedText.get(effectiveUri);
        if (currentText !== undefined && this.lastAutoVerifiedText.get(effectiveUri) === currentText) {
          return;
        }
        const udb = this.workspaceManager.unifiedWorkspace.getIndex();
        const docSymbolIds = udb.symbolsByResource?.get(effectiveUri);
        let hasVerifyCases = false;
        if (docSymbolIds) {
          for (const id of docSymbolIds) {
            const s = udb.symbols.get(id);
            if (
              s &&
              (s.ruleName === "VerifyRequirementUsage" ||
                s.ruleName === "AnalysisCaseDefinition" ||
                s.ruleName === "AnalysisCaseUsage" ||
                s.ruleName === "VerificationCaseDefinition" ||
                s.ruleName === "VerificationCaseUsage")
            ) {
              hasVerifyCases = true;
              break;
            }
          }
        }
        if (hasVerifyCases) {
          if (currentText !== undefined) {
            this.lastAutoVerifiedText.set(effectiveUri, currentText);
          }
          if (this.verificationTimer) clearTimeout(this.verificationTimer);
          const verifyUri = effectiveUri;
          this.verificationTimer = setTimeout(() => {
            this.connection.console.log(`[auto-verify] Triggering verification for ${verifyUri}`);
            this.runVerificationForUri(verifyUri).catch(() => {});
          }, 1000);
        }
      } catch {
        // Ignore — auto-verify is best-effort
      }
    }
  }

  /**
   * Builds the verification context shared by extracted Modelica/SysML verification helpers.
   */
  private getVerificationContext(): ModelicaVerificationContext {
    return {
      connection: this.connection,
      documentManager: this.documentManager,
      parserService: this.parserService,
      workspaceManager: this.workspaceManager,
      documentLSPBridges: this.documentLSPBridges,
      modelicaProofResultsByUri: this.modelicaProofResultsByUri,
      modelicaDaeVerificationResultsByUri: this.modelicaDaeVerificationResultsByUri,
      daeVerificationResultsByUri: this.daeVerificationResultsByUri,
      verificationDiagnosticsByUri: this.verificationDiagnosticsByUri,
      verificationResultsByUri: this.verificationResultsByUri,
      daeVerificationCache: this.daeVerificationCache,
      parsedSysmlReqsCache: this.parsedSysmlReqsCache,
      lastAutoVerifiedText: this.lastAutoVerifiedText,
      activeStandardOverrides: this.activeStandardOverrides,
      daeVerificationBudgetMs: this.daeVerificationBudgetMs,
      formalVerificationOnSave: Boolean(this.diagnosticsConfig.formalVerificationOnSave),
      getActiveVerification: () => this.activeVerification,
      setActiveVerification: (ctrl) => {
        this.activeVerification = ctrl;
      },
      requestCodeLensRefresh: (delayMs) => this.requestCodeLensRefresh(delayMs),
      emitVerificationStatus: (u) => this.emitVerificationStatus(u),
      listModelicaClassesForUri: (u) => this.listModelicaClassesForUri(u),
      flattenModelicaClassForVerification: (name, symbolId, u) =>
        this.flattenModelicaClassForVerification(name, symbolId, u),
      extractArenaStringParams: (arena) =>
        this.extractArenaStringParams(arena as Parameters<ValidationService["extractArenaStringParams"]>[0]),
      findRangeForIri: (iri, currentUri) => this.findRangeForIri(iri, currentUri),
      validateTextDocument: (doc) => this.validateTextDocument(doc),
    };
  }

  /**
   * Populates lightweight top-level class instance wrappers in `workspaceManager` for project and library tree views.
   */
  private populateClassWrappers(
    effectiveUri: string,
    uri: string,
    unifiedIndex: SymbolIndex,
    engine: { toQueryDB?: () => unknown } | null | undefined,
    context: unknown,
  ): void {
    populateClassWrappersImpl(this.workspaceManager, effectiveUri, uri, unifiedIndex, engine, context);
  }

  /**
   * Executes SysML v2 verification cases in `uri` by flattening and simulating linked Modelica models
   * and evaluating requirement constraints against simulated trajectories.
   */
  async runVerificationForUri(
    uri: string,
    progressReporter?: LspWorkDoneProgressReporter,
  ): Promise<{ ok: boolean; error?: string | undefined }> {
    return runVerificationForUriImpl(this.getVerificationContext(), uri, progressReporter);
  }

  /**
   * Resolves an ontology IRI or qualified symbol name to a 0-based line/character range within `currentUri`.
   */
  private findRangeForIri(
    iri: string,
    currentUri: string,
  ): { start: { line: number; character: number }; end: { line: number; character: number } } | null {
    return findRangeForIriImpl(
      { workspaceManager: this.workspaceManager, documentManager: this.documentManager },
      iri,
      currentUri,
    );
  }

  /**
   * Locates the workspace URI and 0-based source range where the given ontology IRI or symbol is declared.
   */
  public findDeclarationLocation(iri: string): {
    uri: string;
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
  } | null {
    return findDeclarationLocationImpl(
      {
        workspaceManager: this.workspaceManager,
        documentManager: this.documentManager,
        parserService: this.parserService,
      },
      iri,
    );
  }
}
