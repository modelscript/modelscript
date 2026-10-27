// SPDX-License-Identifier: AGPL-3.0-or-later

export interface SimulationResultsProps {
  jobId?: string | null | undefined;
  localData?: Record<string, number | string>[] | null | undefined;
  sweepResults?: { value: number; y: number[][] }[] | null | undefined;
  simulationVariables?: string[] | undefined;
  error?: string | null | undefined;
  selectedVariables: string[];
  onVariablesLoaded: (variables: string[]) => void;
  colorMode?: "light" | "dark" | undefined;
}

export interface CustomInspectionTooltipProps {
  active?: boolean | undefined;
  payload?: any[] | undefined;
  label?: any;
  xAxisVar: string;
  minMaxMap: Record<string, { min: number; max: number }>;
  isNormalized: boolean;
  isComparingBaseline: boolean;
  colorMode: "light" | "dark";
  rawData?: Record<string, number | string>[] | undefined;
}

export interface VariableStatEntry {
  min: number;
  max: number;
  peakToPeak: number;
  mean: number;
  finalVal: number;
}

export interface CursorMetricsData {
  t1: number;
  t2: number;
  dt: number;
  freq: number;
  deltas: Record<string, { y1: number; y2: number; dy: number; slope: number }>;
}
