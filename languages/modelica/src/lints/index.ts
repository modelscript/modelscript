// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @module lints
 *
 * Central barrel for Modelica CST-level compiler lints (`CompilerLint`),
 * homotopy continuation synthesis helpers, and linear-memory AST inspection
 * utilities.
 */

import type { CompilerLint } from "@modelscript/dsl";
import { modelicaConnectionLints } from "./connections-streams.js";
import { modelicaHierarchyLints } from "./hierarchy-variability.js";
import { modelicaSyncLints } from "./synchronous-clocks.js";
import { modelicaSyntaxLints } from "./syntax-placement.js";
import { modelicaTypeLints } from "./types-expressions.js";

import {
  getComponentUnit,
  getDottedVariableType,
  getExpressionVariability,
  getFlowVariableCount,
  getVariableTypeInClass,
  getVariableUnitInClass,
  hasUnitInClass,
  inferExprType,
  inferExprUnit,
  isClassKind,
  isExpandableConnector,
  isTypeCompatible,
  resolveComplexName,
  resolveComponentClassDefinition,
} from "./helpers.js";

export {
  getComponentUnit,
  getDottedVariableType,
  getExpressionVariability,
  getFlowVariableCount,
  getVariableTypeInClass,
  getVariableUnitInClass,
  hasUnitInClass,
  inferExprType,
  inferExprUnit,
  isClassKind,
  isExpandableConnector,
  isTypeCompatible,
  modelicaConnectionLints,
  modelicaHierarchyLints,
  modelicaSyncLints,
  modelicaSyntaxLints,
  modelicaTypeLints,
  resolveComplexName,
  resolveComponentClassDefinition,
};

export { deriveSimplification, findNonlinearTermsInCst, type NonlinearTermInfo } from "./homotopy-synthesis.js";

/**
 * Combined registry of all linear-memory CST `CompilerLint` rules for Modelica 3.x,
 * merging syntax/placement, type/expression, hierarchy/variability, connection/stream,
 * and synchronous clock rules.
 */
export const allModelicaLints: Record<string, CompilerLint> = {
  ...modelicaSyntaxLints,
  ...modelicaTypeLints,
  ...modelicaHierarchyLints,
  ...modelicaConnectionLints,
  ...modelicaSyncLints,
};
