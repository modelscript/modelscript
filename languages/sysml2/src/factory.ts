// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Bridge module connecting polyglot-generated SysML2 artifacts to
// the LSP pipeline. Mirrors packages/core/src/compiler/modelica/metascript-bridge.ts.

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  LSPBridge,
  PositionIndex,
  QueryEngine,
  WorkspaceIndex,
  extractIndexerHooks,
  extractQueryHooksMap,
  extractRefHooks,
  type VerificationResult,
} from "@modelscript/language/compiler";
import { buildPolyglotDiagram, type PolyglotDiagramData } from "@modelscript/language/diagram/builder";
import { sysml2Language } from "./language.js";

const indexerHooks = extractIndexerHooks(sysml2Language) ?? (globalThis as any).__sysml2IndexerHooksFallback ?? [];
export const queryHooks =
  extractQueryHooksMap(sysml2Language) ?? (globalThis as any).__sysml2QueryHooksFallback ?? new Map();
const refHooks = extractRefHooks(sysml2Language) ?? (globalThis as any).__sysml2RefHooksFallback ?? [];
const gfxConfig = (sysml2Language as any).graphicsConfig ?? {};

// Convert refHooks into indexerHooks so reference nodes get indexed too.
// The resolver needs reference entries in the index to detect unresolved refs.
const defRuleNames = new Set(indexerHooks.map((h: any) => h.ruleName));
const refAsIndexerHooks = (refHooks ?? [])
  .filter((rh: any) => !defRuleNames.has(rh.ruleName))
  .map((rh: any) => ({
    ruleName: rh.ruleName,
    kind: "Reference",
    namePath: rh.namePath,
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {},
  }));
const allIndexerHooks = [...indexerHooks, ...refAsIndexerHooks];

/**
 * Creates a configured WorkspaceIndex for SysML2.
 */
export function createSysML2WorkspaceIndex(): WorkspaceIndex {
  return new WorkspaceIndex(allIndexerHooks);
}

/**
 * Creates a configured QueryEngine for a given SysML2 SymbolIndex.
 */
export function createSysML2QueryEngine(index: any, tree?: any, cacheStore?: any, maxMemos?: number): QueryEngine {
  return new QueryEngine(index, queryHooks, { tree, cacheStore, ...(maxMemos !== undefined && { maxMemos }) });
}

/**
 * Creates an LSPBridge for a specific SysML2 document.
 */
export function createSysML2LSPBridge(index: any, engine: any, arg3: any, arg4?: any, arg5?: any): LSPBridge {
  if (arg5 !== undefined) {
    return new LSPBridge(index, engine, new PositionIndex(arg4), arg5);
  }
  if (arg4 !== undefined) {
    return new LSPBridge(index, engine, new PositionIndex(arg3), arg4);
  }
  return new LSPBridge(index, engine, new PositionIndex(""), "");
}

/**
 * Builds X6-compatible diagram data for a SysML2 document.
 * Uses the generic polyglot diagram builder with SysML2's graphics config.
 *
 * @param index        The unified symbol index.
 * @param documentUri  The document URI to limit scope to.
 * @param resolver     Optional ScopeResolver for edge source/target resolution.
 */
export function buildSysML2DiagramData(
  index: any,
  documentUri: string,
  resolver?: any,
  diagramType:
    | "All"
    | "BDD"
    | "IBD"
    | "StateMachine"
    | "Activity"
    | "UseCase"
    | "Requirement"
    | "Parametric"
    | "Sequence"
    | "Package" = "All",
): PolyglotDiagramData {
  return buildPolyglotDiagram(index, gfxConfig, documentUri, resolver, diagramType);
}

/**
 * Transforms VerificationRunner results into LSP Diagnostic objects.
 * Maps solver constraint violations and dynamic requirement failures back
 * to their SysML source locations.
 */
export function emitVerificationDiagnostics(
  results: VerificationResult[],
  db: any,
  documentUri: string,
  positions: PositionIndex,
): any[] {
  const diagnostics = [];

  for (const vr of results) {
    if (!vr.constraintId) continue;

    let start = { line: 0, character: 0 };
    let end = { line: 0, character: 10 };

    const targetId = vr.constraintId;
    const targetNode = db.symbols.get(targetId);

    if (targetNode && typeof targetNode.startByte === "number" && typeof targetNode.endByte === "number") {
      const s = positions.offsetToPosition(targetNode.startByte);
      const e = positions.offsetToPosition(targetNode.endByte);
      if (!isNaN(s.line) && !isNaN(e.line)) {
        start = s;
        end = e;
      }
    }

    if (!vr.isSatisfied) {
      let diagMsg: string;
      if (vr.requirementName && vr.message) {
        diagMsg = `Requirement '${vr.requirementName}' violated: ${vr.message.replace(/^Requirement violated: /, "")}`;
      } else if (vr.message) {
        diagMsg = vr.message;
      } else {
        diagMsg = `Requirement constraint violated over the simulation trajectory.`;
      }

      diagnostics.push({
        severity: 1, // DiagnosticSeverity.Error
        range: { start, end },
        message: diagMsg,
        source: "sysml2-verifier",
      });
    }
  }

  return diagnostics;
}
