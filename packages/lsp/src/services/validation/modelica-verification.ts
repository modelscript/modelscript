// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  isTypeLikeSymbol,
  type SymbolEntry,
  type SymbolIndex,
  type VerificationResult,
  VerificationRunner,
} from "@modelscript/runtime";
import { simulateArena } from "@modelscript/simulate";
import { type Connection, type Diagnostic, DiagnosticSeverity, type Range } from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { type LSPBridge, PositionIndex } from "../../lsp-bridge.js";
import { globalLanguageRegistry } from "../../registry/LanguageRegistry.js";
import { getArenaParameterInfo } from "../../utils/arena-utils.js";
import {
  type CstNodeLike,
  type CstTreeLike,
  isLargeXmlForWasm,
  parseXmlFallbackTree,
  type XmlFallbackTree,
} from "../../utils/ast-utils.js";
import type { Tree as FacadeTree } from "../../utils/cst-facade.js";
import type { LspWorkDoneProgressReporter } from "../../utils/progress-reporter.js";
import {
  computeRequirementsFingerprint,
  filterRequirementsForModel,
  resolveActiveComplianceProfiles,
  type SysmlDocSource,
  type TaggedSysmlRequirement,
} from "../compliance-profile-service.js";
import type { DocumentManager } from "../document-manager.js";
import type { ParserService } from "../parser-service.js";
import type { WorkspaceManager } from "../workspace-manager.js";
import { hasWordMatch, splitLinesPreserve } from "./text-helpers.js";

export type VerificationResultLike = VerificationResult & {
  requiredLimit?: unknown;
  suggestedValue?: unknown;
};

export interface ProofResultEntryLike {
  definiteBugs?: unknown[];
  potentialBugs?: unknown[];
  formattedMatrix?: string;
  summary?: {
    blockExitStates?: Map<number, unknown>;
    blockEntryStates?: Map<number, unknown>;
  };
}

export interface DaeVerificationEntryLike {
  issues?: Array<{ severity?: string; message?: string }>;
  verdict?: { kind?: string };
  unboundedVariables?: number;
  variableBounds?: Map<string, { isTop?: () => boolean; isBottom?: () => boolean; toString: () => string }>;
}

export interface ModelicaClassInfo {
  name: string;
  symbolId: number;
  startOffset: number;
  endOffset: number;
}

export interface ModelicaVerificationContext {
  connection: Connection;
  documentManager: DocumentManager;
  parserService: ParserService;
  workspaceManager: WorkspaceManager;
  documentLSPBridges: Map<string, LSPBridge>;
  modelicaProofResultsByUri: Map<string, Map<string, ProofResultEntryLike>>;
  modelicaDaeVerificationResultsByUri: Map<string, Map<string, DaeVerificationEntryLike>>;
  daeVerificationResultsByUri: Map<string, Map<string, DaeVerificationEntryLike>>;
  verificationDiagnosticsByUri: Map<string, Diagnostic[]>;
  verificationResultsByUri: Map<string, VerificationResultLike[]>;
  daeVerificationCache: Map<string, { fingerprint: string; record: unknown }>;
  parsedSysmlReqsCache: Map<string, { text: string; reqs: unknown[] }>;
  lastAutoVerifiedText: Map<string, string>;
  activeStandardOverrides?: ReadonlyMap<string, boolean> | undefined;
  daeVerificationBudgetMs: number;
  formalVerificationOnSave: boolean;
  getActiveVerification: () => AbortController | null;
  setActiveVerification: (ctrl: AbortController | null) => void;
  requestCodeLensRefresh: (delayMs?: number) => void;
  emitVerificationStatus: (uri: string) => void;
  listModelicaClassesForUri: (uri: string) => ModelicaClassInfo[];
  flattenModelicaClassForVerification: (name: string, symbolId: number, uri: string) => unknown | null;
  extractArenaStringParams: (arena: unknown) => Map<string, string>;
  findRangeForIri: (iri: string, currentUri: string) => Range | null;
  validateTextDocument: (doc: TextDocument) => Promise<void>;
}

type LazyTreeUnion = CstTreeLike | XmlFallbackTree | FacadeTree;

interface QueryDbLike {
  query: (name: string, id: number) => unknown;
  symbol: (id: number) => SymbolEntry | null | undefined;
  cstText: (startOffset: number, endOffset: number, entry?: SymbolEntry) => string | null;
}

interface QueryEngineFactoryLike {
  (db: SymbolIndex, cstWrapper: unknown): { toQueryDB: () => QueryDbLike };
}

interface FlattenArenaFnLike {
  (model: { id: number; name: string; compositeName: string }, context: unknown): unknown;
}

