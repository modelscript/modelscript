// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/gproms — gPROMS Process Modeling Language (.gproms, .pml) AST & Data Types.
 *
 * Represents equation-oriented lumped and distributed parameter process models:
 *   - DECLARE TYPE physical variable domain declarations
 *   - MODEL blocks with PARAMETER, DISTRIBUTION_DOMAIN, VARIABLE, BOUNDARY, and EQUATION sections
 *   - Time derivatives ($x) and spatial partial derivatives (PARTIAL(u, z))
 *   - PROCESS simulation blocks with UNIT, SET, ASSIGN, INITIAL, and SOLUTIONPARAMETERS sections
 */

export interface GpromsRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export interface GpromsVariableType {
  name: string;
  defaultValue: number;
  lowerBound: number;
  upperBound: number;
  unit?: string | undefined;
  range?: GpromsRange | undefined;
}

export type GpromsParameterDataType = "REAL" | "INTEGER" | "LOGICAL";

export interface GpromsParameter {
  name: string;
  dataType: GpromsParameterDataType;
  defaultValue?: number | undefined;
  unit?: string | undefined;
  range?: GpromsRange | undefined;
}

export type GpromsDiscretizationMethod = "CFDM" | "BFDM" | "FFDM" | "OCFEM";

export interface GpromsDistributionDomain {
  name: string;
  lowerBound: number;
  upperBound: number;
  gridPoints: number; // default 10
  discretizationMethod?: GpromsDiscretizationMethod | undefined;
  range?: GpromsRange | undefined;
}

export interface GpromsVariable {
  name: string;
  typeName: string;
  domains: string[]; // empty for lumped, e.g. ["Axial"] for distributed
  range?: GpromsRange | undefined;
}

export interface GpromsPartialDerivative {
  variable: string;
  domain: string;
  order: number; // 1 for first-order PARTIAL(u, z), 2 for second-order PARTIAL(PARTIAL(u, z), z)
}

export interface GpromsEquation {
  lhs: string;
  rhs: string;
  raw: string;
  isBoundary?: boolean | undefined;
  domainName?: string | undefined;
  differentialVariables: string[];
  partials: GpromsPartialDerivative[];
  identifiers: string[];
  range?: GpromsRange | undefined;
}

export interface GpromsModel {
  name: string;
  parameters: Map<string, GpromsParameter>;
  domains: Map<string, GpromsDistributionDomain>;
  variables: Map<string, GpromsVariable>;
  boundaryEquations: GpromsEquation[];
  equations: GpromsEquation[];
  range?: GpromsRange | undefined;
}

export interface GpromsProcessAssignment {
  target: string; // e.g. "R101.k" or "k"
  unitName?: string | undefined;
  entityName: string; // e.g. "k"
  value: number;
  range?: GpromsRange | undefined;
}

export interface GpromsProcess {
  name: string;
  units: Map<string, string>; // unitName -> modelName
  sets: Map<string, number>; // entityName -> value (plus unitName.entityName)
  setEntries: GpromsProcessAssignment[];
  assigns: Map<string, number>; // entityName -> value
  assignEntries: GpromsProcessAssignment[];
  initials: Map<string, number>; // entityName -> value
  initialEntries: GpromsProcessAssignment[];
  solutionParameters: Map<string, number>;
  range?: GpromsRange | undefined;
}

export interface GpromsDuplicateDeclaration {
  kind: "TYPE" | "MODEL" | "PARAMETER" | "DISTRIBUTION_DOMAIN" | "VARIABLE" | "PROCESS" | "UNIT";
  name: string;
  scope: string;
  range?: GpromsRange | undefined;
}

export interface GpromsDocument {
  variableTypes: Map<string, GpromsVariableType>;
  models: Map<string, GpromsModel>;
  processes: Map<string, GpromsProcess>;
  duplicateDeclarations: GpromsDuplicateDeclaration[];
  sourceFile?: string | undefined;
}
