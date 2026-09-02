// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Bridge module connecting polyglot-generated Modelica artifacts to
// the existing core compiler API. See implementation_plan.md Phase 2.
//
// Note: TSC with `module: nodenext` has a naming mismatch bug when
// resolving exports from @modelscript/modelica through the
// exports map. The .d.ts files export UPPER_CASE names but TSC resolves
// camelCase aliases. We use @ts-expect-error to work around this.

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  extractIndexerHooks,
  extractQueryHooksMap,
  extractRefHooks,
  LSPBridge,
  PositionIndex,
  QueryEngine,
  WorkspaceIndex,
} from "@modelscript/language/compiler";

import csvLangDef from "@modelscript/csv/language";
import modelicaLangDef from "./language.js";

const INDEXER_HOOKS = extractIndexerHooks(modelicaLangDef);
const QUERY_HOOKS = extractQueryHooksMap(modelicaLangDef);
const REF_HOOKS = extractRefHooks(modelicaLangDef);

const csvIndexerHooks = extractIndexerHooks(csvLangDef);
const csvQueryHooks = extractQueryHooksMap(csvLangDef);

import { modelicaEvaluator } from "./expression-evaluator.js";

const baseIndexerHooks = [
  ...(INDEXER_HOOKS ?? (globalThis as any).__indexerHooksFallback ?? []),
  ...(csvIndexerHooks ?? []),
];
const queryHooks = QUERY_HOOKS ?? (globalThis as any).__queryHooksFallback;
const refHooks = REF_HOOKS ?? (globalThis as any).__refHooksFallback;
const evaluator = modelicaEvaluator ?? (globalThis as any).__evaluatorFallback;

// Helper to normalize rule names (PascalCase <-> snake_case)
function toSnakeCase(str: string): string {
  return str.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

// Merge Modelica and CSV query hooks
const mergedQueryHooks = new Map<string, any>();
if (queryHooks instanceof Map) {
  for (const [k, v] of queryHooks.entries()) {
    mergedQueryHooks.set(k, v);
    mergedQueryHooks.set(toSnakeCase(k), v);
  }
} else if (queryHooks) {
  for (const [k, v] of Object.entries(queryHooks)) {
    mergedQueryHooks.set(k, v);
    mergedQueryHooks.set(toSnakeCase(k), v);
  }
}
if (csvQueryHooks instanceof Map) {
  for (const [k, v] of csvQueryHooks.entries()) {
    mergedQueryHooks.set(k, v);
    mergedQueryHooks.set(toSnakeCase(k), v);
  }
} else if (csvQueryHooks) {
  for (const [k, v] of Object.entries(csvQueryHooks)) {
    mergedQueryHooks.set(k, v);
    mergedQueryHooks.set(toSnakeCase(k), v);
  }
}

// Convert refHooks into indexerHooks so reference nodes get indexed too.
// The resolver needs reference entries in the index to detect unresolved refs.
const defRuleNames = new Set(baseIndexerHooks.map((h: any) => h.ruleName));
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

const msimIndexerHook: any = {
  ruleName: "virtual_msim_record",
  kind: "Class",
  namePath: "name",
  exportPaths: [],
  inheritPaths: [],
  metadataFieldPaths: {
    class_prefixes: "prefixes",
  },
};

const msimPropertyHook: any = {
  ruleName: "virtual_msim_property",
  kind: "Component",
  namePath: "name",
  exportPaths: [],
  inheritPaths: [],
  metadataFieldPaths: {
    type: "type",
    variability: "variability",
  },
};

const wasmModelicaIndexerHooks: any[] = [
  {
    ruleName: "class_definition",
    kind: "Class",
    namePath: "name",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      classPrefixes: "class_prefixes",
    },
  },
  {
    ruleName: "component_declaration",
    kind: "Component",
    namePath: "declaration.name",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      typeSpecifier: "parent.type_specifier",
    },
  },
  {
    ruleName: "extends_clause",
    kind: "Extends",
    namePath: "type_specifier",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      typeSpecifier: "type_specifier",
    },
  },
  {
    ruleName: "connect_equation",
    kind: "ConnectEquation",
    namePath: "lhs",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {},
  },
];

const allIndexerHooks = [
  ...wasmModelicaIndexerHooks,
  ...baseIndexerHooks,
  ...refAsIndexerHooks,
  msimIndexerHook,
  msimPropertyHook,
];

import { injectPredefinedTypes } from "./predefined-types.js";

/**
 * Creates a configured WorkspaceIndex for Modelica.
 */
export function createModelicaWorkspaceIndex(): WorkspaceIndex {
  return new WorkspaceIndex(allIndexerHooks);
}

/**
 * Creates a configured QueryEngine for a given SymbolIndex.
 */
export function createModelicaQueryEngine(
  index: any,
  tree?: any,
  cacheStore?: any,
  maxMemos?: number,
  extraHooks?: Map<string, any>,
): QueryEngine {
  const symbolIndex = index?.toUnified ? index.toUnified() : index;
  injectPredefinedTypes(symbolIndex);

  const finalHooks = new Map(mergedQueryHooks);
  if (extraHooks) {
    for (const [k, v] of extraHooks.entries()) {
      finalHooks.set(k, v);
    }
  }

  return new QueryEngine(symbolIndex, finalHooks, {
    evaluator,
    tree,
    cacheStore,
    ...(maxMemos !== undefined && { maxMemos }),
  });
}

/**
 * Creates an LSPBridge for a specific document.
 */
export function createModelicaLSPBridge(index: any, engine: any, arg3: any, arg4?: any, arg5?: any): LSPBridge {
  if (arg5 !== undefined) {
    return new LSPBridge(index, engine, new PositionIndex(arg4), arg5);
  }
  if (arg4 !== undefined) {
    return new LSPBridge(index, engine, new PositionIndex(arg3), arg4);
  }
  return new LSPBridge(index, engine, new PositionIndex(""), "");
}

import { MsimParser } from "./msim-parser.js";
export { Context } from "./context.js";
export { injectPredefinedTypes, LSPBridge, MsimParser, PositionIndex, QueryEngine, WorkspaceIndex };
