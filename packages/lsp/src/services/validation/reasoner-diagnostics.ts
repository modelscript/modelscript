// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  PolyglotDriftChecker,
  type PolyglotModelSource,
  SemanticAxiomProjector,
  type SymbolIndex,
} from "@modelscript/runtime";
import {
  type Connection,
  type Diagnostic,
  type DiagnosticRelatedInformation,
  DiagnosticSeverity,
  type Range,
} from "vscode-languageserver";
import { PositionIndex } from "../../lsp-bridge.js";
import { globalLanguageRegistry } from "../../registry/LanguageRegistry.js";
import { deduplicateAllDiagnostics } from "../diagnostic-dedup.js";
import type { DocumentManager } from "../document-manager.js";
import type { ParserService } from "../parser-service.js";
import type { ReasonerService } from "../reasoner-service.js";
import type { WorkspaceManager } from "../workspace-manager.js";
import { type PolyglotTreeLike, stripFileExtension } from "./text-helpers.js";

export interface ReasonerDiagnosticsContext {
  connection: Connection;
  documentManager: DocumentManager;
  parserService: ParserService;
  workspaceManager: WorkspaceManager;
  reasonerService: ReasonerService;
  reasonerDiagnosticsByUri: Map<string, Diagnostic[]>;
  lastSemanticDiagnostics: Map<string, Diagnostic[]>;
}

interface ReasonerAxiomLike {
  type?: string;
  subClassIri?: string;
  superClassIri?: string;
  classIris?: string[];
  individualIri?: string;
  classIri?: string;
  subjectIri?: string;
  objectIri?: string;
  propertyIri?: string;
  iri?: string;
}

export interface ReasonerConsistencyLike {
  isConsistent?: boolean;
  explanation?: string;
  minimalConflictCore?: ReasonerAxiomLike[];
  conflictingAxioms?: ReasonerAxiomLike[];
  minimalCorrectionSubsets?: unknown;
}

interface Owl2StoreLike {
  axioms?: readonly unknown[];
  setAxioms?: (sourceKey: string, axioms: unknown[]) => unknown;
  _axiomsBySource?: Map<string, ReasonerAxiomLike[]>;
}

interface WorkspaceIndexLike {
  version?: number;
  files?: Map<string, SymbolIndex>;
  fileIndices?: Map<string, SymbolIndex>;
  getFileIndex?: (uri: string) => SymbolIndex | undefined;
}

interface CstRootWithDescendant {
  descendantForIndex?: (
    start: number,
    end: number,
  ) => {
    startPosition?: { row: number; column: number };
    endPosition?: { row: number; column: number };
  } | null;
}

function getTreeRootWithDescendant(tree: unknown): CstRootWithDescendant | null {
  if (!tree || typeof tree !== "object") return null;
  const candidate = tree as { rootNode?: CstRootWithDescendant; tree?: { rootNode?: CstRootWithDescendant } };
  return candidate.rootNode ?? candidate.tree?.rootNode ?? null;
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (
    err &&
    typeof err === "object" &&
    "message" in err &&
    typeof (err as { message?: unknown }).message === "string"
  ) {
    return (err as { message: string }).message;
  }
  return String(err);
}

/**
 * Resolves an ontology IRI or qualified symbol name to a 0-based line/character range within `currentUri`.
 */
