// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Unit system for HEC-2 computations.
 * - `"US"`: Classic HEC-2 US Customary (ft, cfs, phi = 1.486, g = 32.174 ft/s^2)
 * - `"SI"`: Metric SI (m, m^3/s, phi = 1.0, g = 9.80665 m/s^2)
 */
export type Hec2UnitSystem = "US" | "SI";

/**
 * Recognized 2-character HEC-2 card codes.
 */
export type Hec2CardCode =
  | "T1"
  | "T2"
  | "T3"
  | "J1"
  | "J2"
  | "J3"
  | "J4"
  | "J5"
  | "J6"
  | "NC"
  | "NH"
  | "NV"
  | "QT"
  | "X1"
  | "X2"
  | "X3"
  | "X4"
  | "X5"
  | "GR"
  | "SB"
  | "BT"
  | "CI"
  | "EJ"
  | "ER"
  | "C ";

export interface Hec2RawCard {
  code: string;
  /** Up to 10 numeric fields (fields 1..10); null where blank or non-numeric */
  fields: Array<number | null>;
  rawText: string;
  /** 1-indexed line number */
  line: number;
  format: "fixed" | "free";
}

export interface Hec2JobCard {
  /** Field 1: ICHECK (data check flag) */
  icheck?: number | undefined;
  /** Field 2: INQ (discharge field index in QT table, 2..10) */
  inq?: number | undefined;
  /** Field 3: NINV (direction / storage indicator) */
  ninv?: number | undefined;
  /** Field 4: IDIR (0 = subcritical upstream, 1 = supercritical downstream) */
  idir?: number | undefined;
  /** Field 5: STRT (starting slope for normal depth, or -1 for critical depth) */
  strt?: number | undefined;
  /** Field 6: METRIC (1 = SI metric units, 0 = US customary) */
  metric?: number | undefined;
  /** Field 7: HVINS (velocity head interpolation) */
  hvins?: number | undefined;
  /** Field 8: Q (starting discharge, cfs or m^3/s) */
  q?: number | undefined;
  /** Field 9: WSEL (known starting water surface elevation) */
  wsel?: number | undefined;
  /** Field 10: FQ (discharge multiplier) */
  fq?: number | undefined;
  line: number;
}

export interface Hec2Job2Card {
  nprof?: number | undefined;
  iplot?: number | undefined;
  prfvs?: number | undefined;
  xsecv?: number | undefined;
  xsech?: number | undefined;
  fn?: number | undefined;
  alldc?: number | undefined;
  ibw?: number | undefined;
  chnim?: number | undefined;
  itrace?: number | undefined;
  line: number;
}

export interface Hec2ManningCard {
  /** Field 1: XNL — Left overbank Manning's n */
  xnl: number;
  /** Field 2: XNR — Right overbank Manning's n */
  xnr: number;
  /** Field 3: XNCH — Main channel Manning's n */
  xnch: number;
  /** Field 4: CCHV — Contraction loss coefficient (default 0.1) */
  cchv: number;
  /** Field 5: CEHV — Expansion loss coefficient (default 0.3) */
  cehv: number;
  line: number;
}

export interface Hec2HorizontalManningPair {
  n: number;
  station: number;
}

export interface Hec2HorizontalManningCard {
  numnh: number;
  pairs: Hec2HorizontalManningPair[];
  line: number;
}

export interface Hec2DischargeTableCard {
  numq: number;
  discharges: number[];
  line: number;
}

export interface Hec2StationElevation {
  /** Ground elevation (GR odd field) */
  elevation: number;
  /** Horizontal station coordinate (GR even field) */
  station: number;
}

export interface Hec2BridgeData {
  /** SB card: special bridge parameters */
  xk?: number | undefined;
  xkor?: number | undefined;
  cofq?: number | undefined;
  rdlen?: number | undefined;
  bwp?: number | undefined;
  barea?: number | undefined;
  ss?: number | undefined;
  elchU?: number | undefined;
  elchD?: number | undefined;
  /** BT card: bridge table points (station, high chord, low chord) */
  bridgeTable?: Array<{ station: number; highChord: number; lowChord: number }> | undefined;
  /** X2 card: bridge / weir indicators */
  ibridg?: number | undefined;
  ellc?: number | undefined;
  eltrd?: number | undefined;
  line: number;
}

export interface Hec2CrossSection {
  /** X1.1: SECNO — cross-section river station number */
  secno: number;
  /** X1.2: NUMST — declared number of GR elevation-station pairs */
  numst: number;
  /** X1.3: STCHL — left bank station */
  stchl: number;
  /** X1.4: STCHR — right bank station */
  stchr: number;
  /** X1.5: XLOBL — left overbank reach length to downstream section */
  xlobl: number;
  /** X1.6: XLOBR — right overbank reach length to downstream section */
  xlobr: number;
  /** X1.7: XLCH — main channel reach length to downstream section */
  xlch: number;
  /** X1.8: PXSECR — horizontal station scale factor (0 or 1 = no scale) */
  pxsecr: number;
  /** X1.9: PXSECE — constant elevation shift added to GR elevations */
  pxsece: number;
  /** Effective Manning roughness coefficients (from preceding NC card) */
  manning: {
    left: number;
    right: number;
    channel: number;
  };
  /** Contraction loss coefficient CCHV */
  contractionCoef: number;
  /** Expansion loss coefficient CEHV */
  expansionCoef: number;
  /** Optional horizontal roughness variation (NH card) */
  horizontalManning?: Hec2HorizontalManningPair[] | undefined;
  /** Ground profile points from GR cards (elevation, station) */
  grPoints: Hec2StationElevation[];
  /** Optional bridge/culvert data from SB/BT/X2/CI cards */
  bridge?: Hec2BridgeData | undefined;
  /** Optional local discharge override (QT or X2/J1) */
  discharge?: number | undefined;
  /** 1-indexed line number of X1 card */
  line: number;
}

export interface Hec2ParseError {
  line: number;
  message: string;
}

export interface Hec2Deck {
  titles: string[];
  units: Hec2UnitSystem;
  jobCard?: Hec2JobCard | undefined;
  job2Card?: Hec2Job2Card | undefined;
  jobCards: Hec2RawCard[];
  manningCards: Hec2ManningCard[];
  horizontalManningCards: Hec2HorizontalManningCard[];
  dischargeTable?: Hec2DischargeTableCard | undefined;
  crossSections: Hec2CrossSection[];
  cards: Hec2RawCard[];
  hasEndJob: boolean;
  hasEndRun: boolean;
  parseErrors: Hec2ParseError[];
}

export interface Hec2Diagnostic {
  code: number;
  codeId: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line: number;
  column?: number | undefined;
}
