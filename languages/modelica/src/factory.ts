// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Bridge module connecting polyglot-generated Modelica artifacts to
// the existing core compiler API. See implementation_plan.md Phase 2.
//
// Note: TSC with `module: nodenext` has a naming mismatch bug when
// resolving exports from @modelscript/modelica through the
// exports map. The .d.ts files export UPPER_CASE names but TSC resolves
// camelCase aliases.

import {
  type IndexerHook as DslIndexerHook,
  extractIndexerHooks,
  extractQueryHooksMap,
  extractRefHooks,
  type RefHookInfo,
  type WorkspaceIndexingHooks,
} from "@modelscript/dsl";
import {
  type CSTTree,
  type ExpressionEvaluator,
  type IndexerHook,
  type QueryCacheStore,
  QueryEngine,
  type QueryHooks,
  type SymbolIndex,
  WorkspaceIndex,
} from "@modelscript/runtime";

import csvLangDef, { csvWorkspaceHooks } from "@modelscript/csv/language";
import lasLangDef, { lasWorkspaceHooks } from "@modelscript/las/language";
import modelicaLangDef from "./language.js";
import { modelicaWorkspaceHooks } from "./workspace-hooks.js";

const INDEXER_HOOKS = extractIndexerHooks(modelicaLangDef);
const QUERY_HOOKS = extractQueryHooksMap(modelicaLangDef);
const REF_HOOKS = extractRefHooks(modelicaLangDef);

const csvIndexerHooks = extractIndexerHooks(csvLangDef);
const csvQueryHooks = extractQueryHooksMap(csvLangDef);
const lasIndexerHooks = extractIndexerHooks(lasLangDef);
const lasQueryHooks = extractQueryHooksMap(lasLangDef);

import { modelicaEvaluator } from "./expression-evaluator.js";
import { modelicaQueryHooks } from "./queries.js";

interface FactoryGlobalFallbacks {
  __indexerHooksFallback?: DslIndexerHook[] | undefined;
  __queryHooksFallback?: Map<string, QueryHooks> | Record<string, QueryHooks> | undefined;
  __refHooksFallback?: RefHookInfo[] | undefined;
  __evaluatorFallback?: ExpressionEvaluator | undefined;
}

const globalFallbacks = globalThis as unknown as FactoryGlobalFallbacks;

const baseIndexerHooks: IndexerHook[] = [
  ...(INDEXER_HOOKS ?? globalFallbacks.__indexerHooksFallback ?? []),
  ...(csvIndexerHooks ?? []),
  ...(lasIndexerHooks ?? []),
].map((h) => ({
  ruleName: h.ruleName,
  kind: h.kind,
  namePath: h.namePath,
  exportPaths: h.exportPaths ?? [],
  inheritPaths: h.inheritPaths ?? [],
  metadataFieldPaths: h.metadataFieldPaths ?? {},
}));
const queryHooks = QUERY_HOOKS ?? globalFallbacks.__queryHooksFallback;
const refHooks: RefHookInfo[] | undefined = REF_HOOKS ?? globalFallbacks.__refHooksFallback;
const evaluator: ExpressionEvaluator = modelicaEvaluator ?? globalFallbacks.__evaluatorFallback;

// Helper to normalize rule names (PascalCase <-> snake_case)
function toSnakeCase(str: string): string {
  let out = "";
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    if (ch >= 65 && ch <= 90 && i > 0) {
      const prev = str.charCodeAt(i - 1);
      if ((prev >= 97 && prev <= 122) || (prev >= 48 && prev <= 57)) {
        out += "_";
      }
    }
    out += str[i]!;
  }
  return out.toLowerCase();
}

// Merge Modelica and CSV query hooks
const mergedQueryHooks = new Map<string, QueryHooks>();
for (const [k, v] of modelicaQueryHooks.entries()) {
  mergedQueryHooks.set(k, v as QueryHooks);
  mergedQueryHooks.set(toSnakeCase(k), v as QueryHooks);
}
if (queryHooks instanceof Map) {
  for (const [k, v] of queryHooks.entries()) {
    mergedQueryHooks.set(k, v as QueryHooks);
    mergedQueryHooks.set(toSnakeCase(k), v as QueryHooks);
  }
} else if (queryHooks) {
  for (const [k, v] of Object.entries(queryHooks)) {
    mergedQueryHooks.set(k, v as QueryHooks);
    mergedQueryHooks.set(toSnakeCase(k), v as QueryHooks);
  }
}
if (csvQueryHooks instanceof Map) {
  for (const [k, v] of csvQueryHooks.entries()) {
    mergedQueryHooks.set(k, v as QueryHooks);
    mergedQueryHooks.set(toSnakeCase(k), v as QueryHooks);
  }
} else if (csvQueryHooks) {
  for (const [k, v] of Object.entries(csvQueryHooks)) {
    mergedQueryHooks.set(k, v as QueryHooks);
    mergedQueryHooks.set(toSnakeCase(k), v as QueryHooks);
  }
}
if (lasQueryHooks instanceof Map) {
  for (const [k, v] of lasQueryHooks.entries()) {
    mergedQueryHooks.set(k, v as QueryHooks);
    mergedQueryHooks.set(toSnakeCase(k), v as QueryHooks);
  }
} else if (lasQueryHooks) {
  for (const [k, v] of Object.entries(lasQueryHooks)) {
    mergedQueryHooks.set(k, v as QueryHooks);
    mergedQueryHooks.set(toSnakeCase(k), v as QueryHooks);
  }
}