interface GlobalVerificationHooks {
  createSysML2QueryEngine?: QueryEngineFactoryLike;
  create_sysml2_query_engine?: QueryEngineFactoryLike;
  createModelicaQueryEngine?: QueryEngineFactoryLike;
  create_modelica_query_engine?: QueryEngineFactoryLike;
  flattenArenaFromInstance?: FlattenArenaFnLike;
}

interface ArenaWithExperiment {
  experiment?: {
    startTime?: number;
    stopTime?: number;
    numberOfIntervals?: number;
    interval?: number;
    tolerance?: number;
    algorithm?: string;
  };
  free?: () => void;
}

function getErrorInfo(err: unknown): { message: string; stack?: string | undefined } {
  if (err instanceof Error) return { message: err.message, stack: err.stack };
  if (err && typeof err === "object" && "message" in err) {
    const obj = err as { message?: unknown; stack?: unknown };
    return {
      message: typeof obj.message === "string" ? obj.message : String(err),
      stack: typeof obj.stack === "string" ? obj.stack : undefined,
    };
  }
  return { message: String(err) };
}

function getDescendantFromTree(tree: unknown, startOffset: number, endOffset: number): unknown | null {
  if (!tree || typeof tree !== "object") return null;
  const candidate = tree as {
    rootNode?: CstNodeLike & { descendantForIndex?: (start: number, end: number) => CstNodeLike | null };
    tree?: { rootNode?: CstNodeLike & { descendantForIndex?: (start: number, end: number) => CstNodeLike | null } };
  };
  const root = candidate.rootNode ?? candidate.tree?.rootNode;
  if (root && typeof root.descendantForIndex === "function") {
    return root.descendantForIndex(startOffset, Math.max(startOffset, endOffset));
  }
  return root ?? null;
}

const MODELICA_DECL_KEYWORDS = new Set(["model", "block", "function", "class", "record", "connector", "package"]);

function isModelicaWordChar(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95;
}

function isModelicaWsChar(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\n";
}

function lineHasModelicaDecl(line: string, name: string): boolean {
  if (!name) return false;
  let searchFrom = 0;
  while (searchFrom < line.length) {
    const idx = line.indexOf(name, searchFrom);
    if (idx === -1) return false;
    const afterIdx = idx + name.length;
    const afterOk = afterIdx >= line.length || !isModelicaWordChar(line[afterIdx]!);
    if (afterOk && idx > 0 && isModelicaWsChar(line[idx - 1]!)) {
      let kwEnd = idx - 1;
      while (kwEnd > 0 && isModelicaWsChar(line[kwEnd - 1]!)) kwEnd--;
      let kwStart = kwEnd;
      while (kwStart > 0 && isModelicaWordChar(line[kwStart - 1]!)) kwStart--;
      if (kwStart < kwEnd && MODELICA_DECL_KEYWORDS.has(line.slice(kwStart, kwEnd))) {
        return true;
      }
    }
    searchFrom = idx + 1;
  }
  return false;
}

/**
 * Publishes a lightweight `modelscript/verificationStatus` notification summarizing formal proof
 * counts and per-declaration gutter markers for `uri`.
 */
