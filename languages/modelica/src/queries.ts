// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Modelica Salsa Query Hooks.
 * Barrel and coordinator composing domain-focused query modules under `./queries/`.
 */

import { classCoreQueries } from "./queries/class-core.js";
import { classLintQueries } from "./queries/class-lints.js";
import { componentCoreQueries } from "./queries/component-core.js";
import { componentLintQueries } from "./queries/component-lints.js";
import { connectEquationQueries } from "./queries/connect-queries.js";
import { extendsClauseQueries } from "./queries/extends-queries.js";
import { shortClassSpecifierQueries } from "./queries/short-class-queries.js";
import type { ModelicaQueryHooks } from "./queries/types.js";

export {
  cyrb53,
  getShortClassSpecifierNode,
  isClassExtendsInCst,
  isInnerQuery,
  isOuterQuery,
  splitTopLevel,
  validateEnumeration,
} from "./queries/cst-helpers.js";
export { checkModifierNotFound, parseModArgsFromCst } from "./queries/modifications.js";
export {
  getScopeData,
  isScopeEncapsulated,
  isSymbolEncapsulated,
  mergeInto,
  resolveQualified,
  resolveSimpleNameHelper,
} from "./queries/name-resolution.js";
export type {
  ArrayDimensionDescriptor,
  ComponentInstanceSummary,
  DimEvalResult,
  EnumValidationResult,
  ModelicaCycleRecoveryFn,
  ModelicaQueryDef,
  ModelicaQueryFn,
  ModelicaQueryHooks,
  ParsedModArgs,
  ParsedModificationArg,
  QueryCstNode,
  QueryDiagnostic,
  ResolveNameFn,
  ResolveSimpleNameFn,
  ScopeData,
} from "./queries/types.js";
export { connectEquationQueries, extendsClauseQueries, shortClassSpecifierQueries };

/**
 * Salsa semantic and lint queries attached to `class_definition` (`ClassDefinition`) symbols.
 */
export const classDefinitionQueries: ModelicaQueryHooks = {
  ...classCoreQueries,
  ...classLintQueries,
};

/**
 * Salsa semantic queries and lint hooks attached to `component_declaration` (`Component`) symbols.
 * Computes type resolution, variability/causality/flow prefixes, visibility, array dimension shapes,
 * merged modifications, and component-level semantic diagnostics (`M2003`, `M2004`, `M4043`, `M4076`).
 */
export const componentDeclarationQueries: ModelicaQueryHooks = {
  ...componentCoreQueries,
  ...componentLintQueries,
};

function stripLintQueries(hooks: ModelicaQueryHooks): ModelicaQueryHooks {
  const out: ModelicaQueryHooks = {};
  for (const [key, fn] of Object.entries(hooks)) {
    if (!key.startsWith("lint__")) {
      out[key] = fn;
    }
  }
  return out;
}

/**
 * Polyglot fallback Salsa query tables for non-Modelica symbols (`PSSEDynamics.*`, `PSCAD`,
 * `SPICE`, `SysML v2`, etc.) resolved by `SymbolEntry.kind` when `ruleName` is foreign.
 */
export const foreignClassQueries: ModelicaQueryHooks = stripLintQueries(classDefinitionQueries);
export const foreignComponentQueries: ModelicaQueryHooks = stripLintQueries(componentDeclarationQueries);

/**
 * Registry mapping Modelica CST node rule names (and polyglot `@kind:*` fallbacks)
 * to their corresponding Salsa query hook tables.
 */
export const modelicaQueryHooks = new Map<string, ModelicaQueryHooks>([
  ["class_definition", classDefinitionQueries],
  ["ClassDefinition", classDefinitionQueries],
  ["component_declaration", componentDeclarationQueries],
  ["ComponentDeclaration", componentDeclarationQueries],
  ["extends_clause", extendsClauseQueries],
  ["ExtendsClause", extendsClauseQueries],
  ["short_class_specifier", shortClassSpecifierQueries],
  ["ShortClassSpecifier", shortClassSpecifierQueries],
  ["connect_equation", connectEquationQueries],
  ["ConnectEquation", connectEquationQueries],
  ["@kind:Class", foreignClassQueries],
  ["@kind:Package", foreignClassQueries],
  ["@kind:Definition", foreignClassQueries],
  ["@kind:Port", foreignClassQueries],
  ["@kind:Component", foreignComponentQueries],
  ["@kind:Variable", foreignComponentQueries],
  ["@kind:Usage", foreignComponentQueries],
]);
