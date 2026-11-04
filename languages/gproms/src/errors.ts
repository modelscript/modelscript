// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/gproms — Pre-flight Diagnostic Error Definitions.
 *
 * Conforms to OpenModelica-style diagnostic formatting (M9451 - M9460).
 */

import type { GpromsRange } from "./types.js";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface DiagnosticItem {
  code: number;
  rule: string;
  severity: DiagnosticSeverity;
  message: string;
  range?: GpromsRange | undefined;
}

export const GpromsErrorCode = {
  UNDECLARED_VARIABLE_TYPE: {
    code: 9451,
    rule: "undeclared-variable-type",
    severity: "error" as DiagnosticSeverity,
    message: (modelName: string, varName: string, typeName: string) =>
      `Variable '${varName}' in model '${modelName}' references undeclared DECLARE TYPE '${typeName}'.`,
  },
  INVALID_VARIABLE_BOUNDS: {
    code: 9452,
    rule: "invalid-variable-bounds",
    severity: "error" as DiagnosticSeverity,
    message: (typeName: string, defaultVal: number, lower: number, upper: number) =>
      `Variable type '${typeName}' specifies invalid bounds or default value (default=${defaultVal}, lower=${lower}, upper=${upper}); requires lower < upper and lower <= default <= upper.`,
  },
  INVALID_DISTRIBUTION_DOMAIN: {
    code: 9453,
    rule: "invalid-distribution-domain",
    severity: "error" as DiagnosticSeverity,
    message: (modelName: string, domainName: string, lower: number, upper: number, gridPoints: number) =>
      `Distribution domain '${domainName}' in model '${modelName}' specifies invalid domain [${lower} : ${upper}] or grid points (${gridPoints}); requires lower < upper and gridPoints >= 2.`,
  },
  UNDECLARED_EQUATION_IDENTIFIER: {
    code: 9454,
    rule: "undeclared-equation-identifier",
    severity: "error" as DiagnosticSeverity,
    message: (modelName: string, identifier: string) =>
      `Equation in model '${modelName}' references undeclared identifier '${identifier}'.`,
  },
  STRUCTURAL_DOF_MISMATCH: {
    code: 9455,
    rule: "structural-dof-mismatch",
    severity: "warning" as DiagnosticSeverity,
    message: (modelName: string, eqCount: number, assignCount: number, varCount: number) =>
      `Model '${modelName}' has a structural degrees-of-freedom mismatch: ${eqCount} equations + ${assignCount} ASSIGNed variables != ${varCount} unknown variables.`,
  },
  UNINITIALIZED_DIFFERENTIAL_STATE: {
    code: 9456,
    rule: "uninitialized-differential-state",
    severity: "warning" as DiagnosticSeverity,
    message: (processName: string, varName: string) =>
      `Differential state variable '$${varName}' lacks an INITIAL condition in PROCESS '${processName}'.`,
  },
  PARTIAL_ON_NON_DISTRIBUTED_VARIABLE: {
    code: 9457,
    rule: "partial-on-non-distributed-variable",
    severity: "error" as DiagnosticSeverity,
    message: (modelName: string, varName: string, domainName: string) =>
      `Spatial derivative 'PARTIAL(${varName}, ${domainName})' in model '${modelName}' is applied to variable '${varName}' which is not distributed over domain '${domainName}'.`,
  },
  OVERASSIGNED_PARAMETER_OR_VARIABLE: {
    code: 9458,
    rule: "overassigned-parameter-or-variable",
    severity: "error" as DiagnosticSeverity,
    message: (processName: string, entityName: string, detail: string) =>
      `Entity '${entityName}' in PROCESS '${processName}' is overassigned or misused: ${detail}.`,
  },
  EMPTY_GPROMS_MODEL: {
    code: 9459,
    rule: "empty-gproms-model",
    severity: "error" as DiagnosticSeverity,
    message: (modelName: string) => `gPROMS model '${modelName}' is empty and defines no variables or equations.`,
  },
  DUPLICATE_ENTITY_DECLARATION: {
    code: 9460,
    rule: "duplicate-entity-declaration",
    severity: "error" as DiagnosticSeverity,
    message: (kind: string, name: string, scope: string) => `Duplicate ${kind} declaration '${name}' in '${scope}'.`,
  },
} as const;
