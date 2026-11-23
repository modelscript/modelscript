// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Domain types for USAF Stability and Control Digital DATCOM (.dcm, .dat, .inp).
 */

export type DatcomUnitSystem = "FT" | "IN" | "M" | "CM";
export type DatcomDerivUnit = "DEG" | "RAD";

export const KNOWN_NAMELIST_GROUPS = [
  "FLTCON",
  "OPTINS",
  "SYNTHS",
  "BODY",
  "WGPLNF",
  "HTPLNF",
  "VTPLNF",
  "VFPLNF",
  "SYMFLP",
  "ASYFLP",
  "WGSCHR",
] as const;

export type DatcomNamelistGroupName = (typeof KNOWN_NAMELIST_GROUPS)[number];

export type DatcomNamelistValue = number | number[] | boolean | string;

export interface DatcomParseError {
  code: string;
  message: string;
  line: number;
  column: number;
}

export interface DatcomNacaCard {
  surface: "W" | "H" | "V" | "F";
  series: number;
  designation: string;
  line: number;
  raw: string;
}

export type DatcomControlCardKind =
  "CASEID" | "DIM" | "DERIV" | "NACA" | "DAMP" | "BUILD" | "PLOT" | "NEXT CASE" | "SAVE" | "PART" | "TRIM";

export interface DatcomControlCard {
  kind: DatcomControlCardKind;
  value?: string | undefined;
  line: number;
  raw: string;
}

export interface DatcomNamelistBlock {
  group: string;
  values: Record<string, DatcomNamelistValue>;
  line: number;
  startOffset: number;
  endOffset: number;
}

export interface FltconParams {
  NMACH?: number | undefined;
  MACH?: number[] | undefined;
  NALPHA?: number | undefined;
  ALSCHD?: number[] | undefined;
  NALT?: number | undefined;
  ALT?: number[] | undefined;
  WT?: number | undefined;
  LOOP?: number | undefined;
  RNNUB?: number[] | undefined;
  VINF?: number[] | undefined;
  GAMMA?: number | undefined;
  STMACH?: number | undefined;
  TSMACH?: number | undefined;
  TR?: number | undefined;
}

export interface OptinsParams {
  SREF?: number | undefined;
  CBARR?: number | undefined;
  BLREF?: number | undefined;
  ROUGFC?: number | undefined;
}

export interface SynthsParams {
  XCG?: number | undefined;
  ZCG?: number | undefined;
  XW?: number | undefined;
  ZW?: number | undefined;
  ALIW?: number | undefined;
  XH?: number | undefined;
  ZH?: number | undefined;
  ALIH?: number | undefined;
  XV?: number | undefined;
  ZV?: number | undefined;
  XVF?: number | undefined;
  ZVF?: number | undefined;
  VERTUP?: boolean | undefined;
  HINAX?: number | undefined;
}

export interface BodyParams {
  NX?: number | undefined;
  X?: number[] | undefined;
  S?: number[] | undefined;
  P?: number[] | undefined;
  R?: number[] | undefined;
  ZU?: number[] | undefined;
  ZL?: number[] | undefined;
  BNOSE?: number | undefined;
  BTAIL?: number | undefined;
  BLN?: number | undefined;
  BLA?: number | undefined;
  DS?: number | undefined;
  ITYPE?: number | undefined;
  METHOD?: number | undefined;
}

export interface PlanformParams {
  CHRDTP?: number | undefined;
  SSPNE?: number | undefined;
  SSPN?: number | undefined;
  CHRDR?: number | undefined;
  SAVSI?: number | undefined;
  CHSTAT?: number | undefined;
  TWISTA?: number | undefined;
  DHDADI?: number | undefined;
  DHDADO?: number | undefined;
  TYPE?: number | undefined;
  SSPNOP?: number | undefined;
  CHRDBP?: number | undefined;
  SAVSO?: number | undefined;
}

export interface SymflpParams {
  FTYPE?: number | undefined;
  NDELTA?: number | undefined;
  DELTA?: number[] | undefined;
  SPANFI?: number | undefined;
  SPANFO?: number | undefined;
  CHRDFI?: number | undefined;
  CHRDFO?: number | undefined;
  PHETE?: number | undefined;
  PHETEP?: number | undefined;
  CB?: number | undefined;
  TC?: number | undefined;
  NTYPE?: number | undefined;
}