export function findRangeForIriImpl(
  ctx: Pick<ReasonerDiagnosticsContext, "workspaceManager" | "documentManager">,
  iri: string,
  currentUri: string,
): Range | null {
  if (!iri) return null;

  const candidates: string[] = [iri];
  if (iri.includes("#")) {
    const frag = iri.split("#").pop();
    if (frag && !candidates.includes(frag)) candidates.push(frag);
  }
  if (iri.includes("/")) {
    const segment = iri.split("/").pop();
    if (segment && !candidates.includes(segment)) candidates.push(segment);
  }
  if (iri.includes(":")) {
    const local = iri.split(":").pop();
    if (local && !candidates.includes(local)) candidates.push(local);
  }

  const db = ctx.workspaceManager.unifiedWorkspace.getIndex();
  for (const cand of candidates) {
    const nameIds = db.byName.get(cand);
    if (nameIds && nameIds.length > 0) {
      for (const id of nameIds) {
        const entry = db.symbols.get(id);
        if (entry && typeof entry.startOffset === "number" && typeof entry.endOffset === "number") {
          const matchesUri =
            entry.resourceId === currentUri ||
            (Boolean(entry.resourceId) && currentUri.endsWith(entry.resourceId!)) ||
            (Boolean(entry.resourceId) && entry.resourceId!.endsWith(currentUri));
          if (matchesUri) {
            const idRange =
              entry.fieldRanges?.["declaredName"] ?? entry.fieldRanges?.["name"] ?? entry.fieldRanges?.["id"];
            const startOff = idRange?.startOffset ?? entry.startOffset;
            const endOff = idRange?.endOffset ?? entry.endOffset;
            const docTree = ctx.documentManager.documentTrees.get(currentUri);
            if (docTree && docTree.tree) {
              const root = getTreeRootWithDescendant(docTree.tree);
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
            const doc = ctx.documentManager.documents.get(currentUri);
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
  const doc = ctx.documentManager.documents.get(currentUri);
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
export function findDeclarationLocationImpl(
  ctx: Pick<ReasonerDiagnosticsContext, "workspaceManager" | "documentManager" | "parserService">,
  iri: string,
): { uri: string; range: Range } | null {
  if (!iri) return null;

  const candidates: string[] = [iri];
  if (iri.includes("#")) {
    const frag = iri.split("#").pop();
    if (frag && !candidates.includes(frag)) candidates.push(frag);
  }
  if (iri.includes("/")) {
    const segment = iri.split("/").pop();
    if (segment && !candidates.includes(segment)) candidates.push(segment);
  }
  if (iri.includes(":")) {
    const local = iri.split(":").pop();
    if (local && !candidates.includes(local)) candidates.push(local);
  }

  const db = ctx.workspaceManager?.unifiedWorkspace?.getIndex?.();
  if (!db || !db.byName || !db.symbols) return null;

  for (const cand of candidates) {
    const nameIds = db.byName.get(cand);
    if (nameIds && nameIds.length > 0) {
      for (const id of nameIds) {
        const entry = db.symbols.get(id);
        if (entry && entry.resourceId && typeof entry.startOffset === "number" && typeof entry.endOffset === "number") {
          const entryUri = entry.resourceId;
          const idRange =
            entry.fieldRanges?.["declaredName"] ?? entry.fieldRanges?.["name"] ?? entry.fieldRanges?.["id"];
          const startOff = idRange?.startOffset ?? entry.startOffset;
          const endOff = idRange?.endOffset ?? entry.endOffset;

          const docTree = ctx.documentManager.documentTrees.get(entryUri);
          if (docTree && docTree.tree) {
            const root = getTreeRootWithDescendant(docTree.tree);
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

          const doc = ctx.documentManager.documents.get(entryUri);
          if (doc) {
            return {
              uri: entryUri,
              range: {
                start: doc.positionAt(startOff),
                end: doc.positionAt(endOff),
              },
            };
          }

          let lazyCache = ctx.documentManager.lazyLibTrees.get(entryUri);
          if (!lazyCache && ctx.parserService?.sharedContext) {
            try {
              const fsPath = entryUri.startsWith("file://") ? entryUri.substring(7) : entryUri;
              const text = ctx.parserService.sharedContext.fs.read(fsPath);
              if (text) {
                const ext = entryUri.includes(".") ? entryUri.substring(entryUri.lastIndexOf(".")) : ".mo";
                const tree = ctx.parserService.sharedContext.parse(ext, text);
                lazyCache = { tree, text };
                ctx.documentManager.lazyLibTrees.set(entryUri, lazyCache);
              }
            } catch {
              // ignore lazy file read failures
            }
          }
          if (lazyCache && lazyCache.tree) {
            const root = getTreeRootWithDescendant(lazyCache.tree);
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

/**
 * Maps minimal conflict cores and unsat explanations from the description logic reasoner
 * back to source document ranges and publishes cross-document diagnostics.
 */
export function routeReasonerDiagnosticsImpl(
  ctx: ReasonerDiagnosticsContext,
  currentUri: string,
  consistency: ReasonerConsistencyLike | null | undefined,
  currentSemanticDiagnostics: Diagnostic[],
  source: string,
): void {
  if (!consistency) return;

  const newDiagsByUri = new Map<string, Diagnostic[]>();

  if (!consistency.isConsistent) {
    const explanation = consistency.explanation || "Ontology inconsistency detected";
    const candidateAxioms: ReasonerAxiomLike[] = [];
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

    const buildRelatedInfo = (targetUri: string, targetRange: Range): DiagnosticRelatedInformation[] | undefined => {
      const related: DiagnosticRelatedInformation[] = [];
      for (const ax of candidateAxioms) {
        const iris: string[] = [
          ax.subClassIri,
          ax.superClassIri,
          ax.individualIri,
          ax.classIri,
          ...(Array.isArray(ax.classIris) ? ax.classIris : []),
          ax.subjectIri,
          ax.objectIri,
          ax.iri,
        ].filter((v): v is string => Boolean(v));

        for (const iri of iris) {
          const loc = findDeclarationLocationImpl(ctx, iri);
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

    const addDiag = (locUri: string, range: Range | null | undefined) => {
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

    const candidateUris = new Set<string>([currentUri, ...ctx.documentManager.documents.keys()]);

    const store = ctx.workspaceManager?.unifiedWorkspace?.owl2Store as unknown as Owl2StoreLike | undefined;
    if (store?._axiomsBySource) {
      for (const k of store._axiomsBySource.keys()) {
        if (k.includes(":") || k.includes("/")) {
          candidateUris.add(k);
        }
      }
    }

    for (const targetIri of targetIris) {
      const declLoc = findDeclarationLocationImpl(ctx, targetIri);
      if (declLoc) {
        addDiag(declLoc.uri, declLoc.range);
      }

      for (const cUri of candidateUris) {
        const r = findRangeForIriImpl(ctx, targetIri, cUri);
        if (r) {
          addDiag(cUri, r);
        }
      }
    }

    if (store?._axiomsBySource) {
      for (const [sourceKey, sourceAxioms] of store._axiomsBySource.entries()) {
        if (sourceKey.includes(":") || sourceKey.includes("/")) {
          const hasConflict = sourceAxioms.some((sa) =>
            candidateAxioms.some(
              (ca) =>
                ca.type === sa.type &&
                (ca.type === "DisjointClasses"
                  ? Array.isArray(ca.classIris) &&
                    Array.isArray(sa.classIris) &&
                    ca.classIris.every((i) => sa.classIris!.includes(i))
                  : ca.subClassIri === sa.subClassIri && ca.superClassIri === sa.superClassIri),
            ),
          );
          if (hasConflict) {
            let r: Range | null = null;
            const doc = ctx.documentManager.documents.get(sourceKey);
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
              r = findRangeForIriImpl(ctx, candidateAxioms[0].classIris[0], sourceKey);
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
      let fallbackRange: Range = {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 10 },
      };
      const doc = ctx.documentManager.documents.get(currentUri);
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

  const allKnownUris = new Set<string>([...ctx.reasonerDiagnosticsByUri.keys(), ...newDiagsByUri.keys()]);

  for (const uri of allKnownUris) {
    const newDiags = newDiagsByUri.get(uri) || [];
    if (newDiags.length === 0) {
      const hadPrevious = ctx.reasonerDiagnosticsByUri.has(uri);
      ctx.reasonerDiagnosticsByUri.delete(uri);
      if (hadPrevious && uri !== currentUri) {
        const base = (ctx.lastSemanticDiagnostics.get(uri) || []).filter((d) => !d.source?.includes("reasoner"));
        ctx.lastSemanticDiagnostics.set(uri, base);
        ctx.connection.sendDiagnostics({ uri, diagnostics: base });
      }
    } else {
      ctx.reasonerDiagnosticsByUri.set(uri, newDiags);
      if (uri === currentUri) {
        currentSemanticDiagnostics.push(...newDiags);
      } else {
        const existing = (ctx.lastSemanticDiagnostics.get(uri) || []).filter((d) => !d.source?.includes("reasoner"));
        const merged = deduplicateAllDiagnostics([...existing, ...newDiags]);
        ctx.lastSemanticDiagnostics.set(uri, merged);
        ctx.connection.sendDiagnostics({ uri, diagnostics: merged });
      }
    }
  }
}

/**
 * Runs OWL2 Functional Syntax linting, lowers CST axioms into the shared ontology store,
 * and executes tableau consistency reasoning.
 */
export async function postValidateOwl2Impl(
  ctx: ReasonerDiagnosticsContext,
  effectiveUri: string,
  tree: PolyglotTreeLike | null | undefined,
  text: string,
  diagnostics: Diagnostic[],
): Promise<void> {
  try {
    const { lintOwl2Document, lowerCstToAxioms } = await import("@modelscript/owl2");
    const rootNode = tree?.rootNode;
    if (!rootNode) return;

    const owlLints = lintOwl2Document(rootNode, text, { checkConsistency: false });
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

    const axioms = lowerCstToAxioms(rootNode, text);
    const store = ctx.workspaceManager?.unifiedWorkspace?.owl2Store as unknown as Owl2StoreLike | undefined;
    let delta: unknown = undefined;
    if (store && typeof store.setAxioms === "function") {
      delta = store.setAxioms(effectiveUri, axioms);
    }

    const versions = new Map<string, number>();
    const mIndex = ctx.workspaceManager.getWorkspaceIndex?.("modelica");
    if (mIndex) versions.set("modelica", mIndex.version);
    const sIndex = ctx.workspaceManager.getWorkspaceIndex?.("sysml2");
    if (sIndex) versions.set("sysml2", sIndex.version);

    if (
      !ctx.reasonerService?.updateAndReason &&
      store?.axioms &&
      typeof ctx.reasonerService?.reasoner?.loadOntology === "function"
    ) {
      ctx.reasonerService.reasoner.loadOntology(
        store.axioms as Parameters<typeof ctx.reasonerService.reasoner.loadOntology>[0],
      );
    }

    const consistency = ctx.reasonerService?.updateAndReason
      ? ctx.reasonerService.updateAndReason(
          versions,
          delta as Parameters<typeof ctx.reasonerService.updateAndReason>[1],
        )
      : ctx.reasonerService?.reasoner?.checkConsistency();

    routeReasonerDiagnosticsImpl(
      ctx,
      effectiveUri,
      consistency as ReasonerConsistencyLike | undefined,
      diagnostics,
      "owl2-reasoner",
    );
  } catch (reasonerError: unknown) {
    ctx.connection.console.error(`[owl2-reasoner] Reasoner failed: ${getErrorMessage(reasonerError)}`);
  }
}

/**
 * Updates the ontological reasoner after SysML v2 validation and routes any logical contradictions to affected documents.
 */
export function postValidateSysml2Impl(
  ctx: ReasonerDiagnosticsContext,
  effectiveUri: string,
  diagnostics: Diagnostic[],
): void {
  try {
    const versions = new Map<string, number>();
    const sysml2Index = ctx.workspaceManager.getWorkspaceIndex?.("sysml2");
    if (sysml2Index) versions.set("sysml2", sysml2Index.version);

    const consistency = ctx.reasonerService?.updateAndReason
      ? ctx.reasonerService.updateAndReason(versions)
      : ctx.reasonerService?.reasoner?.checkConsistency();

    routeReasonerDiagnosticsImpl(
      ctx,
      effectiveUri,
      consistency as ReasonerConsistencyLike | undefined,
      diagnostics,
      "sysml2-reasoner",
    );
  } catch (e: unknown) {
    ctx.connection.console.error(`[sysml2-reasoner] Update failed: ${getErrorMessage(e)}`);
  }
}

/**
 * Updates the ontological reasoner after Modelica validation when OWL2 axioms are present in the workspace.
 */
export function postValidateModelicaReasonerImpl(
  ctx: ReasonerDiagnosticsContext,
  effectiveUri: string,
  diagnostics: Diagnostic[],
): void {
  try {
    const store = ctx.workspaceManager?.unifiedWorkspace?.owl2Store as unknown as Owl2StoreLike | undefined;
    if (!store || !store.axioms || store.axioms.length === 0) return;

    const versions = new Map<string, number>();
    const mIndex = ctx.workspaceManager.getWorkspaceIndex?.("modelica");
    if (mIndex) versions.set("modelica", mIndex.version);

    const consistency = ctx.reasonerService?.updateAndReason
      ? ctx.reasonerService.updateAndReason(versions)
      : ctx.reasonerService?.reasoner?.checkConsistency();

    routeReasonerDiagnosticsImpl(
      ctx,
      effectiveUri,
      consistency as ReasonerConsistencyLike | undefined,
      diagnostics,
      "modelica-reasoner",
    );
  } catch (e: unknown) {
    ctx.connection.console.error(`[modelica-reasoner] Update failed: ${getErrorMessage(e)}`);
  }
}

/**
 * Updates the ontological reasoner after polyglot document validation across any supported language.
 * Projects the file's SymbolIndex into BFO/IOF OWL2 axioms and triggers incremental reasoning.
 */
export function postValidatePolyglotReasonerImpl(
  ctx: ReasonerDiagnosticsContext,
  effectiveUri: string,
  langId: string,
  diagnostics: Diagnostic[],
): void {
  try {
    const wsIdx = ctx.workspaceManager.getWorkspaceIndex?.(langId) as WorkspaceIndexLike | undefined;
    const fileIdx =
      wsIdx?.getFileIndex?.(effectiveUri) ?? ctx.workspaceManager?.unifiedWorkspace?.getFileIndex?.(effectiveUri);
    if (!fileIdx) return;

    const store = ctx.workspaceManager?.unifiedWorkspace?.owl2Store as unknown as Owl2StoreLike | undefined;
    if (!store) return;

    const axioms =
      fileIdx.symbols && fileIdx.symbols.size > 0
        ? SemanticAxiomProjector.projectSymbolIndex(fileIdx, {
            sourceLang: langId,
            sourceUri: effectiveUri,
            basePrefix: `${langId}:`,
          })
        : [];

    let delta: unknown = undefined;
    const key = `${langId}:${effectiveUri}`;
    if (typeof store.setAxioms === "function") {
      delta = store.setAxioms(key, axioms);
    }

    const versions = new Map<string, number>();
    const ver = wsIdx?.version ?? ctx.workspaceManager?.unifiedWorkspace?.version;
    if (typeof ver === "number") versions.set(langId, ver);

    const consistency = ctx.reasonerService?.updateAndReason
      ? ctx.reasonerService.updateAndReason(
          versions,
          delta as Parameters<typeof ctx.reasonerService.updateAndReason>[1],
        )
      : ctx.reasonerService?.reasoner?.checkConsistency();

    routeReasonerDiagnosticsImpl(
      ctx,
      effectiveUri,
      consistency as ReasonerConsistencyLike | undefined,
      diagnostics,
      `${langId}-reasoner`,
    );
  } catch (e: unknown) {
    ctx.connection.console.error(`[${langId}-reasoner] Polyglot reasoner update failed: ${getErrorMessage(e)}`);
  }
}

/**
 * Scans cross-language workspace indices for parameter drift and model divergence.
 * Emits M5104 diagnostics with clickable relatedInformation links to counterpart declarations.
 */
export function postValidatePolyglotDriftImpl(
  ctx: Pick<ReasonerDiagnosticsContext, "connection" | "documentManager" | "workspaceManager">,
  effectiveUri: string,
  langId: string,
  diagnostics: Diagnostic[],
): void {
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
    const pushFileSymbols = (pId: string, fUri: string, fIdx: SymbolIndex | null | undefined) => {
      if (!fIdx?.symbols || seenUris.has(fUri)) return;
      seenUris.add(fUri);
      if (fUri !== effectiveUri && isExternalLibraryUri(fUri)) return;
      for (const sym of fIdx.symbols.values()) {
        const meta = sym.metadata as Record<string, unknown> | undefined;
        const val =
          meta?.["value"] ??
          meta?.["nominal"] ??
          meta?.["defaultValue"] ??
          (meta?.["variability"] === "parameter" && typeof meta?.["binding"] === "number"
            ? meta["binding"]
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
      const wsIdx = (plugin.workspaceIndex ?? ctx.workspaceManager?.getWorkspaceIndex?.(pId)) as
        WorkspaceIndexLike | undefined;
      if (!wsIdx) continue;

      const files = wsIdx.files ?? wsIdx.fileIndices;
      if (files) {
        for (const [fUri, fIdx] of files.entries()) {
          pushFileSymbols(pId, fUri, fIdx);
        }
      }
    }

    const unifiedWs = ctx.workspaceManager?.unifiedWorkspace;
    if (unifiedWs && typeof unifiedWs.listDocumentUris === "function") {
      for (const fUri of unifiedWs.listDocumentUris()) {
        const fIdx = unifiedWs.getNativeFileIndex?.(fUri) ?? unifiedWs.getFileIndex?.(fUri);
        const pId = globalLanguageRegistry.getPluginForUri(fUri)?.id ?? langId;
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

        const textDoc = ctx.documentManager.documents.get(effectiveUri);
        const start =
          textDoc && mySource.startOffset !== undefined
            ? textDoc.positionAt(mySource.startOffset)
            : { line: 0, character: 0 };
        const end =
          textDoc && mySource.endOffset !== undefined
            ? textDoc.positionAt(mySource.endOffset)
            : { line: 0, character: 10 };

        const otherDoc = ctx.documentManager.documents.get(otherSource.uri);
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
  } catch (e: unknown) {
    ctx.connection.console.error?.(`[drift-checker] Drift check failed: ${getErrorMessage(e)}`);
  }
}
