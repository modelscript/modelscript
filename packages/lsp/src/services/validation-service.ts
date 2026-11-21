// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-unused-vars */
// ts-check
import { Connection, Diagnostic, DiagnosticSeverity, Range } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { DocumentManager } from "./document-manager.js";
import { ParserService } from "./parser-service.js";
import { hasWorkspaceLinter, runWorkspaceLinterForDocument } from "./workspace-linter-dispatch.js";
import { WorkspaceManager } from "./workspace-manager.js";

import { parseXmlSync } from "@modelscript/dsl/xml";
import {
  countModelicaInputPrimitives,
  getModelicaErrorCodeDef,
  type ModelicaReconcileView,
  parseModelicaEquationsForVariablesCounts,
  reconcileModelicaCstDiagnostics,
  resolveModelicaTypeInWorkspace,
  resolveModelicaVariableInWorkspace,
} from "@modelscript/modelica";
import {
  type CorrespondenceDiagnostic,
  ExprKind,
  extractCrossLanguageLinks,
  isTypeLikeSymbol,
  PolyglotDriftChecker,
  type PolyglotModelSource,
  PolyglotTransformer,
  QueryEngine,
  SemanticAxiomProjector,
  splitQualifiedPath,
  type SymbolEntry,
  symbolEntryToPolyglotNode,
  type SymbolIndex,
  type SyntaxNode,
  type UnifiedWorkspace,
  VerificationRunner,
} from "@modelscript/runtime";
import { simulateArena } from "@modelscript/simulate";
import { LSPBridge, PositionIndex } from "../lsp-bridge.js";
import { ThreadDiagnosticsProvider } from "../providers/threadDiagnosticsProvider.js";
import { getArenaParameterInfo } from "../utils/arena-utils.js";
import {
  computeTreeEdit,
  type CstNodeLike,
  type CstTreeLike,
  isLargeXmlForWasm,
  isWasmTreeActiveInFacade,
  parseXmlFallbackTree,
  type XmlFallbackTree,
} from "../utils/ast-utils.js";
import { LspWorkDoneProgressReporter } from "../utils/progress-reporter.js";
import {
  computeRequirementsFingerprint,
  filterRequirementsForModel,
  resolveActiveComplianceProfiles,
  type SysmlDocSource,
  type TaggedSysmlRequirement,
} from "./compliance-profile-service.js";
import { ReasonerService } from "./reasoner-service.js";

import { globalLanguageRegistry, type LanguagePlugin } from "../registry/LanguageRegistry.js";
import { loadPolyglotCoordinatorProviders } from "./polyglot-coordinator-loader.js";

export interface WasmLintDiagnostic {
  startOffset?: number;
  endOffset?: number;
  range?: Range;
  message?: string;
  code?: string | number;
  lintName?: string;
  severity?: number;
}

interface EngineLintDiagnosticLike {
  startOffset: number;
  endOffset: number;
  severity: "error" | "warning" | "info" | string;
  code?: string | number | undefined;
  lintName?: string | undefined;
  message: string;
}

type ValidationQueryEngine = QueryEngine & {
  preflight?: (symbolIds: number[], phases: string[]) => Promise<void> | void;
  setCancellationChecker?: (fn: (() => boolean) | null, pollInterval?: number) => void;
  runAllLintsAsync?: (
    uri: string,
    shouldYield: () => Promise<boolean>,
    viewport?: { startOffset?: number | undefined; endOffset?: number | undefined },
  ) => Promise<EngineLintDiagnosticLike[]>;
};

interface SharedContextWorkspaceBridge {
  attachExternalUnifiedWorkspace?: (uw: UnifiedWorkspace) => void;
  syncExternalWorkspace?: () => void;
  __attachedExternalUw?: unknown;
}

interface PolyglotTreeLike {
  rootNode?: SyntaxNode | null | undefined;
}

function isWsChar(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\n" || ch === "\f" || ch === "\v";
}

function findFirstNonWsIndex(line: string): number {
  for (let i = 0; i < line.length; i++) {
    if (!isWsChar(line[i]!)) return i;
  }
  return -1;
}

function isAsciiLetter(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

function isIdentStartChar(ch: string): boolean {
  return isAsciiLetter(ch) || ch === "_";
}

function isWordTokenChar(ch: string): boolean {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  return isIdentStartChar(ch) || (c >= 48 && c <= 57);
}

function isChainTokenChar(ch: string): boolean {
  return isWordTokenChar(ch) || ch === "." || ch === ":";
}

function extractDigitsOnly(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 48 && c <= 57) out += s[i]!;
  }
  return out;
}

function splitLinesPreserve(text: string): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 10) {
      const end = i > start && text.charCodeAt(i - 1) === 13 ? i - 1 : i;
      lines.push(text.slice(start, end));
      start = i + 1;
    }
  }
  lines.push(text.slice(start));
  return lines;
}

function stripFileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

function findNextWordMatchIndex(text: string, word: string, fromIndex = 0): number {
  if (!word) return -1;
  const checkStart = isWordTokenChar(word[0]!);
  const checkEnd = isWordTokenChar(word[word.length - 1]!);
  let idx = text.indexOf(word, fromIndex);
  while (idx !== -1) {
    const beforeOk = !checkStart || idx === 0 || !isWordTokenChar(text[idx - 1]!);
    const afterPos = idx + word.length;
    const afterOk = !checkEnd || afterPos === text.length || !isWordTokenChar(text[afterPos]!);
    if (beforeOk && afterOk) return idx;
    idx = text.indexOf(word, idx + 1);
  }
  return -1;
}

function hasWordMatch(text: string, word: string): boolean {
  return findNextWordMatchIndex(text, word, 0) !== -1;
}

function hasConnectCallPrefix(stmtPrefix: string): boolean {
  let pos = 0;
  while (pos < stmtPrefix.length) {
    const idx = findNextWordMatchIndex(stmtPrefix, "connect", pos);
    if (idx === -1) return false;
    let p = idx + "connect".length;
    while (p < stmtPrefix.length && isWsChar(stmtPrefix[p]!)) p++;
    if (stmtPrefix[p] === "(") return true;
    pos = idx + "connect".length;
  }
  return false;
}

function collectCstNodesByTypes(root: SyntaxNode | null | undefined, types: string[]): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  if (!root) return out;
  const typeSet = new Set(types);
  const visit = (n: SyntaxNode) => {
    if (typeSet.has(n.type)) out.push(n);
    for (const ch of n.children || []) visit(ch);
  };
  visit(root);
  return out;
}

function stripLeadingKeywordPrefixes(text: string, phrases: string[]): string {
  const trimmed = text.trimStart();
  for (const phrase of phrases) {
    const words = phrase.split(" ").filter(Boolean);
    let p = 0;
    let matched = true;
    for (let wIdx = 0; wIdx < words.length; wIdx++) {
      const w = words[wIdx]!;
      while (p < trimmed.length && isWsChar(trimmed[p]!)) p++;
      if (!trimmed.startsWith(w, p)) {
        matched = false;
        break;
      }
      p += w.length;
      if (p >= trimmed.length || !isWsChar(trimmed[p]!)) {
        matched = false;
        break;
      }
      while (p < trimmed.length && isWsChar(trimmed[p]!)) p++;
    }
    if (matched) return trimmed.slice(p);
  }
  return text;
}

function extractLeadingNumericAfterEquals(text: string): number | null {
  const eq = text.indexOf("=");
  if (eq === -1) return null;
  let p = eq + 1;
  while (p < text.length && isWsChar(text[p]!)) p++;
  const start = p;
  let sawDigit = false;
  while (p < text.length) {
    const c = text.charCodeAt(p);
    if (c >= 48 && c <= 57) {
      sawDigit = true;
      p++;
    } else if (text[p] === ".") {
      p++;
    } else {
      break;
    }
  }
  if (!sawDigit) return null;
  const num = parseFloat(text.slice(start, p));
  return Number.isFinite(num) ? num : null;
}

function extractParameterRealLine(line: string, targetName: string): { value: number; nameCol: number } | null {
  let p = 0;
  const skipWs = () => {
    while (p < line.length && isWsChar(line[p]!)) p++;
  };
  const expectWord = (w: string): number | null => {
    skipWs();
    if (!line.startsWith(w, p)) return null;
    const end = p + w.length;
    if (end < line.length && isWordTokenChar(line[end]!)) return null;
    const start = p;
    p = end;
    return start;
  };
  if (expectWord("parameter") === null) return null;
  if (expectWord("Real") === null) return null;
  const nameCol = expectWord(targetName);
  if (nameCol === null) return null;
  skipWs();
  if (line[p] !== "=") return null;
  p++;
  skipWs();
  const start = p;
  let sawDigit = false;
  while (p < line.length) {
    const c = line.charCodeAt(p);
    if (c >= 48 && c <= 57) {
      sawDigit = true;
      p++;
    } else if (line[p] === ".") {
      p++;
    } else {
      break;
    }
  }
  if (!sawDigit) return null;
  const value = parseFloat(line.slice(start, p));
  return Number.isFinite(value) ? { value, nameCol } : null;
}

const isXmlTagIdentChar = (ch: string) => isWordTokenChar(ch) || ch === ":" || ch === "-";
const isGeneralTokenChar = (ch: string) => isChainTokenChar(ch) || ch === "-";

function measureSyntaxTokenLength(lineText: string, startCol: number): number {
  if (startCol >= lineText.length) return 0;
  const ch = lineText[startCol]!;
  if (ch === "<") {
    let p = startCol + 1;
    if (lineText[p] === "/") p++;
    const tagStart = p;
    while (p < lineText.length && isXmlTagIdentChar(lineText[p]!)) p++;
    if (p > tagStart) return p - startCol;
  }
  if (ch === "[") {
    const close = lineText.indexOf("]", startCol + 1);
    if (close !== -1) return close - startCol + 1;
  }
  if (ch === "$") {
    let p = startCol + 1;
    while (p < lineText.length && isWordTokenChar(lineText[p]!)) p++;
    if (p > startCol + 1) return p - startCol;
  }
  let p = startCol;
  while (p < lineText.length && isGeneralTokenChar(lineText[p]!)) p++;
  return p - startCol;
}

