// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Unified Cross-Language Causal Traces (GraalVM Polyglot Exception Stack Trace pattern).
 *
 * Synthesizes ordered multi-language provenance chains (`PolyglotDiagnostic` + `PolyglotTraceFrame[]`)
 * from:
 *   - DAE / BLT / simulation failures via `DaeOriginMap` + `DigitalThreadHypergraph`
 *   - Nelson-Oppen SMT `ConflictClause`s via `DigitalThreadHypergraph` + `ProvenanceGraph`
 * and projects them cleanly into LSP `Diagnostic.relatedInformation` for clickable cross-file jumps.
 */

import type { DaeOriginMap } from "../dae/polyglot_inliner.js";
import type { ConflictClause } from "../formal/theory_coordinator.js";
import {
  getDomainLanguageName,
  getSymbolDomain,
  type SymbolEntry,
  type SymbolId,
  type SymbolIndex,
} from "../runtime.js";
import type { PolyglotContext } from "../workspace/polyglot_engine.js";
import type { ProvenanceGraph } from "./provenance.js";
import { type DigitalThreadHypergraph, ThreadDomain } from "./thread_hypergraph.js";

export type PolyglotTraceRole =
  "origin" | "propagated_via_tgg" | "inlined_dae" | "theory_conflict" | "requirement_violated" | "provenance_ancestor";

export interface PolyglotTraceFrame {
  readonly domainId: number;
  readonly languageId: string;
  readonly symbolId: SymbolId;
  readonly symbolName: string;
  readonly uri: string;
  readonly range: { readonly startOffset: number; readonly endOffset: number };
  readonly role: PolyglotTraceRole;
  readonly message: string;
  readonly threadId?: number | undefined;
  readonly ruleId?: number | undefined;
}

export interface PolyglotDiagnostic {
  readonly code: string;
  readonly severity: "error" | "warning" | "info";
  readonly summary: string;
  readonly frames: readonly PolyglotTraceFrame[];
}

export interface LspRelatedInfoProjection {
  readonly location: {
    readonly uri: string;
    readonly range: {
      readonly start: { readonly line: number; readonly character: number };
      readonly end: { readonly line: number; readonly character: number };
    };
  };
  readonly message: string;
}

export type SymbolLookupSource = SymbolIndex | PolyglotContext;

function resolveSymbol(source: SymbolLookupSource, symbolId: SymbolId): Readonly<SymbolEntry> | undefined {
  if ("getSymbol" in source && typeof source.getSymbol === "function") {
    return source.getSymbol(symbolId);
  }
  return (source as SymbolIndex).symbols.get(symbolId);
}

function makeFrameFromSymbol(
  symbolId: SymbolId,
  source: SymbolLookupSource,
  role: PolyglotTraceRole,
  message: string,
  extra?: { threadId?: number; ruleId?: number },
): PolyglotTraceFrame {
  const entry = resolveSymbol(source, symbolId);
  const domainId = getSymbolDomain(symbolId);
  const languageId = getDomainLanguageName(domainId);
  return {
    domainId,
    languageId,
    symbolId,
    symbolName: entry?.name ?? `symbol_0x${symbolId.toString(16)}`,
    uri: entry?.resourceId ?? "",
    range: {
      startOffset: entry?.startOffset ?? 0,
      endOffset: entry?.endOffset ?? 0,
    },
    role,
    message,
    threadId: extra?.threadId,
    ruleId: extra?.ruleId,
  };
}

/**
 * Walks the `DigitalThreadHypergraph` transitively from `(rootThreadDomain, rootSymbolId)`
 * via `computeBlastRadius` to collect all multi-hop aligned cross-language symbols
 * (e.g. SPICE -> Modelica -> SysML v2 -> ReqIF).
 */
function collectHypergraphFrames(
  hypergraph: DigitalThreadHypergraph,
  rootThreadDomain: ThreadDomain | number,
  rootSymbolId: SymbolId,
  source: SymbolLookupSource,
  seen: Set<SymbolId>,
): PolyglotTraceFrame[] {
  const frames: PolyglotTraceFrame[] = [];
  const blast = hypergraph.computeBlastRadius(rootThreadDomain, rootSymbolId);
  for (const impacted of blast.impactedNodes) {
    const nodeId = impacted.nodeId;
    if (nodeId === 0 || seen.has(nodeId)) continue;
    seen.add(nodeId);
    const role: PolyglotTraceRole =
      impacted.domain === ThreadDomain.Requirements ? "requirement_violated" : "propagated_via_tgg";
    const domainLabel = hypergraph.getDomainName(impacted.domain) ?? `domain_${impacted.domain}`;
    frames.push(
      makeFrameFromSymbol(
        nodeId,
        source,
        role,
        `Linked via digital thread #${impacted.threadId} (${domainLabel}, hop ${impacted.distance})`,
        { threadId: impacted.threadId },
      ),
    );
  }
  return frames;
}

/**
 * Assembles a unified cross-language causal trace for a DAE/BLT/simulation error
 * (e.g. structural singularity or solver divergence on `eqId` or `varId`).
 */
