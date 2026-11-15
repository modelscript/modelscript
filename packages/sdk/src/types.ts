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

export interface KernelInput {
  definitionName: string;
  packageName?: string;
  parameters: Record<string, unknown>;
  files?: Array<{ fileName: string; content: string }>;
  waveforms?: Record<string, WaveformInput>;
}

export interface KernelSimulateOptions {
  parameters?: Record<string, number | string | boolean>;
  stopTime?: number;
  stepSize?: number;
}

export interface KernelContext {
  readFile(relPath: string): Promise<string>;
  simulate(modelPath: string, options?: KernelSimulateOptions): Promise<Record<string, WaveformInput>>;
  progress(percent: number, message?: string): void;
}

export interface KernelHostHandlers {
  readFile?: (relPath: string) => Promise<string> | string;
  simulate?: (modelPath: string, options?: KernelSimulateOptions) => Promise<Record<string, WaveformInput>>;
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
