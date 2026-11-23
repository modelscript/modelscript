// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core data structures for USACE HEC-1 (Flood Hydrograph Package, 1968) card decks.
 */

export type Hec1CardCode =
  | "ID"
  | "IT"
  | "IN"
  | "IO"
  | "KK"
  | "KM"
  | "KO"
  | "BA"
  | "PB"
  | "PI"
  | "PC"
  | "LU"
  | "LS"
  | "LE"
  | "UC"
  | "UD"
  | "US"
  | "BF"
  | "RM"
  | "RS"
  | "RD"
  | "HC"
  | "ZW"
  | "ZZ"
  | "*";

export type Hec1UnitSystem = "English" | "Metric";

export type Hec1CardFormat = "fixed" | "free";

export interface Hec1Card {
  code: Hec1CardCode;
  /** Raw string fields (fields[0] = Field 1, ..., fields[9] = Field 10). */
  fields: string[];
  /** Parsed numeric values for each field (NaN if empty or non-numeric). */
  numericFields: number[];
  raw: string;
  line: number;
  format: Hec1CardFormat;
  startOffset: number;
  endOffset: number;
}

export interface Hec1TimeControl {
  /** Computation time interval in minutes (IT field 1: NMIN). */
  nmin: number;
  /** Starting date string (IT field 2: IDATE). */
  idate?: string | undefined;
  /** Starting time string (IT field 3: ITIME). */
  itime?: string | undefined;
  /** Number of hydrograph ordinates (IT field 4: NQ). */
  nq: number;
  /** Ending date string (IT field 5: IDDATE). */
  iddate?: string | undefined;
  /** Ending time string (IT field 6: ITDATE). */
  itdate?: string | undefined;
  /** Precipitation time interval in minutes from IN card (optional; defaults to nmin). */
  precipIntervalMin?: number | undefined;
  line: number;
}

export interface Hec1OutputControl {
  /** Output print level (IO field 1: IPRINT). */
  iprint?: number | undefined;
  /** Plot control (IO field 2: IPLOT). */
  iplot?: number | undefined;
  line: number;
}

export interface Hec1ScsLoss {
  method: "SCS";
  /** Initial abstraction STRTL (in or mm; optional, defaults to 0.2 * S). */
  strtl?: number | undefined;
  /** SCS Curve Number CRVNBR (0 < CN <= 100). */
  curveNumber: number;
  /** Percent impervious area RTIMP (0..100). */
  rtimp: number;
  line: number;
}

export interface Hec1UniformLoss {
  method: "Uniform";
  /** Initial loss STRTL (in or mm). */
  strtl: number;
  /** Constant loss rate CNSTL (in/hr or mm/hr). */
  cnstl: number;
  /** Percent impervious area RTIMP (0..100). */
  rtimp: number;
  line: number;
}

export interface Hec1ExponentialLoss {
  method: "Exponential";
  strkr: number;
  dltkr: number;
  rtiql: number;
  erain: number;
  rtimp: number;
  line: number;
}

export type Hec1LossParams = Hec1ScsLoss | Hec1UniformLoss | Hec1ExponentialLoss;

export interface Hec1ClarkUh {
  method: "Clark";
  /** Time of concentration TC (hours). */
  tc: number;
  /** Storage attenuation coefficient R (hours). */
  r: number;
  line: number;
}

export interface Hec1ScsUh {
  method: "SCS";
  /** Basin lag time TLAG (hours). */
  tlag: number;
  line: number;
}

export interface Hec1SnyderUh {
  method: "Snyder";
  /** Standard lag time TP (hours). */
  tp: number;
  /** Peaking coefficient CP (dimensionless, typically 0.4–0.8). */
  cp: number;
  line: number;
}

export type Hec1UnitHydrograph = Hec1ClarkUh | Hec1ScsUh | Hec1SnyderUh;

