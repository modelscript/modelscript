// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Bridge module connecting polyglot-generated SysML2 artifacts to
// the LSP pipeline. Mirrors packages/core/src/compiler/modelica/metascript-bridge.ts.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { buildPolyglotDiagram, type PolyglotDiagramData } from "@modelscript/diagram/builder";
import { extractGraphicsConfig, extractIndexerHooks, extractQueryHooksMap, extractRefHooks } from "@modelscript/dsl";
import { QueryEngine, WorkspaceIndex, type VerificationResult } from "@modelscript/runtime";
import { sysml2Language } from "./language.js";
import {
  sysml2DefinitionKinds,
  sysml2RedefinitionRules,
  sysml2StandaloneChildKinds,
  sysml2StructuralKinds,
  sysml2SubclassificationRules,
  sysml2SubsettingRules,
  sysml2TypingRules,
  sysml2UsageKinds,
  sysml2Views,
} from "./views.js";

const indexerHooks = extractIndexerHooks(sysml2Language) ?? (globalThis as any).__sysml2IndexerHooksFallback ?? [];
export const queryHooks =
  extractQueryHooksMap(sysml2Language) ?? (globalThis as any).__sysml2QueryHooksFallback ?? new Map();
const refHooks = extractRefHooks(sysml2Language) ?? (globalThis as any).__sysml2RefHooksFallback ?? [];
export const gfxConfig = extractGraphicsConfig(sysml2Language) ?? {};

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

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KERML_STDLIB_URI, kermlStdlibEntries } from "../src-gen/kerml-snapshot.js";

/**
 * Creates a configured WorkspaceIndex for SysML2.
 */
export function createSysML2WorkspaceIndex(): WorkspaceIndex {
  return new WorkspaceIndex(allIndexerHooks);
}

/**
 * Loads and registers the embedded KerML standard library stubs (ScalarValues, ISQ)
 * into a SysML2 WorkspaceIndex.
 *
 * Uses the pre-compiled snapshot for instant 0ms startup without CST parsing,
 * falling back to parser.parse() if the snapshot is unavailable.
 */
export function loadEmbeddedKerMLStdlib(workspaceIndex: WorkspaceIndex, parser?: any): string | null {
  // Fast path: Ingest pre-compiled snapshot without parsing (0ms cold start, browser-safe)
  if (Array.isArray(kermlStdlibEntries) && kermlStdlibEntries.length > 0) {
    workspaceIndex.registerPrecompiledEntries(KERML_STDLIB_URI, kermlStdlibEntries);
    return KERML_STDLIB_URI;
  }

  // Fallback: Read and parse KerML.sysml dynamically if parser is provided
  if (parser) {
    try {
      const currentDir = path.dirname(fileURLToPath(import.meta.url));
      const kermlPath = path.resolve(currentDir, "../stdlib/KerML.sysml");
      if (fs.existsSync(kermlPath)) {
        const text = fs.readFileSync(kermlPath, "utf-8");
        const uri = "sysml2://stdlib/KerML.sysml";
        workspaceIndex.register(uri, () => {
          const tree = parser.parse(text);
          return tree ? (tree.rootNode as any) : null;
        });
        return uri;
      }
    } catch {
      /* ignore in non-filesystem environments */
    }
  }
  return null;
}

/**
 * Creates a configured QueryEngine for a given SysML2 SymbolIndex.
 */
export function createSysML2QueryEngine(index: any, tree?: any, cacheStore?: any, maxMemos?: number): QueryEngine {
  return new QueryEngine(index, queryHooks, { tree, cacheStore, ...(maxMemos !== undefined && { maxMemos }) });
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
    | "Package"
    | string = "All",
): PolyglotDiagramData {
  return buildPolyglotDiagram(index, gfxConfig, documentUri, resolver, diagramType, {
    customProjections: sysml2Views,
    structuralKinds: sysml2StructuralKinds,
    standaloneKinds: sysml2StandaloneChildKinds,
    usageKinds: sysml2UsageKinds,
    definitionKinds: sysml2DefinitionKinds,
    typingRules: sysml2TypingRules,
    subclassificationRules: sysml2SubclassificationRules,
    subsettingRules: sysml2SubsettingRules,
    redefinitionRules: sysml2RedefinitionRules,
    inModelDiscovery: {
      rule: "ViewDefinition",
      nameField: "name",
    },
  });
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
  positions: { offsetToPosition(offset: number): { line: number; character: number } },
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
