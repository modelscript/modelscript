// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/easy5 — Bidirectional TGG Round-Trip Synchronization Types.
 */

export interface ReconciledChange {
  target: "parameter" | "state" | "component" | "connection";
  elementId: string;
  property?: string | undefined;
  sourceOldVal?: any;
  targetNewVal?: any;
  reconciledVal?: any;
  strategy?: "target-wins" | "source-wins" | "physics-simplex" | "manual" | undefined;
}

export interface SyncOptions {
  strategy?: "target-wins" | "source-wins" | "physics-simplex" | undefined;
  tolerance?: number | undefined;
  physicsBounds?: Record<string, { min?: number; max?: number }> | undefined;
}

export interface SyncConflict {
  id: string;
  sourceVal: any;
  targetVal: any;
  isResolved: boolean;
  resolved?: any;
}

export interface SyncResult {
  updatedText: string;
  changes: ReconciledChange[];
  conflicts: SyncConflict[];
}
