// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Bridge module connecting polyglot-generated Modelica artifacts to
// the existing core compiler API. See implementation_plan.md Phase 2.
//
// Note: TSC with `module: nodenext` has a naming mismatch bug when
// resolving exports from @modelscript/modelica-polyglot through the
// exports map. The .d.ts files export UPPER_CASE names but TSC resolves
// camelCase aliases. We use @ts-expect-error to work around this.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { LSPBridge, PositionIndex } from "@modelscript/polyglot/lsp-bridge";
import { QueryEngine } from "@modelscript/polyglot/query-engine";
import { ScopeResolver } from "@modelscript/polyglot/resolver";
import { WorkspaceIndex } from "@modelscript/polyglot/workspace-index";

// @ts-expect-error — TSC resolves camelCase aliases, but the actual exports are UPPER_CASE
import { INDEXER_HOOKS } from "@modelscript/modelica-polyglot/indexer_config";
// @ts-expect-error — TSC resolves camelCase aliases, but the actual exports are UPPER_CASE
import { QUERY_HOOKS } from "@modelscript/modelica-polyglot/query_hooks";
// @ts-expect-error — TSC resolves camelCase aliases, but the actual exports are UPPER_CASE
import { REF_HOOKS } from "@modelscript/modelica-polyglot/ref_config";

import {
  QueryBackedClassInstance,
  QueryBackedComponentInstance,
  QueryBackedElement,
} from "@modelscript/modelica-polyglot/compat-shim";

// @ts-expect-error — TSC resolves as `modelicaExpressionEvaluator` but actual export name is `modelicaEvaluator`
import { modelicaEvaluator } from "@modelscript/modelica-polyglot/expression-evaluator";

const indexerHooks = INDEXER_HOOKS ?? (globalThis as any).__indexerHooksFallback;
const queryHooks = QUERY_HOOKS ?? (globalThis as any).__queryHooksFallback;
const refHooks = REF_HOOKS ?? (globalThis as any).__refHooksFallback;
const evaluator = modelicaEvaluator ?? (globalThis as any).__evaluatorFallback;

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
 * Creates a configured WorkspaceIndex for Modelica.
 */
export function createModelicaWorkspaceIndex(): WorkspaceIndex {
  return new WorkspaceIndex(allIndexerHooks);
}

/**
 * Creates a configured QueryEngine for a given SymbolIndex.
 */
export function createModelicaQueryEngine(index: any): QueryEngine {
  return new QueryEngine(index, queryHooks, { evaluator });
}

/**
 * Creates a configured ScopeResolver for a given SymbolIndex.
 */
export function createModelicaScopeResolver(index: any): ScopeResolver {
  return new ScopeResolver(index, refHooks, indexerHooks);
}

/**
 * Creates an LSPBridge for a specific document.
 */
export function createModelicaLSPBridge(
  index: any,
  engine: any,
  resolver: any,
  sourceText: string,
  documentUri: string,
): LSPBridge {
  return new LSPBridge(index, engine, resolver, new PositionIndex(sourceText), documentUri);
}

export { LSPBridge, PositionIndex, QueryEngine, ScopeResolver, WorkspaceIndex };

export { QueryBackedClassInstance, QueryBackedComponentInstance, QueryBackedElement };
