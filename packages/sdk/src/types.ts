// SPDX-License-Identifier: AGPL-3.0-or-later

export interface PlotSeries {
  name: string;
  x: number[];
  y: number[];
}

export type VisualArtifact =
  | {
      kind: "timeseries" | "bode";
      id: string;
      title: string;
      xLabel: string;
      yLabel: string;
      series: PlotSeries[];
    }
  | {
      kind: "table" | "compliance-matrix";
      id: string;
      title: string;
      columns: string[];
      rows: Array<Array<string | number | boolean>>;
    }
  | {
      kind: "diagram-overlay";
      id: string;
      title: string;
      badges: Array<{
        nodeId: string;
        text: string;
        severity: "pass" | "warn" | "fail";
      }>;
    }
  | {
      kind: "kpi-cards";
      id: string;
      title: string;
      cards: Array<{
        label: string;
        value: string | number;
        unit?: string;
        status?: "pass" | "warn" | "fail" | "neutral";
        subtitle?: string;
      }>;
    }
  | {
      kind: "markdown";
      id: string;
      title: string;
      content: string;
    }
  | {
      kind: "histogram";
      id: string;
      title: string;
      xLabel: string;
      yLabel: string;
      binCenters: number[];
      counts: number[];
    };

export interface KernelDiagnostic {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
}

export interface WaveformInput {
  x: Float64Array | number[];
  y: Float64Array | number[];
}

export type KernelSimulateMode = "transient" | "powerflow" | "short-circuit" | "frequency-scan" | "harmonic" | string;

export interface KernelSimulateFault {
  bus: string | number;
  type?: "3ph" | "1ph" | "ll" | "llg" | string;
  rOhm?: number;
  xOhm?: number;
  tStart?: number;
  duration?: number;
}

export interface KernelInput {
  definitionName: string;
  packageName?: string;
  parameters: Record<string, unknown>;
  files?: Array<{ fileName: string; content: string }>;
  waveforms?: Record<string, WaveformInput>;
  /** Resolved outputs from upstream SysML definitions keyed by definition name. */
  upstream?: Record<string, Record<string, number | string | boolean>>;
}

export interface KernelSimulateOptions {
  parameters?: Record<string, number | string | boolean>;
  stopTime?: number;
  stepSize?: number;
  /** Requested solver execution mode (engine-defined, e.g. 'transient', 'short-circuit', 'frequency-scan'). */
  mode?: KernelSimulateMode;
  /** Relative companion model/control/sequence file paths loaded alongside the primary model. */
  companions?: string[];
  /** Discrete fault events applied during fault/transient simulation. */
  faults?: KernelSimulateFault[];
}

export interface KernelInspectOptions {
  /** Relative companion files to inspect jointly with the primary model file (e.g. .dyr/.seq alongside .raw). */
  companions?: string[];
  /** Named structural or standard-specific audit checks requested by the caller. */
  checks?: string[];
  /** Engine-specific inspection options. */
  options?: Record<string, unknown>;
}

export interface KernelInspectResult {
  format: string;
  metrics: Record<string, number | string | boolean>;
  summary?: string;
  diagnostics?: KernelDiagnostic[];
  metadata?: Record<string, unknown>;
}

export interface KernelBatchTask {
  id?: string;
  modelPath: string;
  options?: KernelSimulateOptions;
}

export interface KernelBatchItemResult {
  id: string;
  ok: boolean;
  waveforms?: Record<string, WaveformInput>;
  error?: string;
}

export interface EnvelopePoint {
  time: number;
  min?: number;
  max?: number;
}

export interface EnvelopeViolation {
  time: number;
  value: number;
  bound: "min" | "max";
  limit: number;
  margin: number;
}

export interface EnvelopeCheckResult {
  ok: boolean;
  checkedSamples: number;
  violationCount: number;
  worstMargin: number;
  violations: EnvelopeViolation[];
}

export interface SlidingPhasorResult {
  times: number[];
  magnitude: number[];
  phaseRad: number[];
  frequencyHz: number;
}

export interface SymmetricalComponentsResult {
  zeroMag: number[];
  positiveMag: number[];
  negativeMag: number[];
  positivePhaseRad: number[];
  unbalanceFactor: number[];
}

export interface KernelContext {
  readFile(relPath: string): Promise<string>;
  /** Read a binary file (e.g. COMTRADE .dat, raw capture, binary table) relative to the package root. */
  readBinary(relPath: string): Promise<Uint8Array>;
  /** Persist a generated artifact (CSV, JSON, SVG, report) inside the workspace and return its normalized path. */
  writeArtifact(relPath: string, data: string | Uint8Array): Promise<string>;
  /** Run static format parsing / schema / companion-key completeness inspection without time-domain simulation. */
  inspect(modelPath: string, options?: KernelInspectOptions): Promise<KernelInspectResult>;
  simulate(modelPath: string, options?: KernelSimulateOptions): Promise<Record<string, WaveformInput>>;
  /** Execute a batch of simulations concurrently via the host runner. */
  runBatch(tasks: KernelBatchTask[], concurrency?: number): Promise<KernelBatchItemResult[]>;
  progress(percent: number, message?: string): void;
}

export interface KernelHostHandlers {
  readFile?: (relPath: string) => Promise<string> | string;
  readBinary?: (relPath: string) => Promise<Uint8Array> | Uint8Array;
  writeArtifact?: (relPath: string, data: string | Uint8Array) => Promise<string> | string;
  inspect?: (modelPath: string, options?: KernelInspectOptions) => Promise<KernelInspectResult> | KernelInspectResult;
  simulate?: (modelPath: string, options?: KernelSimulateOptions) => Promise<Record<string, WaveformInput>>;
  runBatch?: (
    tasks: KernelBatchTask[],
    concurrency?: number,
  ) => Promise<KernelBatchItemResult[]> | KernelBatchItemResult[];
  onProgress?: (percent: number, message?: string) => void;
}

export interface KernelResult {
  ok: boolean;
  kernelId: string;
  parameters?: Record<string, number | string | boolean>;
  diagnostics?: KernelDiagnostic[];
  artifacts?: VisualArtifact[];
  summary?: string;
}

export interface ImplementationRef {
  scheme: "wasm" | "ts" | "sysml";
  modulePath: string;
  exportName: string;
}
