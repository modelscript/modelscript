// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * DIgSILENT PowerFactory Object Model and Type Definitions.
 *
 * Implements representations for PowerFactory grids, substations, terminals (busbars),
 * branches, machines, static generators, loads, switches, and graphical layouts.
 */

export interface ElmSubstat {
  id: string;
  loc_name: string;
  desc?: string | undefined;
}

export interface ElmBay {
  id: string;
  loc_name: string;
  substatId?: string | undefined;
}

export interface ElmTerm {
  id: string;
  loc_name: string;
  uknom: number; // Nominal voltage in kV
  fnom: number; // Nominal frequency in Hz (typically 50 or 60)
  substatId?: string | undefined;
  bayId?: string | undefined;
  iPhtech?: "3-phase" | "1-phase" | "DC" | undefined;
  x?: number | undefined; // Graphical X coordinate
  y?: number | undefined; // Graphical Y coordinate
}

export interface TypLne {
  id: string;
  loc_name: string;
  uline: number; // Rated voltage in kV
  snom?: number | undefined; // Rated apparent power MVA
  inom?: number | undefined; // Rated thermal current in kA
  r1: number; // Positive-sequence resistance in Ohm/km
  x1: number; // Positive-sequence reactance in Ohm/km
  b1: number; // Positive-sequence susceptance in uS/km
  r0?: number | undefined; // Zero-sequence resistance in Ohm/km
  x0?: number | undefined; // Zero-sequence reactance in Ohm/km
  b0?: number | undefined; // Zero-sequence susceptance in uS/km
}

export interface ElmLne {
  id: string;
  loc_name: string;
  bus1Id: string; // Terminal 1 ref
  bus2Id: string; // Terminal 2 ref
  dline: number; // Line length in km (default: 1.0)
  typId?: string | undefined;
  r1?: number | undefined; // Explicit Ohm (or total)
  x1?: number | undefined;
  b1?: number | undefined; // Total uS
  r0?: number | undefined;
  x0?: number | undefined;
  b0?: number | undefined;
  inom?: number | undefined; // Rated current in kA
  outserv?: boolean | undefined; // true if switched out of service
}

export interface TypTr2 {
  id: string;
  loc_name: string;
  strn: number; // Rated apparent power in MVA
  utrn_h: number; // Rated HV voltage in kV
  utrn_l: number; // Rated LV voltage in kV
  ukrr: number; // Short-circuit voltage in % (impedance magnitude)
  pkr: number; // Copper losses at rated current in kW
  pfe?: number | undefined; // Iron/core losses in kW
  i0?: number | undefined; // No-load magnetization current in %
  vecgrp?: string | undefined; // Vector group, e.g. "Dyn11", "Yy0", "YNd11"
}

export interface ElmTr2 {
  id: string;
  loc_name: string;
  bushvId: string; // High-voltage terminal ref
  buslvId: string; // Low-voltage terminal ref
  typId?: string | undefined;
  strn?: number | undefined; // MVA
  nntap?: number | undefined; // Current tap position
  ntpmn?: number | undefined; // Min tap position
  ntpmx?: number | undefined; // Max tap position
  dutap?: number | undefined; // Step size per tap in %
  outserv?: boolean | undefined;
}

export interface TypTr3 {
  id: string;
  loc_name: string;
  strn_h: number; // HV rated MVA
  strn_m: number; // MV rated MVA
  strn_l: number; // LV rated MVA
  utrn_h: number; // HV kV
  utrn_m: number; // MV kV
  utrn_l: number; // LV kV
  uk_hm: number; // HV-MV short circuit %
  uk_ml: number; // MV-LV short circuit %
  uk_hl: number; // HV-LV short circuit %
}

export interface ElmTr3 {
  id: string;
  loc_name: string;
  bushvId: string;
  busmvId: string;
  buslvId: string;
  typId?: string | undefined;
  outserv?: boolean | undefined;
}