export interface Hec1Baseflow {
  /** Initial baseflow STRTQ (cfs or m^3/s). */
  strtq: number;
  /** Recession threshold QRCSN. */
  qrcsn: number;
  /** Recession ratio RTIOR (>= 1.0). */
  rtior: number;
  line: number;
}

export interface Hec1Muskingum {
  /** Number of routing subreaches NSTPS (>= 1). */
  nstps: number;
  /** Total Muskingum travel time AMSKK (hours). */
  amskk: number;
  /** Muskingum weighting factor X (0 <= X <= 0.5). */
  x: number;
  /** Optional starting storage/flow indicator TSTRA. */
  tstra?: number | undefined;
  line: number;
}

export interface Hec1StorageRouting {
  /** Number of routing steps NSTPS. */
  nstps: number;
  /** Storage routing type ITYP. */
  ityp: number;
  /** Initial condition RSVRIC. */
  rsvric: number;
  /** Weighting factor X. */
  x: number;
  line: number;
}

export type Hec1StationKind = "subbasin" | "route" | "combine" | "unknown";

export interface Hec1Station {
  /** Station identifier from KK field 1. */
  id: string;
  /** Optional descriptive comment from KM card(s) or KK remainder. */
  description?: string | undefined;
  kind: Hec1StationKind;
  /** Subbasin drainage area from BA card (mi^2 in English, km^2 in Metric). */
  area?: number | undefined;
  areaLine?: number | undefined;
  /** Basin-average total storm precipitation from PB card (in or mm). */
  precipitationTotal?: number | undefined;
  /** Incremental precipitation hyetograph from PI card(s) (in or mm per interval). */
  precipitationIncrements?: number[] | undefined;
  /** Cumulative precipitation series from PC card(s) (in or mm). */
  precipitationCumulative?: number[] | undefined;
  loss?: Hec1LossParams | undefined;
  unitHydrograph?: Hec1UnitHydrograph | undefined;
  baseflow?: Hec1Baseflow | undefined;
  muskingum?: Hec1Muskingum | undefined;
  storageRouting?: Hec1StorageRouting | undefined;
  /** Number of upstream hydrographs combined by HC card (ICOMP). */
  combineCount?: number | undefined;
  combineLine?: number | undefined;
  /** HEC-DSS write path from ZW card. */
  dssWritePath?: string | undefined;
  line: number;
  startOffset: number;
  endOffset: number;
  cards: Hec1Card[];
}

export interface Hec1ParseError {
  message: string;
  line: number;
  column: number;
  raw: string;
}

export interface Hec1Deck {
  /** Job title lines from ID cards. */
  titleLines: string[];
  timeControl?: Hec1TimeControl | undefined;
  outputControl?: Hec1OutputControl | undefined;
  /** Stations keyed by first-seen station ID. */
  stations: Map<string, Hec1Station>;
  /** All stations in card-deck execution order (including duplicates for linting). */
  stationList: Hec1Station[];
  /** Ordered unique station IDs. */
  stationOrder: string[];
  /** All parsed cards including comments. */
  cards: Hec1Card[];
  /** Whether a ZZ end-of-job card was present. */
  hasEndCard: boolean;
  /** Unit system (HEC-1 defaults to English unless IM card or Metric override). */
  unitSystem: Hec1UnitSystem;
  /** Syntax errors detected during card parsing. */
  parseErrors: Hec1ParseError[];
}

export interface Hec1HydrographPoint {
  timeHours: number;
  flow: number;
}

export interface Hec1StationSimulationResult {
  stationId: string;
  kind: Hec1StationKind;
  hydrograph: Hec1HydrographPoint[];
  peakFlow: number;
  timeToPeakHours: number;
  totalVolume: number;
  excessRainTotal?: number | undefined;
}

export interface Hec1SimulationResult {
  timeStepHours: number;
  unitSystem: Hec1UnitSystem;
  stations: Map<string, Hec1StationSimulationResult>;
  outletStationId?: string | undefined;
}
