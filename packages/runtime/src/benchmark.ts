// SPDX-License-Identifier: AGPL-3.0-or-later

export type BenchmarkScale = "micro" | "standard" | "industrial";

export type BenchmarkMetricKind = "rmse" | "max-relative-error" | "residual" | "ast-pass-rate" | "dae-parity" | "exact";

export interface BenchmarkCaseResult {
  id: string;
  name: string;
  scale: BenchmarkScale;
  referenceTool: string;
  metricKind: BenchmarkMetricKind;
  threshold: number;
  measuredError: number | null;
  passed: boolean;
  durationMs: number;
  details?: string | undefined;
}

export interface LanguageBenchmarkAdapterContext {
  tolerance?: number | undefined;
  scale?: BenchmarkScale | undefined;
}

export interface LanguageBenchmarkAdapter {
  slug: string;
  referenceTool: string;
  referenceVersion?: string | undefined;
  defaultTolerance: number;
  metricKind: BenchmarkMetricKind;
  runCases(ctx?: LanguageBenchmarkAdapterContext): Promise<BenchmarkCaseResult[]>;
}
