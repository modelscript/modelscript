// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cellml — Domain Types for CellML 1.0 / 1.1 / 2.0 Cellular & Electrophysiology Models.
 */

export interface CellmlSourceRange {
  startOffset: number;
  endOffset: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface CellmlDimensionVector {
  ampere: number;
  kelvin: number;
  kilogram: number;
  metre: number;
  mole: number;
  second: number;
  candela: number;
  multiplierScale: number;
}

export interface CellmlUnits {
  name: string;
  isBaseUnits: boolean;
  dimensions: CellmlDimensionVector;
  range: CellmlSourceRange;
}

export type CellmlInterfaceType = "in" | "out" | "none";

export interface CellmlVariable {
  name: string;
  units: string;
  initialValue?: number | undefined;
  publicInterface: CellmlInterfaceType;
  privateInterface: CellmlInterfaceType;
  range: CellmlSourceRange;
}

export interface CellmlEquation {
  targetVariable: string;
  isOde: boolean;
  independentVariable?: string | undefined;
  rhsExpression: string;
  referencedIdentifiers: string[];
  range: CellmlSourceRange;
}

export interface CellmlComponent {
  name: string;
  variables: Map<string, CellmlVariable>;
  equations: CellmlEquation[];
  range: CellmlSourceRange;
  duplicateVariables?: Array<{ name: string; range: CellmlSourceRange }> | undefined;
}

export interface CellmlVariableMapping {
  variable1: string;
  variable2: string;
  range: CellmlSourceRange;
}

export interface CellmlConnection {
  component1: string;
  component2: string;
  mappings: CellmlVariableMapping[];
  range: CellmlSourceRange;
}

export interface CellmlEncapsulationNode {
  componentRef: string;
  children: CellmlEncapsulationNode[];
  range: CellmlSourceRange;
}

export interface CellmlDocument {
  name: string;
  version: "1.0" | "1.1" | "2.0";
  units: Map<string, CellmlUnits>;
  components: Map<string, CellmlComponent>;
  connections: CellmlConnection[];
  encapsulation: CellmlEncapsulationNode[];
  uri?: string | undefined;
  range?: CellmlSourceRange | undefined;
  duplicateComponents?: Array<{ name: string; range: CellmlSourceRange }> | undefined;
  unresolvedUnitRefs?: Array<{ unitsName: string; refUnitName: string; range: CellmlSourceRange }> | undefined;
}

export type CellmlDiagnosticSeverity = "error" | "warning" | "info";

export interface CellmlDiagnostic {
  code: string;
  rule: string;
  severity: CellmlDiagnosticSeverity;
  message: string;
  range: CellmlSourceRange;
}