export function emitVerificationStatusImpl(
  ctx: Pick<
    ModelicaVerificationContext,
    | "connection"
    | "documentManager"
    | "workspaceManager"
    | "documentLSPBridges"
    | "modelicaProofResultsByUri"
    | "modelicaDaeVerificationResultsByUri"
    | "verificationResultsByUri"
  >,
  uri: string,
): void {
  if (typeof ctx.connection?.sendNotification !== "function") return;
  const effectiveUri = uri.startsWith("modelscript-lib://global")
    ? "file://" + uri.substring("modelscript-lib://global".length)
    : uri;
  const proofMap = ctx.modelicaProofResultsByUri.get(uri) ?? ctx.modelicaProofResultsByUri.get(effectiveUri);
  const daeMap =
    ctx.modelicaDaeVerificationResultsByUri.get(uri) ?? ctx.modelicaDaeVerificationResultsByUri.get(effectiveUri);
  const sysmlResults = ctx.verificationResultsByUri.get(uri) ?? ctx.verificationResultsByUri.get(effectiveUri);

  let provenCount = 0;
  let unprovenCount = 0;
  let defectCount = 0;
  let unboundedVariables = 0;
  const markers: Array<{ line: number; status: "proven" | "unproven" | "defect"; label: string }> = [];

  const doc = ctx.documentManager?.documents?.get?.(uri) ?? ctx.documentManager?.documents?.get?.(effectiveUri);
  const docText = doc?.getText?.() ?? ctx.documentManager?.documentTrees?.get?.(uri)?.text ?? "";
  const lines = docText ? splitLinesPreserve(docText) : [];
  const posIndex = !doc?.positionAt && docText ? new PositionIndex(docText) : null;

  const bridge = (ctx.documentLSPBridges.get(uri) ?? ctx.documentLSPBridges.get(effectiveUri)) as unknown as
    { index?: SymbolIndex; engine?: { index?: SymbolIndex } } | undefined;
  const pluginId = globalLanguageRegistry.getPluginForUri(effectiveUri, docText)?.id ?? "modelica";
  const wsIdx =
    ctx.workspaceManager?.getWorkspaceIndex?.(pluginId) ??
    (pluginId !== "modelica" ? ctx.workspaceManager?.getWorkspaceIndex?.("modelica") : undefined);
  const symbolIndex: SymbolIndex | undefined =
    bridge?.index ??
    bridge?.engine?.index ??
    wsIdx?.getFileIndex?.(uri) ??
    wsIdx?.getFileIndex?.(effectiveUri) ??
    wsIdx?.getIndex?.();

  const offsetToLine = (offset: number): number => {
    if (doc?.positionAt) return doc.positionAt(offset).line;
    if (posIndex) return posIndex.charOffsetToPosition(offset).line;
    return 0;
  };

  const findDeclLine = (name: string): number => {
    if (!name) return 0;

    // 1. Prefer SymbolIndex lookup for accurate declaration line
    if (symbolIndex?.symbols) {
      const simpleName = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : name;
      const candidateIds = symbolIndex.byName?.get(simpleName) ?? symbolIndex.byName?.get(name);
      const candidates: SymbolEntry[] = [];
      if (candidateIds && candidateIds.length > 0) {
        for (const id of candidateIds) {
          const sym = symbolIndex.symbols.get(id);
          if (sym) candidates.push(sym);
        }
      } else {
        for (const sym of symbolIndex.symbols.values()) {
          if (sym.name === name || sym.name === simpleName) {
            candidates.push(sym);
          }
        }
      }
      const match =
        candidates.find(
          (s) =>
            (s.resourceId === uri || s.resourceId === effectiveUri) &&
            typeof s.startOffset === "number" &&
            isTypeLikeSymbol(s),
        ) ??
        candidates.find(
          (s) => (s.resourceId === uri || s.resourceId === effectiveUri) && typeof s.startOffset === "number",
        );
      if (match && typeof match.startOffset === "number") {
        return offsetToLine(match.startOffset);
      }
    }

    // 2. Fallback: zero-regex token scan on source lines
    if (lines.length === 0) return 0;
    for (let i = 0; i < lines.length; i++) {
      if (lineHasModelicaDecl(lines[i]!, name)) return i;
    }
    return 0;
  };

  if (proofMap) {
    for (const [name, rawProof] of proofMap.entries()) {
      const proof = rawProof as ProofResultEntryLike | undefined;
      const hasDef = (proof?.definiteBugs?.length ?? 0) > 0;
      const hasPot = (proof?.potentialBugs?.length ?? 0) > 0;
      const status: "proven" | "unproven" | "defect" = hasDef ? "defect" : hasPot ? "unproven" : "proven";
      if (status === "defect") defectCount++;
      else if (status === "unproven") unprovenCount++;
      else provenCount++;
      const label =
        status === "defect"
          ? `${name}: ${proof?.definiteBugs?.length ?? 0} formal defect(s)`
          : status === "unproven"
            ? `${name}: ${proof?.potentialBugs?.length ?? 0} unproven condition(s)`
            : `${name}: formally verified (0 RTEs)`;
      markers.push({ line: findDeclLine(name), status, label });
    }
  }

  if (daeMap) {
    for (const [name, rawDae] of daeMap.entries()) {
      const dae = rawDae as DaeVerificationEntryLike | undefined;
      const issues = dae?.issues ?? [];
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
    ctx.connection.sendNotification("modelscript/verificationStatus", {
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
 * Runs formal abstract interpretation over Modelica `algorithm` sections to prove absence of
 * runtime defects (division by zero, array out-of-bounds, uninitialized reads) or emit diagnostics.
 */
export async function postValidateModelicaAbstractInterpretationImpl(
  ctx: Pick<
    ModelicaVerificationContext,
    | "connection"
    | "documentManager"
    | "parserService"
    | "modelicaProofResultsByUri"
    | "requestCodeLensRefresh"
    | "emitVerificationStatus"
  >,
  effectiveUri: string,
  textDocument: TextDocument,
  diagnostics: Diagnostic[],
): Promise<void> {
  try {
    const text = textDocument.getText();
    if (!hasWordMatch(text, "algorithm")) return;
    const { validateModelicaAbstractInterpretation } = await import("@modelscript/modelica");
    const cached = ctx.documentManager.documentTrees.get(effectiveUri);
    const res = validateModelicaAbstractInterpretation({
      text,
      positionAt: (offset) => textDocument.positionAt(offset),
      cstRoot: cached?.tree?.rootNode,
      moParser: ctx.parserService?.getParser?.("modelica"),
      onError: (msg) => ctx.connection?.console?.error?.(msg),
    });
    if (!res) return;
    ctx.modelicaProofResultsByUri.set(effectiveUri, res.proofMap);
    if (textDocument.uri !== effectiveUri) {
      ctx.modelicaProofResultsByUri.set(textDocument.uri, res.proofMap);
    }
    ctx.requestCodeLensRefresh();
    ctx.emitVerificationStatus(textDocument.uri);
    for (const d of res.diagnostics) {
      diagnostics.push(d as unknown as Diagnostic);
    }
  } catch (err: unknown) {
    ctx.connection?.console?.error?.(
      `[modelica-prover] Error in abstract interpretation: ${getErrorInfo(err).message}`,
    );
  }
}

/**
 * Flattens Modelica classes in the document, performs BLT transformation, and runs
 * `DaeBltReachabilityEngine` and `HybridModeConsistencyVerifier` within `daeVerificationBudgetMs`.
 */
export async function postValidateModelicaDaeReachabilityImpl(
  ctx: Pick<
    ModelicaVerificationContext,
    | "connection"
    | "documentManager"
    | "modelicaDaeVerificationResultsByUri"
    | "daeVerificationResultsByUri"
    | "daeVerificationCache"
    | "parsedSysmlReqsCache"
    | "activeStandardOverrides"
    | "daeVerificationBudgetMs"
    | "formalVerificationOnSave"
    | "listModelicaClassesForUri"
    | "flattenModelicaClassForVerification"
    | "extractArenaStringParams"
    | "requestCodeLensRefresh"
    | "emitVerificationStatus"
  >,
  effectiveUri: string,
  textDocument: TextDocument,
  diagnostics: Diagnostic[],
): Promise<void> {
  const emptyMap = new Map<string, DaeVerificationEntryLike>();
  ctx.modelicaDaeVerificationResultsByUri.set(effectiveUri, emptyMap);
  ctx.daeVerificationResultsByUri.set(effectiveUri, emptyMap);
  try {
    const classes = ctx.listModelicaClassesForUri(effectiveUri);
    if (classes.length === 0) return;

    const [{ extractModelicaTwinAnnotations, parseSysmlRequirements }, { validateModelicaDaeReachability }] =
      await Promise.all([import("@modelscript/runtime"), import("@modelscript/modelica")]);

    const text = textDocument.getText();
    const twinMap = extractModelicaTwinAnnotations(text);
    const taggedSysmlReqs: TaggedSysmlRequirement[] = [];
    const allSysmlDocs: SysmlDocSource[] = [];
    const seenSysmlUris = new Set<string>();
    const packageJsonTexts: string[] = [];

    interface CandidateDocLike {
      uri?: string;
      languageId?: string;
      getText?: () => string;
      text?: string;
    }

    const docsMap = ctx.documentManager.documents as unknown as {
      all?: () => CandidateDocLike[];
      values?: () => Iterable<CandidateDocLike>;
    };
    let candidateDocs: CandidateDocLike[] = [];
    if (typeof docsMap?.all === "function") {
      candidateDocs = docsMap.all();
    } else if (typeof docsMap?.values === "function") {
      candidateDocs = Array.from(docsMap.values());
    }

    const getCachedSysmlReqs = (sUri: string, sText: string): ReturnType<typeof parseSysmlRequirements> => {
      const cached = ctx.parsedSysmlReqsCache.get(sUri);
      if (cached && cached.text === sText) {
        return cached.reqs as ReturnType<typeof parseSysmlRequirements>;
      }
      const reqs = parseSysmlRequirements(sText);
      if (ctx.parsedSysmlReqsCache.size >= 128) {
        const oldest = ctx.parsedSysmlReqsCache.keys().next().value;
        if (oldest !== undefined) ctx.parsedSysmlReqsCache.delete(oldest);
      }
      ctx.parsedSysmlReqsCache.set(sUri, { text: sText, reqs });
      return reqs;
    };

    for (const d of candidateDocs) {
      const dUri = d?.uri || "";
      const lang = d?.languageId || "";
      const dText = typeof d?.getText === "function" ? d.getText() : d?.text;
      if (typeof dText !== "string") continue;
      if (dUri.endsWith("/package.json") || dUri === "package.json") {
        packageJsonTexts.push(dText);
      } else if (dUri.endsWith(".sysml") || dUri.endsWith(".sysml2") || dUri.endsWith(".kerml") || lang === "sysml2") {
        seenSysmlUris.add(dUri);
        allSysmlDocs.push({ uri: dUri, text: dText });
        for (const req of getCachedSysmlReqs(dUri, dText)) {
          taggedSysmlReqs.push({ req, sourceUri: dUri });
        }
      }
    }

    if (ctx.documentManager.documentTrees) {
      for (const [tUri, entry] of ctx.documentManager.documentTrees.entries()) {
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
      activeStandardOverrides: ctx.activeStandardOverrides,
    });
    const sysmlReqs = filterRequirementsForModel(taggedSysmlReqs, activeCompliance);
    const reqFingerprint = computeRequirementsFingerprint(sysmlReqs);
    const cachedTree = ctx.documentManager.documentTrees.get(effectiveUri);
    const rootCst =
      cachedTree?.tree?.rootNode ?? (cachedTree?.tree as { tree?: { rootNode?: unknown } } | undefined)?.tree?.rootNode;

    const res = await validateModelicaDaeReachability({
      effectiveUri,
      text,
      positionAt: (offset) => textDocument.positionAt(offset),
      classes,
      flattenClass: (name, symbolId, uri) =>
        (symbolId !== undefined ? ctx.flattenModelicaClassForVerification(name, symbolId, uri) : null) as ReturnType<
          Parameters<typeof validateModelicaDaeReachability>[0]["flattenClass"]
        >,
      extractArenaStringParams: (arena) => ctx.extractArenaStringParams(arena),
      rootCst: rootCst as Parameters<typeof validateModelicaDaeReachability>[0]["rootCst"],
      sysmlReqs,
      reqFingerprint,
      twinMap,
      daeVerificationCache: ctx.daeVerificationCache as Parameters<
        typeof validateModelicaDaeReachability
      >[0]["daeVerificationCache"],
      budgetMs: ctx.daeVerificationBudgetMs,
      formalVerificationOnSave: ctx.formalVerificationOnSave,
      onWarn: (msg) => ctx.connection?.console?.warn?.(msg),
      onError: (msg) => ctx.connection?.console?.error?.(msg),
    });

    ctx.modelicaDaeVerificationResultsByUri.set(effectiveUri, res.daeMap);
    ctx.daeVerificationResultsByUri.set(effectiveUri, res.daeMap);
    if (textDocument.uri !== effectiveUri) {
      ctx.modelicaDaeVerificationResultsByUri.set(textDocument.uri, res.daeMap);
      ctx.daeVerificationResultsByUri.set(textDocument.uri, res.daeMap);
    }
    ctx.requestCodeLensRefresh();
    ctx.emitVerificationStatus(textDocument.uri);
    for (const d of res.diagnostics) {
      diagnostics.push(d as unknown as Diagnostic);
    }
  } catch (err: unknown) {
    ctx.connection?.console?.error?.(`[modelica-dae-verifier] Error in DAE verification: ${getErrorInfo(err).message}`);
  }
}

/**
 * Populates lightweight top-level class instance wrappers in `workspaceManager` for project and library tree views.
 */
export function populateClassWrappersImpl(
  workspaceManager: WorkspaceManager,
  effectiveUri: string,
  uri: string,
  unifiedIndex: SymbolIndex,
  engine: { toQueryDB?: () => unknown } | null | undefined,
  context: unknown,
): void {
  const db = engine?.toQueryDB
    ? engine.toQueryDB()
    : {
        childrenOf: (id: number) => {
          const childIds = unifiedIndex.childrenOf?.get(id) || [];
          return childIds.map((cid) => unifiedIndex.symbols.get(cid)).filter(Boolean);
        },
        symbol: (id: number) => unifiedIndex.symbols.get(id) || null,
        query: (_name: string, _id: number) => null,
        cstNode: (id: number) => workspaceManager.getCstNodeForSymbol(unifiedIndex.symbols.get(id)),
      };

  const thisDocInstances: Array<Record<string, unknown>> = [];
  const normUri = (u: string) => {
    if (!u) return "";
    let s = u;
    try {
      s = decodeURIComponent(u);
    } catch {
      // keep raw uri
    }
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
  const symbolsToCheck: Iterable<[number, SymbolEntry]> =
    resourceSymbolIds && resourceSymbolIds.length > 0
      ? resourceSymbolIds
          .map((id): [number, SymbolEntry | undefined] => [id, unifiedIndex.symbols.get(id)])
          .filter((pair): pair is [number, SymbolEntry] => Boolean(pair[1]))
      : unifiedIndex.symbols;

  for (const [id, entry] of symbolsToCheck) {
    if (!entry || !entry.resourceId || !matchesResource(entry.resourceId)) continue;
    if (entry.kind !== "Class" && entry.kind !== "Def") continue;
    if (entry.parentId !== null) {
      const parentEntry = unifiedIndex.symbols.get(entry.parentId);
      if (parentEntry && parentEntry.resourceId && matchesResource(parentEntry.resourceId)) continue;
    }
    const meta = entry.metadata as Record<string, unknown> | undefined;
    const wrapper = {
      id,
      db,
      entry,
      name: entry.name ?? "",
      kind: entry.kind ?? "Class",
      classKind: meta?.["classKind"] ?? "class",
      compositeName: entry.name ?? "",
      description: meta?.["description"] ?? null,
      isClassInstance: true,
    };
    thisDocInstances.push(wrapper);
  }
  workspaceManager.workspaceInstances.set(uri, thisDocInstances);
  workspaceManager.workspaceInstances.set(effectiveUri, thisDocInstances);
  workspaceManager.documentInstances.set(uri, thisDocInstances);
  workspaceManager.documentInstances.set(effectiveUri, thisDocInstances);
  if (context) {
    workspaceManager.documentContexts.set(uri, context);
    workspaceManager.documentContexts.set(effectiveUri, context);
  }
}

/**
 * Executes SysML v2 verification cases in `uri` by flattening and simulating linked Modelica models
 * and evaluating requirement constraints against simulated trajectories.
 */
export async function runVerificationForUriImpl(
  ctx: Pick<
    ModelicaVerificationContext,
    | "connection"
    | "documentManager"
    | "parserService"
    | "workspaceManager"
    | "documentLSPBridges"
    | "verificationDiagnosticsByUri"
    | "verificationResultsByUri"
    | "lastAutoVerifiedText"
    | "getActiveVerification"
    | "setActiveVerification"
    | "requestCodeLensRefresh"
    | "emitVerificationStatus"
    | "extractArenaStringParams"
    | "findRangeForIri"
    | "validateTextDocument"
  >,
  uri: string,
  progressReporter?: LspWorkDoneProgressReporter,
): Promise<{ ok: boolean; error?: string | undefined }> {
  try {
    const textDocument = ctx.documentManager.documents.get(uri);
    if (!textDocument) throw new Error("Document not found");

    const prevVerification = ctx.getActiveVerification();
    if (prevVerification) prevVerification.abort();
    const controller = new AbortController();
    ctx.setActiveVerification(controller);
    const signal = controller.signal;

    if (progressReporter) {
      progressReporter.abortController.signal.addEventListener("abort", () => {
        ctx.getActiveVerification()?.abort();
      });
    }

    const db = ctx.workspaceManager.unifiedWorkspace.getIndex();
    const fileNodes = Array.from(db.symbols.values()).filter(
      (s) =>
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

    const resolveLazyTree = (entryUri: string): { tree: LazyTreeUnion; text: string } | undefined => {
      let lazyCache = ctx.documentManager.lazyLibTrees.get(entryUri);
      if (!lazyCache) {
        try {
          const fsPath = entryUri.startsWith("file://") ? entryUri.substring(7) : entryUri;
          const text = ctx.parserService.sharedContext?.fs.read(fsPath);
          if (text) {
            const lower = entryUri.toLowerCase();
            const isSysml = lower.endsWith(".sysml") || lower.endsWith(".sysml2") || lower.endsWith(".kerml");
            const entryPlugin = globalLanguageRegistry.getPluginForUri(entryUri);
            const parser = ctx.parserService.getParserForUri(entryUri);
            const tree = isLargeXmlForWasm(entryUri, text, entryPlugin)
              ? parseXmlFallbackTree(text)
              : parser
                ? parser.parse(text)
                : ctx.parserService.sharedContext?.parse(isSysml ? ".sysml" : ".mo", text);
            if (tree) {
              lazyCache = { tree: tree as LazyTreeUnion, text };
              ctx.documentManager.lazyLibTrees.set(entryUri, lazyCache);
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
        const docTree = ctx.documentManager.documentTrees.get(entryUri);
        if (docTree && docTree.text) return docTree.text.substring(startOffset, endOffset);

        const lazyCache = resolveLazyTree(entryUri);
        if (lazyCache) return lazyCache.text.substring(startOffset, endOffset);

        const doc = ctx.documentManager.documents.get(entryUri);
        if (doc) return doc.getText().substring(startOffset, endOffset);
        return null;
      },
      getNode: (startOffset: number, endOffset: number, entry?: { resourceId?: string }): unknown | null => {
        if (!entry || !entry.resourceId) return null;
        const entryUri = entry.resourceId;
        const docTree = ctx.documentManager.documentTrees.get(entryUri);
        if (docTree && docTree.tree) {
          return getDescendantFromTree(docTree.tree, startOffset, endOffset);
        }

        const lazyCache = resolveLazyTree(entryUri);
        if (lazyCache && lazyCache.tree) {
          return getDescendantFromTree(lazyCache.tree, startOffset, endOffset);
        }

        const doc = ctx.documentManager.documents.get(entryUri);
        if (doc) {
          const text = doc.getText();
          let tree: unknown;
          const entryPlugin = globalLanguageRegistry.getPluginForUri(entryUri);
          const parser = ctx.parserService.getParserForUri(entryUri);
          if (isLargeXmlForWasm(entryUri, text, entryPlugin)) {
            tree = parseXmlFallbackTree(text);
          } else if (parser) {
            tree = parser.parse(text);
          } else if (ctx.parserService.sharedContext) {
            const ext = entryUri.includes(".") ? entryUri.substring(entryUri.lastIndexOf(".")) : ".mo";
            tree = ctx.parserService.sharedContext.parse(ext, text);
          }
          if (tree) {
            ctx.documentManager.documentTrees.set(entryUri, {
              text,
              tree: tree as LazyTreeUnion,
              classCache: new Map(),
            });
            return getDescendantFromTree(tree, startOffset, endOffset);
          }
        }
        return null;
      },
    };

    const gHooks = globalThis as unknown as GlobalVerificationHooks;
    const sysmlFactory =
      gHooks.createSysML2QueryEngine ??
      gHooks.create_sysml2_query_engine ??
      (globalLanguageRegistry.getPluginForLanguageIdOrUri("sysml2")?.createQueryEngine as
        QueryEngineFactoryLike | undefined);
    const sysmlEngine = typeof sysmlFactory === "function" ? sysmlFactory(db, verifyCstTreeWrapper) : null;
    if (!sysmlEngine) {
      progressReporter?.done("SysML v2 query engine unavailable");
      return { ok: false };
    }
    const sysmlDB = sysmlEngine.toQueryDB();
    const newDiagnostics: Diagnostic[] = [];
    const allResults: VerificationResultLike[] = [];

    let caseIdx = 0;
    for (const verifyUsage of fileNodes) {
      if (signal.aborted || progressReporter?.isCancelled) {
        progressReporter?.done("Verification cancelled");
        return { ok: false };
      }
      caseIdx++;
      const caseProgress = 10 + Math.round((caseIdx / fileNodes.length) * 80);
      progressReporter?.report(caseProgress, `Simulating & verifying case ${caseIdx}/${fileNodes.length}...`);

      const topo = sysmlDB.query("extractTopology", verifyUsage.id) as
        | {
            rootIds: number[];
            nodes: Map<number, { targetClassId?: number }>;
            variableMap: ConstructorParameters<typeof VerificationRunner>[1];
          }
        | null
        | undefined;
      if (!topo || topo.rootIds.length === 0) continue;

      const rootNode = topo.nodes.get(topo.rootIds[0]!);
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
            ctx.documentManager.documentTrees.get(resId)?.text ?? ctx.documentManager.documents.get(resId)?.getText?.();
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
      let targetEngine: { toQueryDB?: () => QueryDbLike } | undefined = undefined;
      if (finalEntry && finalEntry.resourceId) {
        targetEngine = (
          finalEntry.resourceId.endsWith(".sysml")
            ? ctx.workspaceManager.globalSysML2QueryEngine
            : ctx.workspaceManager.globalModelicaQueryEngine
        ) as { toQueryDB?: () => QueryDbLike } | undefined;
        if (!targetEngine && finalEntry.resourceId.endsWith(".mo")) {
          const moFactory =
            gHooks.createModelicaQueryEngine ??
            gHooks.create_modelica_query_engine ??
            (globalLanguageRegistry.getPluginForLanguageIdOrUri("modelica")?.createQueryEngine as
              QueryEngineFactoryLike | undefined);
          if (typeof moFactory === "function") {
            targetEngine = moFactory(db, verifyCstTreeWrapper);
          }
        }
      }

      const uwWithEngine = ctx.workspaceManager.unifiedWorkspace as unknown as {
        engine?: { toQueryDB?: () => QueryDbLike };
      };
      const targetDB: QueryDbLike = targetEngine?.toQueryDB?.() ?? uwWithEngine.engine?.toQueryDB?.() ?? sysmlDB;
      const targetModel = {
        id: simTargetId,
        name: targetDB.symbol(simTargetId)?.name ?? "",
        compositeName: targetDB.symbol(simTargetId)?.name ?? "",
      };

      const context = ctx.parserService.sharedContext;
      if (!context) {
        progressReporter?.done("Context not initialized");
        return { ok: false, error: "Context not initialized" };
      }
      const flattenFn = gHooks.flattenArenaFromInstance;
      if (typeof flattenFn !== "function") {
        progressReporter?.done("Flattener not available");
        return { ok: false, error: "Flattener not available" };
      }
      const arena = flattenFn(targetModel, context);
      let arenaSimResult: ReturnType<typeof simulateArena>;
      const simParameters: { name: string; value: number | string | boolean }[] = [];
      try {
        const exp = (arena as ArenaWithExperiment | null)?.experiment ?? {};
        const startTime = exp.startTime ?? 0;
        const stopTime = exp.stopTime ?? 10;
        const numIntervals = exp.numberOfIntervals;
        const step = exp.interval ?? (numIntervals && numIntervals > 0 ? (stopTime - startTime) / numIntervals : 0.1);

        arenaSimResult = simulateArena(arena as Parameters<typeof simulateArena>[0], {
          startTime,
          stopTime,
          step,
          atol: exp.tolerance,
          rtol: exp.tolerance,
          solver: exp.algorithm as NonNullable<Parameters<typeof simulateArena>[1]>["solver"],
        });

        if (signal.aborted || progressReporter?.isCancelled) {
          progressReporter?.done("Verification cancelled");
          return { ok: false };
        }

        const paramInfo = getArenaParameterInfo(arena as Parameters<typeof getArenaParameterInfo>[0]);
        for (const p of paramInfo) {
          simParameters.push({ name: p.name, value: p.defaultValue });
        }
        for (const [sName, sVal] of ctx.extractArenaStringParams(arena).entries()) {
          simParameters.push({ name: sName, value: sVal });
        }
      } finally {
        (arena as ArenaWithExperiment | null)?.free?.();
      }

      const simResult = {
        t: arenaSimResult.t,
        states: arenaSimResult.states,
        y: arenaSimResult.y,
        parameters: simParameters,
      };

      const runner = new VerificationRunner(
        sysmlDB as unknown as ConstructorParameters<typeof VerificationRunner>[0],
        topo.variableMap,
      );
      const vResults = runner.verifyCase(verifyUsage.id, simResult);
      allResults.push(...vResults);

      const bridge = ctx.documentLSPBridges.get(uri);
      if (bridge) {
        const diags: Diagnostic[] = vResults
          .filter((v) => !v.isSatisfied)
          .map((v) => {
            const vExt = v as unknown as VerificationResultLike;
            return {
              range: ctx.findRangeForIri(v.constraintId as unknown as string, uri) || {
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
                requiredLimit: vExt.requiredLimit ?? v.limitValue,
                suggestedValue: vExt.suggestedValue ?? v.limitValue,
              },
            };
          });
        newDiagnostics.push(...diags);
      }
    }

    if (signal.aborted || progressReporter?.isCancelled) {
      progressReporter?.done("Verification cancelled");
      return { ok: false };
    }

    ctx.lastAutoVerifiedText.set(uri, textDocument.getText());
    ctx.verificationDiagnosticsByUri.set(uri, newDiagnostics);
    ctx.verificationResultsByUri.set(uri, allResults);
    ctx.requestCodeLensRefresh();
    ctx.emitVerificationStatus(uri);

    ctx.validateTextDocument(textDocument);
    progressReporter?.report(100, `Completed ${fileNodes.length} verification case(s)`);
    progressReporter?.done("Verification completed successfully");
    return { ok: true };
  } catch (e: unknown) {
    const info = getErrorInfo(e);
    progressReporter?.done(`Verification error: ${info.message}`);
    ctx.connection.console.error(`[sysml2-verifier] Error: ${info.message}\n${info.stack ?? ""}`);

    const crashDiag: Diagnostic = {
      severity: DiagnosticSeverity.Error,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
      message: `Verification CRASHED: ${info.message}`,
      source: "sysml2-verifier",
    };
    ctx.verificationDiagnosticsByUri.set(uri, [crashDiag]);
    const doc = ctx.documentManager.documents.get(uri);
    if (doc) {
      ctx.lastAutoVerifiedText.set(uri, doc.getText());
      ctx.validateTextDocument(doc);
    }

    return { ok: false };
  }
}