export interface AsyflpParams {
  STYPE?: number | undefined;
  NDELTA?: number | undefined;
  DELTAL?: number[] | undefined;
  DELTAR?: number[] | undefined;
  SPANFI?: number | undefined;
  SPANFO?: number | undefined;
  CHRDFI?: number | undefined;
  CHRDFO?: number | undefined;
}

export interface WgschrParams {
  TYPEIN?: number | undefined;
  NPTS?: number | undefined;
  X?: number[] | undefined;
  YUPPER?: number[] | undefined;
  YLOWER?: number[] | undefined;
  MEAN?: number[] | undefined;
  THICK?: number[] | undefined;
  TOVC?: number | undefined;
  DELTAY?: number | undefined;
  XOVC?: number | undefined;
  CLI?: number | undefined;
  ALPHAI?: number | undefined;
  CLMAXL?: number | undefined;
  CMO?: number | undefined;
  LERI?: number | undefined;
}

export interface DatcomCase {
  caseId: string;
  dim: DatcomUnitSystem;
  deriv: DatcomDerivUnit;
  damp: boolean;
  build: boolean;
  plot: boolean;
  save: boolean;
  nacaCards: DatcomNacaCard[];
  namelists: DatcomNamelistBlock[];
  fltcon?: FltconParams | undefined;
  optins?: OptinsParams | undefined;
  synths?: SynthsParams | undefined;
  body?: BodyParams | undefined;
  wgplnf?: PlanformParams | undefined;
  htplnf?: PlanformParams | undefined;
  vtplnf?: PlanformParams | undefined;
  vfplnf?: PlanformParams | undefined;
  symflp?: SymflpParams | undefined;
  asyflp?: AsyflpParams | undefined;
  wgschr?: WgschrParams | undefined;
  controlCards: DatcomControlCard[];
  parseErrors: DatcomParseError[];
  startOffset: number;
  endOffset: number;
}

export interface DatcomDeck {
  cases: DatcomCase[];
  parseErrors: DatcomParseError[];
}

export interface DatcomAeroPoint {
  alphaDeg: number;
  alphaRad: number;
  CL: number;
  CD: number;
  CD0: number;
  CDi: number;
  Cm: number;
  LoverD: number;
}

export interface DatcomLongitudinalModes {
  shortPeriodOmegaN: number;
  shortPeriodZeta: number;
  phugoidOmegaN: number;
  phugoidZeta: number;
  Xu: number;
  Xw: number;
  Zu: number;
  Zw: number;
  Mu: number;
  Mw: number;
  Mq: number;
}

export interface DatcomLateralModes {
  rollTimeConstant: number;
  dutchRollOmegaN: number;
  dutchRollZeta: number;
  spiralEigenvalue: number;
  Yv: number;
  Yp: number;
  Yr: number;
  Lv: number;
  Lp: number;
  Lr: number;
  Nv: number;
  Np: number;
  Nr: number;
}

export interface DatcomAeroResult {
  caseId: string;
  mach: number;
  altitudeM: number;
  airDensityKgM3: number;
  speedOfSoundMS: number;
  airspeedMS: number;
  dynamicPressurePa: number;
  massKg: number;
  SrefM2: number;
  cbarM: number;
  brefM: number;
  aspectRatio: number;
  taperRatio: number;
  sweepQuarterChordDeg: number;
  sweepHalfChordDeg: number;
  oswaldEfficiency: number;
  beta: number;
  CLalphaPerRad: number;
  CLalphaPerDeg: number;
  CL0: number;
  CD0: number;
  Cm0: number;
  CmalphaPerRad: number;
  CmalphaPerDeg: number;
  neutralPointX: number;
  cgX: number;
  staticMargin: number;
  Cmq: number;
  Clp: number;
  Cnr: number;
  CYbeta: number;
  Clbeta: number;
  Cnbeta: number;
  polar: DatcomAeroPoint[];
  longitudinalModes: DatcomLongitudinalModes;
  lateralModes: DatcomLateralModes;
}