export interface TypSym {
  id: string;
  loc_name: string;
  snom: number; // Rated MVA
  unom: number; // Rated kV
  cosn: number; // Rated power factor
  xd?: number | undefined; // Synchronous d-axis reactance in p.u.
  xq?: number | undefined; // Synchronous q-axis reactance in p.u.
  xdp?: number | undefined; // Transient d-axis reactance in p.u.
  xdpp?: number | undefined; // Subtransient d-axis reactance in p.u.
  H?: number | undefined; // Inertia constant in seconds
}

export interface ElmSym {
  id: string;
  loc_name: string;
  bus1Id: string;
  pgini: number; // Active power in MW
  qgini: number; // Reactive power in Mvar
  usetp: number; // Voltage setpoint in p.u. (typically 1.0)
  sgini?: number | undefined; // Rated MVA
  typId?: string | undefined;
  mode?: "PV" | "PQ" | "SL" | undefined; // Dispatch control mode
  qmax?: number | undefined; // Max reactive power in Mvar
  qmin?: number | undefined; // Min reactive power in Mvar
  outserv?: boolean | undefined;
}

export interface ElmGenstat {
  id: string;
  loc_name: string;
  bus1Id: string;
  pgini: number; // Active power in MW
  qgini: number; // Reactive power in Mvar
  sgn?: number | undefined; // Rated MVA
  cosphi?: number | undefined;
  mode?: "PV" | "PQ" | undefined;
  usetp?: number | undefined;
  category?: "PV" | "WIND" | "BESS" | "OTHER" | undefined;
  outserv?: boolean | undefined;
}

export interface ElmLod {
  id: string;
  loc_name: string;
  bus1Id: string;
  plini: number; // Active load in MW
  qlini: number; // Reactive load in Mvar
  slini?: number | undefined; // Apparent power in MVA
  cosphi?: number | undefined;
  mode?: "PC" | "IC" | "ZC" | undefined; // Constant Power, Current, or Impedance
  outserv?: boolean | undefined;
}

export interface ElmShnt {
  id: string;
  loc_name: string;
  bus1Id: string;
  qtot: number; // Rated reactive power in Mvar (positive = capacitor, negative = reactor)
  ncap?: number | undefined; // Connected steps (default: 1)
  ncapx?: number | undefined; // Maximum steps
  ushnom?: number | undefined; // Nominal voltage in kV
  outserv?: boolean | undefined;
}

export interface StaSwitch {
  id: string;
  loc_name: string;
  bus1Id: string;
  bus2Id: string;
  on_off: number; // 0 = open, 1 = closed
  isBreaker?: boolean | undefined;
}

export interface IntGrf {
  elementId: string;
  x: number;
  y: number;
  width?: number | undefined;
  height?: number | undefined;
  rotation?: number | undefined;
}

export interface SetDesktop {
  id: string;
  loc_name: string;
  graphics: IntGrf[];
}

export interface PowerFactoryModel {
  name: string;
  version?: string | undefined;
  substations: Map<string, ElmSubstat>;
  bays: Map<string, ElmBay>;
  terminals: Map<string, ElmTerm>;
  lines: Map<string, ElmLne>;
  lineTypes: Map<string, TypLne>;
  transformers2w: Map<string, ElmTr2>;
  trafo2Types: Map<string, TypTr2>;
  transformers3w: Map<string, ElmTr3>;
  trafo3Types: Map<string, TypTr3>;
  generators: Map<string, ElmSym>;
  symTypes: Map<string, TypSym>;
  staticGenerators: Map<string, ElmGenstat>;
  loads: Map<string, ElmLod>;
  shunts: Map<string, ElmShnt>;
  switches: Map<string, StaSwitch>;
  diagrams: Map<string, SetDesktop>;
}

/** DIgSILENT Simulation Language (DSL) parsed structure. */
export interface DslBlock {
  name: string;
  type: "model" | "composite";
  desc?: string | undefined;
  inputs: string[];
  outputs: string[];
  parameters: Map<string, number>;
  internals: string[];
  equations: DslEquation[];
}

export interface DslEquation {
  kind: "differential" | "algebraic" | "macro";
  lhs: string;
  rhs: string;
  macroType?: "INT" | "INT_L" | "LIM" | "PIC" | "LEAD_LAG" | "LAG" | "WASHOUT" | undefined;
  macroArgs?: string[] | undefined;
}
