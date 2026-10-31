// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript Unified Engineering Study Specification (v1.0)
 *
 * Standards Alignment:
 *  - SED-ML L1V4 (Simulation Experiment Description Markup Language):
 *    Separates Model Contract (`modelContract`), Simulation/Task Configuration (`inputs`, `kind`),
 *    Data Generators (`outputs.kpis`), and Output Reports/Plots (`outputs.views`).
 *  - FMI 3.0 & SSP 2.0 (`.ssd` / `.ssv` / `.ssm`):
 *    Typed parameter & observable slots with physical units and explicit binding maps.
 *  - Frictionless Data Package (`datapackage.lock.json`):
 *    Reproducible SHA-256 provenance of model source, study template, sample matrix, and outputs.
 */

export type StudyStandardFormat = "sedml" | "ssp-ssv" | "dakota";

export type StudyKind =
  | "time-course"
  | "steady-state"
  | "eigen-frequency"
  | "parameter-sweep"
  | "monte-carlo"
  | "optimization"
  | "verification"
  | "surrogate";

export type StudyCategory =
  | "simulation"
  | "sweep"
  | "uncertainty"
  | "optimization"
  | "verification"
  | "fea"
  | "cfd"
  | "power-emt"
  | "multibody";

export type StudyDomain =
  | "modelica"
  | "msx"
  | "fmu"
  | "ssp"
  | "fea"
  | "calculix"
  | "cfd"
  | "su2"
  | "openfoam"
  | "cad"
  | "pscad"
  | "psse"
  | "opendss"
  | "simpack"
  | "gensys"
  | "adams"
  | "spice"
  | "verilog-a"
  | "verilog-ams"
  | "vhdl-ams"
  | "touchstone"
  | "ibis"
  | "sysml2"
  | "sysmlv2"
  | "reqif"
  | "owl2"
  | "scad"
  | "step"
  | "sbml"
  | "cellml"
  | "olga"
  | "sima"
  | "lps"
  | "epanet"
  | "swmm"
  | "gtsuite"
  | "easy5"
  | "rocets"
  | "relap5"
  | "energyplus"
  | "aspen"
  | "eclipse"
  | "jsbsim"
  | "urdf"
  | "ccsds"
  | "opendrive"
  | "openscenario"
  | "plcopen"
  | "autosar"
  | "simulink"
  | "matlab"
  | "python"
  | "julia"
  | "c"
  | "cpp"
  | "rust"
  | "fortran"
  | "csv";

export type StudyExecutionTarget = "local-wasm" | "local-native" | "hpc-cluster";

export type StudySourceType = "official" | "package" | "community";

export interface StudyParameterDistribution {
  kind: "normal" | "uniform" | "lognormal" | "weibull" | "triangular";
  mean?: number | undefined;
  std?: number | undefined;
  cov?: number | undefined;
  min?: number | undefined;
  max?: number | undefined;
}

export interface StudyParameterSlot {
  slotId: string;
  label: string;
  description: string;
  type: "Real" | "Integer" | "Boolean";
  variability: "parameter" | "constant" | "input";
  unit?: string | undefined;
  multiple: boolean;
  defaultDistribution?: StudyParameterDistribution | undefined;
}

export interface StudyObservableSlot {
  slotId: string;
  label: string;
  description: string;
  type: "Real" | "Integer" | "Boolean";
  unit?: string | undefined;
  multiple: boolean;
}

export interface StudyModelContract {
  domains: StudyDomain[];
  minParameters: number;
  minObservables: number;
  parameterSlots: StudyParameterSlot[];
  observableSlots: StudyObservableSlot[];
}

export interface StudyInputFieldOption {
  value: string;
  label: string;
}

export interface StudyInputField {
  key: string;
  label: string;
  type: "number" | "integer" | "select" | "boolean" | "text";
  unit?: string | undefined;
  defaultValue: number | string | boolean;
  min?: number | undefined;
  max?: number | undefined;
  step?: number | undefined;
  options?: StudyInputFieldOption[] | undefined;
  description?: string | undefined;
  group?: "solver" | "sampling" | "physics" | "convergence" | "criteria" | undefined;
}

export interface StudyPreset {
  id: string;
  label: string;
  description: string;
  targetHint?: StudyExecutionTarget | undefined;
  values: Record<string, number | string | boolean>;
}

export interface StudyKpiSpec {
  id: string;
  label: string;
  unit?: string | undefined;
  expr: string;
  description?: string | undefined;
}

export interface StudyOutputViewSpec {
  kind:
    | "trajectory"
    | "fan-chart"
    | "sobol-bar"
    | "sweep-curve"
    | "pareto-front"
    | "vtu-3d"
    | "compliance-matrix"
    | "histogram";
  title: string;
  xLabel?: string | undefined;
  yLabel?: string | undefined;
}

export interface StudyExecutionSpec {
  supportedTargets: StudyExecutionTarget[];
  defaultTarget: StudyExecutionTarget | "auto";
  recommendedSolver: string;
  recommendedProfile: "wasm-edge" | "standard" | "high-cpu" | "gpu-a100";
  estimatedCredits: number;
  pipelineSteps: string[];
}

