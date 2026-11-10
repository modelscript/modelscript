// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Data structures and constants for MATPOWER case files (.m / .mat).
 */

export const MATPOWER_BUS_TYPES = {
  PQ: 1,
  PV: 2,
  REF: 3,
  ISOLATED: 4,
} as const;

export type MatpowerBusType = (typeof MATPOWER_BUS_TYPES)[keyof typeof MATPOWER_BUS_TYPES];

export interface MatpowerBus {
  bus_i: number;
  type: number;
  pd: number;
  qd: number;
  gs: number;
  bs: number;
  area: number;
  vm: number;
  va: number;
  baseKv: number;
  zone: number;
  vmax: number;
  vmin: number;
  name?: string | undefined;
}

export interface MatpowerGen {
  bus: number;
  pg: number;
  qg: number;
  qmax: number;
  qmin: number;
  vg: number;
  mbase: number;
  status: number;
  pmax: number;
  pmin: number;
  pc1?: number | undefined;
  pc2?: number | undefined;
  qc1min?: number | undefined;
  qc1max?: number | undefined;
  qc2min?: number | undefined;
  qc2max?: number | undefined;
  ramp_agc?: number | undefined;
  ramp_10?: number | undefined;
  ramp_30?: number | undefined;
  ramp_q?: number | undefined;
  apf?: number | undefined;
}

export interface MatpowerBranch {
  fbus: number;
  tbus: number;
  r: number;
  x: number;
  b: number;
  rateA: number;
  rateB: number;
  rateC: number;
  ratio: number;
  angle: number;
  status: number;
  angmin: number;
  angmax: number;
}

export interface MatpowerGenCost {
  model: number; // 1 = piecewise linear, 2 = polynomial
  startup: number;
  shutdown: number;
  ncost: number;
  cost: number[];
}

export interface MatpowerCase {
  caseName?: string | undefined;
  version: string;
  baseMVA: number;
  bus: MatpowerBus[];
  gen: MatpowerGen[];
  branch: MatpowerBranch[];
  gencost?: MatpowerGenCost[] | undefined;
  busNames?: Map<number, string> | undefined;
}
