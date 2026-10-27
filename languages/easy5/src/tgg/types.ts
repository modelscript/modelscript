// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/easy5 — Bidirectional TGG Round-Trip Synchronization Types.
 */

export interface ReconciledChange {
  target: "parameter" | "state" | "component" | "connection";
  elementId: string;
  property?: string | undefined;
  sourceOldVal?: unknown;
  targetNewVal?: unknown;
  reconciledVal?: unknown;
  strategy?: "target-wins" | "source-wins" | "physics-simplex" | "manual" | undefined;
}

export interface SyncOptions {
  strategy?: "target-wins" | "source-wins" | "physics-simplex" | undefined;
  tolerance?: number | undefined;
  physicsBounds?: Record<string, { min?: number; max?: number }> | undefined;
}

export interface SyncConflict {
  id: string;
  sourceVal: unknown;
  targetVal: unknown;
  isResolved: boolean;
  resolved?: unknown;
}

export interface SyncResult {
  updatedText: string;
  changes: ReconciledChange[];
  conflicts: SyncConflict[];
}