export interface StudyDefinition {
  schemaVersion: "1.0.0";
  standardFormat?: StudyStandardFormat | undefined;
  id: string;
  slug: string;
  name: string;
  version: string;
  kind: StudyKind;
  category: StudyCategory;
  sourceType: StudySourceType;
  packageName?: string | null | undefined;
  packageVersion?: string | null | undefined;
  artifactPath?: string | null | undefined;
  targetModel?: string | null | undefined;
  targetArtifact?: string | null | undefined;
  bundledInRelease?: boolean | undefined;
  authorUsername: string;
  icon: string;
  description: string;
  tags: string[];
  featured: boolean;
  starsCount: number;
  runsCount: number;
  modelContract: StudyModelContract;
  inputs: StudyInputField[];
  presets: StudyPreset[];
  execution: StudyExecutionSpec;
  outputs: {
    kpis: StudyKpiSpec[];
    views: StudyOutputViewSpec[];
  };
}

export interface StudyInstanceArtifact {
  id?: number | string | undefined;
  standardFormat: StudyStandardFormat;
  filename: string;
  fileName: string;
  fileExtension: ".sedml" | ".ssv" | ".dakota";
  mimeType: "application/sedml+xml" | "application/ssp-ssv+xml" | "text/x-dakota";
  sourceContent: string;
  sha256?: string | undefined;
  templateSlug: string;
  templateName: string;
  modelId: string;
  modelName: string;
  modelDomain: StudyDomain;
  packageName?: string | undefined;
  packageVersion?: string | undefined;
  targetArtifact?: string | undefined;
  executionTarget: StudyExecutionTarget;
  inputs: Record<string, number | string | boolean>;
  parameterBindings: StudyParameterBinding[];
  observables: string[];
  createdAt: string;
}

export interface ModelParameterInfo {
  name: string;
  type: "Real" | "Integer" | "Boolean" | "String";
  defaultValue: number | string | boolean;
  unit?: string | undefined;
  min?: number | undefined;
  max?: number | undefined;
  description?: string | undefined;
}

export interface ModelObservableInfo {
  name: string;
  type: "Real" | "Integer" | "Boolean";
  unit?: string | undefined;
  description?: string | undefined;
}

export interface CompatibleModelItem {
  id: string;
  name: string;
  qualifiedName: string;
  domain: StudyDomain;
  source: "package" | "artifact" | "post" | "curated";
  packageName?: string | undefined;
  packageVersion?: string | undefined;
  artifactPath?: string | undefined;
  description: string;
  parameters: ModelParameterInfo[];
  observables: ModelObservableInfo[];
  code?: string | undefined;
}

export interface StudyParameterBinding {
  parameterName: string;
  slotId?: string | undefined;
  nominalValue: number;
  min?: number | undefined;
  max?: number | undefined;
  steps?: number | undefined;
  distribution?: StudyParameterDistribution | undefined;
}

export interface StudyRunRequest {
  templateIdOrSlug: string | number;
  standardFormat?: StudyStandardFormat | undefined;
  studyInstanceSource?: string | undefined;
  saveInstanceToPackage?: string | boolean | undefined;
  linkToPackage?: string | boolean | undefined;
  saveToPackageName?: string | undefined;
  saveToArtifactPath?: string | undefined;
  targetArtifact?: string | undefined;
  modelId?: string | undefined;
  modelName?: string | undefined;
  modelDomain?: StudyDomain | undefined;
  modelCode?: string | undefined;
  packageName?: string | undefined;
  packageVersion?: string | undefined;
  executionTarget?: StudyExecutionTarget | undefined;
  computeProfile?: string | undefined;
  inputs?: Record<string, number | string | boolean> | undefined;
  parameterBindings?: StudyParameterBinding[] | undefined;
  observables?: string[] | undefined;
}

export interface StudyKpiValue {
  id: string;
  label: string;
  value: number | string;
  unit?: string | undefined;
  status?: "pass" | "warn" | "fail" | "info" | undefined;
}

export interface StudyEnsembleBandSeries {
  observable: string;
  unit?: string | undefined;
  time: number[];
  mean: number[];
  p05: number[];
  p50: number[];
  p95: number[];
  min: number[];
  max: number[];
}

export interface StudySobolIndex {
  parameter: string;
  firstOrder: number;
  totalOrder: number;
}

export interface StudySweepPoint {
  sampleIndex: number;
  parameters: Record<string, number>;
  metrics: Record<string, number>;
  status: "completed" | "failed";
  feasible?: boolean | undefined;
  paretoOptimal?: boolean | undefined;
}

export interface StudyComplianceCase {
  caseId: string;
  standardRef: string;
  description: string;
  measuredValue: string;
  limitSpec: string;
  passed: boolean;
}

export interface StudyRunResultsPayload {
  studyKind: StudyKind;
  standardFormat?: StudyStandardFormat | undefined;
  studyInstance?: StudyInstanceArtifact | undefined;
  templateSlug: string;
  templateName: string;
  modelName: string;
  modelDomain: StudyDomain;
  executionTarget: StudyExecutionTarget;
  computeProfile: string;
  solver: string;
  sampleCount: number;
  kpis: StudyKpiValue[];
  timeSeries?:
    | {
        time: number[];
        series: Record<string, number[]>;
      }
    | undefined;
  ensembleBands?: StudyEnsembleBandSeries[] | undefined;
  sobolIndices?: StudySobolIndex[] | undefined;
  sweepPoints?: StudySweepPoint[] | undefined;
  complianceMatrix?: StudyComplianceCase[] | undefined;
  provenance: {
    studySchemaVersion: string;
    standardFormat?: StudyStandardFormat | undefined;
    templateSlug: string;
    templateVersion: string;
    modelName: string;
    packageName?: string | undefined;
    packageVersion?: string | undefined;
    sha256Lock: string;
    completedAt: string;
    executionTarget: StudyExecutionTarget;
    computeProfile: string;
  };
}
