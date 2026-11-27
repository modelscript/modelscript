// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SimulationResultsProps } from "@modelscript/editor/workbench/SimulationResults.js";
import type { WaterComplianceReport } from "../simulation-results-webview.js";

export const COLORS = [
  "#0969da",
  "#2da44e",
  "#bf3989",
  "#db6d28",
  "#8250df",
  "#218bff",
  "#a371f7",
  "#3fb950",
  "#e34c26",
  "#f0883e",
  "#56d364",
  "#79c0ff",
  "#d2a8ff",
  "#ffa657",
];

export const RUN_ACCENT_COLORS = ["#38bdf8", "#f59e0b", "#ec4899", "#10b981", "#a855f7", "#06b6d4"];

export interface SimulationData {
  t: number[];
  y: number[][];
  states: string[];
  variableMetadata?: Record<string, { unit?: string | undefined; description?: string | undefined }> | undefined;
  sweepResults?: { value: number; y: number[][] }[];
  comtrade?: { cfg: string; dat: string };
  pscadOut?: { inf: string; out: { suffix: string; content: string }[] };
  pscadPsout?: Uint8Array | string;
  complianceReport?: unknown;
  waterCompliance?: WaterComplianceReport;
  pscadExports?: SimulationResultsProps["pscadExports"];
  projectName?: string;
}

/** Per-variable statistics from Monte Carlo analysis */
export interface MCVariableStats {
  mean: number[];
  stddev: number[];
  ciLo: number[];
  ciHi: number[];
  percentiles: Record<string, number[]>;
}

export interface MonteCarloData {
  t: number[];
  statistics: Record<string, MCVariableStats>;
  numSamples: number;
  convergence: { coeffOfVariation: number; effectiveSampleSize: number };
}

export interface FlowpipeEnvelope {
  name: string;
  kind: "zonotope" | "interval" | "octagon" | "affine";
  color: string;
  fillColor?: string;
  borderDash?: number[];
  lineWidth?: number;
  lo: number[];
  hi: number[];
  peakVal?: number;
  breachTime?: number;
  isViolation?: boolean;
}

export interface VariableReachabilityProfile {
  variable: string;
  nominalTrajectory: number[];
  envelopes: FlowpipeEnvelope[];
  requirementLimit?: number;
  requirementDirection?: "max" | "min";
  requirementLabel?: string;
  isCertifiedSafe: boolean;
  statusBadges?: { text: string; kind: "pass" | "warn" | "fail" }[];
  yRange?: [number, number];
}

export interface ParameterSpec {
  name: string;
  description?: string;
  defaultValue: number;
  type: string;
  unit?: string;
  min?: number;
  max?: number;
}

export interface ReachabilityData {
  t: number[];
  variable: string;
  nominalTrajectory: number[];
  envelopes: FlowpipeEnvelope[];
  requirementLimit: number;
  requirementLabel: string;
  isCertifiedSafe: boolean;
  statusBadges?: { text: string; kind: "pass" | "warn" | "fail" }[];
  yRange?: [number, number];
  variables?: Record<string, VariableReachabilityProfile>;
  states?: string[];
  y?: number[][];
  parameters?: ParameterSpec[];
  experiment?: {
    startTime?: number;
    stopTime?: number;
    interval?: number;
    tolerance?: number;
  };
  telemetry?: { executionTimeMs: number; stepCount: number };
  modelName?: string;
  summary?: string;
}

/** Verification limit line overlay */
export interface VerificationLimit {
  /** The variable name this limit applies to (e.g., "T") */
  variable: string;
  /** The y-value of the horizontal limit line */
  value: number;
  /** Human-readable label (e.g., "max: 85.0 °C") */
  label: string;
  /** Whether the constraint was violated */
  violated: boolean;
  /** Direction of the limit ("max" or "min") */
  direction?: "max" | "min";
}

/** Ring buffer per variable for live mode */
export interface LiveBuffer {
  times: number[];
  values: Map<string, number[]>;
  head: number;
  count: number;
  variableNames: string[];
}

export interface PinnedRun {
  id: number;
  name: string;
  visible: boolean;
  data: SimulationData;
}

export interface PlotMargin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export function getReachabilityProfileForVar(
  data: ReachabilityData | null,
  varName: string,
): VariableReachabilityProfile | undefined {
  if (!data) return undefined;
  if (data.variables && data.variables[varName]) {
    return data.variables[varName];
  }
  if (data.variable === varName) {
    return {
      variable: data.variable,
      nominalTrajectory: data.nominalTrajectory,
      envelopes: data.envelopes,
      requirementLimit: data.requirementLimit,
      requirementDirection: "max",
      requirementLabel: data.requirementLabel,
      isCertifiedSafe: data.isCertifiedSafe,
      statusBadges: data.statusBadges,
      yRange: data.yRange,
    };
  }
  return undefined;
}