export function assembleDaeCausalTrace(params: {
  code: string;
  severity?: "error" | "warning" | "info";
  summary: string;
  eqId?: number;
  varId?: number;
  originMap: DaeOriginMap;
  symbolSource: SymbolLookupSource;
  hypergraph?: DigitalThreadHypergraph;
  rootThreadDomain?: ThreadDomain | number;
}): PolyglotDiagnostic {
  const frames: PolyglotTraceFrame[] = [];
  const seen = new Set<SymbolId>();

  const originSym =
    (params.eqId !== undefined ? params.originMap.getEqOrigin(params.eqId) : undefined) ??
    (params.varId !== undefined ? params.originMap.getVarOrigin(params.varId) : undefined);

  if (originSym !== undefined) {
    seen.add(originSym);
    const targetDesc = params.eqId !== undefined ? `DAE equation #${params.eqId}` : `DAE variable #${params.varId}`;
    frames.push(
      makeFrameFromSymbol(originSym, params.symbolSource, "inlined_dae", `Originated ${targetDesc}: ${params.summary}`),
    );

    if (params.hypergraph) {
      const originLang = getDomainLanguageName(getSymbolDomain(originSym));
      const resolvedDomain =
        params.rootThreadDomain ??
        params.hypergraph.getDomainId(originLang) ??
        params.hypergraph.getDomainId(originLang.toLowerCase());
      if (resolvedDomain !== undefined) {
        frames.push(
          ...collectHypergraphFrames(params.hypergraph, resolvedDomain, originSym, params.symbolSource, seen),
        );
      }
    }
  }

  return {
    code: params.code,
    severity: params.severity ?? "error",
    summary: params.summary,
    frames,
  };
}

/**
 * Assembles a unified cross-language causal trace for a Nelson-Oppen SMT `ConflictClause`
 * spanning one or more `DigitalThreadHypergraph` slots and optional W3C PROV-O lineage.
 */
export function assembleSmtCausalTrace(params: {
  code: string;
  conflict: ConflictClause;
  threadSlot?: number;
  hypergraph: DigitalThreadHypergraph;
  symbolSource: SymbolLookupSource;
  provenance?: ProvenanceGraph;
  rootProvenanceEntityId?: string;
}): PolyglotDiagnostic {
  const frames: PolyglotTraceFrame[] = [];
  const seen = new Set<SymbolId>();

  if (params.conflict.culpritSymbolIds) {
    for (const symId of params.conflict.culpritSymbolIds) {
      if (seen.has(symId)) continue;
      seen.add(symId);
      frames.push(
        makeFrameFromSymbol(
          symId,
          params.symbolSource,
          "theory_conflict",
          `Culprit symbol in SMT conflict (${params.conflict.theoryName}): ${params.conflict.explanation}`,
        ),
      );
    }
  }

  for (const lit of params.conflict.literals ?? []) {
    const symId = lit.originSymbolId;
    if (symId !== undefined && !seen.has(symId)) {
      seen.add(symId);
      frames.push(
        makeFrameFromSymbol(
          symId,
          params.symbolSource,
          "theory_conflict",
          `Asserted literal '${lit.predicate}' in SMT conflict (${params.conflict.theoryName})`,
        ),
      );
    }
  }

  if (params.threadSlot !== undefined) {
    const rec = params.hypergraph.getRecord(params.threadSlot);
    if (rec) {
      for (const [domKey, nodeId] of Object.entries(rec.domainNodes)) {
        const domNum = Number(domKey);
        if (nodeId === 0 || seen.has(nodeId)) continue;
        seen.add(nodeId);
        const role: PolyglotTraceRole =
          domNum === ThreadDomain.Requirements ? "requirement_violated" : "theory_conflict";
        frames.push(
          makeFrameFromSymbol(
            nodeId,
            params.symbolSource,
            role,
            `Participates in SMT conflict (${params.conflict.theoryName}): ${params.conflict.explanation}`,
            { threadId: rec.threadId },
          ),
        );
      }
    }
  }

  if (params.provenance && params.rootProvenanceEntityId) {
    const lineage = params.provenance.verifyLineage(params.rootProvenanceEntityId);
    for (const entityId of lineage.chain) {
      const entity = params.provenance.getEntity(entityId);
      const symId = typeof entity?.attributes?.["symbolId"] === "number" ? entity.attributes["symbolId"] : undefined;
      if (symId !== undefined && !seen.has(symId)) {
        seen.add(symId);
        frames.push(
          makeFrameFromSymbol(
            symId,
            params.symbolSource,
            "provenance_ancestor",
            `Derived from PROV-O entity '${entity?.label ?? entityId}'`,
          ),
        );
      }
    }
  }

  return {
    code: params.code,
    severity: "error",
    summary: params.conflict.explanation,
    frames,
  };
}

/**
 * Projects `PolyglotDiagnostic.frames` into LSP `Diagnostic.relatedInformation` entries
 * using an optional offset-to-position mapper (defaults to line 0, character = startOffset).
 */
export function projectTraceToLspRelatedInfo(
  diagnostic: PolyglotDiagnostic,
  offsetToPosition?: (uri: string, offset: number) => { line: number; character: number },
): LspRelatedInfoProjection[] {
  return diagnostic.frames
    .filter((f) => f.uri.length > 0)
    .map((f) => {
      const start = offsetToPosition
        ? offsetToPosition(f.uri, f.range.startOffset)
        : { line: 0, character: f.range.startOffset };
      const end = offsetToPosition
        ? offsetToPosition(f.uri, f.range.endOffset)
        : { line: 0, character: f.range.endOffset };
      return {
        location: {
          uri: f.uri,
          range: { start, end },
        },
        message: `[${f.languageId}:${f.role}] ${f.symbolName}: ${f.message}`,
      };
    });
}
