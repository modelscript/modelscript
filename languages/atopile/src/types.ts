// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/atopile — Semantic AST & Physical Constraint Types.
 */

export interface AtoSpan {
  startOffset: number;
  endOffset: number;
  line: number;
}

export interface AtoDiagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  span?: AtoSpan;
}

export interface AtoPhysicalValue {
  raw: string;
  /** Nominal SI-scaled value (e.g. 10kohm -> 10000). */
  nominal: number;
  /** Base physical unit (e.g. "ohm", "F", "H", "V", "A", "Hz", ""). */
  unit: string;
  /** Symmetric relative tolerance in percent (e.g. 1 for +/- 1%). */
  tolerancePct?: number;
  /** Minimum bound in SI units (from tolerance or `a to b` range). */
  min: number;
  /** Maximum bound in SI units (from tolerance or `a to b` range). */
  max: number;
}

export interface AtoImport {
  source?: string;
  names: string[];
  span: AtoSpan;
}

export interface AtoInstance {
  name: string;
  typeName: string;
  count?: number;
  span: AtoSpan;
}

export interface AtoConnection {
  /** Ordered chain of endpoints (e.g. `a ~ b` -> [a, b], `a ~> r ~> b` -> bridge). */
  kind: "direct" | "bridge";
  endpoints: string[];
  span: AtoSpan;
}

export interface AtoAssignment {
  target: string;
  rawValue: string;
  stringValue?: string;
  physicalValue?: AtoPhysicalValue;
  span: AtoSpan;
}

export interface AtoAssertion {
  target: string;
  operator: "within" | "<" | "<=" | ">" | ">=" | "==";
  bound: AtoPhysicalValue;
  span: AtoSpan;
}

export interface AtoBlock {
  kind: "module" | "component" | "interface";
  name: string;
  baseName?: string;
  signals: string[];
  pins: string[];
  instances: AtoInstance[];
  connections: AtoConnection[];
  assignments: AtoAssignment[];
  assertions: AtoAssertion[];
  span: AtoSpan;
}

export interface AtoFile {
  imports: AtoImport[];
  blocks: AtoBlock[];
  diagnostics: AtoDiagnostic[];
}
