// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/topas — Domain types for TOPAS (.topas) and GATE (.mac)
 * Monte Carlo particle transport and proton/carbon-ion hadrontherapy simulations.
 */

export interface TopasSourceRange {
  startOffset: number;
  endOffset: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export type TopasDiagnosticSeverity = "error" | "warning" | "info";

export interface TopasDiagnostic {
  code: string;
  rule?: string | undefined;
  severity: TopasDiagnosticSeverity;
  message: string;
  range: TopasSourceRange;
}

export type TopasTypePrefix = "d" | "i" | "b" | "s" | "u" | "dv" | "iv" | "sv" | "uv" | "bv";

export interface TopasParameterAssignment {
  rawLine: string;
  typePrefix: string;
  isChangeOverride: boolean;
  category: string;
  componentName?: string | undefined;
  propertyName: string;
  fullPath: string;
  declaredVectorLength?: number | undefined;
  actualVectorLength?: number | undefined;
  rawValue: string;
  numericValue?: number | undefined;
  vectorValues?: (number | string | boolean)[] | undefined;
  stringValue?: string | undefined;
  booleanValue?: boolean | undefined;
  unit?: string | undefined;
  typeMismatch?: boolean | undefined;
  typeMismatchReason?: string | undefined;
  vectorLengthMismatch?: boolean | undefined;
  range: TopasSourceRange;
}

export interface TopasGeometryComponent {
  name: string;
  type: string;
  parent?: string | undefined;
  material?: string | undefined;
  hlx?: number | undefined;
  hly?: number | undefined;
  hlz?: number | undefined;
  rMin?: number | undefined;
  rMax?: number | undefined;
  hl?: number | undefined;
  transX?: number | undefined;
  transY?: number | undefined;
  transZ?: number | undefined;
  rotX?: number | undefined;
  rotY?: number | undefined;
  rotZ?: number | undefined;
  xBins?: number | undefined;
  yBins?: number | undefined;
  zBins?: number | undefined;
  range: TopasSourceRange;
}

export interface TopasParticleSource {
  name: string;
  type: string;
  component?: string | undefined;
  beamParticle: string;
  beamEnergy?: number | undefined;
  beamEnergySpread?: number | undefined;
  beamPositionSpreadX?: number | undefined;
  beamPositionSpreadY?: number | undefined;
  numberOfHistoriesInRun?: number | undefined;
  range: TopasSourceRange;
}

export interface TopasScorer {
  name: string;
  quantity?: string | undefined;
  component?: string | undefined;
  outputFile?: string | undefined;
  outputType?: string | undefined;
  onlyIncludeIfIncidentParticleNamed?: string | undefined;
  range: TopasSourceRange;
}

export interface TopasMaterialDefinition {
  name: string;
  density?: number | undefined;
  components?: string[] | undefined;
  fractions?: number[] | undefined;
  meanExcitationEnergy?: number | undefined;
  range: TopasSourceRange;
}

export interface TopasIncludeDirective {
  filePath: string;
  chain?: string[] | undefined;
  range: TopasSourceRange;
}

export interface TopasDocument {
  dialect: "topas" | "gate";
  parameters: TopasParameterAssignment[];
  components: TopasGeometryComponent[];
  sources: TopasParticleSource[];
  scorers: TopasScorer[];
  materials: TopasMaterialDefinition[];
  includes: TopasIncludeDirective[];
  includeGraph?: Record<string, string[]> | undefined;
  sourceUri?: string | undefined;
  range: TopasSourceRange;
}
