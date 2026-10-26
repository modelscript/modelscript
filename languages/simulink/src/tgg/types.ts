// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulink — Bidirectional TGG Round-Trip Synchronization Types.
 */

export interface ReconciledChange {
  target: "parameter" | "component" | "connection";
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

export interface ModelicaComponentDecl {
  name: string;
  typeSpecifier: string;
  modifications: Record<string, number | number[] | string>;
  variability?: string | undefined;
}

export interface ModelicaConnection {
  source: string;
  target: string;
}

export interface ParsedModelicaModel {
  name: string;
  components: Map<string, ModelicaComponentDecl>;
  connections: ModelicaConnection[];
}
