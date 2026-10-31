// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Source line and column range in a .dss file.
 */
export interface DssRange {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

/**
 * Circuit definition (substation voltage source).
 */
export interface DssCircuit {
  name: string;
  baseKv: number;
  pu: number;
  phases: number;
  bus1: string;
  angle?: number | undefined;
  frequency?: number | undefined;
  range: DssRange;
}

/**
 * Distribution line segment.
 */
export interface DssLine {
  name: string;
  bus1: string;
  bus2: string;
  phases: number;
  phaseNodes1?: number[] | undefined;
  phaseNodes2?: number[] | undefined;
  length: number;
  units?: string | undefined;
  lineCode?: string | undefined;
  r1?: number | undefined;
  x1?: number | undefined;
  c1?: number | undefined;
  r0?: number | undefined;
  x0?: number | undefined;
  c0?: number | undefined;
  rmatrix?: number[][] | undefined;
  xmatrix?: number[][] | undefined;
  range: DssRange;
}

/**
 * Multi-winding substation or service distribution transformer.
 */
export interface DssTransformer {
  name: string;
  phases: number;
  windings: number;
  buses: string[];
  kvs: number[];
  kvas: number[];
  pctLoadLoss?: number | undefined;
  xhl?: number | undefined;
  range: DssRange;
}

/**
 * Power consumption load.
 */
export interface DssLoad {
  name: string;
  bus1: string;
  phases: number;
  phaseNodes?: number[] | undefined;
  kv: number;
  kw: number;
  kvar: number;
  pf?: number | undefined;
  model?: number | undefined;
  daily?: string | undefined;
  yearly?: string | undefined;
  duty?: string | undefined;
  range: DssRange;
}

/**
 * Distributed solar photovoltaic (PV) generation system.
 */
export interface DssPVSystem {
  name: string;
  bus1: string;
  phases: number;
  phaseNodes?: number[] | undefined;
  kv: number;
  kva: number;
  pmpp: number;
  pctCutIn?: number | undefined;
  pctCutOut?: number | undefined;
  daily?: string | undefined;
  yearly?: string | undefined;
  duty?: string | undefined;
  range: DssRange;
}

/**
 * Battery energy storage system (BESS).
 */
export interface DssStorage {
  name: string;
  bus1: string;
  phases: number;
  phaseNodes?: number[] | undefined;
  kv: number;
  kwRated: number;
  kwhRated: number;
  pctStored?: number | undefined;
  range: DssRange;
}

/**
 * Shunt capacitor bank for power factor / voltage support.
 */
export interface DssCapacitor {
  name: string;
  bus1: string;
  phases: number;
  phaseNodes?: number[] | undefined;
  kvar: number;
  kv: number;
  range: DssRange;
}

/**
 * Line impedance and geometry line code definition.
 */
export interface DssLineCode {
  name: string;
  nphases: number;
  r1: number;
  x1: number;
  c1?: number | undefined;
  r0?: number | undefined;
  x0?: number | undefined;
  c0?: number | undefined;
  range: DssRange;
}

/**
 * Time-series multiplier profile (LoadShape) for QSTS simulation.
 */
export interface DssLoadShape {
  name: string;
  npts: number;
  interval: number;
  mult: number[];
  qmult?: number[] | undefined;
  range: DssRange;
}

/**
 * Complete parsed OpenDSS distribution circuit deck.
 */
export interface DssDeck {
  circuit?: DssCircuit | undefined;
  lines: Map<string, DssLine>;
  transformers: Map<string, DssTransformer>;
  loads: Map<string, DssLoad>;
  pvSystems: Map<string, DssPVSystem>;
  storages: Map<string, DssStorage>;
  capacitors: Map<string, DssCapacitor>;
  lineCodes: Map<string, DssLineCode>;
  loadShapes?: Map<string, DssLoadShape> | undefined;
  voltageBases: number[];
  comments: string[];
  sourceFile?: string | undefined;
}