import {
  deduplicateAllDiagnostics,
  extractCanonicalErrorInfo,
  SemanticDiagnosticLineIndex,
  tryDeduplicateOrMergeSemanticDiagnostic,
} from "./diagnostic-dedup.js";
export {
  deduplicateAllDiagnostics,
  extractCanonicalErrorInfo,
  SemanticDiagnosticLineIndex,
  tryDeduplicateOrMergeSemanticDiagnostic,
};

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
  public verificationResultsByUri = new Map<string, any[]>();
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
  public modelicaProofResultsByUri = new Map<string, Map<string, any>>();
  /** Cached Modelica DAE reachability and BLT verification results per URI and class name. */
  public modelicaDaeVerificationResultsByUri = new Map<string, Map<string, any>>();
  /** Cached polyglot DAE reachability and BLT verification results per URI and model/class name. */
  public daeVerificationResultsByUri = new Map<string, Map<string, any>>();
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
  private parsedSysmlReqsCache = new Map<string, { text: string; reqs: any[] }>();
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
    if (typeof this.connection?.sendNotification !== "function") return;
    const effectiveUri = uri.startsWith("modelscript-lib://global")
      ? "file://" + uri.substring("modelscript-lib://global".length)
      : uri;
    const proofMap = this.modelicaProofResultsByUri.get(uri) ?? this.modelicaProofResultsByUri.get(effectiveUri);
    const daeMap =
      this.modelicaDaeVerificationResultsByUri.get(uri) ?? this.modelicaDaeVerificationResultsByUri.get(effectiveUri);
    const sysmlResults = this.verificationResultsByUri.get(uri) ?? this.verificationResultsByUri.get(effectiveUri);

    let provenCount = 0;
    let unprovenCount = 0;
    let defectCount = 0;
    let unboundedVariables = 0;
    const markers: Array<{ line: number; status: "proven" | "unproven" | "defect"; label: string }> = [];

    const doc = this.documentManager?.documents?.get?.(uri) ?? this.documentManager?.documents?.get?.(effectiveUri);
    const docText = doc?.getText?.() ?? this.documentManager?.documentTrees?.get?.(uri)?.text ?? "";
    const lines = docText ? splitLinesPreserve(docText) : [];
    const findDeclLine = (name: string): number => {
      if (!name || lines.length === 0) return 0;
      const re = new RegExp(
        `\\b(model|block|function|class|record|connector|package)\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      );
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i]!)) return i;
      }
      return 0;
    };

    if (proofMap) {
      for (const [name, proof] of proofMap.entries()) {
        const hasDef = (proof?.definiteBugs?.length ?? 0) > 0;
        const hasPot = (proof?.potentialBugs?.length ?? 0) > 0;
        const status: "proven" | "unproven" | "defect" = hasDef ? "defect" : hasPot ? "unproven" : "proven";
        if (status === "defect") defectCount++;
        else if (status === "unproven") unprovenCount++;
        else provenCount++;
        const label =
          status === "defect"
            ? `${name}: ${proof.definiteBugs.length} formal defect(s)`
            : status === "unproven"
              ? `${name}: ${proof.potentialBugs.length} unproven condition(s)`
              : `${name}: formally verified (0 RTEs)`;
        markers.push({ line: findDeclLine(name), status, label });
      }
    }

    if (daeMap) {
      for (const [name, dae] of daeMap.entries()) {
        const issues: any[] = dae?.issues ?? [];
        const hasDef = issues.some((i) => i.severity === "definite");
        const hasWarn = issues.length > 0 || dae?.verdict?.kind !== "proven";
        const status: "proven" | "unproven" | "defect" = hasDef ? "defect" : hasWarn ? "unproven" : "proven";
        if (status === "defect") defectCount++;
        else if (status === "unproven") unprovenCount++;
        else provenCount++;
        if (typeof dae?.unboundedVariables === "number") {
          unboundedVariables += dae.unboundedVariables;
        }
        const label =
          status === "defect"
            ? `${name}: DAE formal defect`
            : status === "unproven"
              ? `${name}: DAE inconclusive (${dae?.unboundedVariables ?? 0} unbounded)`
              : `${name}: DAE proven singularity-free`;
        markers.push({ line: findDeclLine(name), status, label });
      }
    }

    if (Array.isArray(sysmlResults) && sysmlResults.length > 0) {
      for (const r of sysmlResults) {
        if (r?.isSatisfied) provenCount++;
        else defectCount++;
      }
    }

    try {
      this.connection.sendNotification("modelscript/verificationStatus", {
        uri,
        provenCount,
        unprovenCount,
        defectCount,
        unboundedVariables,
        markers,
      });
    } catch {
      // Non-fatal notification
    }
  }

  /**
   * Returns true once all declared project library dependencies have been loaded into the workspace.
   */
  get dependenciesReady(): boolean {
    return this.declaredDependencies.every((dep) => this.loadedDependencies.has(`${dep.name}@${dep.version}`));
  }

  /**
   * Marks a project dependency (`name@version`) as loaded and triggers full re-validation
   * of all open documents once all declared dependencies are ready.
   */
  markDependencyLoaded(name: string, version: string): void {
    this.loadedDependencies.add(`${name}@${version}`);
    if (this.dependenciesReady) {
      (globalThis as any).clearDiagramCache?.();
      (globalThis as any).clearIconCache?.();
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
    if (
      this.workspaceManager?.hypergraph &&
      typeof (this.workspaceManager.hypergraph as any).addListener === "function"
    ) {
      (this.workspaceManager.hypergraph as any).addListener((event: any) => {
        try {
          this.connection.sendNotification("modelscript/threadStatusChanged", event);
        } catch {}
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
    const g = globalThis as any;
    if (g.projectTreeChangedTimer) {
      g.projectTreeChangedPending = true;
      return;
    }
    this.connection.sendNotification("modelscript/projectTreeChanged");
    g.projectTreeChangedTimer = setTimeout(() => {
      g.projectTreeChangedTimer = null;
      if (g.projectTreeChangedPending) {
        g.projectTreeChangedPending = false;
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
    this.reasonerDiagnosticsByUri.delete(uri);
    this.reasonerDiagnosticsByUri.delete(eff);
    this.digitalThreadDiagnosticsByUri.delete(uri);
    this.digitalThreadDiagnosticsByUri.delete(eff);
    this.lastAutoVerifiedText.delete(uri);
    this.lastAutoVerifiedText.delete(eff);
    this.parsedSysmlReqsCache.delete(uri);
    this.parsedSysmlReqsCache.delete(eff);

    // Retract registered axioms from owl2Store and update reasoner
    const store = this.workspaceManager?.unifiedWorkspace?.owl2Store;
    if (store && typeof (store as any).setAxioms === "function") {
      const keysToClear: string[] = [];
      if ((store as any)._axiomsBySource instanceof Map) {
        for (const k of (store as any)._axiomsBySource.keys()) {
          if (k === uri || k === eff || k.endsWith(`:${uri}`) || k.endsWith(`:${eff}`)) {
            keysToClear.push(k);
          }
        }
      } else {
        keysToClear.push(uri, eff);
      }

      for (const k of keysToClear) {
        const delta = (store as any).setAxioms(k, []);
        if (typeof (store as any).clearAxioms === "function") {
          (store as any).clearAxioms(k);
        }
        if (delta && this.reasonerService?.updateAndReason) {
          this.reasonerService.updateAndReason(new Map(), delta);
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
    rootNode: any,
    textDocument: TextDocument,
    plugin?: LanguagePlugin,
  ): { syntaxDiags: Diagnostic[]; wasmLintDiags: WasmLintDiagnostic[] } {
    const t0 = performance.now();
    const syntaxDiags: Diagnostic[] = [];
    const wasmLintDiags: WasmLintDiagnostic[] = [];
    if (!rootNode) return { syntaxDiags, wasmLintDiags };

    const clampRangeToLine = (r: Range): Range => {
      if (r.end.line <= r.start.line) {
        if (r.start.character === r.end.character) {
          return { start: r.start, end: { line: r.start.line, character: r.start.character + 1 } };
        }
        return r;
      }
      const nextLineOffset = textDocument.offsetAt({ line: r.start.line + 1, character: 0 });
      const rawLineText = textDocument.getText({
        start: r.start,
        end: textDocument.positionAt(nextLineOffset),
      });
      const trimmedLen = rawLineText.trimEnd().length;
      const clampedChar = trimmedLen > 0 ? r.start.character + trimmedLen : r.start.character + 1;
      return {
        start: r.start,
        end: { line: r.start.line, character: clampedChar },
      };
    };

    const pushSyntaxRange = (
      range: Range,
      message: string,
      source = plugin?.name ? plugin.name.toLowerCase() : "modelscript",
    ) => {
      if (range.end.line <= range.start.line) {
        syntaxDiags.push({
          severity: DiagnosticSeverity.Error,
          range: clampRangeToLine(range),
          message,
          source,
        });
        return;
      }
      // If multi-line syntax error range, emit a diagnostic for each non-empty line in the range
      // so squiggly lines appear on each affected line instead of being clamped away to line 1
      for (let line = range.start.line; line <= range.end.line; line++) {
        const nextLineOffset = textDocument.offsetAt({ line: line + 1, character: 0 });
        const lineText = textDocument.getText({
          start: { line, character: 0 },
          end: textDocument.positionAt(nextLineOffset),
        });
        const trimmed = lineText.trim();
        if (!trimmed) continue;
        const startChar = line === range.start.line ? range.start.character : findFirstNonWsIndex(lineText);
        const endChar =
          line === range.end.line ? Math.max(range.end.character, startChar + 1) : lineText.trimEnd().length;
        if (endChar > startChar) {
          syntaxDiags.push({
            severity: DiagnosticSeverity.Error,
            range: {
              start: { line, character: Math.max(0, startChar) },
              end: { line, character: Math.max(startChar + 1, endChar) },
            },
            message,
            source,
          });
        }
      }
    };

    const treeMeta = rootNode?.tree as
      | {
          __isXmlCstFallback?: boolean;
          __xmlErrors?: Array<{ start: number; end: number; message: string }>;
        }
      | undefined;
    if (treeMeta?.__isXmlCstFallback) {
      if (Array.isArray(treeMeta.__xmlErrors)) {
        for (const err of treeMeta.__xmlErrors) {
          pushSyntaxRange(
            {
              start: textDocument.positionAt(err.start),
              end: textDocument.positionAt(Math.max(err.start, err.end)),
            },
            err.message || "XML syntax error",
          );
        }
      }
      return { syntaxDiags, wasmLintDiags };
    }

    // 1. Native WASM GLR parser diagnostics
    const facade = plugin?.facade ?? rootNode?.tree?.facade ?? this.parserService.facade;
    if (facade && typeof facade.getDiagnostics === "function") {
      try {
        const rootPtr = rootNode.id ?? rootNode.ptr ?? rootNode?.tree?.rootPtr ?? 0;
        if (rootPtr) {
          const docText = textDocument ? textDocument.getText() : (rootNode?.tree?.sourceCode ?? "");
          if (docText && typeof facade.loadSource === "function") {
            facade.loadSource(docText);
          }
          const wasmDiags = facade.getDiagnostics(rootPtr, 0, 0, docText);
          if (Array.isArray(wasmDiags)) {
            for (const d of wasmDiags) {
              const isSyntax = !d.code || d.code === "ERROR" || d.code === 1001 || d.code === 1002;
              if (isSyntax) {
                // Syntax Error
                let range = d.range;
                const startOff = d.startOffset;
                const endOff = d.endOffset;
                if (startOff !== undefined && endOff !== undefined) {
                  range = {
                    start: textDocument.positionAt(startOff),
                    end: textDocument.positionAt(endOff),
                  };
                }
                pushSyntaxRange(range, d.message || "Syntax error");
              } else {
                // Lint diagnostics — capture now while WASM state is valid
                wasmLintDiags.push(d);
              }
            }
            const rootHasError = typeof rootNode.hasError === "function" ? rootNode.hasError() : rootNode.hasError;
            if (syntaxDiags.length > 0 || !rootHasError) {
              return { syntaxDiags, wasmLintDiags };
            }
          }
        }
      } catch (e) {
        this.connection.console.error(`[collectSyntaxErrors] error calling facade.getDiagnostics: ${e}`);
      }
    }

    // 2. Fallback: CST tree walk (only if native WASM parser diagnostics unavailable and root has error)
    const hasError = typeof rootNode.hasError === "function" ? rootNode.hasError() : rootNode.hasError;
    if (!hasError) return { syntaxDiags, wasmLintDiags };
    if (typeof rootNode.walk !== "function") return { syntaxDiags, wasmLintDiags };
    const cursor = rootNode.walk();
    let didDescend = true;

    while (didDescend) {
      if (performance.now() - t0 > 1000) {
        this.connection.console.warn(
          `[perf] this.collectSyntaxErrors aborted after ${(performance.now() - t0).toFixed(2)}ms (too many nodes)`,
        );
        break;
      }
      const node = cursor.currentNode;
      const hasErr = typeof node.hasError === "function" ? node.hasError() : node.hasError;
      const isMissing = typeof node.isMissing === "function" ? node.isMissing() : node.isMissing;

      let start = textDocument.positionAt(node.startOffset ?? node.startIndex ?? node.startOffset);
      let end = textDocument.positionAt(node.endOffset ?? node.endIndex ?? node.endOffset);

      if (isMissing) {
        if (start.line === end.line && start.character === end.character) {
          if (node.previousSibling) {
            start = textDocument.positionAt(
              node.previousSibling.startOffset ?? node.previousSibling.startIndex ?? node.previousSibling.startOffset,
            );
            end = textDocument.positionAt(
              node.previousSibling.endOffset ?? node.previousSibling.endIndex ?? node.previousSibling.endOffset,
            );
          } else {
            end = { line: start.line, character: start.character + 1 };
          }
        }
        syntaxDiags.push({
          severity: DiagnosticSeverity.Error,
          range: { start, end },
          message: `Missing syntax element`,
          source: "modelscript",
        });
      } else if (node.type === "ERROR") {
        const textSnippet = textDocument.getText({ start, end });
        pushSyntaxRange(
          { start, end },
          textSnippet ? `Syntax error near '${textSnippet.slice(0, 30)}'` : "Syntax error",
          "modelscript",
        );

        // Don't descend further into this ERROR node's children to prevent duplicate noisy diagnostics
        while (!cursor.gotoNextSibling()) {
          if (!cursor.gotoParent()) {
            didDescend = false;
            break;
          }
        }
        continue;
      }

      if (hasErr) {
        if (cursor.gotoFirstChild()) {
          continue;
        }
      }

      while (!cursor.gotoNextSibling()) {
        if (!cursor.gotoParent()) {
          didDescend = false;
          break;
        }
      }
    }

    const totalMs = performance.now() - t0;
    if (totalMs > 100) {
      this.connection.console.warn(
        `[perf] this.collectSyntaxErrors took ${totalMs.toFixed(2)}ms for ${syntaxDiags.length} diagnostics`,
      );
    }
    return { syntaxDiags, wasmLintDiags };
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
      | { getText?(): string; languageId?: string; positionAt?(offset: number): { line: number; character: number } },
    plugin?: LanguagePlugin,
    currentText?: string,
    bridge?: unknown,
  ): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    if (!wasmLintDiags || wasmLintDiags.length === 0) return diagnostics;

    const text =
      currentText ?? (textDocument && typeof textDocument.getText === "function" ? textDocument.getText() : "");
    const langId = plugin?.id ?? (textDocument?.languageId || "modelica");
    const pluginLints = plugin?.languageDef?.lints;
    const pluginSource = plugin?.name ? plugin.name.toLowerCase() : "modelscript";

    for (const d of wasmLintDiags) {
      const startOff = d.startOffset;
      const endOff = d.endOffset;

      let range = d.range;
      if (startOff !== undefined && endOff !== undefined) {
        const bridgePositions = (
          bridge as { positions?: { rangeFromOffsets?: (start: number, end: number) => Range } } | null | undefined
        )?.positions;
        if (bridgePositions?.rangeFromOffsets) {
          range = bridgePositions.rangeFromOffsets(startOff, endOff);
        } else if (textDocument?.positionAt) {
          range = {
            start: textDocument.positionAt(startOff),
            end: textDocument.positionAt(endOff),
          };
        }
      }
      if (!range) continue;

      if (range.start.line === range.end.line && range.start.character === range.end.character) {
        range = {
          start: range.start,
          end: { line: range.start.line, character: range.start.character + 1 },
        };
      }

      const tokenText =
        startOff !== undefined && endOff !== undefined && endOff > startOff ? text.slice(startOff, endOff).trim() : "";

      let message = d.message;
      const code = d.code;
      type MatchedLintDef = {
        code?: unknown;
        severity?: string;
        message?: (target: { text: string }, extra: { text: string }) => string;
      };
      let matchedLint: MatchedLintDef | null = null;

      if (pluginLints && code) {
        for (const lint of Object.values(pluginLints)) {
          if ((lint as { code?: unknown })?.code === code) {
            matchedLint = lint as MatchedLintDef;
            break;
          }
        }
      }

      const codeNum = typeof code === "number" ? code : typeof code === "string" ? Number(code) : undefined;

      // Modelica M4004: Do not flag models as unbalanced if exogenous 'input' variables account for the difference
      if (codeNum === 4004 && langId === "modelica") {
        let inputCount = 0;
        const docUri = (textDocument as any)?.uri;
        const cachedTree = docUri ? this.documentManager?.documentTrees?.get(docUri) : null;
        const root = cachedTree?.tree?.rootNode;
        if (root) {
          const countInputsInCst = (n: any) => {
            if (!n) return;
            if (n.type === "component_clause" || n.type === "ComponentClause") {
              const hasInput = (n.children || []).some(
                (c: any) => c.type === "input" || (c.type === "type_prefix" && hasWordMatch(c.text ?? "", "input")),
              );
              if (hasInput) {
                const compDecls = (n.children || []).filter(
                  (c: any) => c.type === "component_declaration" || c.type === "declaration",
                );
                inputCount += Math.max(1, compDecls.length);
              }
            }
            for (const ch of n.children || []) {
              countInputsInCst(ch);
            }
          };
          countInputsInCst(root);
        } else {
          inputCount = countModelicaInputPrimitives(text);
        }

        const msgToCheck = message || d.message || "";
        const counts = parseModelicaEquationsForVariablesCounts(msgToCheck);
        if (counts && inputCount > 0) {
          if (counts.eqCount === counts.varCount - inputCount) {
            continue;
          }
        }
      }

      const errorCodes = plugin?.languageDef?.errorCodes as
        | Record<
            string | number,
            { code: number; rule?: string; severity?: string; message: (param: string) => string }
          >
        | undefined;
      const matchedCodeDef =
        codeNum !== undefined ? (errorCodes?.[codeNum] ?? getModelicaErrorCodeDef(codeNum)) : undefined;

      if (
        !message ||
        message.startsWith("Linter Rule ") ||
        message.startsWith("Linter rule ") ||
        message.startsWith("Syntax Error")
      ) {
        if (matchedLint && typeof matchedLint.message === "function") {
          try {
            message = matchedLint.message({ text: tokenText }, { text: "" });
          } catch {
            // Fallback
          }
        }

        if (!message || message.startsWith("Linter Rule ") || message.startsWith("Linter rule ")) {
          if (codeNum === 2001 || codeNum === 2002) {
            message = tokenText ? `Variable '${tokenText}' not found in scope.` : "Variable not found in scope.";
          } else if (codeNum === 2003) {
            message = tokenText
              ? `Class or type '${tokenText}' not found in scope.`
              : "Class or type not found in scope.";
          } else if (codeNum === 3001) {
            message = tokenText
              ? `Type mismatch in binding or modification expression '${tokenText}'.`
              : "Type mismatch in binding.";
          } else if (codeNum === 3009) {
            message = tokenText
              ? `Array index '${tokenText}' has invalid type: expected Integer or Boolean.`
              : "Invalid array index type.";
          } else if (codeNum === 4031) {
            message = tokenText ? `Subscript '${tokenText}' is out of bounds.` : "Array index out of bounds.";
          } else if (codeNum === 5001) {
            message = tokenText ? `Type mismatch in equation '${tokenText}'.` : "Type mismatch in equation.";
          } else if (codeNum === 5005) {
            message = tokenText ? `Division by literal zero in '${tokenText}'.` : "Division by literal zero.";
          } else if (codeNum === 5006) {
            message = tokenText ? `Type mismatch in assignment in '${tokenText}'.` : "Type mismatch in assignment.";
          } else if (matchedCodeDef) {
            try {
              const formatted = matchedCodeDef.message(tokenText || "");
              if (formatted && !formatted.includes("undefined")) {
                message = formatted;
              }
            } catch {
              // Fallback
            }
            if (!message || message.startsWith("Linter Rule ") || message.startsWith("Linter rule ")) {
              const ruleDisplay = matchedCodeDef.rule ? matchedCodeDef.rule.replaceAll("-", " ") : `rule ${code}`;
              const capitalizedRule = ruleDisplay.charAt(0).toUpperCase() + ruleDisplay.slice(1);
              message = tokenText ? `${capitalizedRule} for '${tokenText}'.` : `${capitalizedRule}.`;
            }
          } else {
            message = `Linter rule ${code}`;
          }
        }
      }

      // Determine severity dynamically
      let severity: DiagnosticSeverity = DiagnosticSeverity.Warning;
      const defSeverity = matchedCodeDef?.severity ?? matchedLint?.severity;

      if (d.severity === 1 || defSeverity === "error") {
        severity = DiagnosticSeverity.Error;
      } else if (defSeverity === "info") {
        severity = DiagnosticSeverity.Information;
      } else if (defSeverity === "warning") {
        severity = DiagnosticSeverity.Warning;
      } else if (typeof codeNum === "number" && codeNum >= 1000 && codeNum < 6000) {
        // Standard compiler error code numbering ranges (1xxx-5xxx)
        severity = DiagnosticSeverity.Error;
      }

      const diagCode = code ?? d.lintName;
      diagnostics.push({
        severity,
        range,
        message,
        source: pluginSource,
        ...(diagCode !== undefined ? { code: diagCode } : {}),
      });
    }

    return diagnostics;
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
  public async syncDocumentForDiagram(uri: string, explicitText?: string): Promise<boolean> {
    const effectiveUri = uri.startsWith("modelscript-lib://global")
      ? "file://" + uri.substring("modelscript-lib://global".length)
      : uri;
    const doc = this.documentManager.documents.get(uri) ?? this.documentManager.documents.get(effectiveUri);
    const text = explicitText ?? doc?.getText();
    if (!text) return false;
    const plugin = globalLanguageRegistry.getPluginForUri(uri);
    const langId =
      plugin?.id ??
      (doc?.languageId ||
        (uri.endsWith(".mo") || uri.endsWith(".mos") || uri.endsWith(".msim") ? "modelica" : "sysml2"));
    const isModelica = langId === "modelica";

    let cached = this.documentManager.documentTrees.get(uri) ?? this.documentManager.documentTrees.get(effectiveUri);
    if (!cached?.tree || cached.text !== text) {
      await this.parserService.ensureLanguageParserLoaded(doc?.languageId || uri);
      const parser =
        plugin?.parser ??
        this.parserService.getParserForUri(uri) ??
        (isModelica && this.parserService.isParserReady("modelica")
          ? this.parserService.getParser("modelica")
          : undefined);
      let processedText = text;
      if (plugin?.preprocessText) {
        processedText = plugin.preprocessText(text);
      } else if (typeof (globalThis as any).preprocessLanguageText === "function") {
        processedText = (globalThis as any).preprocessLanguageText(langId, text);
      }

      let releaseLock: () => void = () => {};
      const currentLock = this.wasmParserMutex;
      this.wasmParserMutex = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      await currentLock;

      let tree: any;
      try {
        if (isLargeXmlForWasm(uri, processedText, plugin)) {
          tree =
            cached?.text === text && (cached?.tree as XmlFallbackTree | undefined)?.__isXmlCstFallback
              ? cached.tree
              : parseXmlFallbackTree(processedText);
        } else {
          const oldTree = cached?.tree as unknown as
            | {
                rootPtr?: number;
                rootNode?: { id?: number; tree?: { facade?: unknown } };
                facade?: unknown;
                edit?: (e: unknown) => void;
              }
            | null
            | undefined;
          const activeFacade = (plugin?.facade ??
            oldTree?.facade ??
            oldTree?.rootNode?.tree?.facade ??
            this.parserService.facade) as { lastAstRoot?: number; loadSource?: (text: string) => void } | undefined;
          const isOldTreeActiveInWasm = isWasmTreeActiveInFacade(cached?.tree, activeFacade, uri);

          if (cached?.tree && cached.text !== text && isOldTreeActiveInWasm && parser) {
            const edit = computeTreeEdit(cached.text, text);
            if (typeof oldTree?.edit === "function") {
              oldTree.edit(edit as never);
            }
            tree = parser.parse(processedText, cached.tree, edit.startIndex, edit.oldEndIndex, edit.newEndIndex, uri);
          } else if (parser) {
            tree = (
              parser as unknown as {
                parse(
                  t: string,
                  p?: unknown,
                  a?: number,
                  b?: number,
                  c?: number,
                  u?: string,
                ): ReturnType<NonNullable<typeof parser>["parse"]>;
              }
            ).parse(processedText, null, 0, 0, 0, uri);
          } else if (this.parserService.sharedContext && isModelica) {
            tree = this.parserService.sharedContext.parse(".mo", processedText);
          }
        }
      } finally {
        releaseLock();
      }

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
        this.documentManager.documentTrees.set(uri, docEntry);
        this.documentManager.documentTrees.set(normUri, docEntry);
        this.documentManager.documentTrees.set(oneSlashUri, docEntry);
        cached = docEntry;
      }
    }

    if (!cached?.tree) return false;

    const normUri = uri.replace(/^([a-z0-9+-]+):\/{0,3}/i, "$1:///");
    const oneSlashUri = uri.replace(/^([a-z0-9+-]+):\/{0,3}/i, "$1:/");
    if (this.workspaceManager.unifiedWorkspace) {
      this.workspaceManager.unifiedWorkspace.setDocumentTree(uri, cached.tree);
      this.workspaceManager.unifiedWorkspace.setDocumentTree(normUri, cached.tree);
      this.workspaceManager.unifiedWorkspace.setDocumentTree(oneSlashUri, cached.tree);
      const uDoc =
        this.workspaceManager.unifiedWorkspace.getDocument(uri) ??
        this.workspaceManager.unifiedWorkspace.getDocument(normUri) ??
        this.workspaceManager.unifiedWorkspace.getDocument(oneSlashUri);
      if (uDoc) {
        uDoc.text = text;
        uDoc.tree = cached.tree;
      }
    }

    const prevIndexedText = this.lastIndexedText.get(effectiveUri) ?? this.lastIndexedText.get(uri);
    const hasInstances = Boolean(
      this.workspaceManager.documentInstances.get(uri)?.length ||
      this.workspaceManager.documentInstances.get(effectiveUri)?.length,
    );
    if (prevIndexedText === text && hasInstances) {
      return false;
    }

    const wsIndex = plugin?.workspaceIndex ?? this.workspaceManager.getWorkspaceIndex(langId);
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
            wsIndex.reindexDocument?.(effectiveUri, () => cached!.tree.rootNode, actualEditRanges, totalDelta);
          } else {
            wsIndex.register?.(effectiveUri, () => cached!.tree.rootNode);
          }
          wsIndex.getFileIndex?.(effectiveUri);
        }
        const wsInstances = this.workspaceManager.workspaceInstances;
        if (wsInstances) {
          for (const key of wsInstances.keys()) {
            if (key.startsWith(effectiveUri + "#")) {
              wsInstances.delete(key);
            }
          }
        }
        this.workspaceManager.workspaceInstances.delete(uri);
        this.workspaceManager.workspaceInstances.delete(effectiveUri);
        this.workspaceManager.documentInstances.delete(uri);
        this.workspaceManager.documentInstances.delete(effectiveUri);
        this.lastIndexedText.set(effectiveUri, text);
        this.lastIndexedText.set(uri, text);
      }

      const changedIdsObj = typeof wsIndex.takeGlobalChangedIds === "function" ? wsIndex.takeGlobalChangedIds() : null;
      changedIds = changedIdsObj ? changedIdsObj.changedIds : null;
      structuralChangedIds = changedIdsObj ? (changedIdsObj as any).structuralChangedIds : null;
      changedNames = typeof wsIndex.takeGlobalChangedNames === "function" ? wsIndex.takeGlobalChangedNames() : null;

      if (prevIndexedText !== text && !changedIds) {
        const activeEngine = (plugin?.queryEngine ?? this.workspaceManager.getQueryEngine(langId)) as unknown as {
          disposeDocument?: (u: string) => void;
        } | null;
        if (activeEngine && typeof activeEngine.disposeDocument === "function") {
          activeEngine.disposeDocument(effectiveUri);
          if (uri !== effectiveUri) activeEngine.disposeDocument(uri);
          if (normUri !== effectiveUri && normUri !== uri) activeEngine.disposeDocument(normUri);
        }
      }
    }

    if (this.revalidationTimer) {
      clearTimeout(this.revalidationTimer);
      this.revalidationTimer = null;
    }

    const unifiedIndex = this.workspaceManager.unifiedWorkspace.getIndex();
    const cstTreeWrapper = this.parserService.getSharedCstTreeWrapper();

    let engine = plugin?.queryEngine ?? this.workspaceManager.getQueryEngine(langId);
    if (!engine) {
      engine = this.createDefaultQueryEngine(langId, unifiedIndex, cstTreeWrapper);
      if (engine) {
        this.workspaceManager.setQueryEngine(langId, engine);
      }
    } else {
      if (langId === "modelica") {
        const injectFn = (globalThis as any).injectPredefinedTypes;
        if (typeof injectFn === "function") injectFn(unifiedIndex);
      }
      if (changedIds && typeof (engine as any).swapIndex === "function") {
        (engine as any).swapIndex(unifiedIndex, changedIds, structuralChangedIds || undefined);
      } else if (prevIndexedText !== text && typeof (engine as any).updateIndex === "function") {
        (engine as any).updateIndex(unifiedIndex);
      }
      if (typeof (engine as any).updateTree === "function") {
        (engine as any).updateTree(cstTreeWrapper);
      }
    }

    this.syncWorkspaceStateAfterIndex(effectiveUri, changedIds, structuralChangedIds, changedNames);

    const context = this.parserService.sharedContext;
    if (context && langId === "modelica") {
      if (typeof (context as any).setQueryEngine === "function") context.setQueryEngine(engine);
      else context.queryEngine = engine;
      if (typeof (context as any).setWorkspaceIndex === "function") context.setWorkspaceIndex(wsIndex);
      else context.workspaceIndex = wsIndex;
    }

    const bridge = new LSPBridge(unifiedIndex, engine, new PositionIndex(text), uri, {
      documentLSPBridges: this.documentLSPBridges,
      documents: this.documentManager.documents,
      sharedFs: this.parserService?.sharedContext?.fs ?? this.documentManager?.sharedContext?.fs,
    });
    this.documentLSPBridges.set(uri, bridge as any);

    this.populateClassWrappers(effectiveUri, uri, unifiedIndex, engine, context);
    return true;
  }

  /**
   * Indexes a document directly into `UnifiedWorkspace` using its declarative DSL `indexing.indexFile` hook,
   * registering `languageDef` on the fly if needed.
   */
  private indexNativeDslDocument(uri: string, text: string, langId: string, languageDef?: any): boolean {
    const uw = this.workspaceManager?.unifiedWorkspace;
    if (!uw || typeof uw.indexDocumentText !== "function") return false;
    const def = languageDef ?? globalLanguageRegistry.getPluginById(langId)?.languageDef;
    if (def && typeof uw.getLanguageDef === "function" && !uw.getLanguageDef(langId)) {
      uw.registerLanguageDef(langId, def);
    }
    if (typeof uw.getLanguageDef === "function" && !uw.getLanguageDef(langId) && !def) {
      return false;
    }
    try {
      uw.indexDocumentText(uri, text, langId);
      return true;
    } catch (err: any) {
      this.connection?.console?.warn?.(
        `[validate] Failed to index ${uri} via DSL UnifiedWorkspace (${langId}): ${err?.message ?? err}`,
      );
      return false;
    }
  }

  /**
   * Validates a `TextDocument` by routing to domain-specific validators (STEP, CFD, FEA, SCAD,
   * PSCAD, SSP, CSV, JS/TS sidecars) or running the uniform incremental WASM GLR parse and semantic pipeline.
   */
  public diagnosticsConfig: {
    enabled?: boolean | undefined;
    maxProblems?: number | undefined;
    maxNumberOfProblems?: number | undefined;
    disabledRules?: string[] | undefined;
    crossDomainDrift?: "error" | "warning" | "information" | "off" | undefined;
    formalVerificationOnSave?: boolean | undefined;
    daeSingularityCheck?: boolean | undefined;
    showInformationalBadges?: boolean | undefined;
  } = {};

  /**
   * Applies user diagnostic configuration (`disabledRules`, `crossDomainDrift`, and `maxProblems` / `maxNumberOfProblems`).
   */
  public applyDiagnosticFilters(diagnostics: Diagnostic[]): Diagnostic[] {
    const disabledRaw = this.diagnosticsConfig.disabledRules;
    const disabledSet =
      Array.isArray(disabledRaw) && disabledRaw.length > 0
        ? new Set(disabledRaw.map((r) => String(r).trim().toLowerCase()).filter(Boolean))
        : null;
    const driftMode = this.diagnosticsConfig.crossDomainDrift;
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

    const rawMax = this.diagnosticsConfig.maxProblems ?? this.diagnosticsConfig.maxNumberOfProblems;
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

    const normalizePluginDiagnostics = (rawDiags: any[], sourceId: string): Diagnostic[] => {
      if (!Array.isArray(rawDiags)) return [];
      const lines = splitLinesPreserve(text);
      return rawDiags.map((d: any) => {
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
                  : this.computeTokenEndCharacter(text, line, col)
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
        return {
          severity,
          range,
          code: d.code ?? d.id,
          message: d.message ?? "Diagnostic warning",
          source: d.source ?? sourceId,
        };
      });
    };

    // 1. Check custom validation handler (e.g. for specialized formats)
    if (plugin?.customHandlers?.validate) {
      const revisionAtStart = this.documentRevisions.get(uri) ?? null;
      const isStale = () => revisionAtStart !== null && (this.documentRevisions.get(uri) ?? 0) !== revisionAtStart;
      try {
        await this.parserService?.ensureLanguageParserLoaded?.(plugin.id);
        if (isStale()) return;
        const existingCached = this.documentManager.documentTrees.get(uri);
        const wasmTree = this.parseIncrementalWasmTree(uri, plugin.id, text, plugin);
        const res = await (plugin.customHandlers.validate as (d: TextDocument, t?: unknown) => unknown)(
          textDocument,
          wasmTree ?? undefined,
        );
        if (isStale()) return;
        if (Array.isArray(res)) {
          const diags = normalizePluginDiagnostics(res, plugin.id);
          const head = text
            .slice(0, 512)
            .replace(/^\uFEFF/, "")
            .trimStart();
          const isXmlDoc =
            head.startsWith("<?xml") ||
            /^<!DOCTYPE\b/i.test(head) ||
            (head.startsWith("<") &&
              (/\.(xml|reqif|reqifz|urdf|sdf|xacro|sbml|cellml|sedml|arxml|osim|aml|plcopen|xodr|xosc|qif|sbol|3mf|feb|scl|scd|icd|cid|pscx|owx|rdf)$/i.test(
                uri,
              ) ||
                Boolean((plugin.languageDef as { grammar?: { xmlRules?: unknown } } | undefined)?.grammar?.xmlRules)));
          const usesNativeXmlWasm =
            new Set([
              "autosar",
              "cellml",
              "dicom-rt",
              "febio",
              "igtl",
              "jsbsim",
              "lps",
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
            ]).has(plugin.id) && text.length <= 2 * 1024 * 1024;
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
          const docTree: any = wasmTree ?? { rootNode: { text } };
          this.documentManager.documentTrees.set(uri, {
            text,
            tree: docTree,
            classCache: existingCached?.classCache ?? new Map(),
          });
          const contentChanged = this.lastIndexedText.get(uri) !== text;
          if ((plugin.languageDef as any)?.indexing?.indexFile) {
            this.indexNativeDslDocument(uri, text, plugin.id, plugin.languageDef);
          } else if (plugin.workspaceIndex) {
            try {
              if (typeof (plugin.workspaceIndex as any).indexFile === "function") {
                (plugin.workspaceIndex as any).indexFile(uri, text);
              } else if (typeof (plugin.workspaceIndex as any).addFile === "function") {
                (plugin.workspaceIndex as any).addFile(uri, text);
              }
            } catch (indexErr: any) {
              this.connection.console.warn(
                `[validate] Failed to index ${uri} in plugin workspace: ${indexErr?.message ?? indexErr}`,
              );
            }
          }
          this.lastIndexedText.set(uri, text);
          await this.finalizeCrossLanguageValidation({
            uri,
            effectiveUri: uri,
            text,
            langId: plugin.id,
            tree: docTree,
            textDocument,
            diagnostics: diags,
            hasSyntaxErrors: diags.some((d) => d.severity === DiagnosticSeverity.Error),
            contentChanged,
            isStale,
          });
          return;
        }
      } catch (e: any) {
        this.connection.console.error(`[validate] Custom validation handler failed for ${uri}: ${e.message}`);
        return;
      }
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
      if (plugin?.actionHandlers) {
        const lintKey = Object.keys(plugin.actionHandlers).find((k) => k.startsWith("lint_"));
        if (lintKey && typeof plugin.actionHandlers[lintKey] === "function") {
          try {
            const rawDiags = await plugin.actionHandlers[lintKey](
              { documentText: text, uri },
              { documentText: text, uri },
            );
            const diags = normalizePluginDiagnostics(rawDiags, plugin.id);
            const docTree = { rootNode: { text } } as any;
            this.documentManager.documentTrees.set(uri, {
              text,
              tree: docTree,
              classCache: new Map(),
            });
            const contentChanged = this.lastIndexedText.get(uri) !== text;
            const wsIdx = plugin.workspaceIndex ?? this.workspaceManager.getWorkspaceIndex(plugin.id);
            if ((plugin.languageDef as any)?.indexing?.indexFile) {
              this.indexNativeDslDocument(uri, text, plugin.id, plugin.languageDef);
            } else if (wsIdx) {
              try {
                if (typeof (wsIdx as any).indexFile === "function") {
                  (wsIdx as any).indexFile(uri, text);
                } else if (typeof (wsIdx as any).addFile === "function") {
                  (wsIdx as any).addFile(uri, text);
                }
              } catch (wsErr: any) {
                this.connection.console.warn(
                  `[validate] Failed to index ${uri} in workspace: ${wsErr?.message ?? wsErr}`,
                );
              }
            }
            this.lastIndexedText.set(uri, text);
            await this.finalizeCrossLanguageValidation({
              uri,
              effectiveUri: uri,
              text,
              langId: plugin.id,
              tree: docTree,
              textDocument,
              diagnostics: diags,
              hasSyntaxErrors: diags.some((d) => d.severity === DiagnosticSeverity.Error),
              contentChanged,
            });
            return;
          } catch (e: any) {
            this.connection.console.error(`[validate] Action lint handler ${lintKey} failed for ${uri}: ${e.message}`);
          }
        }
      }
      this.connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: [] });
      return;
    }

    // Pre-process text if needed via plugin hook
    let processedText = text;
    if (plugin?.preprocessText) {
      processedText = plugin.preprocessText(text);
    } else if (typeof (globalThis as any).preprocessLanguageText === "function") {
      processedText = (globalThis as any).preprocessLanguageText(langId, text);
    }

    const oldCached = this.documentManager.documentTrees.get(uri);
    let tree: any;
    let editRanges: Array<{ startOffset: number; endOffset: number }> | undefined;
    let syntaxDiags: Diagnostic[] = [];
    let wasmLintDiags: any[] = [];

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
          const oldTree = oldCached?.tree as unknown as
            | {
                rootPtr?: number;
                rootNode?: { id?: number; tree?: { facade?: unknown } };
                facade?: unknown;
                edit?: (e: unknown) => void;
              }
            | null
            | undefined;
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
              );
            } else if (this.parserService.sharedContext && isModelica) {
              tree = this.parserService.sharedContext.parse(".mo", processedText, oldCached.tree as never, {
                editStart: edit.startIndex,
                editOldEnd: edit.oldEndIndex,
                editNewEnd: edit.newEndIndex,
              });
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
              tree = (
                parser as unknown as {
                  parse(
                    t: string,
                    p?: unknown,
                    a?: number,
                    b?: number,
                    c?: number,
                    u?: string,
                  ): ReturnType<NonNullable<typeof parser>["parse"]>;
                }
              ).parse(processedText, null, 0, 0, 0, uri);
            } else if (this.parserService.sharedContext && isModelica) {
              tree = this.parserService.sharedContext.parse(".mo", processedText);
            }
          }
        }
      } catch (err: any) {
        this.connection.console.error(`[validate] Parser error for ${uri}: ${err.message}`);
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
        this.workspaceManager.unifiedWorkspace.setDocumentTree(uri, tree);
        this.workspaceManager.unifiedWorkspace.setDocumentTree(normUri, tree);
        this.workspaceManager.unifiedWorkspace.setDocumentTree(oneSlashUri, tree);
        const uDoc =
          this.workspaceManager.unifiedWorkspace.getDocument(uri) ??
          this.workspaceManager.unifiedWorkspace.getDocument(normUri) ??
          this.workspaceManager.unifiedWorkspace.getDocument(oneSlashUri);
        if (uDoc) {
          uDoc.text = text;
          uDoc.tree = tree;
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
    const prevPublished = this.lastSemanticDiagnostics.get(uri);
    const cachedSemantic = (prevPublished || []).filter(
      (d) => d.source !== "sysml2-verifier" && (typeof d.code !== "number" || d.code < 1000 || d.code >= 6000),
    );
    const initialDiags = this.applyDiagnosticFilters(
      deduplicateAllDiagnostics([...syntaxDiags, ...wasmLspDiags, ...cachedSemantic]),
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
  public async runUnifiedSemanticPipeline(params: {
    uri: string;
    text: string;
    tree: any;
    editRanges?: Array<{ startOffset: number; endOffset: number }> | undefined;
    baseDiagnostics: Diagnostic[];
    wasmLintDiags?: any[] | undefined;
    revisionAtStart: number | null;
    plugin?: LanguagePlugin | undefined;
    langId: string;
    textDocument?: TextDocument | undefined;
    isSave?: boolean | undefined;
  }): Promise<void> {
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

    const isStale = () => {
      if (revisionAtStart !== null && (this.documentRevisions.get(uri) ?? 0) !== revisionAtStart) return true;
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
      const wsIndex = plugin?.workspaceIndex ?? this.workspaceManager.getWorkspaceIndex(langId);
      const textChanged = this.lastIndexedText.get(effectiveUri) !== text;
      let changedIds: Set<number> | null = null;
      let changedNames: Set<string> | null = null;
      let structuralChangedIds: Set<number> | null = null;

      if (wsIndex) {
        if (textChanged) {
          let actualEditRanges: { startOffset: number; endOffset: number; delta?: number }[] | undefined = editRanges;
          let totalDelta = actualEditRanges ? actualEditRanges.reduce((acc, r) => acc + (r.delta ?? 0), 0) : 0;
          if (!actualEditRanges) {
            const lastText = this.lastIndexedText.get(effectiveUri);
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
              wsIndex.reindexDocument?.(effectiveUri, () => tree.rootNode, actualEditRanges, totalDelta);
            } else {
              wsIndex.register?.(effectiveUri, () => tree.rootNode);
            }
            wsIndex.getFileIndex?.(effectiveUri);
          }
          this.workspaceManager.workspaceInstances.delete(uri);
          this.workspaceManager.workspaceInstances.delete(effectiveUri);
          this.workspaceManager.documentInstances.delete(uri);
          this.workspaceManager.documentInstances.delete(effectiveUri);
          this.lastIndexedText.set(effectiveUri, text);
          const activeEngine = plugin?.queryEngine ?? this.workspaceManager.getQueryEngine(langId);
          if (activeEngine && typeof (activeEngine as any).disposeDocument === "function") {
            (activeEngine as any).disposeDocument(effectiveUri);
            (activeEngine as any).disposeDocument(uri);
            const effNorm = effectiveUri.replace(/^([a-z0-9+-]+):\/{0,3}/i, "$1:///");
            (activeEngine as any).disposeDocument(effNorm);
          }
        }

        const changedIdsObj =
          typeof wsIndex.takeGlobalChangedIds === "function" ? wsIndex.takeGlobalChangedIds() : null;
        changedIds = changedIdsObj ? changedIdsObj.changedIds : null;
        structuralChangedIds = changedIdsObj ? (changedIdsObj as any).structuralChangedIds : null;
        changedNames = typeof wsIndex.takeGlobalChangedNames === "function" ? wsIndex.takeGlobalChangedNames() : null;
      } else if (textChanged && (plugin?.languageDef as any)?.indexing?.indexFile) {
        this.indexNativeDslDocument(effectiveUri, text, plugin?.id ?? langId, plugin?.languageDef);
        this.workspaceManager.workspaceInstances.delete(uri);
        this.workspaceManager.workspaceInstances.delete(effectiveUri);
        this.workspaceManager.documentInstances.delete(uri);
        this.workspaceManager.documentInstances.delete(effectiveUri);
        this.lastIndexedText.set(effectiveUri, text);
      }

      if (isStale()) return;

      // ── Step 2: Cross-File Dependency State Prep ──────────────────────────
      if (this.revalidationTimer) {
        clearTimeout(this.revalidationTimer);
        this.revalidationTimer = null;
      }

      // ── Step 3: Unified Index & QueryEngine Update ───────────────────────
      const unifiedIndex = this.workspaceManager.unifiedWorkspace.getIndex();
      const cstTreeWrapper = this.parserService.getSharedCstTreeWrapper();

      let engine = plugin?.queryEngine ?? this.workspaceManager.getQueryEngine(langId);
      if (!engine) {
        engine = this.createDefaultQueryEngine(langId, unifiedIndex, cstTreeWrapper);
        if (engine) {
          this.workspaceManager.setQueryEngine(langId, engine);
        }
      } else {
        if (plugin?.queryEngine && !this.workspaceManager.getQueryEngine(langId)) {
          this.workspaceManager.setQueryEngine(langId, engine);
        }
        if (langId === "modelica") {
          const injectFn = (globalThis as any).injectPredefinedTypes;
          if (typeof injectFn === "function") injectFn(unifiedIndex);
        }
        if (changedIds && typeof (engine as any).swapIndex === "function") {
          (engine as any).swapIndex(unifiedIndex, changedIds, structuralChangedIds || undefined);
        } else if (textChanged && typeof (engine as any).updateIndex === "function") {
          (engine as any).updateIndex(unifiedIndex);
        }
        if (typeof (engine as any).updateTree === "function") {
          (engine as any).updateTree(cstTreeWrapper);
        }
      }

      this.syncWorkspaceStateAfterIndex(effectiveUri, changedIds, structuralChangedIds, changedNames);

      // Sync parser sharedContext if Modelica
      const context = this.parserService.sharedContext;
      if (context && langId === "modelica") {
        if (typeof (context as any).setQueryEngine === "function") context.setQueryEngine(engine);
        else context.queryEngine = engine;
        if (typeof (context as any).setWorkspaceIndex === "function") context.setWorkspaceIndex(wsIndex);
        else context.workspaceIndex = wsIndex;
      }

      // Create / update LSP bridge
      const currentDoc = this.documentManager.documents.get(uri);
      const currentText = currentDoc ? currentDoc.getText() : text;
      const bridge = new LSPBridge(unifiedIndex, engine, new PositionIndex(currentText), uri, {
        documentLSPBridges: this.documentLSPBridges,
        documents: this.documentManager.documents,
        sharedFs: this.parserService?.sharedContext?.fs ?? this.documentManager?.sharedContext?.fs,
      });
      this.documentLSPBridges.set(uri, bridge as any);

      // Populate class wrappers immediately so diagram edit handlers always see up-to-date CST nodes
      if (textChanged || !this.workspaceManager.documentInstances.get(uri)?.length) {
        this.populateClassWrappers(effectiveUri, uri, unifiedIndex, engine, context);
      }

      await yieldToEventLoop();
      if (isStale()) return;

      // ── Step 4: Preflight Cache Hydration ────────────────────────────────
      const resourceSymbolIds = unifiedIndex.symbolsByResource?.get(effectiveUri);
      const docSymbolCount = resourceSymbolIds ? resourceSymbolIds.length : 0;
      const isWorkspaceFile = !!this.documentManager.documents.get(uri);

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
      const hasError = typeof tree.rootNode.hasError === "function" ? tree.rootNode.hasError() : tree.rootNode.hasError;
      const hasSyntaxErrors = baseDiagnostics.length > 0 || hasError;

      if (hasSyntaxErrors) {
        const cachedSemantic = this.lastSemanticDiagnostics.get(uri) || [];
        newSemanticDiagnostics.push(...cachedSemantic);
      }

      // 5a. WASM Linear Memory CST Linter diagnostics (pre-collected synchronously in collectSyntaxErrors)
      // NOTE: We use the pre-collected wasmLintDiags instead of re-calling facade.getDiagnostics(rootPtr)
      // here because the WASM input buffer may have been overwritten by parsing another document
      // during the async yields above. Using a stale rootPtr with a different input buffer would
      // cause the linter to read garbled text at the old CST byte offsets.
      let pendingWasmDiags: Diagnostic[] = [];
      if (!hasSyntaxErrors && wasmLintDiags && wasmLintDiags.length > 0) {
        try {
          pendingWasmDiags = this.convertWasmLintDiagnostics(
            wasmLintDiags,
            currentDoc ?? textDocument,
            plugin,
            currentText,
            bridge,
          );
        } catch (e: unknown) {
          this.connection.console.warn(
            `[runUnifiedSemanticPipeline] CST linter error for ${uri}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }

      // 5b. Salsa QueryEngine symbol lints
      const skipHeavyLints = (!isWorkspaceFile && docSymbolCount > 1000) || hasSyntaxErrors;
      let capturedEngineDiags: EngineLintDiagnosticLike[] = [];
      const semanticLineIndex = new SemanticDiagnosticLineIndex(newSemanticDiagnostics);
      if (!skipHeavyLints && vEngine && typeof vEngine.runAllLintsAsync === "function") {
        const viewportRange = this.documentViewports.get(uri) ?? undefined;
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

        const posIdx = (bridge as any)?.positions ?? this.documentManager.getLineIndexForDoc(uri);
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
        const reconciledWasm = this.reconcileCrossLanguageWasmDiagnostics(
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
      // (abstract interpretation, DAE reachability, cross-language drift, workspace linters).
      if (isStale()) return;
      const earlyDiags = this.applyDiagnosticFilters(
        deduplicateAllDiagnostics([...baseDiagnostics, ...newSemanticDiagnostics]),
      );
      this.connection.sendDiagnostics({ uri, diagnostics: earlyDiags });
      this.sendProjectTreeChanged(uri);

      // ── Step 6: Domain Post-Validation Hooks ──────────────────────────────
      if (plugin?.customHandlers?.postValidate && textDocument) {
        await plugin.customHandlers.postValidate(textDocument, context, newSemanticDiagnostics);
      } else {
        if (langId === "owl2" && !hasSyntaxErrors) {
          await this.postValidateOwl2(effectiveUri, tree, text, newSemanticDiagnostics);
        } else if (langId === "sysml2" || langId === "sysml") {
          if (!hasSyntaxErrors) {
            this.postValidateSysml2(effectiveUri, newSemanticDiagnostics);
          }
          this.checkAutoVerify(effectiveUri);
        } else if (langId === "modelica" && !hasSyntaxErrors && textDocument) {
          const deferFormalToSave = Boolean(this.diagnosticsConfig.formalVerificationOnSave) && !isSave;
          if (!deferFormalToSave) {
            await this.postValidateModelicaAbstractInterpretation(effectiveUri, textDocument, newSemanticDiagnostics);
            if (this.diagnosticsConfig.daeSingularityCheck !== false) {
              await this.postValidateModelicaDaeReachability(effectiveUri, textDocument, newSemanticDiagnostics);
            }
          }
          this.postValidateModelicaReasoner(effectiveUri, newSemanticDiagnostics);
        } else if (!hasSyntaxErrors) {
          this.postValidatePolyglotReasoner(effectiveUri, langId, newSemanticDiagnostics);
        }
      }

      const vDiags = this.verificationDiagnosticsByUri.get(uri) ?? this.verificationDiagnosticsByUri.get(effectiveUri);
      if (vDiags) {
        newSemanticDiagnostics.push(...vDiags);
      }

      const rDiags = this.reasonerDiagnosticsByUri.get(uri) ?? this.reasonerDiagnosticsByUri.get(effectiveUri);
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

      const dtDiags =
        this.digitalThreadDiagnosticsByUri.get(uri) ?? this.digitalThreadDiagnosticsByUri.get(effectiveUri);
      if (dtDiags && dtDiags.length > 0) {
        newSemanticDiagnostics.push(...dtDiags);
      }

      // ── Step 7: Populate Class / Symbol Wrappers for Trees ───────────────
      if (!this.workspaceManager.documentInstances.get(uri)?.length) {
        this.populateClassWrappers(effectiveUri, uri, unifiedIndex, engine, context);
      }

      // ── Step 8: Finalize Cross-Language Links, Deliver Diagnostics, & Cascade ──
      if (isStale()) return;
      const finalSemanticDiags = await this.finalizeCrossLanguageValidation({
        uri,
        effectiveUri,
        text,
        langId,
        tree,
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
      this.lastSemanticDiagnostics.set(uri, finalSemanticDiags);
      const rawDiagnostics = [...baseDiagnostics, ...finalSemanticDiags];
      const diagnostics = this.applyDiagnosticFilters(deduplicateAllDiagnostics(rawDiagnostics));
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
        this.connection.sendDiagnostics({ uri, diagnostics });
        this.sendProjectTreeChanged(uri);
      }

      if ((textChanged || (changedNames && changedNames.size > 0)) && !this.isCascadeRevalidationActive) {
        await this.revalidateCrossLanguageDependents(effectiveUri);
      }
    } catch (e: any) {
      if (e?.name === "QueryCancelledError" || e?.message === "Query computation was cancelled") {
        return;
      }
      this.connection.console.error(`[runUnifiedSemanticPipeline] Error for ${uri}: ${e.message}\n${e.stack}`);
      if (!isStale()) {
        const rawDiagnostics = [...baseDiagnostics, ...newSemanticDiagnostics];
        const diagnostics = this.applyDiagnosticFilters(deduplicateAllDiagnostics(rawDiagnostics));
        this.connection.sendDiagnostics({ uri, diagnostics });
        this.sendProjectTreeChanged(uri);
      }
    }
  }

  /**
   * Evaluates digital thread alignments and multi-master conflicts for the given document URI,
   * returning LSP diagnostics for parameter drift or conflict slots.
   */
  public collectThreadDiagnostics(uri: string, textDocument?: TextDocument): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    if (typeof this.workspaceManager?.getThreadsForUri !== "function") return diagnostics;

    const threadEntries = this.workspaceManager.getThreadsForUri(uri);
    if (!threadEntries || threadEntries.length === 0) return diagnostics;

    const text = textDocument ? textDocument.getText() : "";

    for (const entry of threadEntries) {
      const { slot, record, meta, domain } = entry;
      const alignedElements = this.workspaceManager.findAlignedElementsBySlot(slot);
      const conflict =
        typeof (this.workspaceManager.hypergraph as any).getConflict === "function"
          ? (this.workspaceManager.hypergraph as any).getConflict(slot)
          : undefined;

      const threadDiags = ThreadDiagnosticsProvider.diagnoseThread(
        record?.id ?? slot,
        alignedElements,
        0.05,
        conflict,
        domain,
      );

      for (const td of threadDiags) {
        if (td.domain.toLowerCase() !== domain.toLowerCase()) continue;

        let startLine = Math.max(0, (td.line || meta.line || 1) - 1);
        let startCol = Math.max(0, (td.column || meta.column || 1) - 1);
        let len = td.length || meta.length || (meta.name ? meta.name.length : 8);

        // If textDocument is provided and variable name is found, match exact token position if possible
        if (text && td.elementName) {
          const varBase = td.elementName.split(".").pop() || td.elementName;
          const lineOffsets = text.split("\n");
          if (startLine < lineOffsets.length) {
            const lineStr = lineOffsets[startLine] || "";
            const idx = lineStr.indexOf(varBase);
            if (idx >= 0) {
              startCol = idx;
              len = varBase.length;
            }
          }
        }

        const relatedInformation = alignedElements
          .filter((el: any) => el?.uri && el.uri !== uri)
          .map((el: any) => {
            const relLine = Math.max(0, (el.line ?? 1) - 1);
            const relCol = Math.max(0, (el.column ?? 1) - 1);
            return {
              location: {
                uri: el.uri as string,
                range: {
                  start: { line: relLine, character: relCol },
                  end: { line: relLine, character: relCol + Math.max(1, (el.name || "").length) },
                },
              },
              message: `Aligned ${String(el.domain || "domain").toUpperCase()} element '${el.name || td.elementName}'`,
            };
          });

        diagnostics.push({
          range: {
            start: { line: startLine, character: startCol },
            end: { line: startLine, character: startCol + len },
          },
          severity:
            td.severity === "error"
              ? DiagnosticSeverity.Error
              : td.severity === "info"
                ? DiagnosticSeverity.Information
                : DiagnosticSeverity.Warning,
          code: td.code || "THREAD_CONFLICT",
          source: td.source || "modelscript-digital-thread",
          message: td.message,
          ...(relatedInformation.length > 0 ? { relatedInformation } : {}),
          data: {
            threadId: td.threadId ?? record?.id ?? slot,
            slot,
            elementName: td.elementName,
            sourceDomain: td.sourceDomain,
            sourceValue: td.sourceValue,
            targetDomain: td.targetDomain,
            targetValue: td.targetValue,
            simplexConsensus: td.simplexConsensus,
            unit: td.unit,
            alignedElements,
          },
        });
      }
    }

    return diagnostics;
  }

  /**
   * Backward-compatible delegation for runSemanticPipeline.
   */
  public async runSemanticPipeline(
    uri: string,
    text: string,
    tree: any,
    editRanges: Array<{ startOffset: number; endOffset: number }> | undefined,
    baseDiagnostics: Diagnostic[],
    revisionAtStart: number | null,
    _context: any,
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
  private createDefaultQueryEngine(langId: string, unifiedIndex: any, cstTreeWrapper: any): QueryEngine {
    const rawNorm = langId.toLowerCase();
    const norm = rawNorm === "sysml" ? "sysml2" : rawNorm;
    const plugin = globalLanguageRegistry.getPluginById(norm) ?? globalLanguageRegistry.getPluginById(rawNorm);
    const altPlugin = norm === "sysml2" ? globalLanguageRegistry.getPluginById("sysml") : undefined;
    const factory =
      plugin?.createQueryEngine ??
      altPlugin?.createQueryEngine ??
      (norm === "sysml2" ? (globalThis as any).createSysML2QueryEngine : undefined) ??
      (norm === "owl2" ? (globalThis as any).createOWL2QueryEngine : undefined) ??
      (globalThis as any)[`create_${norm}_query_engine`] ??
      (globalThis as any)[`create${norm.charAt(0).toUpperCase() + norm.slice(1)}QueryEngine`];
    if (typeof factory === "function") {
      return factory(unifiedIndex, cstTreeWrapper) as any;
    }
    return new QueryEngine(unifiedIndex, new Map(), { tree: cstTreeWrapper });
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
    const uw = this.workspaceManager?.unifiedWorkspace as
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
    const sharedContext = this.parserService?.sharedContext as SharedContextWorkspaceBridge | undefined;
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
    if (!wasmDiags.length || !unifiedIndex?.symbols) return wasmDiags;

    const normLang = langId.toLowerCase();
    const normUri = (u: string) =>
      (u.startsWith("modelscript-lib://global")
        ? "file://" + u.substring("modelscript-lib://global".length)
        : u
      ).replace(/^([a-z0-9+-]+):\/{0,3}/i, "$1:///");
    const targetNorm = normUri(effectiveUri);

    const docIds: number[] =
      unifiedIndex.symbolsByResource?.get(effectiveUri) ?? unifiedIndex.symbolsByResource?.get(targetNorm) ?? [];
    const docSymbols: SymbolEntry[] = docIds
      .map((id) => unifiedIndex.symbols.get(id))
      .filter((s): s is SymbolEntry => Boolean(s));

    const importedPrefixes: string[][] = [];
    const importedLeafMap = new Map<string, string[]>();
    for (const sym of docSymbols) {
      if (sym.kind !== "Import" || !sym.name) continue;
      const rawImp = String(sym.name).trim();
      if (rawImp.endsWith(".*") || rawImp.endsWith("::*")) {
        const pkgPath = rawImp.endsWith("::*") ? rawImp.slice(0, -3) : rawImp.slice(0, -2);
        const parts = splitQualifiedPath(pkgPath);
        if (parts.length > 0) importedPrefixes.push(parts);
      } else {
        const parts = splitQualifiedPath(rawImp);
        if (parts.length > 0) importedLeafMap.set(parts[parts.length - 1]!, parts);
      }
    }

    const resolvePathInUnified = (parts: string[]): SymbolEntry | undefined => {
      if (parts.length === 0) return undefined;
      const isExternalMatch = (cand: SymbolEntry | undefined): boolean => {
        if (!cand) return false;
        const candLang = (cand.language ?? "").toLowerCase();
        if (candLang && candLang !== normLang) return true;
        return Boolean(cand.resourceId && normUri(cand.resourceId) !== targetNorm);
      };

      const walkChildren = (root: SymbolEntry, rest: string[]): SymbolEntry | undefined => {
        let curr: SymbolEntry | undefined = root;
        for (const seg of rest) {
          if (!curr) return undefined;
          const childIds: number[] = unifiedIndex.childrenOf?.get(curr.id) ?? [];
          let next: SymbolEntry | undefined;
          for (const cid of childIds) {
            const c = unifiedIndex.symbols.get(cid);
            if (c && c.name === seg && c.kind !== "Import" && c.kind !== "Extends") {
              next = c;
              break;
            }
          }
          if (!next) {
            // Also traverse extends base classes if present
            for (const cid of childIds) {
              const c = unifiedIndex.symbols.get(cid);
              if (c?.kind === "Extends" && c.name) {
                const base = resolvePathInUnified(splitQualifiedPath(c.name));
                if (base) {
                  const foundInBase = walkChildren(base, [seg]);
                  if (foundInBase) {
                    next = foundInBase;
                    break;
                  }
                }
              }
            }
          }
          curr = next;
        }
        return curr;
      };

      const roots: SymbolEntry[] = (unifiedIndex.byName?.get(parts[0]!) ?? [])
        .map((id: number) => unifiedIndex.symbols.get(id))
        .filter((s): s is SymbolEntry => Boolean(s && s.kind !== "Import" && s.kind !== "Extends"));
      for (const r of roots) {
        const hit = parts.length === 1 ? r : walkChildren(r, parts.slice(1));
        if (hit && isExternalMatch(hit)) return hit;
      }

      // Suffix/namePath fallback across external/foreign entries
      const leaf = parts[parts.length - 1]!;
      const candidates: SymbolEntry[] = (unifiedIndex.byName?.get(leaf) ?? [])
        .map((id: number) => unifiedIndex.symbols.get(id))
        .filter((s): s is SymbolEntry => Boolean(s && isExternalMatch(s)));
      const expected = parts.join(".").toLowerCase();
      for (const c of candidates) {
        if (parts.length === 1) return c;
        const np = (c.namePath ?? c.name).replaceAll("::", ".").toLowerCase();
        if (np === expected || np.endsWith(`.${expected}`)) return c;
      }
      return undefined;
    };

    const resolveImportedOrQualifiedChain = (chain: string): boolean => {
      const parts = splitQualifiedPath(chain);
      if (parts.length === 0) return false;
      if (resolvePathInUnified(parts)) return true;
      const aliased = importedLeafMap.get(parts[0]!);
      if (aliased && resolvePathInUnified([...aliased, ...parts.slice(1)])) return true;
      for (const pref of importedPrefixes) {
        if (resolvePathInUnified([...pref, ...parts])) return true;
      }
      return false;
    };

    const computeOffset = (pos: { line: number; character: number }): number => {
      if (textDocument && typeof textDocument.offsetAt === "function") {
        return textDocument.offsetAt(pos);
      }
      let line = 0;
      let i = 0;
      while (i < text.length && line < pos.line) {
        if (text.charCodeAt(i) === 10) line++;
        i++;
      }
      return Math.min(text.length, i + pos.character);
    };

    const extractChainAround = (startOff: number, endOff: number): string => {
      let l = startOff;
      let r = endOff;
      while (l > 0 && isChainTokenChar(text[l - 1]!)) l--;
      while (r < text.length && isChainTokenChar(text[r]!)) r++;
      let s = l;
      let e = r;
      while (s < e && (text[s] === ":" || text[s] === ".")) s++;
      while (e > s && (text[e - 1] === ":" || text[e - 1] === ".")) e--;
      return text.slice(s, e);
    };

    const resolveMemberViaComponentType = (offset: number, fullChain: string): boolean => {
      const parts = splitQualifiedPath(fullChain);
      if (parts.length < 2) return resolveImportedOrQualifiedChain(fullChain);

      let enclosingClass: SymbolEntry | undefined;
      for (const s of docSymbols) {
        if (s.startOffset <= offset && s.endOffset >= offset && isTypeLikeSymbol(s)) {
          if (!enclosingClass || s.endOffset - s.startOffset < enclosingClass.endOffset - enclosingClass.startOffset) {
            enclosingClass = s;
          }
        }
      }
      if (enclosingClass && engine && typeof engine.query === "function") {
        const compIds: number[] = unifiedIndex.childrenOf?.get(enclosingClass.id) ?? [];
        const comp = compIds.map((cid) => unifiedIndex.symbols.get(cid)).find((c) => c && c.name === parts[0]);
        if (comp) {
          const typeSpec =
            (engine.query("typeSpecifier", comp.id) as string | undefined) ??
            (comp.metadata?.["typeSpecifier"] as string | undefined) ??
            (comp.metadata?.["type_specifier"] as string | undefined);
          if (typeSpec) {
            const typeEntry =
              resolvePathInUnified(splitQualifiedPath(String(typeSpec))) ??
              (() => {
                const resolved = engine.query("resolveName", enclosingClass.id);
                if (typeof resolved === "function") {
                  return (resolved as (name: string) => SymbolEntry | null | undefined)(String(typeSpec)) ?? undefined;
                }
                return typeof resolved === "number" ? unifiedIndex.symbols.get(resolved) : undefined;
              })();
            if (typeEntry) {
              const targetEntry =
                resolvePathInUnified([typeEntry.name, ...parts.slice(1)]) ??
                (() => {
                  let curr: SymbolEntry | undefined = typeEntry;
                  for (const seg of parts.slice(1)) {
                    const cids: number[] = unifiedIndex.childrenOf?.get(curr.id) ?? [];
                    curr = cids.map((id) => unifiedIndex.symbols.get(id)).find((c) => c && c.name === seg);
                    if (!curr) return undefined;
                  }
                  return curr;
                })();
              if (targetEntry) return true;
            }
          }
        }
      }
      return resolveImportedOrQualifiedChain(fullChain);
    };

    const engineHasOverlappingCode = (codeNum: number, startOff: number, endOff: number): boolean =>
      (engineDiags ?? []).some((ed) => {
        const edCode = typeof ed.code === "number" ? ed.code : parseInt(extractDigitsOnly(String(ed.code ?? "")), 10);
        if (edCode !== codeNum) return false;
        const es = ed.startOffset ?? -1;
        const ee = ed.endOffset ?? es;
        return Math.max(es, startOff) <= Math.min(ee, endOff) + 2;
      });

    const modelicaView: ModelicaReconcileView | null =
      normLang === "modelica" && engine && typeof engine.query === "function"
        ? {
            symbols: unifiedIndex.symbols,
            symbol: (id: number) => unifiedIndex.symbols.get(id),
            byName: (n: string) =>
              (unifiedIndex.byName?.get(n) ?? [])
                .map((id: number) => unifiedIndex.symbols.get(id))
                .filter((s): s is SymbolEntry => Boolean(s)),
            query: <T = unknown>(q: string, id: number) => engine.query<T>(q, id),
          }
        : null;
    const docScopeIds = docSymbols.filter((s) => s.kind === "Class" || s.kind === "Package").map((s) => s.id);

    const preFiltered =
      normLang === "modelica"
        ? reconcileModelicaCstDiagnostics({
            cstDiags: wasmDiags,
            hasArenaResult: false,
            engineDiags,
            isOldFrontend: text.includes("-d=-newInst"),
          })
        : wasmDiags;

    return preFiltered.filter((diag) => {
      const info = extractCanonicalErrorInfo(diag.code, undefined, plugin);
      const codeNum = info.codeNum;
      const isTypeNotFound = codeNum === 2003 || info.ruleName === "typenotfound" || info.ruleName === "classnotfound";
      const isVarNotFound = codeNum === 2002 || info.ruleName === "variablenotfound";
      if (!isTypeNotFound && !isVarNotFound) return true;

      const startOff = computeOffset(diag.range.start);
      const endOff = Math.max(startOff, computeOffset(diag.range.end));
      const tokenText = text.slice(startOff, endOff).trim();
      const fullChain = extractChainAround(startOff, endOff) || tokenText;

      if (isTypeNotFound) {
        if (engineHasOverlappingCode(2003, startOff, endOff)) {
          // Step 5b already checked multi-file and emitted the authoritative M2003
          return false;
        }
        if (resolveImportedOrQualifiedChain(fullChain) || resolveImportedOrQualifiedChain(tokenText)) {
          return false;
        }
        if (
          modelicaView &&
          (resolveModelicaTypeInWorkspace(modelicaView, fullChain, docScopeIds) ||
            resolveModelicaTypeInWorkspace(modelicaView, tokenText, docScopeIds))
        ) {
          return false;
        }
        // Check enclosing declaration resolved cleanly via Step 5b typeSpecifier
        for (const s of docSymbols) {
          if (s.startOffset <= startOff && s.endOffset >= endOff && engine && typeof engine.query === "function") {
            const rt = engine.query("resolvedType", s.id);
            if (rt) return false;
          }
        }
        return true;
      }

      // M2002 variableNotFound
      const stmtStart = Math.max(0, text.lastIndexOf(";", startOff) + 1);
      const stmtPrefix = text.slice(stmtStart, endOff);
      if (
        engineDiags !== null &&
        hasConnectCallPrefix(stmtPrefix) &&
        engine &&
        typeof engine.runAllLintsAsync === "function"
      ) {
        // Multi-file `lint__validateConnect` in Step 5b authoritatively validates connect() endpoints
        return false;
      }
      if (resolveMemberViaComponentType(startOff, fullChain)) {
        return false;
      }
      if (modelicaView && resolveModelicaVariableInWorkspace(modelicaView, fullChain, null, docScopeIds)) {
        return false;
      }
      return true;
    });
  }

  private getTggTransformer(langId: string): PolyglotTransformer | null {
    const norm = langId.toLowerCase();
    const cached = this.tggTransformerCache.get(norm);
    if (cached) return cached;

    const uw = this.workspaceManager?.unifiedWorkspace as
      | (UnifiedWorkspace & { createPolyglotTransformer?: (lang: string) => PolyglotTransformer | null })
      | undefined;
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
      this.tggTransformerCache.set(norm, transformer);
    }
    return transformer;
  }

  private mapCorrespondenceErrorCode(diagCode: CorrespondenceDiagnostic["code"], langId: string): number | string {
    const norm = langId.toLowerCase();
    if (norm === "modelica") {
      switch (diagCode) {
        case "CONFORMANCE_MISSING_PORT":
          return 4140;
        case "CONFORMANCE_PARAM_MISMATCH":
          return 4141;
        case "CONFORMANCE_MISSING_COMPONENT":
          return 4142;
        case "CONFORMANCE_UNRESOLVED_TARGET":
          return 4143;
      }
    } else if (norm === "sysml2" || norm === "sysml") {
      switch (diagCode) {
        case "CONFORMANCE_MISSING_PORT":
          return 4080;
        case "CONFORMANCE_PARAM_MISMATCH":
          return 4081;
        case "CONFORMANCE_MISSING_COMPONENT":
          return 4082;
        case "CONFORMANCE_UNRESOLVED_TARGET":
          return 4083;
      }
    }
    return diagCode;
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
    const { effectiveUri, langId, text, tree, textDocument, diagnostics } = params;
    const uw = this.workspaceManager?.unifiedWorkspace;
    if (!uw || typeof uw.getIndex !== "function" || !text) return;
    const uIdx = uw.getIndex();
    if (!uIdx?.symbols) return;

    const normLang = langId.toLowerCase();
    if (normLang === "step" && text.length > 262_144) return;
    let links: ReturnType<typeof extractCrossLanguageLinks> = [];
    try {
      links = extractCrossLanguageLinks({
        uri: effectiveUri,
        language: normLang,
        index: uIdx,
        text,
        tree,
      });
    } catch {
      return;
    }
    const explicitLinks = links.filter((l) => l.relationKind === "twin" || l.relationKind === "implements");

    const dbView = {
      symbol: (id: number) => uIdx.symbols.get(id),
      childrenOf: (id: number | null) =>
        (uIdx.childrenOf.get(id) ?? [])
          .map((cid: number) => uIdx.symbols.get(cid))
          .filter((s): s is SymbolEntry => Boolean(s)),
      byName: (name: string) =>
        (uIdx.byName.get(name) ?? [])
          .map((id: number) => uIdx.symbols.get(id))
          .filter((s): s is SymbolEntry => Boolean(s)),
    };

    const inferTargetLang = (targetPath: string, fallbackLang: string): string => {
      const lower = targetPath.toLowerCase();
      if (lower.startsWith("sysml2::") || lower.startsWith("sysml::") || targetPath.includes("::")) return "sysml2";
      if (lower.startsWith("modelica::")) return "modelica";
      if (lower.startsWith("psse::")) return "psse";
      if (lower.startsWith("pscad::")) return "pscad";
      return fallbackLang === "modelica" ? "sysml2" : "modelica";
    };

    const srcTransformer = this.getTggTransformer(normLang) ?? new PolyglotTransformer();
    const validatedPairs = new Set<string>();

    const validatePair = (
      srcEntry: SymbolEntry,
      tgtEntry: SymbolEntry | null,
      targetNameHint: string,
      fallbackLine: number,
      fallbackCol: number,
    ) => {
      const pairKey = `${srcEntry.id}:${tgtEntry?.id ?? targetNameHint}`;
      if (validatedPairs.has(pairKey)) return;
      validatedPairs.add(pairKey);

      const startPos = textDocument
        ? textDocument.positionAt(srcEntry.startOffset)
        : { line: Math.max(0, fallbackLine - 1), character: Math.max(0, fallbackCol - 1) };
      const endPos = textDocument
        ? textDocument.positionAt(
            Math.max(
              srcEntry.startOffset + Math.max(1, srcEntry.name.length),
              Math.min(text.length, srcEntry.startOffset + srcEntry.name.length + 1),
            ),
          )
        : { line: startPos.line, character: startPos.character + Math.max(1, srcEntry.name.length) };
      const range: Range = { start: startPos, end: endPos };

      const srcNode = symbolEntryToPolyglotNode(dbView, srcEntry);
      if (!tgtEntry) {
        const expectedLang = inferTargetLang(targetNameHint, normLang);
        const corrDiags = srcTransformer.validateCorrespondence(srcNode, null, normLang, expectedLang);
        for (const cd of corrDiags) {
          diagnostics.push({
            severity: cd.severity === "error" ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
            range,
            code: this.mapCorrespondenceErrorCode(cd.code, normLang),
            source: "modelscript-tgg",
            message: cd.message,
          });
        }
        return;
      }

      const tgtLang = (tgtEntry.language ?? inferTargetLang(targetNameHint, normLang)).toLowerCase();
      if (tgtLang === normLang) return;

      const isContainerTwin =
        isTypeLikeSymbol(srcEntry) ||
        srcEntry.ruleName === "psse_model" ||
        srcEntry.ruleName === "psse_dyr_record" ||
        srcEntry.ruleName === "pscad_component" ||
        srcEntry.ruleName === "ModuleDeclaration";
      if (!isContainerTwin) return;

      const tgtNode = symbolEntryToPolyglotNode(dbView, tgtEntry);
      const seenCorr = new Set<string>();
      const emitCorr = (cd: CorrespondenceDiagnostic) => {
        const key = `${cd.code}:${cd.expectedName ?? cd.elementName}`;
        if (seenCorr.has(key)) return;
        seenCorr.add(key);
        diagnostics.push({
          severity: cd.severity === "error" ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
          range,
          code: this.mapCorrespondenceErrorCode(cd.code, normLang),
          source: "modelscript-tgg",
          message: cd.message,
        });
      };

      for (const cd of srcTransformer.validateCorrespondence(srcNode, tgtNode, normLang, tgtLang)) {
        emitCorr(cd);
      }

      const tgtTransformer = this.getTggTransformer(tgtLang);
      if (tgtTransformer) {
        for (const cd of tgtTransformer.validateCorrespondence(tgtNode, srcNode, tgtLang, normLang)) {
          emitCorr(cd);
        }
      }
    };

    for (const link of explicitLinks) {
      const srcEntry = uIdx.symbols.get(link.sourceSymbolId);
      if (!srcEntry) continue;
      validatePair(srcEntry, link.targetEntry ?? null, link.targetName, link.sourceLine, link.sourceColumn);
    }

    // Also validate zero-annotation TGG container correspondences aligned by TggCorrespondenceIndexer
    const tggIndexer = uw.tggCorrespondenceIndexer;
    if (tggIndexer) {
      if ((tggIndexer as any).lastSyncedVersion !== uw.version) {
        uw.syncTggCorrespondences?.(uIdx);
      }
      for (const sym of uIdx.symbols.values()) {
        if ((sym.resourceId || sym.documentUri || "") !== effectiveUri) continue;
        for (const slot of tggIndexer.getSlotsForSymbol(sym.id)) {
          const rec = tggIndexer.hypergraph.getRecord(slot);
          if (!rec || rec.isRemoved) continue;
          for (const memberId of Object.values(rec.domainNodes)) {
            if (typeof memberId === "number" && memberId !== sym.id) {
              const peer = uIdx.symbols.get(memberId);
              if (peer) validatePair(sym, peer, peer.name, 1, 1);
            }
          }
        }
      }
    }
  }

  private collectDroneSimulationParityDiagnostics(
    uri: string,
    langId: string,
    text: string,
    textDocument: TextDocument | undefined,
    diagnostics: Diagnostic[],
  ): void {
    if (!text) return;
    const lines = splitLinesPreserve(text);
    const threadEntries = this.workspaceManager?.getThreadsForUri?.(uri) ?? [];
    let calibratedMass: number | undefined;
    let peerSysmlName: string | undefined;

    for (const te of threadEntries) {
      const aligned = this.workspaceManager?.findAlignedElementsBySlot?.(te.slot) ?? [];
      for (const el of aligned) {
        if (el.uri !== uri && typeof el.properties?.["mass"] === "number") {
          if (calibratedMass === undefined || el.domain === "fea") {
            calibratedMass = el.properties["mass"];
          }
        }
        if (!peerSysmlName && (el.domain === "sysml2" || el.domain === "sysml")) {
          peerSysmlName = stripLeadingKeywordPrefixes(el.name, ["part def", "model"]);
        }
      }
      if (calibratedMass !== undefined && peerSysmlName !== undefined) break;
    }

    const pushMassParityDiag = (range: Diagnostic["range"], val: number, targetMass: number): void => {
      if (Math.abs(val - targetMass) > 0.01) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range,
          message: `[Digital Thread Drift] Parameter 'm = ${val}' drifts from FEA calibrated structural mass (${targetMass.toFixed(2)} kg). Run 'ModelScript: Sync Digital Thread Parameters' to reconcile.`,
          source: "modelscript-digital-thread",
        });
      } else {
        const peerSuffix = peerSysmlName ? ` and SysML v2 ${peerSysmlName}` : "";
        diagnostics.push({
          severity: DiagnosticSeverity.Information,
          range,
          message: `[Digital Thread In Parity] Parameter 'm' (${targetMass.toFixed(2)} kg) is synchronized with FEA structural mass${peerSuffix}.`,
          source: "modelscript-digital-thread",
        });
      }
    };

    const isParityTarget = (uri.endsWith(".mo") || langId === "modelica") && calibratedMass !== undefined;

    if (isParityTarget && calibratedMass !== undefined) {
      const targetMass = calibratedMass;
      const cachedTree = this.documentManager?.documentTrees?.get(uri);
      const rootNode = cachedTree?.tree?.rootNode;
      let handledViaCst = false;
      if (rootNode && textDocument) {
        const compDecls = collectCstNodesByTypes(rootNode, ["component_declaration"]);
        for (const cd of compDecls) {
          const idNode = (cd.children || []).find((c: SyntaxNode) => c.type === "identifier");
          if (idNode?.text === "m") {
            const modNode = (cd.children || []).find((c: SyntaxNode) => c.type === "modification");
            const val = modNode?.text ? extractLeadingNumericAfterEquals(modNode.text) : null;
            if (val !== null) {
              const startPos = textDocument.positionAt(idNode.startIndex);
              const endPos = textDocument.positionAt(idNode.endIndex);
              handledViaCst = true;
              pushMassParityDiag({ start: startPos, end: endPos }, val, targetMass);
              break;
            }
          }
        }
      }

      if (!handledViaCst) {
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          const parsed = extractParameterRealLine(line, "m");
          if (parsed !== null) {
            pushMassParityDiag(
              { start: { line: i, character: parsed.nameCol }, end: { line: i, character: parsed.nameCol + 1 } },
              parsed.value,
              targetMass,
            );
          }
        }
      }
    }

    if (this.workspaceManager && typeof this.workspaceManager.getThreadsForUri === "function") {
      const currentThreads = this.workspaceManager.getThreadsForUri(uri);
      if (currentThreads && currentThreads.length > 0) {
        for (const entry of currentThreads) {
          const { slot, meta } = entry;
          const aligned = this.workspaceManager.findAlignedElementsBySlot?.(slot) ?? [];
          if (aligned.length > 1) {
            const rawName = stripLeadingKeywordPrefixes(meta.name, ["part def", "model", "package", "def"]).trim();
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i]!;
              const col = rawName ? line.indexOf(rawName) : -1;
              if (
                col >= 0 &&
                (line.includes("part def") ||
                  line.includes("part ") ||
                  line.includes("model ") ||
                  line.includes("package "))
              ) {
                const peerList = aligned
                  .filter((el) => el.domain.toLowerCase() !== entry.domain.toLowerCase())
                  .map((el) => `${el.domain.toUpperCase()} (${el.name})`)
                  .join(", ");
                diagnostics.push({
                  severity: DiagnosticSeverity.Information,
                  range: {
                    start: { line: i, character: col },
                    end: { line: i, character: col + rawName.length },
                  },
                  message: `[Multi-Domain Digital Thread] Architecture bound across ${aligned.length} domains: ${peerList}.`,
                  source: "modelscript-digital-thread",
                });
                break;
              }
            }
          }
        }
      }
    }
  }

  /**
   * Shared cross-language finalizer invoked by both the unified GLR/Salsa pipeline and all
   * standalone format validators (PSSE, PSCAD, STEP, Easy5, ROCETS, SCAD, FEA, CFD, etc.).
   * Ensures UnifiedWorkspace query engine sync, automatic thread discovery, TGG conformance checks,
   * digital-thread contradiction reporting, and bounded dependent revalidation run uniformly.
   */
  private async finalizeCrossLanguageValidation(params: {
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
  }): Promise<Diagnostic[]> {
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

    this.syncWorkspaceStateAfterIndex(effectiveUri, changedIds, structuralChangedIds, changedNames);

    if (
      (contentChanged || (langId !== "step" && text.length <= 262_144)) &&
      typeof this.workspaceManager?.discoverThreadsForDocument === "function"
    ) {
      try {
        this.workspaceManager.discoverThreadsForDocument(effectiveUri, text, langId, tree);
      } catch {
        // Non-fatal on partial buffers
      }
    }

    if (!hasSyntaxErrors) {
      this.postValidatePolyglotDrift(effectiveUri, langId, diagnostics);
      this.collectLiveTggCorrespondenceDiagnostics({
        effectiveUri,
        langId,
        text,
        tree,
        textDocument,
        diagnostics,
      });
    }

    const threadDiags = this.collectThreadDiagnostics(effectiveUri, textDocument);
    if (threadDiags.length > 0) {
      diagnostics.push(...threadDiags);
    }

    this.collectDroneSimulationParityDiagnostics(uri, langId, text, textDocument, diagnostics);

    await this.collectWorkspaceLinterDiagnostics(effectiveUri, langId, text, diagnostics);

    if (isStale?.()) return diagnostics;

    const finalDiags = this.applyDiagnosticFilters(deduplicateAllDiagnostics(diagnostics));

    if (!skipSend) {
      this.lastSemanticDiagnostics.set(uri, finalDiags);
      if (effectiveUri !== uri) {
        this.lastSemanticDiagnostics.set(effectiveUri, finalDiags);
      }
      this.connection.sendDiagnostics({ uri, diagnostics: finalDiags });
      this.sendProjectTreeChanged(uri);
    }

    if (!skipCascade && contentChanged && !this.isCascadeRevalidationActive) {
      await this.revalidateCrossLanguageDependents(effectiveUri);
    }

    return finalDiags;
  }

  /**
   * Collects multi-file / workspace-graph diagnostics for languages with a registered
   * `lint<Lang>Workspace` analyzer across all open and cached workspace documents.
   */
  private async collectWorkspaceLinterDiagnostics(
    effectiveUri: string,
    langId: string,
    text: string,
    diagnostics: Diagnostic[],
  ): Promise<void> {
    if (!hasWorkspaceLinter(langId)) return;
    try {
      const workspaceDocs: Record<string, string> = {};
      if (this.documentManager?.documentTrees) {
        for (const [docUri, entry] of this.documentManager.documentTrees.entries()) {
          if (typeof entry?.text === "string") {
            workspaceDocs[docUri] = entry.text;
          }
        }
      }
      if (this.documentManager?.documents && typeof this.documentManager.documents.all === "function") {
        for (const doc of this.documentManager.documents.all()) {
          workspaceDocs[doc.uri] = doc.getText();
        }
      }
      workspaceDocs[effectiveUri] = text;

      await runWorkspaceLinterForDocument(langId, workspaceDocs, effectiveUri, diagnostics);
    } catch (err: any) {
      this.connection?.console?.warn?.(
        `[validate] Workspace linter failed for ${effectiveUri} (${langId}): ${err?.message ?? err}`,
      );
    }
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
    await this.finalizeCrossLanguageValidation({
      uri: textDocument.uri,
      effectiveUri: textDocument.uri,
      text,
      langId,
      tree: this.documentManager.documentTrees.get(textDocument.uri)?.tree,
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
  public async validateScadDocument(textDocument: TextDocument, plugin?: LanguagePlugin): Promise<void> {
    const text = textDocument.getText();
    const prevIndexedText = this.lastIndexedText.get(textDocument.uri);
    const existingTreeEntry = this.documentManager.documentTrees.get(textDocument.uri);
    const cachedScad = this.lastScadOwnDiagnostics.get(textDocument.uri);
    if (cachedScad && cachedScad.text === text && prevIndexedText === text && existingTreeEntry?.text === text) {
      await this.finalizeCustomDocument(textDocument, "scad", [...cachedScad.diagnostics], text);
      return;
    }
    const scadDiagnostics: Diagnostic[] = [];
    let scadValidationFailed = false;

    try {
      this.connection.console.info(`[scad] Validating ${textDocument.uri} (${text.length} chars)`);
      this.lastIndexedText.set(textDocument.uri, text);
      await this.parserService?.ensureLanguageParserLoaded?.("scad");
      const { getScadParser, lintScadCst, validateScadDigitalThreadAndBounds } = await import("@modelscript/scad");
      let scadTreeRoot: SyntaxNode | null = null;
      const parser = plugin?.parser ?? this.parserService?.getParser?.("scad") ?? (await getScadParser());
      if (parser) {
        const tree = parser.parse(text);
        if (tree?.rootNode) {
          scadTreeRoot = tree.rootNode;
          this.documentManager.documentTrees.set(textDocument.uri, {
            text,
            tree,
            classCache: new Map(),
          });
          const { syntaxDiags } = this.collectSyntaxErrors(tree.rootNode, textDocument, plugin);
          scadDiagnostics.push(...syntaxDiags);

          if (syntaxDiags.length === 0) {
            const semanticDiags = lintScadCst(tree.rootNode, text, {
              uri: textDocument.uri,
              workspace: this.workspaceManager.unifiedWorkspace,
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

      const allowInfoBadges = this.diagnosticsConfig.showInformationalBadges !== false;
      scadDiagnostics.push(
        ...(validateScadDigitalThreadAndBounds(
          text,
          scadTreeRoot,
          (off) => textDocument.positionAt(off),
          allowInfoBadges,
        ) as Diagnostic[]),
      );
    } catch (e: any) {
      scadValidationFailed = true;
      this.connection.console.warn(`[scad] Validation failed for ${textDocument.uri}: ${e.message}`);
    }

    const latestDoc = this.documentManager?.documents?.get(textDocument.uri);
    if (!scadValidationFailed && (!latestDoc || latestDoc.version === textDocument.version)) {
      this.lastScadOwnDiagnostics.set(textDocument.uri, { text, diagnostics: [...scadDiagnostics] });
    }
    await this.finalizeCustomDocument(textDocument, "scad", scadDiagnostics, prevIndexedText);
  }

  /**
   * Registers a JavaScript/TypeScript sidecar file as a synthetic class instance in the workspace.
   */
  private validateSidecarDocument(textDocument: TextDocument): void {
    const context = this.parserService.sharedContext;
    if (!context) return;
    const text = textDocument.getText();
    const entity = {
      isClassInstance: true,
      jsSource: text,
      name: "",
      context,
      uri: textDocument.uri,
      instantiate() {},
    } as any;
    const filename = textDocument.uri.split("/").pop();
    if (filename) {
      entity.name = filename.endsWith(".ts") || filename.endsWith(".js") ? filename.slice(0, -3) : filename;
    }
    entity.instantiate();
    this.workspaceManager.workspaceInstances.set(textDocument.uri, [entity]);
    this.workspaceManager.documentInstances.set(textDocument.uri, [entity]);
    this.workspaceManager.documentContexts.set(textDocument.uri, context);
    this.connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: [] });
    this.sendProjectTreeChanged();
  }

  /**
   * Parses, lints, and indexes a PSCAD (`.pscx`, `.pslx`, `.pswx`, `.psmx`) power systems document.
   */
  /**
   * Computes a safe 0-based end character on the given line when `endColumn` is not provided,
   * clamping to the XML tag name (`<tagName`) or identifier token at `(line, col)` so squiggles
   * never spill across whitespace into attributes.
   */
  private computeTokenEndCharacter(text: string, lineZero: number, colZero: number): number {
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

  private parseIncrementalWasmTree(uri: string, langId: string, text: string, plugin?: LanguagePlugin): any | null {
    if (isLargeXmlForWasm(uri, text, plugin)) return null;
    const wasmParser = plugin?.parser ?? this.parserService?.getParser?.(langId);
    if (!wasmParser || typeof wasmParser.parse !== "function") return null;

    const cached = this.documentManager.documentTrees.get(uri);
    const cachedTree = cached?.tree as
      | {
          rootNode?: unknown;
          edit?: (e: unknown) => void;
          delete?: () => void;
        }
      | undefined;

    if (cached?.text === text && cachedTree?.rootNode && typeof cachedTree.edit === "function") {
      return cachedTree;
    }

    try {
      if (cachedTree && cached?.text && cached.text !== text && typeof cachedTree.edit === "function") {
        const activeFacade = (plugin?.facade ?? this.parserService.getFacade(langId)) as
          | { lastAstRoot?: number }
          | undefined;
        if (!activeFacade || isWasmTreeActiveInFacade(cachedTree, activeFacade, uri)) {
          const edit = computeTreeEdit(cached.text, text);
          cachedTree.edit(edit as never);
          const nextTree = wasmParser.parse(text, cachedTree, edit.startIndex, edit.oldEndIndex, edit.newEndIndex, uri);
          if (nextTree && nextTree !== cachedTree) {
            cachedTree.delete?.();
          }
          return nextTree ?? null;
        }
      }
      const freshTree = wasmParser.parse(text, null, 0, 0, 0, uri);
      if (cachedTree && cachedTree !== freshTree) {
        cachedTree.delete?.();
      }
      return freshTree ?? null;
    } catch {
      return null;
    }
  }

  public async validatePscadDocument(textDocument: TextDocument, plugin?: LanguagePlugin): Promise<void> {
    const text = textDocument.getText();
    const pscadDiagnostics: Diagnostic[] = [];

    try {
      this.connection.console.info(`[pscad] Validating ${textDocument.uri} (${text.length} chars)`);
      await this.parserService?.ensureLanguageParserLoaded?.("pscad");
      const { pscadLanguage, validatePscadDocumentCore } = await import("@modelscript/pscad");
      const workspaceDocs =
        typeof this.documentManager?.documents?.all === "function"
          ? this.documentManager.documents.all().map((doc) => ({ uri: doc.uri, text: doc.getText() }))
          : [];
      const wasmTree = this.parseIncrementalWasmTree(textDocument.uri, "pscad", text, plugin);
      const syntaxLines = new Set<number>();
      if (wasmTree?.rootNode) {
        const { syntaxDiags } = this.collectSyntaxErrors(wasmTree.rootNode, textDocument, plugin);
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
        computeTokenEndCharacter: (src, line, col) => this.computeTokenEndCharacter(src, line, col),
      });
      pscadDiagnostics.push(...(coreDiags as Diagnostic[]));

      if (wasmTree?.rootNode) {
        (wasmTree.rootNode as { data?: unknown }).data = project;
        this.documentManager.documentTrees.set(textDocument.uri, {
          text,
          tree: wasmTree,
          classCache: new Map(),
        });
      } else {
        this.documentManager.documentTrees.set(textDocument.uri, {
          text,
          tree: { rootNode: { text, data: project } },
          classCache: new Map(),
        });
      }

      // Index symbols for Library Tree panel and navigation
      if (this.indexNativeDslDocument(textDocument.uri, text, "pscad", pscadLanguage)) {
        this.sendProjectTreeChanged();
      }
    } catch (err: any) {
      this.connection.console.error(`[pscad] Error validating PSCAD document ${textDocument.uri}: ${err.message}`);
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
          message: `PSCAD Parse Error: ${err.message}`,
          source: "pscad",
        });
      }
    }

    await this.finalizeCustomDocument(textDocument, "pscad", pscadDiagnostics);
  }

  /**
   * Validates an ISO 10303-21 STEP document (`.step`, `.stp`, `.p21`) for syntax, entity reference integrity, and schema arity.
   */
  private async validateStepDocument(textDocument: TextDocument, plugin?: LanguagePlugin): Promise<void> {
    const text = textDocument.getText();
    const isLargeStep = text.length > 262_144;
    const stepParser = isLargeStep ? undefined : (plugin?.parser ?? this.parserService.getParser("step"));
    const existingTreeEntry = this.documentManager.documentTrees.get(textDocument.uri);
    const cachedStep = this.lastStepOwnDiagnostics.get(textDocument.uri);
    if (
      cachedStep &&
      cachedStep.text === text &&
      this.lastIndexedText.get(textDocument.uri) === text &&
      (isLargeStep || !stepParser || existingTreeEntry?.text === text)
    ) {
      await this.finalizeCrossLanguageValidation({
        uri: textDocument.uri,
        effectiveUri: textDocument.uri,
        text,
        langId: "step",
        tree: existingTreeEntry?.tree,
        textDocument,
        diagnostics: [...cachedStep.diagnostics],
        hasSyntaxErrors: cachedStep.diagnostics.some((d) => d.severity === DiagnosticSeverity.Error),
        contentChanged: false,
      });
      return;
    }

    const inflight = this.inFlightStepValidations.get(textDocument.uri);
    if (inflight && inflight.text === text) {
      await inflight.promise;
      return;
    }

    const run = async (): Promise<void> => {
      const buffer = new TextEncoder().encode(text);
      const stepDiagnostics: Diagnostic[] = [];
      try {
        this.connection.console.info(`[step] Validating ${textDocument.uri} (${text.length} chars)`);
        let tree;
        if (existingTreeEntry && existingTreeEntry.text === text && existingTreeEntry.tree) {
          tree = existingTreeEntry.tree;
        } else if (stepParser) {
          tree = stepParser.parse(text);
          if (tree) {
            this.documentManager.documentTrees.set(textDocument.uri, { text, tree, classCache: new Map() });
          }
        }

        const { indexStepDocument } = await import("@modelscript/step");
        const serverDistBase = (this.parserService as any)?.serverDistBase ?? (globalThis as any).serverDistBase;
        await indexStepDocument(
          this.workspaceManager.unifiedWorkspace,
          textDocument.uri,
          buffer,
          serverDistBase ? { serverDistBase } : undefined,
        );

        const unifiedIndex = this.workspaceManager.unifiedWorkspace.getIndex();
        if (this.workspaceManager.globalModelicaQueryEngine) {
          this.workspaceManager.globalModelicaQueryEngine.updateIndex(unifiedIndex);
        }
        if (this.workspaceManager.globalSysML2QueryEngine) {
          this.workspaceManager.globalSysML2QueryEngine.updateIndex(unifiedIndex);
        }

        if (!this.workspaceManager.globalStepQueryEngine) {
          this.workspaceManager.globalStepQueryEngine = new QueryEngine(unifiedIndex, {} as any);
          this.workspaceManager.setQueryEngine?.("step", this.workspaceManager.globalStepQueryEngine);
        } else {
          this.workspaceManager.globalStepQueryEngine.updateIndex(unifiedIndex);
        }
        this.syncWorkspaceStateAfterIndex(textDocument.uri);

        const engine = this.workspaceManager.globalStepQueryEngine;
        const bridge = new LSPBridge(unifiedIndex, engine, new PositionIndex(text), textDocument.uri, {
          documentLSPBridges: this.documentLSPBridges,
          documents: this.documentManager.documents,
          sharedFs: this.parserService?.sharedContext?.fs ?? this.documentManager?.sharedContext?.fs,
        });
        this.documentLSPBridges.set(textDocument.uri, bridge);

        if (tree) {
          const collectErrors = (node: any) => {
            if (!node) return;
            if (typeof node.hasError === "function" ? !node.hasError() : node.hasError === false) return;
            if (node.isMissing || node.type === "ERROR") {
              const startOff = typeof node.startOffset === "number" ? node.startOffset : node.startIndex;
              const endOff = typeof node.endOffset === "number" ? node.endOffset : node.endIndex;
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
      } catch (e: any) {
        this.connection.console.error(
          `[step] Error in STEP pipeline for ${textDocument.uri}: ${e.message}\n${e.stack}`,
        );
      }

      const { validateStepReferencesAndSchema } = await import("@modelscript/step");
      stepDiagnostics.push(
        ...(validateStepReferencesAndSchema(text, (off) => textDocument.positionAt(off)) as Diagnostic[]),
      );

      const contentChanged = this.lastIndexedText.get(textDocument.uri) !== text;
      this.lastIndexedText.set(textDocument.uri, text);
      this.lastStepOwnDiagnostics.set(textDocument.uri, { text, diagnostics: [...stepDiagnostics] });
      await this.finalizeCrossLanguageValidation({
        uri: textDocument.uri,
        effectiveUri: textDocument.uri,
        text,
        langId: "step",
        tree: this.documentManager.documentTrees.get(textDocument.uri)?.tree,
        textDocument,
        diagnostics: stepDiagnostics,
        hasSyntaxErrors: stepDiagnostics.some((d) => d.severity === DiagnosticSeverity.Error),
        contentChanged,
      });
    };

    const promise = run().finally(() => {
      const current = this.inFlightStepValidations.get(textDocument.uri);
      if (current?.promise === promise) {
        this.inFlightStepValidations.delete(textDocument.uri);
      }
    });
    this.inFlightStepValidations.set(textDocument.uri, { text, promise });
    await promise;
  }

  /**
   * Runs OWL2 Functional Syntax linting, lowers CST axioms into the shared ontology store,
   * and executes tableau consistency reasoning.
   */
  private async postValidateOwl2(
    effectiveUri: string,
    tree: any,
    text: string,
    diagnostics: Diagnostic[],
  ): Promise<void> {
    try {
      const { lintOwl2Document } = await import("@modelscript/owl2");
      const owlLints = lintOwl2Document(tree.rootNode, text, { checkConsistency: false });
      const posIndex = new PositionIndex(text);
      for (const od of owlLints) {
        const start = posIndex.charOffsetToPosition(od.startOffset);
        const end = posIndex.charOffsetToPosition(od.endOffset);
        const severity =
          od.severity === "error"
            ? DiagnosticSeverity.Error
            : od.severity === "info"
              ? DiagnosticSeverity.Information
              : DiagnosticSeverity.Warning;
        diagnostics.push({
          severity,
          range: { start, end },
          code: `O${od.code}`,
          message: od.message,
          source: "owl2",
        });
      }

      const { lowerCstToAxioms } = await import("@modelscript/owl2");
      const axioms = lowerCstToAxioms(tree.rootNode, text);
      const store = this.workspaceManager?.unifiedWorkspace?.owl2Store;
      let delta: any = undefined;
      if (store && typeof store.setAxioms === "function") {
        delta = store.setAxioms(effectiveUri, axioms);
      }

      const versions = new Map<string, number>();
      const mIndex = this.workspaceManager.getWorkspaceIndex?.("modelica");
      if (mIndex) versions.set("modelica", mIndex.version);
      const sIndex = this.workspaceManager.getWorkspaceIndex?.("sysml2");
      if (sIndex) versions.set("sysml2", sIndex.version);

      if (
        !this.reasonerService?.updateAndReason &&
        store?.axioms &&
        typeof this.reasonerService?.reasoner?.loadOntology === "function"
      ) {
        this.reasonerService.reasoner.loadOntology(store.axioms);
      }

      const consistency = this.reasonerService?.updateAndReason
        ? this.reasonerService.updateAndReason(versions, delta)
        : this.reasonerService?.reasoner?.checkConsistency();

      this.routeReasonerDiagnostics(effectiveUri, consistency, diagnostics, "owl2-reasoner");
    } catch (reasonerError: any) {
      this.connection.console.error(`[owl2-reasoner] Reasoner failed: ${reasonerError.message}`);
    }
  }

  /**
   * Updates the ontological reasoner after SysML v2 validation and routes any logical contradictions to affected documents.
   */
  private postValidateSysml2(effectiveUri: string, diagnostics: Diagnostic[]): void {
    try {
      const versions = new Map<string, number>();
      const sysml2Index = this.workspaceManager.getWorkspaceIndex?.("sysml2");
      if (sysml2Index) versions.set("sysml2", sysml2Index.version);

      const consistency = this.reasonerService?.updateAndReason
        ? this.reasonerService.updateAndReason(versions)
        : this.reasonerService?.reasoner?.checkConsistency();

      this.routeReasonerDiagnostics(effectiveUri, consistency, diagnostics, "sysml2-reasoner");
    } catch (e: any) {
      this.connection.console.error(`[sysml2-reasoner] Update failed: ${e.message}`);
    }
  }

  /**
   * Updates the ontological reasoner after Modelica validation when OWL2 axioms are present in the workspace.
   */
  private postValidateModelicaReasoner(effectiveUri: string, diagnostics: Diagnostic[]): void {
    try {
      const store = this.workspaceManager?.unifiedWorkspace?.owl2Store;
      if (!store || !store.axioms || store.axioms.length === 0) return;

      const versions = new Map<string, number>();
      const mIndex = this.workspaceManager.getWorkspaceIndex?.("modelica");
      if (mIndex) versions.set("modelica", mIndex.version);

      const consistency = this.reasonerService?.updateAndReason
        ? this.reasonerService.updateAndReason(versions)
        : this.reasonerService?.reasoner?.checkConsistency();

      this.routeReasonerDiagnostics(effectiveUri, consistency, diagnostics, "modelica-reasoner");
    } catch (e: any) {
      this.connection.console.error(`[modelica-reasoner] Update failed: ${e.message}`);
    }
  }

  /**
   * Updates the ontological reasoner after polyglot document validation across any of the 81 languages.
   * Projects the file's SymbolIndex into BFO/IOF OWL2 axioms and triggers incremental reasoning.
   */
  private postValidatePolyglotReasoner(effectiveUri: string, langId: string, diagnostics: Diagnostic[]): void {
    try {
      const wsIdx = this.workspaceManager.getWorkspaceIndex?.(langId);
      const fileIdx =
        wsIdx?.getFileIndex?.(effectiveUri) ?? this.workspaceManager?.unifiedWorkspace?.getFileIndex?.(effectiveUri);
      if (!fileIdx) return;

      const store = this.workspaceManager?.unifiedWorkspace?.owl2Store;
      if (!store) return;

      const axioms =
        fileIdx.symbols && fileIdx.symbols.size > 0
          ? SemanticAxiomProjector.projectSymbolIndex(fileIdx, {
              sourceLang: langId,
              sourceUri: effectiveUri,
              basePrefix: `${langId}:`,
            })
          : [];

      let delta: any = undefined;
      const key = `${langId}:${effectiveUri}`;
      if (typeof (store as any).setAxioms === "function") {
        delta = (store as any).setAxioms(key, axioms);
      }

      const versions = new Map<string, number>();
      const ver = wsIdx?.version ?? this.workspaceManager?.unifiedWorkspace?.version;
      if (typeof ver === "number") versions.set(langId, ver);

      const consistency = this.reasonerService?.updateAndReason
        ? this.reasonerService.updateAndReason(versions, delta)
        : this.reasonerService?.reasoner?.checkConsistency();

      this.routeReasonerDiagnostics(effectiveUri, consistency, diagnostics, `${langId}-reasoner`);
    } catch (e: any) {
      this.connection.console.error(`[${langId}-reasoner] Polyglot reasoner update failed: ${e.message}`);
    }
  }

  /**
   * Scans cross-language workspace indices for parameter drift and model divergence.
   * Emits M5104 diagnostics with clickable relatedInformation links to counterpart declarations.
   */
  private postValidatePolyglotDrift(effectiveUri: string, _langId: string, diagnostics: Diagnostic[]): void {
    try {
      const isExternalLibraryUri = (u: string): boolean =>
        u.startsWith("modelica:") ||
        u.startsWith("sysml2://stdlib/") ||
        u.startsWith("library-bundle:") ||
        u.includes("/modelscript_registry/") ||
        u.startsWith("/lib/") ||
        u.startsWith("/packages/") ||
        u.startsWith("file:///lib/") ||
        u.startsWith("file:///packages/");

      const sources: PolyglotModelSource[] = [];
      const seenUris = new Set<string>();
      const pushFileSymbols = (pId: string, fUri: string, fIdx: any) => {
        if (!fIdx?.symbols || seenUris.has(fUri)) return;
        seenUris.add(fUri);
        if (fUri !== effectiveUri && isExternalLibraryUri(fUri)) return;
        for (const sym of fIdx.symbols.values()) {
          const val =
            sym.metadata?.value ??
            sym.metadata?.nominal ??
            sym.metadata?.defaultValue ??
            (sym.metadata?.variability === "parameter" && typeof sym.metadata?.binding === "number"
              ? sym.metadata.binding
              : undefined);
          if (val !== undefined && typeof val === "number" && Number.isFinite(val)) {
            const parent = sym.parentId ? fIdx.symbols.get(sym.parentId) : undefined;
            const fileBase = stripFileExtension(fUri.split("/").pop() || "") || sym.name;
            const compName = parent ? parent.name : fileBase;
            sources.push({
              lang: pId,
              uri: fUri,
              component: compName,
              param: sym.name,
              value: val,
              startOffset: sym.startOffset,
              endOffset: sym.endOffset,
            });
          }
        }
      };

      const plugins = globalLanguageRegistry.getAllPlugins();
      for (const plugin of plugins) {
        const pId = plugin.id;
        const wsIdx = plugin.workspaceIndex ?? this.workspaceManager?.getWorkspaceIndex?.(pId);
        if (!wsIdx) continue;

        const files: Map<string, any> | undefined = wsIdx.files ?? wsIdx.fileIndices;
        if (files) {
          for (const [fUri, fIdx] of files.entries()) {
            pushFileSymbols(pId, fUri, fIdx);
          }
        }
      }

      const unifiedWs = this.workspaceManager?.unifiedWorkspace;
      if (unifiedWs && typeof unifiedWs.listDocumentUris === "function") {
        for (const fUri of unifiedWs.listDocumentUris()) {
          const fIdx = unifiedWs.getNativeFileIndex?.(fUri) ?? unifiedWs.getFileIndex?.(fUri);
          const pId = globalLanguageRegistry.getPluginForUri(fUri)?.id ?? _langId;
          pushFileSymbols(pId, fUri, fIdx);
        }
      }

      if (sources.length < 2) return;

      const violations = PolyglotDriftChecker.checkDrift(sources, { tolerance: 0.001 });
      const norm = (u: string) => u.replace(/^([a-z0-9+-]+):\/{1,3}/i, "$1:///");
      const targetUri = norm(effectiveUri);

      for (const v of violations) {
        if (norm(v.sourceA.uri) === targetUri || norm(v.sourceB.uri) === targetUri) {
          const isA = norm(v.sourceA.uri) === targetUri;
          const mySource = isA ? v.sourceA : v.sourceB;
          const otherSource = isA ? v.sourceB : v.sourceA;

          const textDoc = this.documentManager.documents.get(effectiveUri);
          const start =
            textDoc && mySource.startOffset !== undefined
              ? textDoc.positionAt(mySource.startOffset)
              : { line: 0, character: 0 };
          const end =
            textDoc && mySource.endOffset !== undefined
              ? textDoc.positionAt(mySource.endOffset)
              : { line: 0, character: 10 };

          const otherDoc = this.documentManager.documents.get(otherSource.uri);
          const otherStart =
            otherDoc && otherSource.startOffset !== undefined
              ? otherDoc.positionAt(otherSource.startOffset)
              : { line: 0, character: 0 };
          const otherEnd =
            otherDoc && otherSource.endOffset !== undefined
              ? otherDoc.positionAt(otherSource.endOffset)
              : { line: 0, character: 10 };

          const otherFile = otherSource.uri.split("/").pop() || otherSource.uri;
          const pct = (v.relativeDiscrepancy * 100).toFixed(1);

          const diag: Diagnostic = {
            severity: v.relativeDiscrepancy > 0.2 ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
            range: { start, end },
            code: "M5104",
            source: "modelscript-drift-checker",
            message: `Cross-language parameter drift: '${mySource.param}' in ${mySource.lang.toUpperCase()} (${mySource.value}) diverges from ${otherSource.lang.toUpperCase()} (${otherSource.value}) in '${otherFile}' by ${pct}%.`,
            relatedInformation: [
              {
                location: {
                  uri: otherSource.uri,
                  range: { start: otherStart, end: otherEnd },
                },
                message: `Counterpart declaration: '${otherSource.param} = ${otherSource.value}' in ${otherSource.lang.toUpperCase()}`,
              },
            ],
            data: {
              code: "M5104",
              component: v.componentName,
              param: mySource.param,
              currentValue: mySource.value,
              suggestedValue: otherSource.value,
              sourceLang: mySource.lang,
              counterpartLang: otherSource.lang,
              counterpartUri: otherSource.uri,
            },
          };

          diagnostics.push(diag);
        }
      }
    } catch (e: any) {
      this.connection.console.error?.(`[drift-checker] Drift check failed: ${e.message}`);
    }
  }

  /**
   * Maps minimal conflict cores and unsat explanations from the description logic reasoner
   * back to source document ranges and publishes cross-document diagnostics.
   */
  private routeReasonerDiagnostics(
    currentUri: string,
    consistency: any,
    currentSemanticDiagnostics: Diagnostic[],
    source: string,
  ): void {
    if (!consistency) return;

    const newDiagsByUri = new Map<string, Diagnostic[]>();

    if (!consistency.isConsistent) {
      const explanation = consistency.explanation || "Ontology inconsistency detected";
      const candidateAxioms: any[] = [];
      if (consistency.minimalConflictCore && consistency.minimalConflictCore.length > 0) {
        candidateAxioms.push(...consistency.minimalConflictCore);
      }
      if (consistency.conflictingAxioms && consistency.conflictingAxioms.length > 0) {
        candidateAxioms.push(...consistency.conflictingAxioms);
      }

      const targetIris: string[] = [];
      for (const axiom of candidateAxioms) {
        if (axiom.type === "SubClassOf") {
          if (axiom.subClassIri) targetIris.push(axiom.subClassIri);
          if (axiom.superClassIri) targetIris.push(axiom.superClassIri);
        } else if (axiom.type === "DisjointClasses") {
          if (axiom.subClassIri) targetIris.push(axiom.subClassIri);
          if (Array.isArray(axiom.classIris)) targetIris.push(...axiom.classIris);
        } else if (axiom.type === "ClassAssertion") {
          if (axiom.individualIri) targetIris.push(axiom.individualIri);
          if (axiom.classIri) targetIris.push(axiom.classIri);
        } else if (axiom.type === "EquivalentClasses") {
          if (Array.isArray(axiom.classIris)) targetIris.push(...axiom.classIris);
        } else if (axiom.type === "ObjectPropertyAssertion") {
          if (axiom.subjectIri) targetIris.push(axiom.subjectIri);
          if (axiom.objectIri) targetIris.push(axiom.objectIri);
          if (axiom.propertyIri) targetIris.push(axiom.propertyIri);
        } else if (axiom.iri) {
          targetIris.push(axiom.iri);
        }
      }

      // Determine if this is a BFO disjointness / category violation
      const isBfoViolation =
        explanation.toLowerCase().includes("bfo") ||
        candidateAxioms.some((a) => {
          const s = JSON.stringify(a);
          return s.includes("bfo:") || s.includes("Continuant") || s.includes("Occurrent");
        });
      const diagCode = isBfoViolation ? "M4102" : "M4101";

      const buildRelatedInfo = (targetUri: string, targetRange: any) => {
        const related: any[] = [];
        for (const ax of candidateAxioms) {
          const iris: string[] = [
            (ax as any).subClassIri,
            (ax as any).superClassIri,
            (ax as any).individualIri,
            (ax as any).classIri,
            ...(Array.isArray((ax as any).classIris) ? (ax as any).classIris : []),
            (ax as any).subjectIri,
            (ax as any).objectIri,
            (ax as any).iri,
          ].filter(Boolean);

          for (const iri of iris) {
            const loc = this.findDeclarationLocation(iri);
            if (
              loc &&
              (loc.uri !== targetUri ||
                loc.range.start.line !== targetRange.start.line ||
                loc.range.start.character !== targetRange.start.character)
            ) {
              if (
                !related.some(
                  (r) =>
                    r.location.uri === loc.uri &&
                    r.location.range.start.line === loc.range.start.line &&
                    r.location.range.start.character === loc.range.start.character,
                )
              ) {
                related.push({
                  location: { uri: loc.uri, range: loc.range },
                  message: `Conflicting axiom (${ax.type}) involves '${iri}'`,
                });
              }
            }
          }
        }
        return related.length > 0 ? related : undefined;
      };

      const seenRangesByUri = new Map<string, Set<string>>();

      const addDiag = (locUri: string, range: any) => {
        if (!locUri || !range) return;
        let uriSeen = seenRangesByUri.get(locUri);
        if (!uriSeen) {
          uriSeen = new Set<string>();
          seenRangesByUri.set(locUri, uriSeen);
        }
        const rangeKey = `${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`;
        if (!uriSeen.has(rangeKey)) {
          uriSeen.add(rangeKey);
          let uriDiags = newDiagsByUri.get(locUri);
          if (!uriDiags) {
            uriDiags = [];
            newDiagsByUri.set(locUri, uriDiags);
          }
          const msgPrefix =
            locUri.endsWith(".owl") ||
            locUri.endsWith(".owl2") ||
            locUri.endsWith(".ofn") ||
            locUri.endsWith(".fss") ||
            locUri.endsWith(".ttl")
              ? "Ontology inconsistency: "
              : "Logical contradiction: ";
          const relInfo = buildRelatedInfo(locUri, range);
          const diag: Diagnostic = {
            severity: DiagnosticSeverity.Error,
            range,
            code: diagCode,
            message: `${msgPrefix}${explanation}`,
            source,
            data: {
              code: diagCode,
              minimalConflictCore: consistency.minimalConflictCore,
              minimalCorrectionSubsets: consistency.minimalCorrectionSubsets,
              explanation,
            },
          };
          if (relInfo && relInfo.length > 0) {
            diag.relatedInformation = relInfo;
          }
          uriDiags.push(diag);
        }
      };

      const candidateUris = new Set<string>([currentUri, ...this.documentManager.documents.keys()]);

      const store = this.workspaceManager?.unifiedWorkspace?.owl2Store;
      if (store && (store as any)._axiomsBySource) {
        for (const k of (store as any)._axiomsBySource.keys()) {
          if (k.includes(":") || k.includes("/")) {
            candidateUris.add(k);
          }
        }
      }

      for (const targetIri of targetIris) {
        const declLoc = this.findDeclarationLocation(targetIri);
        if (declLoc) {
          addDiag(declLoc.uri, declLoc.range);
        }

        for (const cUri of candidateUris) {
          const r = this.findRangeForIri(targetIri, cUri);
          if (r) {
            addDiag(cUri, r);
          }
        }
      }

      if (store && (store as any)._axiomsBySource) {
        for (const [sourceKey, sourceAxioms] of (store as any)._axiomsBySource.entries()) {
          if (sourceKey.includes(":") || sourceKey.includes("/")) {
            const hasConflict = sourceAxioms.some((sa: any) =>
              candidateAxioms.some(
                (ca: any) =>
                  ca.type === sa.type &&
                  (ca.type === "DisjointClasses"
                    ? Array.isArray(ca.classIris) &&
                      Array.isArray(sa.classIris) &&
                      ca.classIris.every((i: string) => sa.classIris.includes(i))
                    : ca.subClassIri === sa.subClassIri && ca.superClassIri === sa.superClassIri),
              ),
            );
            if (hasConflict) {
              let r: any = null;
              const doc = this.documentManager.documents.get(sourceKey);
              if (doc) {
                const text = doc.getText();
                const idx = text.indexOf("DisjointClasses");
                if (idx !== -1) {
                  r = {
                    start: doc.positionAt(idx),
                    end: doc.positionAt(idx + "DisjointClasses".length),
                  };
                }
              }
              if (!r && candidateAxioms[0]?.classIris?.[0]) {
                r = this.findRangeForIri(candidateAxioms[0].classIris[0], sourceKey);
              }
              if (r) {
                addDiag(sourceKey, r);
              }
            }
          }
        }
      }

      const isOwlFile =
        currentUri.endsWith(".owl") ||
        currentUri.endsWith(".owl2") ||
        currentUri.endsWith(".ofn") ||
        currentUri.endsWith(".fss") ||
        currentUri.endsWith(".ttl");
      if (isOwlFile && (!newDiagsByUri.has(currentUri) || (newDiagsByUri.get(currentUri)?.length ?? 0) === 0)) {
        let fallbackRange = {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 10 },
        };
        const doc = this.documentManager.documents.get(currentUri);
        if (doc) {
          const docText = doc.getText();
          const ontologyIdx = docText.indexOf("Ontology(");
          if (ontologyIdx !== -1) {
            fallbackRange = {
              start: doc.positionAt(ontologyIdx),
              end: doc.positionAt(ontologyIdx + "Ontology(".length),
            };
          }
        }
        let uriDiags = newDiagsByUri.get(currentUri);
        if (!uriDiags) {
          uriDiags = [];
          newDiagsByUri.set(currentUri, uriDiags);
        }
        uriDiags.push({
          severity: DiagnosticSeverity.Error,
          range: fallbackRange,
          message: `Ontology inconsistency: ${explanation}`,
          source,
        });
      }
    }

    const allKnownUris = new Set<string>([...this.reasonerDiagnosticsByUri.keys(), ...newDiagsByUri.keys()]);

    for (const uri of allKnownUris) {
      const newDiags = newDiagsByUri.get(uri) || [];
      if (newDiags.length === 0) {
        const hadPrevious = this.reasonerDiagnosticsByUri.has(uri);
        this.reasonerDiagnosticsByUri.delete(uri);
        if (hadPrevious && uri !== currentUri) {
          const base = (this.lastSemanticDiagnostics.get(uri) || []).filter((d) => !d.source?.includes("reasoner"));
          this.lastSemanticDiagnostics.set(uri, base);
          this.connection.sendDiagnostics({ uri, diagnostics: base });
        }
      } else {
        this.reasonerDiagnosticsByUri.set(uri, newDiags);
        if (uri === currentUri) {
          currentSemanticDiagnostics.push(...newDiags);
        } else {
          const existing = (this.lastSemanticDiagnostics.get(uri) || []).filter((d) => !d.source?.includes("reasoner"));
          const merged = deduplicateAllDiagnostics([...existing, ...newDiags]);
          this.lastSemanticDiagnostics.set(uri, merged);
          this.connection.sendDiagnostics({ uri, diagnostics: merged });
        }
      }
    }
  }

  /**
   * Merges polyglot digital thread diagnostics into cached per-document diagnostics without
   * clobbering existing syntax/semantic lints, then pushes updated diagnostics to the client.
   */
  public mergeDigitalThreadDiagnostics(diagsByUri: Map<string, Diagnostic[]>): void {
    const allKnownUris = new Set<string>([...this.digitalThreadDiagnosticsByUri.keys(), ...diagsByUri.keys()]);
    let didChange = false;
    for (const uri of allKnownUris) {
      const next = diagsByUri.get(uri) || [];
      if (next.length === 0) {
        const hadPrev = this.digitalThreadDiagnosticsByUri.has(uri);
        this.digitalThreadDiagnosticsByUri.delete(uri);
        if (hadPrev) {
          const base = this.applyDiagnosticFilters(
            (this.lastSemanticDiagnostics.get(uri) || []).filter((d) => d.source !== "modelscript-digital-thread"),
          );
          this.lastSemanticDiagnostics.set(uri, base);
          this.connection.sendDiagnostics({ uri, diagnostics: base });
          didChange = true;
        }
      } else {
        this.digitalThreadDiagnosticsByUri.set(uri, next);
        const existing = (this.lastSemanticDiagnostics.get(uri) || []).filter(
          (d) => d.source !== "modelscript-digital-thread",
        );
        const merged = this.applyDiagnosticFilters(deduplicateAllDiagnostics([...existing, ...next]));
        this.lastSemanticDiagnostics.set(uri, merged);
        this.connection.sendDiagnostics({ uri, diagnostics: merged });
        didChange = true;
      }
    }
    if (didChange) {
      this.requestCodeLensRefresh();
    }
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
        | { getAllDocumentEntries?: () => Array<{ uri?: string; text?: string }> }
        | undefined;
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
    if (this.isDigitalThreadRunning) return;
    const openDocs = this.documentManager?.documents?.all?.() ?? [];
    const byUri = new Map<string, { uri: string; fileName: string; content: string }>();
    const addDoc = (uri: string, content: string) => {
      const key = uri.replace(/^([a-z0-9+-]+):\/(?!\/)/i, "$1:///").toLowerCase();
      if (byUri.has(key) || /^(builtin|modelica|msl):/i.test(uri) || !content.trim()) return;
      byUri.set(key, { uri, fileName: uri.split(/[\\/]/).pop() || uri, content });
    };
    for (const d of openDocs) addDoc(d.uri, d.getText());
    const unifiedWs = this.workspaceManager?.unifiedWorkspace as unknown as
      | {
          getAllDocumentEntries?: () => Array<{ uri?: string; text?: string }>;
          getIndex?: (opts?: { eager?: boolean }) => unknown;
        }
      | undefined;
    if (unifiedWs && typeof unifiedWs.getAllDocumentEntries === "function") {
      for (const e of unifiedWs.getAllDocumentEntries()) {
        if (e?.uri && e.text) addDoc(e.uri, e.text);
      }
    }

    // Fallback: when a single file:// document is opened outside a workspace index, scan sibling files asynchronously with a 5s TTL cache
    if (/^file:\/\//i.test(triggerUri) && typeof process !== "undefined") {
      try {
        const procBuiltin = process as unknown as { getBuiltinModule?: (id: string) => unknown };
        const nodeFs = procBuiltin.getBuiltinModule?.("node:fs") as
          | {
              promises?: {
                readdir: (
                  p: string,
                  opts: { withFileTypes: boolean },
                ) => Promise<Array<{ isFile: () => boolean; name: string }>>;
                stat: (p: string) => Promise<{ size: number }>;
                readFile: (p: string, enc: string) => Promise<string>;
              };
            }
          | undefined;
        const nodePath = procBuiltin.getBuiltinModule?.("node:path") as
          | { dirname: (p: string) => string; extname: (p: string) => string; join: (...p: string[]) => string }
          | undefined;
        const nodeUrl = procBuiltin.getBuiltinModule?.("node:url") as
          | { fileURLToPath: (u: string) => string; pathToFileURL: (p: string) => { href: string } }
          | undefined;
        if (nodeFs?.promises && nodePath && nodeUrl) {
          const triggerDir = nodePath.dirname(nodeUrl.fileURLToPath(triggerUri));
          const now = Date.now();
          const cachedDir = this.siblingDirCache.get(triggerDir);
          if (cachedDir && now - cachedDir.ts < 5000) {
            for (const f of cachedDir.files) {
              addDoc(f.uri, f.content);
            }
          } else {
            const siblingExts = new Set([
              ".sysml",
              ".mo",
              ".sp",
              ".spice",
              ".cir",
              ".scad",
              ".inp",
              ".cfd",
              ".urdf",
              ".step",
              ".stp",
              ".reqif",
              ".owl",
              ".omn",
              ".ttl",
              ".ofn",
              ".owl2",
            ]);
            const entries = await nodeFs.promises.readdir(triggerDir, { withFileTypes: true });
            const scannedFiles: Array<{ uri: string; content: string }> = [];
            for (const entry of entries) {
              if (!entry.isFile()) continue;
              const ext = nodePath.extname(entry.name).toLowerCase();
              if (!siblingExts.has(ext)) continue;
              const fullPath = nodePath.join(triggerDir, entry.name);
              const sibUri = nodeUrl.pathToFileURL(fullPath).href;
              const sibKey = sibUri.replace(/^([a-z0-9+-]+):\/(?!\/)/i, "$1:///").toLowerCase();
              if (!byUri.has(sibKey)) {
                try {
                  const stat = await nodeFs.promises.stat(fullPath);
                  if (stat.size <= 1024 * 1024) {
                    const content = await nodeFs.promises.readFile(fullPath, "utf-8");
                    scannedFiles.push({ uri: sibUri, content });
                    addDoc(sibUri, content);
                  }
                } catch {
                  // Ignore unreadable sibling file
                }
              }
            }
            if (this.siblingDirCache.size >= 32) {
              const oldest = this.siblingDirCache.keys().next().value;
              if (oldest !== undefined) this.siblingDirCache.delete(oldest);
            }
            this.siblingDirCache.set(triggerDir, { ts: now, files: scannedFiles });
          }
        }
      } catch {
        // Ignore inaccessible disk directory
      }
    }

    const files = Array.from(byUri.values());
    const uniqueExts = new Set(files.map((f) => f.fileName.split(".").pop()?.toLowerCase() ?? "").filter(Boolean));
    const hasDirectives = files.some(
      (f) =>
        f.content.includes("@twin:") ||
        f.content.includes("@port_map:") ||
        f.content.includes("@mesh_source:") ||
        f.content.includes("annotation(twin"),
    );
    if (files.length < 2 || (!hasDirectives && uniqueExts.size < 2)) {
      this.lastDigitalThreadFingerprint = "";
      if (this.digitalThreadDiagnosticsByUri.size > 0) {
        this.mergeDigitalThreadDiagnostics(new Map());
      }
      return;
    }

    const fingerprint = files
      .map((f) => `${f.uri}:${f.content.length}:${f.content.slice(0, 64)}:${f.content.slice(-64)}`)
      .sort()
      .join("|");
    if (fingerprint === this.lastDigitalThreadFingerprint && this.digitalThreadDiagnosticsByUri.size > 0) {
      return;
    }

    this.isDigitalThreadRunning = true;
    const docVersionsAtStart = new Map<string, number>();
    if (this.documentManager?.documents && typeof this.documentManager.documents.all === "function") {
      for (const d of this.documentManager.documents.all()) {
        docVersionsAtStart.set(d.uri, d.version);
      }
    }
    try {
      const [{ createPolyglotCoordinator }, providers] = await Promise.all([
        import("@modelscript/runtime"),
        this.getPolyglotProviders(),
      ]);
      const { evaluatePolyglotDigitalThreadFromFiles } = createPolyglotCoordinator(
        providers as unknown as Parameters<typeof createPolyglotCoordinator>[0],
      );
      const symbolIndex = typeof unifiedWs?.getIndex === "function" ? unifiedWs.getIndex({ eager: false }) : undefined;
      type ThreadOptions = NonNullable<Parameters<typeof evaluatePolyglotDigitalThreadFromFiles>[2]>;
      const threadRes = evaluatePolyglotDigitalThreadFromFiles(files, undefined, {
        symbolIndex: symbolIndex as ThreadOptions["symbolIndex"],
      });
      const diagsByUri = new Map<string, Diagnostic[]>();
      const threadEdits =
        "suggestedEdits" in threadRes && Array.isArray(threadRes.suggestedEdits) ? threadRes.suggestedEdits : [];
      const artifacts = "artifacts" in threadRes && Array.isArray(threadRes.artifacts) ? threadRes.artifacts : [];

      for (const art of artifacts) {
        const targetUri = art.uri || files[art.index]?.uri;
        if (!targetUri) continue;
        const artEdits = threadEdits.filter((se) => (se.uri ?? files[se.fileIndex]?.uri) === targetUri);
        const mapped: Diagnostic[] = (art.diagnostics ?? []).map((d) => ({
          range: {
            start: { line: Math.max(0, (d.startLine ?? 1) - 1), character: Math.max(0, (d.startCol ?? 1) - 1) },
            end: { line: Math.max(0, (d.endLine ?? 1) - 1), character: Math.max(0, (d.endCol ?? 12) - 1) },
          },
          severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
          code: d.code ?? "POLYGLOT_TWIN_DRIFT",
          source: "modelscript-digital-thread",
          message: d.message,
          data: { suggestedEdits: artEdits.length > 0 ? artEdits : threadEdits },
        }));
        diagsByUri.set(targetUri, mapped);
      }
      let isStale = false;
      if (this.documentManager?.documents && typeof this.documentManager.documents.all === "function") {
        for (const d of this.documentManager.documents.all()) {
          const prev = docVersionsAtStart.get(d.uri);
          if (prev !== undefined && d.version !== prev) {
            isStale = true;
            break;
          }
        }
      }
      if (!isStale) {
        this.lastDigitalThreadFingerprint = fingerprint;
        this.mergeDigitalThreadDiagnostics(diagsByUri);
      }
    } catch {
      // Non-fatal background check
    } finally {
      this.isDigitalThreadRunning = false;
    }
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
    try {
      const text = textDocument.getText();
      if (!hasWordMatch(text, "algorithm")) return;
      const { validateModelicaAbstractInterpretation } = await import("@modelscript/modelica");
      const cached = this.documentManager.documentTrees.get(effectiveUri);
      const res = validateModelicaAbstractInterpretation({
        text,
        positionAt: (offset) => textDocument.positionAt(offset),
        cstRoot: cached?.tree?.rootNode,
        moParser: this.parserService?.getParser?.("modelica"),
        onError: (msg) => this.connection?.console?.error?.(msg),
      });
      if (!res) return;
      this.modelicaProofResultsByUri.set(effectiveUri, res.proofMap);
      if (textDocument.uri !== effectiveUri) {
        this.modelicaProofResultsByUri.set(textDocument.uri, res.proofMap);
      }
      this.requestCodeLensRefresh();
      this.emitVerificationStatus(textDocument.uri);
      for (const d of res.diagnostics) {
        diagnostics.push(d as unknown as Diagnostic);
      }
    } catch (err: any) {
      this.connection?.console?.error?.(`[modelica-prover] Error in abstract interpretation: ${err?.message}`);
    }
  }

  /** Per-class DAE verification results keyed by `<uri>#<class>`; valid while the DAE fingerprint matches (K5). */
  private daeVerificationCache = new Map<string, { fingerprint: string; record: any }>();

  /** Wall-clock budget (ms) for keystroke-tier DAE verification of one document. Classes beyond it are left unverified. */
  public daeVerificationBudgetMs = process.env["TEST_TIMEOUT"] || process.env["CI"] ? 5000 : 150;

  /**
   * Flattens a Modelica class through the canonical arena pipeline
   * (`sharedContext.flattenArena` -> `ArenaQueryFlattener`). Returns `null` when flattening is
   * unavailable or fails; callers then report nothing instead of guessing from source text (K6).
   */
  protected flattenModelicaClassForVerification(name: string, symbolId: number, uri: string): any | null {
    const ctx = this.parserService?.sharedContext as any;
    if (!ctx || typeof ctx.flattenArena !== "function") return null;
    try {
      return (
        ctx.flattenArena(name, symbolId, uri, {
          deadlineMs: Date.now() + Math.max(50, this.daeVerificationBudgetMs),
        }) ?? null
      );
    } catch (err: any) {
      this.connection.console.debug?.(`[verification] Could not flatten '${name}' (${uri}): ${err?.message ?? err}`);
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
    const engine: any =
      this.workspaceManager?.globalModelicaQueryEngine ?? this.workspaceManager?.getQueryEngine?.("modelica");
    const symbols: Map<number, any> | undefined = engine?.index?.symbols;
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
      const classKind = (entry.metadata?.classKind as string | undefined) ?? "class";
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
    const emptyMap = new Map<string, any>();
    this.modelicaDaeVerificationResultsByUri.set(effectiveUri, emptyMap);
    this.daeVerificationResultsByUri.set(effectiveUri, emptyMap);
    try {
      const classes = this.listModelicaClassesForUri(effectiveUri);
      if (classes.length === 0) return;

      const [{ extractModelicaTwinAnnotations, parseSysmlRequirements }, { validateModelicaDaeReachability }] =
        await Promise.all([import("@modelscript/runtime"), import("@modelscript/modelica")]);

      const text = textDocument.getText();
      const twinMap = extractModelicaTwinAnnotations(text);
      const taggedSysmlReqs: TaggedSysmlRequirement[] = [];
      const allSysmlDocs: SysmlDocSource[] = [];
      const seenSysmlUris = new Set<string>();
      const packageJsonTexts: string[] = [];

      let candidateDocs: any[] = [];
      if (typeof (this.documentManager.documents as any)?.all === "function") {
        candidateDocs = (this.documentManager.documents as any).all();
      } else if (typeof (this.documentManager.documents as any)?.values === "function") {
        candidateDocs = Array.from((this.documentManager.documents as any).values());
      }
      const getCachedSysmlReqs = (sUri: string, sText: string): any[] => {
        const cached = this.parsedSysmlReqsCache.get(sUri);
        if (cached && cached.text === sText) {
          return cached.reqs;
        }
        const reqs = parseSysmlRequirements(sText);
        if (this.parsedSysmlReqsCache.size >= 128) {
          const oldest = this.parsedSysmlReqsCache.keys().next().value;
          if (oldest !== undefined) this.parsedSysmlReqsCache.delete(oldest);
        }
        this.parsedSysmlReqsCache.set(sUri, { text: sText, reqs });
        return reqs;
      };
      for (const d of candidateDocs) {
        const dUri = d?.uri || "";
        const lang = d?.languageId || "";
        const dText = typeof d?.getText === "function" ? d.getText() : d?.text;
        if (typeof dText !== "string") continue;
        if (dUri.endsWith("/package.json") || dUri === "package.json") {
          packageJsonTexts.push(dText);
        } else if (
          dUri.endsWith(".sysml") ||
          dUri.endsWith(".sysml2") ||
          dUri.endsWith(".kerml") ||
          lang === "sysml2"
        ) {
          seenSysmlUris.add(dUri);
          allSysmlDocs.push({ uri: dUri, text: dText });
          for (const req of getCachedSysmlReqs(dUri, dText)) {
            taggedSysmlReqs.push({ req, sourceUri: dUri });
          }
        }
      }
      if (this.documentManager.documentTrees) {
        for (const [tUri, entry] of this.documentManager.documentTrees.entries()) {
          if (typeof entry?.text !== "string") continue;
          if (tUri.endsWith("/package.json") || tUri === "package.json") {
            packageJsonTexts.push(entry.text);
          } else if (
            !seenSysmlUris.has(tUri) &&
            (tUri.endsWith(".sysml") || tUri.endsWith(".sysml2") || tUri.endsWith(".kerml"))
          ) {
            seenSysmlUris.add(tUri);
            allSysmlDocs.push({ uri: tUri, text: entry.text });
            for (const req of getCachedSysmlReqs(tUri, entry.text)) {
              taggedSysmlReqs.push({ req, sourceUri: tUri });
            }
          }
        }
      }

      const activeCompliance = resolveActiveComplianceProfiles({
        modelText: text,
        allSysmlDocs,
        packageJsonTexts,
        twinAnnotations: twinMap,
        activeStandardOverrides: this.activeStandardOverrides,
      });
      const sysmlReqs = filterRequirementsForModel(taggedSysmlReqs, activeCompliance);
      const reqFingerprint = computeRequirementsFingerprint(sysmlReqs);
      const cachedTree = this.documentManager.documentTrees.get(effectiveUri);
      const rootCst = cachedTree?.tree?.rootNode ?? (cachedTree?.tree as any)?.tree?.rootNode;

      const res = await validateModelicaDaeReachability({
        effectiveUri,
        text,
        positionAt: (offset) => textDocument.positionAt(offset),
        classes,
        flattenClass: (name, symbolId, uri) => this.flattenModelicaClassForVerification(name, symbolId, uri),
        extractArenaStringParams: (arena) => this.extractArenaStringParams(arena),
        rootCst,
        sysmlReqs,
        reqFingerprint,
        twinMap,
        daeVerificationCache: this.daeVerificationCache,
        budgetMs: this.daeVerificationBudgetMs,
        formalVerificationOnSave: Boolean(this.diagnosticsConfig.formalVerificationOnSave),
        onWarn: (msg) => this.connection?.console?.warn?.(msg),
        onError: (msg) => this.connection?.console?.error?.(msg),
      });

      this.modelicaDaeVerificationResultsByUri.set(effectiveUri, res.daeMap);
      this.daeVerificationResultsByUri.set(effectiveUri, res.daeMap);
      if (textDocument.uri !== effectiveUri) {
        this.modelicaDaeVerificationResultsByUri.set(textDocument.uri, res.daeMap);
        this.daeVerificationResultsByUri.set(textDocument.uri, res.daeMap);
      }
      this.requestCodeLensRefresh();
      this.emitVerificationStatus(textDocument.uri);
      for (const d of res.diagnostics) {
        diagnostics.push(d as unknown as Diagnostic);
      }
    } catch (err: any) {
      this.connection?.console?.error?.(`[modelica-dae-verifier] Error in DAE verification: ${err?.message}`);
    }
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
   * Populates lightweight top-level class instance wrappers in `workspaceManager` for project and library tree views.
   */
  private populateClassWrappers(effectiveUri: string, uri: string, unifiedIndex: any, engine: any, context: any): void {
    const db = engine?.toQueryDB
      ? engine.toQueryDB()
      : {
          childrenOf: (id: number) => {
            const childIds = unifiedIndex.childrenOf?.get(id) || [];
            return childIds.map((cid: any) => unifiedIndex.symbols.get(cid)).filter(Boolean);
          },
          symbol: (id: number) => unifiedIndex.symbols.get(id) || null,
          query: (_name: string, _id: number) => null,
          cstNode: (id: number) => this.workspaceManager.getCstNodeForSymbol(unifiedIndex.symbols.get(id)),
        };

    const thisDocInstances: any[] = [];
    const normUri = (u: string) => {
      if (!u) return "";
      let s = u;
      try {
        s = decodeURIComponent(u);
      } catch {}
      return s.replace(/^([a-z0-9+-]+):\/{1,3}/i, "$1:///");
    };
    const matchEffective = normUri(effectiveUri);
    const matchUri = normUri(uri);
    const matchesResource = (resId: string) => {
      if (!resId) return false;
      if (resId === uri || resId === effectiveUri) return true;
      const normRes = normUri(resId);
      return (
        normRes === matchEffective ||
        normRes === matchUri ||
        (matchEffective.startsWith("file:///") && normRes === matchEffective.substring(7)) ||
        (matchUri.startsWith("file:///") && normRes === matchUri.substring(7))
      );
    };

    const resourceSymbolIds =
      unifiedIndex.symbolsByResource?.get(effectiveUri) ?? unifiedIndex.symbolsByResource?.get(uri);
    const symbolsToCheck =
      resourceSymbolIds && resourceSymbolIds.length > 0
        ? (resourceSymbolIds.map((id: any) => [id, unifiedIndex.symbols.get(id)]).filter(([, e]: any) => e) as Iterable<
            [any, any]
          >)
        : unifiedIndex.symbols;

    for (const [id, entry] of symbolsToCheck) {
      if (!entry || !entry.resourceId || !matchesResource(entry.resourceId)) continue;
      if (entry.kind !== "Class" && entry.kind !== "Def") continue;
      if (entry.parentId !== null) {
        const parentEntry = unifiedIndex.symbols.get(entry.parentId);
        if (parentEntry && parentEntry.resourceId && matchesResource(parentEntry.resourceId)) continue;
      }
      const wrapper = {
        id,
        db,
        entry,
        name: entry.name ?? "",
        kind: entry.kind ?? "Class",
        classKind: (entry.metadata as any)?.classKind ?? "class",
        compositeName: entry.name ?? "",
        description: (entry.metadata as any)?.description ?? null,
        isClassInstance: true,
      };
      thisDocInstances.push(wrapper);
    }
    this.workspaceManager.workspaceInstances.set(uri, thisDocInstances);
    this.workspaceManager.workspaceInstances.set(effectiveUri, thisDocInstances);
    this.workspaceManager.documentInstances.set(uri, thisDocInstances);
    this.workspaceManager.documentInstances.set(effectiveUri, thisDocInstances);
    if (context) {
      this.workspaceManager.documentContexts.set(uri, context);
      this.workspaceManager.documentContexts.set(effectiveUri, context);
    }
  }

  /**
   * Executes SysML v2 verification cases in `uri` by flattening and simulating linked Modelica models
   * and evaluating requirement constraints against simulated trajectories.
   */
  async runVerificationForUri(
    uri: string,
    progressReporter?: LspWorkDoneProgressReporter,
  ): Promise<{ ok: boolean; error?: string | undefined }> {
    try {
      const textDocument = this.documentManager.documents.get(uri);
      if (!textDocument) throw new Error("Document not found");

      if (this.activeVerification) this.activeVerification.abort();
      this.activeVerification = new AbortController();
      const signal = this.activeVerification.signal;

      if (progressReporter) {
        progressReporter.abortController.signal.addEventListener("abort", () => {
          this.activeVerification?.abort();
        });
      }

      const db = this.workspaceManager.unifiedWorkspace.getIndex();
      const fileNodes = Array.from(db.symbols.values()).filter(
        (s: any) =>
          s.resourceId === textDocument.uri &&
          (s.ruleName === "VerifyRequirementUsage" ||
            s.ruleName === "AnalysisCaseDefinition" ||
            s.ruleName === "AnalysisCaseUsage" ||
            s.ruleName === "VerificationCaseDefinition" ||
            s.ruleName === "VerificationCaseUsage"),
      );

      if (fileNodes.length === 0) {
        progressReporter?.done("No verification cases found");
        return { ok: true };
      }

      progressReporter?.report(10, `Found ${fileNodes.length} verification case(s). Initializing engines...`);

      const resolveLazyTree = (
        entryUri: string,
      ):
        | {
            tree:
              | import("../utils/ast-utils.js").CstTreeLike
              | import("../utils/ast-utils.js").XmlFallbackTree
              | import("../utils/cst-facade.js").Tree;
            text: string;
          }
        | undefined => {
        let lazyCache = this.documentManager.lazyLibTrees.get(entryUri);
        if (!lazyCache) {
          try {
            const fsPath = entryUri.startsWith("file://") ? entryUri.substring(7) : entryUri;
            const text = this.parserService.sharedContext?.fs.read(fsPath);
            if (text) {
              const lower = entryUri.toLowerCase();
              const isSysml = lower.endsWith(".sysml") || lower.endsWith(".sysml2") || lower.endsWith(".kerml");
              const entryPlugin = globalLanguageRegistry.getPluginForUri(entryUri);
              const parser = this.parserService.getParserForUri(entryUri);
              const tree = isLargeXmlForWasm(entryUri, text, entryPlugin)
                ? parseXmlFallbackTree(text)
                : parser
                  ? parser.parse(text)
                  : this.parserService.sharedContext?.parse(isSysml ? ".sysml" : ".mo", text);
              if (tree) {
                lazyCache = { tree, text };
                this.documentManager.lazyLibTrees.set(entryUri, lazyCache);
              }
            }
          } catch {
            /* ignore */
          }
        }
        return lazyCache;
      };

      const verifyCstTreeWrapper = {
        getText: (startOffset: number, endOffset: number, entry?: { resourceId?: string }): string | null => {
          if (!entry || !entry.resourceId) return null;
          const entryUri = entry.resourceId;
          const docTree = this.documentManager.documentTrees.get(entryUri);
          if (docTree && docTree.text) return docTree.text.substring(startOffset, endOffset);

          const lazyCache = resolveLazyTree(entryUri);
          if (lazyCache) return lazyCache.text.substring(startOffset, endOffset);

          const doc = this.documentManager.documents.get(entryUri);
          if (doc) return doc.getText().substring(startOffset, endOffset);
          return null;
        },
        getNode: (startOffset: number, endOffset: number, entry?: any): any | null => {
          if (!entry || !entry.resourceId) return null;
          const entryUri = entry.resourceId;
          const docTree = this.documentManager.documentTrees.get(entryUri);
          if (docTree && docTree.tree) {
            const root = docTree.tree.rootNode ?? (docTree.tree as any)?.tree?.rootNode;
            if (root && typeof root.descendantForIndex === "function") {
              return root.descendantForIndex(startOffset, Math.max(startOffset, endOffset));
            }
            return root ?? null;
          }

          const lazyCache = resolveLazyTree(entryUri);
          if (lazyCache && lazyCache.tree) {
            const root = lazyCache.tree.rootNode ?? (lazyCache.tree as { tree?: CstTreeLike }).tree?.rootNode;
            const rootWithLookup = root as
              | (CstNodeLike & { descendantForIndex?: (start: number, end: number) => CstNodeLike | null })
              | undefined;
            if (rootWithLookup && typeof rootWithLookup.descendantForIndex === "function") {
              return rootWithLookup.descendantForIndex(startOffset, Math.max(startOffset, endOffset));
            }
            return root ?? null;
          }

          const doc = this.documentManager.documents.get(entryUri);
          if (doc) {
            const text = doc.getText();
            let tree: any;
            const entryPlugin = globalLanguageRegistry.getPluginForUri(entryUri);
            const parser = this.parserService.getParserForUri(entryUri);
            if (isLargeXmlForWasm(entryUri, text, entryPlugin)) {
              tree = parseXmlFallbackTree(text);
            } else if (parser) {
              tree = parser.parse(text);
            } else if (this.parserService.sharedContext) {
              const ext = entryUri.includes(".") ? entryUri.substring(entryUri.lastIndexOf(".")) : ".mo";
              tree = this.parserService.sharedContext.parse(ext, text);
            }
            if (tree) {
              this.documentManager.documentTrees.set(entryUri, { text, tree, classCache: new Map() });
              const root = tree.rootNode ?? (tree as any)?.tree?.rootNode;
              if (root && typeof root.descendantForIndex === "function") {
                return root.descendantForIndex(startOffset, Math.max(startOffset, endOffset));
              }
              return root ?? null;
            }
          }
          return null;
        },
      };

      const sysmlFactory =
        (globalThis as any).createSysML2QueryEngine ??
        (globalThis as any).create_sysml2_query_engine ??
        globalLanguageRegistry.getPluginForLanguageIdOrUri("sysml2")?.createQueryEngine;
      const sysmlEngine = typeof sysmlFactory === "function" ? sysmlFactory(db, verifyCstTreeWrapper) : null;
      if (!sysmlEngine) {
        progressReporter?.done("SysML v2 query engine unavailable");
        return { ok: false };
      }
      const sysmlDB = sysmlEngine.toQueryDB();
      const newDiagnostics: Diagnostic[] = [];
      const allResults: any[] = [];

      let caseIdx = 0;
      for (const verifyUsage of fileNodes) {
        if (signal.aborted || progressReporter?.isCancelled) {
          progressReporter?.done("Verification cancelled");
          return { ok: false };
        }
        caseIdx++;
        const caseProgress = 10 + Math.round((caseIdx / fileNodes.length) * 80);
        progressReporter?.report(caseProgress, `Simulating & verifying case ${caseIdx}/${fileNodes.length}...`);

        const topo = sysmlDB.query("extractTopology", (verifyUsage as any).id) as any;
        if (!topo || topo.rootIds.length === 0) continue;

        const rootNode = topo.nodes.get(topo.rootIds[0]);
        if (!rootNode?.targetClassId) continue;

        let simTargetId = rootNode.targetClassId;
        const targetEntry = db.symbols.get(rootNode.targetClassId);

        if (targetEntry) {
          const implNeedle1 = `implements="${targetEntry.name}"`;
          const implNeedle2 = `::${targetEntry.name}"`;
          for (const entry of db.symbols.values()) {
            if (entry.kind !== "Class" && entry.kind !== "Def") continue;
            const resId = entry.resourceId;
            if (
              !resId ||
              resId.startsWith("modelica:") ||
              resId.startsWith("sysml2://stdlib/") ||
              resId.startsWith("library-bundle:") ||
              resId.startsWith("builtin:")
            ) {
              continue;
            }
            const loadedText =
              this.documentManager.documentTrees.get(resId)?.text ??
              this.documentManager.documents.get(resId)?.getText?.();
            if (loadedText !== undefined) {
              if (!loadedText.includes(implNeedle1) && !loadedText.includes(implNeedle2)) continue;
              const slice = loadedText.substring(entry.startOffset, entry.endOffset);
              if (slice.includes(implNeedle1) || slice.includes(implNeedle2)) {
                simTargetId = entry.id;
                break;
              }
              continue;
            }
            const text = sysmlDB.cstText(entry.startOffset, entry.endOffset, entry);
            if (text && (text.includes(implNeedle1) || text.includes(implNeedle2))) {
              simTargetId = entry.id;
              break;
            }
          }
        }

        const finalEntry = db.symbols.get(simTargetId);
        let targetEngine = undefined;
        if (finalEntry && finalEntry.resourceId) {
          targetEngine = finalEntry.resourceId.endsWith(".sysml")
            ? this.workspaceManager.globalSysML2QueryEngine
            : this.workspaceManager.globalModelicaQueryEngine;
          if (!targetEngine && finalEntry.resourceId.endsWith(".mo")) {
            const moFactory =
              (globalThis as any).createModelicaQueryEngine ??
              (globalThis as any).create_modelica_query_engine ??
              globalLanguageRegistry.getPluginForLanguageIdOrUri("modelica")?.createQueryEngine;
            if (typeof moFactory === "function") {
              targetEngine = moFactory(db, verifyCstTreeWrapper);
            }
          }
        }

        const targetDB = targetEngine
          ? (targetEngine as any).toQueryDB()
          : (this.workspaceManager.unifiedWorkspace as any).engine?.toQueryDB() || sysmlDB;
        const targetModel = {
          id: simTargetId,
          name: targetDB.symbol(simTargetId)?.name ?? "",
          compositeName: targetDB.symbol(simTargetId)?.name ?? "",
        };

        const context = this.parserService.sharedContext;
        if (!context) {
          progressReporter?.done("Context not initialized");
          return { ok: false, error: "Context not initialized" };
        }
        const flattenFn = (globalThis as any).flattenArenaFromInstance;
        if (typeof flattenFn !== "function") {
          progressReporter?.done("Flattener not available");
          return { ok: false, error: "Flattener not available" };
        }
        const arena = flattenFn(targetModel, context);
        let arenaSimResult: ReturnType<typeof simulateArena>;
        const simParameters: { name: string; value: number | string | boolean }[] = [];
        try {
          const exp = (arena as any)?.experiment ?? {};
          const startTime = exp.startTime ?? 0;
          const stopTime = exp.stopTime ?? 10;
          const numIntervals = exp.numberOfIntervals;
          const step = exp.interval ?? (numIntervals && numIntervals > 0 ? (stopTime - startTime) / numIntervals : 0.1);

          arenaSimResult = simulateArena(arena, {
            startTime,
            stopTime,
            step,
            atol: exp.tolerance,
            rtol: exp.tolerance,
            solver: exp.algorithm as any,
          });

          if (signal.aborted || progressReporter?.isCancelled) {
            progressReporter?.done("Verification cancelled");
            return { ok: false };
          }

          const paramInfo = getArenaParameterInfo(arena);
          for (const p of paramInfo) {
            simParameters.push({ name: p.name, value: p.defaultValue });
          }
          for (const [sName, sVal] of this.extractArenaStringParams(arena).entries()) {
            simParameters.push({ name: sName, value: sVal });
          }
        } finally {
          (arena as { free?: () => void } | null)?.free?.();
        }

        const simResult = {
          t: arenaSimResult.t,
          states: arenaSimResult.states,
          y: arenaSimResult.y,
          parameters: simParameters,
        };

        const runner = new VerificationRunner(sysmlDB, topo.variableMap);
        const vResults = runner.verifyCase((verifyUsage as any).id, simResult);
        allResults.push(...vResults);

        const bridge = this.documentLSPBridges.get(uri);
        if (bridge) {
          const diags: Diagnostic[] = vResults
            .filter((v) => !v.isSatisfied)
            .map((v) => ({
              range: this.findRangeForIri(v.constraintId as unknown as string, uri) || {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 0 },
              },
              message: v.message || "Constraint violated",
              severity: DiagnosticSeverity.Error,
              source: "sysml2-verifier",
              code: v.standardClause ? "S5020" : "M5102",
              data: {
                constraintId: v.constraintId,
                standardClause: v.standardClause,
                margin: v.margin,
                requiredLimit: (v as any).requiredLimit ?? v.limitValue,
                suggestedValue: (v as any).suggestedValue ?? v.limitValue,
              },
            }));
          newDiagnostics.push(...diags);
        }
      }

      if (signal.aborted || progressReporter?.isCancelled) {
        progressReporter?.done("Verification cancelled");
        return { ok: false };
      }

      this.lastAutoVerifiedText.set(uri, textDocument.getText());
      this.verificationDiagnosticsByUri.set(uri, newDiagnostics);
      this.verificationResultsByUri.set(uri, allResults);
      this.requestCodeLensRefresh();
      this.emitVerificationStatus(uri);

      this.validateTextDocument(textDocument);
      progressReporter?.report(100, `Completed ${fileNodes.length} verification case(s)`);
      progressReporter?.done("Verification completed successfully");
      return { ok: true };
    } catch (e: any) {
      progressReporter?.done(`Verification error: ${e.message}`);
      this.connection.console.error(`[sysml2-verifier] Error: ${e.message}\n${e.stack}`);

      const crashDiag: Diagnostic = {
        severity: DiagnosticSeverity.Error,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        message: `Verification CRASHED: ${e.message}`,
        source: "sysml2-verifier",
      };
      this.verificationDiagnosticsByUri.set(uri, [crashDiag]);
      const doc = this.documentManager.documents.get(uri);
      if (doc) {
        this.lastAutoVerifiedText.set(uri, doc.getText());
        this.validateTextDocument(doc);
      }

      return { ok: false };
    }
  }

  /**
   * Resolves an ontology IRI or qualified symbol name to a 0-based line/character range within `currentUri`.
   */
  private findRangeForIri(
    iri: string,
    currentUri: string,
  ): { start: { line: number; character: number }; end: { line: number; character: number } } | null {
    if (!iri) return null;

    const candidates: string[] = [iri];
    if (iri.includes("#")) {
      const frag = iri.split("#").pop()!;
      if (frag && !candidates.includes(frag)) candidates.push(frag);
    }
    if (iri.includes("/")) {
      const segment = iri.split("/").pop()!;
      if (segment && !candidates.includes(segment)) candidates.push(segment);
    }
    if (iri.includes(":")) {
      const local = iri.split(":").pop()!;
      if (local && !candidates.includes(local)) candidates.push(local);
    }

    const db = this.workspaceManager.unifiedWorkspace.getIndex();
    for (const cand of candidates) {
      const nameIds = db.byName.get(cand);
      if (nameIds && nameIds.length > 0) {
        for (const id of nameIds) {
          const entry = db.symbols.get(id);
          if (
            entry &&
            (typeof entry.startOffset === "number" || typeof entry.startOffset === "number") &&
            (typeof entry.endOffset === "number" || typeof entry.endOffset === "number")
          ) {
            const matchesUri =
              entry.resourceId === currentUri ||
              (entry.resourceId && currentUri.endsWith(entry.resourceId)) ||
              (entry.resourceId && entry.resourceId.endsWith(currentUri));
            if (matchesUri) {
              const idRange =
                entry.fieldRanges?.["declaredName"] ?? entry.fieldRanges?.["name"] ?? entry.fieldRanges?.["id"];
              const startOff = idRange?.startOffset ?? entry.startOffset;
              const endOff = idRange?.endOffset ?? entry.endOffset;
              const docTree = this.documentManager.documentTrees.get(currentUri);
              if (docTree && docTree.tree) {
                const root = docTree.tree.rootNode ?? (docTree.tree as any)?.tree?.rootNode;
                if (root && typeof root.descendantForIndex === "function") {
                  const node = root.descendantForIndex(startOff, Math.max(startOff, endOff));
                  if (node && node.startPosition && node.endPosition) {
                    return {
                      start: { line: node.startPosition.row, character: node.startPosition.column },
                      end: { line: node.endPosition.row, character: node.endPosition.column },
                    };
                  }
                }
              }
              const doc = this.documentManager.documents.get(currentUri);
              if (doc) {
                return {
                  start: doc.positionAt(startOff),
                  end: doc.positionAt(endOff),
                };
              }
            }
          }
        }
      }
    }

    // Direct document text fallback
    const doc = this.documentManager.documents.get(currentUri);
    if (doc) {
      const text = doc.getText();
      for (const cand of candidates) {
        const idx = text.indexOf(cand);
        if (idx !== -1) {
          return {
            start: doc.positionAt(idx),
            end: doc.positionAt(idx + cand.length),
          };
        }
      }
    }

    return null;
  }

  /**
   * Locates the workspace URI and 0-based source range where the given ontology IRI or symbol is declared.
   */
  public findDeclarationLocation(iri: string): {
    uri: string;
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
  } | null {
    if (!iri) return null;

    const candidates: string[] = [iri];
    if (iri.includes("#")) {
      const frag = iri.split("#").pop()!;
      if (frag && !candidates.includes(frag)) candidates.push(frag);
    }
    if (iri.includes("/")) {
      const segment = iri.split("/").pop()!;
      if (segment && !candidates.includes(segment)) candidates.push(segment);
    }
    if (iri.includes(":")) {
      const local = iri.split(":").pop()!;
      if (local && !candidates.includes(local)) candidates.push(local);
    }

    const db = this.workspaceManager?.unifiedWorkspace?.getIndex?.();
    if (!db || !db.byName || !db.symbols) return null;

    for (const cand of candidates) {
      const nameIds = db.byName.get(cand);
      if (nameIds && nameIds.length > 0) {
        for (const id of nameIds) {
          const entry = db.symbols.get(id);
          if (
            entry &&
            entry.resourceId &&
            (typeof entry.startOffset === "number" || typeof entry.startOffset === "number") &&
            (typeof entry.endOffset === "number" || typeof entry.endOffset === "number")
          ) {
            const entryUri = entry.resourceId;
            const idRange =
              entry.fieldRanges?.["declaredName"] ?? entry.fieldRanges?.["name"] ?? entry.fieldRanges?.["id"];
            const startOff = idRange?.startOffset ?? entry.startOffset;
            const endOff = idRange?.endOffset ?? entry.endOffset;

            const docTree = this.documentManager.documentTrees.get(entryUri);
            if (docTree && docTree.tree) {
              const root = docTree.tree.rootNode ?? (docTree.tree as any)?.tree?.rootNode;
              if (root && typeof root.descendantForIndex === "function") {
                const node = root.descendantForIndex(startOff, Math.max(startOff, endOff));
                if (node && node.startPosition && node.endPosition) {
                  return {
                    uri: entryUri,
                    range: {
                      start: { line: node.startPosition.row, character: node.startPosition.column },
                      end: { line: node.endPosition.row, character: node.endPosition.column },
                    },
                  };
                }
              }
            }

            const doc = this.documentManager.documents.get(entryUri);
            if (doc) {
              return {
                uri: entryUri,
                range: {
                  start: doc.positionAt(startOff),
                  end: doc.positionAt(endOff),
                },
              };
            }

            let lazyCache = this.documentManager.lazyLibTrees.get(entryUri);
            if (!lazyCache && this.parserService?.sharedContext) {
              try {
                const fsPath = entryUri.startsWith("file://") ? entryUri.substring(7) : entryUri;
                const text = this.parserService.sharedContext.fs.read(fsPath);
                if (text) {
                  const ext = entryUri.includes(".") ? entryUri.substring(entryUri.lastIndexOf(".")) : ".mo";
                  const tree = this.parserService.sharedContext.parse(ext, text);
                  lazyCache = { tree, text };
                  this.documentManager.lazyLibTrees.set(entryUri, lazyCache);
                }
              } catch (e) {}
            }
            if (lazyCache && lazyCache.tree) {
              const root = lazyCache.tree.rootNode ?? (lazyCache.tree as any)?.tree?.rootNode;
              if (root && typeof root.descendantForIndex === "function") {
                const node = root.descendantForIndex(startOff, Math.max(startOff, endOff));
                if (node && node.startPosition && node.endPosition) {
                  return {
                    uri: entryUri,
                    range: {
                      start: { line: node.startPosition.row, character: node.startPosition.column },
                      end: { line: node.endPosition.row, character: node.endPosition.column },
                    },
                  };
                }
              }
            }
          }
        }
      }
    }

    return null;
  }
}
