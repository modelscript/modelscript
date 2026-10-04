// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Types and interfaces for the on-the-fly MSL Comparison & Verification Suite.
 */

export type MslStage = "flatten" | "simulate" | "icon" | "diagram" | "all";

export interface DiscoveredModel {
  fqn: string;
  name: string;
  file: string;
  isExample: boolean;
  package: string;
  canSimulate?: boolean;
  canDiagram?: boolean;
  canIcon?: boolean;
}

export interface WorkerTask {
  modelFqn: string;
  mslDir: string;
  version: string;
  cacheDir: string;
  indexCachePath: string;
  stage: MslStage;
  forceOmc?: boolean;
  simTolerance?: number;
  simIntervals?: number;
  simStopTime?: number;
}

export interface FlattenResult {
  omc: {
    success: boolean;
    cached: boolean;
    durationMs: number;
    cpuMs?: number;
    peakMemoryMB?: number;
    varCount: number;
    eqCount: number;
    error?: string;
  };
  modelscript: {
    success: boolean;
    durationMs: number;
    cpuMs: number;
    peakMemoryMB: number;
    varCount: number;
    eqCount: number;
    error?: string;
  };
  comparison: {
    varCountMatch: boolean;
    eqCountMatch: boolean;
    diffLines: number;
    diffSummary?: string;
  };
}

export interface SimComparisonResult {
  omc: {
    success: boolean;
    cached: boolean;
    durationMs: number;
    cpuMs?: number;
    peakMemoryMB?: number;
    stepCount: number;
    error?: string;
  };
  modelscript: {
    success: boolean;
    durationMs: number;
    cpuMs: number;
    peakMemoryMB: number;
    stepCount: number;
    error?: string;
  };
  comparison: {
    pass: boolean;
    matchedVariables: number;
    maxRelativeError: number;
    rmse: number;
    errorSummary?: string;
    sampleTrajectory?: {
      variable: string;
      times: number[];
      omcValues: number[];
      msValues: number[];
    };
  };
}

export interface IconValidationResult {
  modelscript: {
    success: boolean;
    durationMs: number;
    cpuMs: number;
    peakMemoryMB: number;
    svgLength: number;
    elementCount: number;
    viewBox?: string;
    svgPreview?: string;
    error?: string;
  };
  validSvg: boolean;
  hasGraphics: boolean;
}

export interface DiagramComparisonResult {
  omc?: {
    success: boolean;
    componentCount: number;
    cpuMs?: number;
    peakMemoryMB?: number;
    error?: string;
  };
  modelscript: {
    success: boolean;
    durationMs: number;
    cpuMs: number;
    peakMemoryMB: number;
    nodeCount: number;
    edgeCount: number;
    unresolvedCount: number;
    svgLength: number;
    svgPreview?: string;
    error?: string;
  };
  placementMatch?: boolean;
  hasUnresolvedNodes: boolean;
  validSvg: boolean;
}

export interface WorkerResult {
  modelFqn: string;
  status: "MATCH" | "DIFF" | "MS_ERROR" | "OMC_ERROR" | "TIMEOUT" | "SKIPPED";
  durationMs: number;
  cpuMs?: number;
  peakMemoryMB?: number;
  stage: MslStage;
  flatten?: FlattenResult;
  simulation?: SimComparisonResult;
  icon?: IconValidationResult;
  diagram?: DiagramComparisonResult;
  error?: string;
}

export interface RunnerOptions {
  version: string;
  stage: MslStage;
  all: boolean;
  packagePrefix?: string;
  modelFqn?: string;
  limit?: number;
  jobs: number;
  forceOmc: boolean;
  timeoutMs: number;
  tolerance: number;
  reportJson?: string;
  reportHtml?: string;
  reportCtrf?: string;
}