// Convert refHooks into indexerHooks so reference nodes get indexed too.
// The resolver needs reference entries in the index to detect unresolved refs.
const defRuleNames = new Set(baseIndexerHooks.map((h: IndexerHook) => h.ruleName));
const refAsIndexerHooks: IndexerHook[] = (refHooks ?? [])
  .filter((rh: RefHookInfo) => !defRuleNames.has(rh.ruleName))
  .map((rh: RefHookInfo) => ({
    ruleName: rh.ruleName,
    kind: "Reference",
    namePath: rh.namePath,
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {},
  }));

const msimIndexerHook: IndexerHook = {
  ruleName: "virtual_msim_record",
  kind: "Class",
  namePath: "name",
  exportPaths: [],
  inheritPaths: [],
  metadataFieldPaths: {
    class_prefixes: "prefixes",
  },
};

const msimPropertyHook: IndexerHook = {
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

const wasmModelicaIndexerHooks: IndexerHook[] = [
  {
    ruleName: "class_definition",
    kind: "Class",
    namePath: "name",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      classPrefixes: "class_prefixes",
      classKind: "class_prefixes",
      description: "class_specifier.long_class_specifier.description_string",
    },
  },
  {
    ruleName: "component_declaration",
    kind: "Component",
    namePath: "declaration.name",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      typePrefix: "parent.parent.type_prefix",
      typeSpecifier: "parent.parent.type_specifier",
      description: "description.description_string",
      modification: "declaration.modification",
      value: "declaration.modification.modification_expression",
      expression: "declaration.modification.modification_expression",
    },
  },
  {
    ruleName: "component_declaration1",
    kind: "Component",
    namePath: "declaration.name",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      description: "description.description_string",
      modification: "declaration.modification",
      value: "declaration.modification.modification_expression",
      expression: "declaration.modification.modification_expression",
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
    metadataFieldPaths: {
      lhs: "lhs",
      rhs: "rhs",
    },
  },
  {
    ruleName: "import_clause",
    kind: "Import",
    namePath: "name",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {},
  },
  {
    ruleName: "SimpleImportClause",
    kind: "Import",
    namePath: "packageName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      packageName: "packageName",
      shortName: "shortName",
    },
  },
  {
    ruleName: "UnqualifiedImportClause",
    kind: "Import",
    namePath: "packageName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      packageName: "packageName",
    },
  },
  {
    ruleName: "CompoundImportClause",
    kind: "Import",
    namePath: "packageName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      packageName: "packageName",
    },
  },
];

const allIndexerHooks: IndexerHook[] = [
  ...baseIndexerHooks,
  ...wasmModelicaIndexerHooks,
  ...refAsIndexerHooks,
  msimIndexerHook,
  msimPropertyHook,
];

import { injectPredefinedTypes } from "./predefined-types.js";

/**
 * Language conventions for the Modelica workspace index. The Modelica index also hosts `.csv` and
 * `.las` tabular resources (exposed as parameter/curve packages), so their indexers are merged here.
 */
export const modelicaIndexingHooks: WorkspaceIndexingHooks = {
  ...modelicaWorkspaceHooks,
  indexResource: (uri, rootNode, parentFQN) =>
    lasWorkspaceHooks.indexResource?.(uri, rootNode, parentFQN) ??
    csvWorkspaceHooks.indexResource?.(uri, rootNode, parentFQN),
};

/**
 * Creates a configured WorkspaceIndex for Modelica.
 */
export function createModelicaWorkspaceIndex(): WorkspaceIndex {
  return new WorkspaceIndex(allIndexerHooks, modelicaIndexingHooks);
}

/**
 * Creates a configured QueryEngine for a given SymbolIndex.
 */
export function createModelicaQueryEngine(
  index: SymbolIndex | WorkspaceIndex | { getIndex: (opts?: { eager?: boolean }) => SymbolIndex },
  tree?: CSTTree,
  cacheStore?: QueryCacheStore,
  maxMemos?: number,
  extraHooks?: Map<string, QueryHooks>,
): QueryEngine {
  const symbolIndex: SymbolIndex =
    "getIndex" in index && typeof index.getIndex === "function"
      ? index.getIndex({ eager: true })
      : (index as SymbolIndex);
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

export { Context } from "./context.js";
export { injectPredefinedTypes, QueryEngine, WorkspaceIndex };

/**
 * Modelica Standard Library display conventions: variables whose names mark them as auxiliary
 * (ground references, conditional heat-port temperatures, actual-resistance diagnostics) are
 * plotted after the primary simulation outputs.
 */
export function isSecondaryOutputName(name: string): boolean {
  return name.startsWith("ground.") || name.endsWith(".T_heatPort") || name.endsWith(".R_actual");
}
