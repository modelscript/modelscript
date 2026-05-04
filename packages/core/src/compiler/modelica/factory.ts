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

import { LSPBridge, PositionIndex } from "@modelscript/polyglot/lsp-bridge";
import { QueryEngine } from "@modelscript/polyglot/query-engine";
import { ScopeResolver } from "@modelscript/polyglot/resolver";
import { WorkspaceIndex } from "@modelscript/polyglot/workspace-index";

import * as ModelicaAST from "@modelscript/modelica/ast";

// @ts-expect-error — TSC resolves camelCase aliases, but the actual exports are UPPER_CASE
import { INDEXER_HOOKS } from "@modelscript/modelica/indexer_config";
// @ts-expect-error — TSC resolves camelCase aliases, but the actual exports are UPPER_CASE
import { QUERY_HOOKS } from "@modelscript/modelica/query_hooks";
// @ts-expect-error — TSC resolves camelCase aliases, but the actual exports are UPPER_CASE
import { REF_HOOKS } from "@modelscript/modelica/ref_config";

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
} from "@modelscript/modelica/semantic-model";

import { AnnotationEvaluator } from "./annotation-evaluator.js";

// Bridge the Polyglot CST to the Legacy AST for flattener and simulator compatibility.
// This preserves the @modelscript/modelica package's decoupling from modelica-ast.
registerAbstractSyntaxNodeFactory((cst: any) => ModelicaAST.ModelicaSyntaxNode.new(null, cst));

registerAnnotationEvaluator((ast: any, name: string, evalScope?: any, overrideModification?: any) => {
  const evaluator = new AnnotationEvaluator(evalScope, overrideModification);
  return evaluator.evaluate(ast, name);
});

// @ts-expect-error — TSC resolves as `modelicaExpressionEvaluator` but actual export name is `modelicaEvaluator`
import { modelicaEvaluator } from "@modelscript/modelica/expression-evaluator";

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

import { injectPredefinedTypes } from "@modelscript/modelica/predefined-types";

/**
 * Creates a configured WorkspaceIndex for Modelica.
 */
export function createModelicaWorkspaceIndex(): WorkspaceIndex {
  return new WorkspaceIndex(allIndexerHooks);
}

/**
 * Creates a configured QueryEngine for a given SymbolIndex.
 */
export function createModelicaQueryEngine(index: any, tree?: any): QueryEngine {
  const symbolIndex = index?.toUnified ? index.toUnified() : index;
  injectPredefinedTypes(symbolIndex);
  return new QueryEngine(symbolIndex, queryHooks, { evaluator, tree });
}

/**
 * Creates a configured ScopeResolver for a given SymbolIndex.
 */
import { BUILTIN_MODELICA_NAMES } from "./linter.js";

export function createModelicaScopeResolver(index: any): ScopeResolver {
  const resolver = new ScopeResolver(index, refHooks, indexerHooks);
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
