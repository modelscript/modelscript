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
  isTypeCompatible,
  modelicaConnectionLints,
  modelicaHierarchyLints,
  modelicaSyncLints,
  modelicaSyntaxLints,
  modelicaTypeLints,
  resolveComplexName,
  resolveComponentClassDefinition,
};

export const allModelicaLints: Record<string, CompilerLint> = {
  ...modelicaSyntaxLints,
  ...modelicaTypeLints,
  ...modelicaHierarchyLints,
  ...modelicaConnectionLints,
  ...modelicaSyncLints,
};
