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

import { QueryEngine } from "@modelscript/compiler";
import { LSPBridge, PositionIndex } from "@modelscript/compiler/lsp-bridge";
import { ScopeResolver } from "@modelscript/compiler/resolver";
import { WorkspaceIndex } from "@modelscript/compiler/workspace-index";

import * as ModelicaAST from "./ast.js";

import { INDEXER_HOOKS, REF_HOOKS } from "./src-gen/config.js";
import { QUERY_HOOKS } from "./src-gen/query-hooks.js";

import { INDEXER_HOOKS as csvIndexerHooks } from "@modelscript/csv/config";
import { QUERY_HOOKS as csvQueryHooks } from "@modelscript/csv/query-hooks";

import {
  ModelicaArrayClassInstance,
  ModelicaBooleanClassInstance,
  ModelicaClassInstance,
  ModelicaClockClassInstance,
  ModelicaComponentInstance,
  ModelicaElement,
  ModelicaElementModification,
  ModelicaEnumerationClassInstance,
  ModelicaExpressionClassInstance,
  ModelicaExtendsClassInstance,
  ModelicaIntegerClassInstance,
  ModelicaModification,
  ModelicaPredefinedClassInstance,
  ModelicaRealClassInstance,
  ModelicaShortClassInstance,
  ModelicaStringClassInstance,
  registerAbstractSyntaxNodeFactory,
  registerAnnotationEvaluator,
} from "./semantic-model.js";

import { AnnotationEvaluator } from "./diagram/annotation-evaluator.js";

// Bridge the Polyglot CST to the Legacy AST for flattener and simulator compatibility.
// This preserves the @modelscript/modelica package's decoupling from modelica-ast.
registerAbstractSyntaxNodeFactory((cst: any) => ModelicaAST.ModelicaSyntaxNode.new(null, cst));

registerAnnotationEvaluator((ast: any, name: string, evalScope?: any, overrideModification?: any) => {
  const evaluator = new AnnotationEvaluator(evalScope, overrideModification);
  return evaluator.evaluate(ast, name);
});

import { modelicaEvaluator } from "./expression-evaluator.js";

const baseIndexerHooks = [
  ...(INDEXER_HOOKS ?? (globalThis as any).__indexerHooksFallback ?? []),
  ...(csvIndexerHooks ?? []),
];
const queryHooks = QUERY_HOOKS ?? (globalThis as any).__queryHooksFallback;
const refHooks = REF_HOOKS ?? (globalThis as any).__refHooksFallback;
const evaluator = modelicaEvaluator ?? (globalThis as any).__evaluatorFallback;

// Merge Modelica and CSV query hooks
const mergedQueryHooks = new Map<string, any>();
if (queryHooks instanceof Map) {
  for (const [k, v] of queryHooks.entries()) {
    mergedQueryHooks.set(k, v);
  }
} else if (queryHooks) {
  for (const [k, v] of Object.entries(queryHooks)) {
    mergedQueryHooks.set(k, v);
  }
}
if (csvQueryHooks instanceof Map) {
  for (const [k, v] of csvQueryHooks.entries()) {
    mergedQueryHooks.set(k, v);
  }
} else if (csvQueryHooks) {
  for (const [k, v] of Object.entries(csvQueryHooks)) {
    mergedQueryHooks.set(k, v);
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
const allIndexerHooks = [...baseIndexerHooks, ...refAsIndexerHooks];

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
export function createModelicaQueryEngine(index: any, tree?: any, cacheStore?: any, maxMemos?: number): QueryEngine {
  const symbolIndex = index?.toUnified ? index.toUnified() : index;
  injectPredefinedTypes(symbolIndex);
  return new QueryEngine(symbolIndex, mergedQueryHooks, {
    evaluator,
    tree,
    cacheStore,
    ...(maxMemos !== undefined && { maxMemos }),
  });
}

/**
 * Creates a configured ScopeResolver for a given SymbolIndex.
 */
const BUILTIN_MODELICA_NAMES = new Set([
  "Real",
  "Integer",
  "Boolean",
  "String",
  "enumeration",
  "Clock",
  "time",
  "AssertionLevel",
  "StateSelect",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "sinh",
  "cosh",
  "tanh",
  "exp",
  "log",
  "log10",
  "sqrt",
  "abs",
  "sign",
  "der",
  "pre",
  "edge",
  "change",
  "reinit",
  "initial",
  "terminal",
  "sample",
  "noEvent",
  "smooth",
  "delay",
  "cardinality",
  "homotopy",
  "semiLinear",
  "inStream",
  "actualStream",
  "spatialDistribution",
  "getInstanceName",
  "sum",
  "product",
  "ndims",
  "size",
  "scalar",
  "vector",
  "matrix",
  "identity",
  "diagonal",
  "zeros",
  "ones",
  "fill",
  "linspace",
  "min",
  "max",
  "mod",
  "rem",
  "ceil",
  "floor",
  "integer",
  "cross",
  "skew",
  "outerProduct",
  "symmetric",
  "sort",
  "cat",
  "div",
  "Connections",
  "Subtask",
  "super",
  // Modelica Script (.mos) built-in functions
  "loadFile",
  "loadString",
  "loadModel",
  "simulate",
  "calibrate",
  "getClassNames",
  "print",
]);

export function createModelicaScopeResolver(index: any): ScopeResolver {
  const resolver = new ScopeResolver(index, refHooks, allIndexerHooks);
  resolver.setImplicitNames(BUILTIN_MODELICA_NAMES);
  return resolver;
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

export { injectPredefinedTypes, LSPBridge, PositionIndex, QueryEngine, ScopeResolver, WorkspaceIndex };

export {
  ModelicaArrayClassInstance,
  ModelicaBooleanClassInstance,
  ModelicaClassInstance,
  ModelicaClockClassInstance,
  ModelicaComponentInstance,
  ModelicaElement,
  ModelicaElementModification,
  ModelicaEnumerationClassInstance,
  ModelicaExpressionClassInstance,
  ModelicaExtendsClassInstance,
  ModelicaIntegerClassInstance,
  ModelicaModification,
  ModelicaPredefinedClassInstance,
  ModelicaRealClassInstance,
  ModelicaShortClassInstance,
  ModelicaStringClassInstance,
};
