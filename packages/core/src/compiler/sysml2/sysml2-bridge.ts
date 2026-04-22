// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Bridge module connecting polyglot-generated SysML2 artifacts to
// the LSP pipeline. Mirrors packages/core/src/compiler/modelica/metascript-bridge.ts.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { buildPolyglotDiagram, type PolyglotDiagramData } from "@modelscript/polyglot/diagram-builder";
import { LSPBridge, PositionIndex } from "@modelscript/polyglot/lsp-bridge";
import { QueryEngine } from "@modelscript/polyglot/query-engine";
import { ScopeResolver } from "@modelscript/polyglot/resolver";
import { WorkspaceIndex } from "@modelscript/polyglot/workspace-index";

import { INDEXER_HOOKS } from "@modelscript/sysml2-polyglot/indexer_config";
import { QUERY_HOOKS } from "@modelscript/sysml2-polyglot/query_hooks";
import { REF_HOOKS } from "@modelscript/sysml2-polyglot/ref_config";

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — graphicsConfig is a generated named export
import { graphicsConfig as sysml2GraphicsConfig } from "@modelscript/sysml2-polyglot/graphics_config";

const indexerHooks = INDEXER_HOOKS ?? (globalThis as any).__sysml2IndexerHooksFallback;
const queryHooks = QUERY_HOOKS ?? (globalThis as any).__sysml2QueryHooksFallback;
const refHooks = REF_HOOKS ?? (globalThis as any).__sysml2RefHooksFallback;
const gfxConfig = sysml2GraphicsConfig ?? {};

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
export function createSysML2QueryEngine(index: any, tree?: any): QueryEngine {
  return new QueryEngine(index, queryHooks, tree ? { tree } : undefined);
}

/**
 * KerML primitive types that are always implicitly in scope in SysML2.
 * These come from kernel library packages (ScalarValues, Base, etc.)
 * defined in `.kerml` files that the SysML2 parser cannot parse.
 * Per the SysML2 spec, every package implicitly imports the kernel libraries.
 */
const KERML_IMPLICIT_NAMES = new Set([
  // ScalarValues (import ScalarValues::*)
  "ScalarValue",
  "Boolean",
  "String",
  "NumericalValue",
  "Number",
  "Complex",
  "Real",
  "Rational",
  "Integer",
  "Natural",
  "Positive",
  // Base (import Base::*)
  "Anything",
  "DataValue",
  "Object",
  "Performance",
  "Occurrence",
  // BaseFunctions
  "sum",
  "size",
  // Common KerML classifiers
  "Null",
]);

/**
 * Creates a configured ScopeResolver for a given SysML2 SymbolIndex.
 */
export function createSysML2ScopeResolver(index: any): ScopeResolver {
  const resolver = new ScopeResolver(index, refHooks, indexerHooks);
  resolver.setImplicitNames(KERML_IMPLICIT_NAMES);
  return resolver;
}

/**
 * Creates an LSPBridge for a specific SysML2 document.
 */
export function createSysML2LSPBridge(
  index: any,
  engine: any,
  resolver: any,
  sourceText: string,
  documentUri: string,
): LSPBridge {
  return new LSPBridge(index, engine, resolver, new PositionIndex(sourceText), documentUri);
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
  diagramType: "All" | "BDD" | "IBD" | "StateMachine" = "All",
): PolyglotDiagramData {
  return buildPolyglotDiagram(index, gfxConfig, documentUri, resolver, diagramType);
}
