// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/eclipse — Schlumberger ECLIPSE 100/300 Reservoir Deck AST & Data Types.
 *
 * Conforms to industry standard ECLIPSE keyword deck specifications (.DATA, .DAT, .inc).
 */

export interface EclipseRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export type EclipseUnitSystem = "FIELD" | "METRIC" | "LAB";

export interface EclipsePhases {
  oil: boolean;
  water: boolean;
  gas: boolean;
  disgas?: boolean | undefined;
  vapoil?: boolean | undefined;
}

export interface EclipseDimensions {
  nx: number;
  ny: number;
  nz: number;
}

export interface EclipseGrid {
  dx: number; // default or uniform cell length X
  dy: number; // cell length Y
  dz: number; // cell thickness Z
  tops: number; // reservoir top datum depth
  poro: number; // average porosity (0 - 1)
  permX: number; // permeability X (mD)
  permY: number; // permeability Y (mD)
  permZ: number; // permeability Z (mD)
  range?: EclipseRange | undefined;
}

export interface EclipseDensityProps {
  oil: number; // lb/ft^3 or kg/m^3
  water: number;
  gas: number;
}

export interface EclipsePvtw {
  pref: number; // reference pressure (psi or bar)
  bw: number; // water formation volume factor (rb/stb or rm3/sm3)
  cw: number; // water compressibility (1/psi or 1/bar)
  muw: number; // water viscosity (cP)
  cmu: number; // viscosibility
}

export interface EclipsePvtTableEntry {
  pressure: number;
  fvf: number; // B_o or B_g
  viscosity: number; // mu_o or mu_g (cP)
}

export interface EclipseRelPermEntry {
  saturation: number; // S_w or S_g
  krPhase: number; // k_rw or k_rg
  krowPhase: number; // k_row or k_rog
  pcPhase: number; // capillary pressure
}

export interface EclipseProps {
  density: EclipseDensityProps;
  pvtw?: EclipsePvtw | undefined;
  pvdo: EclipsePvtTableEntry[];
  pvdg: EclipsePvtTableEntry[];
  swof: EclipseRelPermEntry[];
  sgof: EclipseRelPermEntry[];
  range?: EclipseRange | undefined;
}

export interface EclipseEquil {
  datumDepth: number;
  datumPressure: number;
  woc: number; // Water-Oil Contact depth
  pcWoc: number;
  goc: number; // Gas-Oil Contact depth
  pcGoc: number;
}

export interface EclipseSolution {
  equil?: EclipseEquil | undefined;
  initialPressure?: number | undefined;
  initialSwat?: number | undefined;
  range?: EclipseRange | undefined;
}

export interface EclipseCompletion {
  wellName: string;
  i: number;
  j: number;
  k1: number;
  k2: number;
  status: "OPEN" | "SHUT";
  satTable: number;
  wellIndex: number; // WI factor
  diameter: number; // ft or m
  range?: EclipseRange | undefined;
}

export interface EclipseProductionControl {
  status: "OPEN" | "SHUT";
  controlMode: "ORAT" | "WRAT" | "GRAT" | "LRAT" | "BHP";
  oilRate: number; // stb/d or sm3/d
  waterRate: number;
  gasRate: number; // Mscf/d or sm3/d
  liquidRate: number;
  bhpLimit: number; // psi or bar
}

export interface EclipseInjectionControl {
  fluidType: "WATER" | "GAS";
  status: "OPEN" | "SHUT";
  controlMode: "RATE" | "BHP";
  rate: number;
  bhpLimit: number;
}

export interface EclipseWell {
  name: string;
  group: string;
  i: number;
  j: number;
  refDepth: number;
  preferredPhase: "OIL" | "WATER" | "GAS";
  completions: EclipseCompletion[];
  productionControl?: EclipseProductionControl | undefined;
  injectionControl?: EclipseInjectionControl | undefined;
  range?: EclipseRange | undefined;
}

export interface EclipseDeck {
  title: string;
  dimensions: EclipseDimensions;
  phases: EclipsePhases;
  units: EclipseUnitSystem;
  startDate: string;
  grid: EclipseGrid;
  props: EclipseProps;
  solution: EclipseSolution;
  wells: Map<string, EclipseWell>;
  timeSteps: number[]; // days
  sourceFile?: string | undefined;
  rawKeywords: string[];
}
