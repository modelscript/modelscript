// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core TypeScript types for RINEX v2 (Receiver Independent Exchange Format)
 * GNSS/GPS observation (OBS) and navigation (NAV) files, ephemeris propagation,
 * and 3D Gauss-Newton position fix solutions.
 */

export type RinexFileType = "O" | "N" | "M" | "G" | "H" | "B" | "C" | "UNKNOWN";

export type RinexSatelliteSystem = "G" | "R" | "E" | "S" | "M" | "C" | "J";

export interface RinexHeaderLine {
  label: string;
  data: string;
  line: number;
}

export interface EcefCoords {
  x: number;
  y: number;
  z: number;
}

export interface GeodeticCoords {
  /** Geodetic latitude in degrees (-90..+90). */
  latDeg: number;
  /** Geodetic longitude in degrees (-180..+180). */
  lonDeg: number;
  /** Ellipsoidal height above WGS-84 in meters. */
  altM: number;
}

export interface AntennaDeltaHen {
  h: number;
  e: number;
  n: number;
}

export interface RinexTimestamp {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** Seconds since Unix epoch (UTC/GPS nominal). */
  epochSec: number;
  /** GPS Time of Week in seconds (0..604800). */
  gpsTow: number;
  /** GPS week number. */
  gpsWeek: number;
}

export interface RinexHeader {
  version: number;
  fileType: RinexFileType;
  fileTypeRaw: string;
  satelliteSystem: RinexSatelliteSystem;
  hasVersionHeader: boolean;
  hasEndOfHeader: boolean;
  endOfHeaderLine?: number | undefined;
  program?: string | undefined;
  runBy?: string | undefined;
  date?: string | undefined;
  markerName?: string | undefined;
  markerNumber?: string | undefined;
  observer?: string | undefined;
  agency?: string | undefined;
  receiverNumber?: string | undefined;
  receiverType?: string | undefined;
  receiverVersion?: string | undefined;
  antennaNumber?: string | undefined;
  antennaType?: string | undefined;
  approxPositionXyz?: EcefCoords | undefined;
  antennaDeltaHen?: AntennaDeltaHen | undefined;
  observationTypes: string[];
  interval?: number | undefined;
  timeOfFirstObs?: RinexTimestamp | undefined;
  timeOfLastObs?: RinexTimestamp | undefined;
  leapSeconds?: number | undefined;
  ionAlpha?: [number, number, number, number] | undefined;
  ionBeta?: [number, number, number, number] | undefined;
  deltaUtc?: { a0: number; a1: number; t: number; w: number } | undefined;
  comments: string[];
  rawLines: RinexHeaderLine[];
}

export interface RinexObservationValue {
  value: number;
  lli?: number | undefined;
  ssi?: number | undefined;
}

export interface RinexSatelliteObservation {
  /** Satellite PRN string, e.g. "G01", "G12", "R05". */
  prn: string;
  system: RinexSatelliteSystem;
  prnNumber: number;
  /** Map from observation type (e.g. "C1", "P1", "L1", "D1", "S1") to value. */
  observations: Record<string, RinexObservationValue>;
  line: number;
}

export interface RinexObsEpoch {
  timestamp: RinexTimestamp;
  epochFlag: number;
  numSatellites: number;
  receiverClockOffset?: number | undefined;
  satellites: RinexSatelliteObservation[];
  line: number;
}

/**
 * GPS Broadcast Keplerian Ephemeris Record (8 lines in RINEX v2 NAV).
 * Units follow ICD-GPS-200 / RINEX v2.11 specification.
 */
export interface RinexNavEphemeris {
  /** Satellite PRN string, e.g. "G01". */
  prn: string;
  prnNumber: number;
  /** Time of clock (Toc). */
  toc: RinexTimestamp;
  /** SV clock bias (seconds). */
  af0: number;
  /** SV clock drift (sec/sec). */
  af1: number;
  /** SV clock drift rate (sec/sec^2). */
  af2: number;
  /** Issue of Data, Ephemeris. */
  iode: number;
  /** Amplitude of sine harmonic correction term to orbit radius (m). */
  crs: number;
  /** Mean motion difference from computed value (rad/s). */
  deltaN: number;
  /** Mean anomaly at reference time (rad). */
  m0: number;
  /** Amplitude of cosine harmonic correction term to argument of latitude (rad). */
  cuc: number;
  /** Eccentricity (dimensionless). */
  e: number;
  /** Amplitude of sine harmonic correction term to argument of latitude (rad). */
  cus: number;
  /** Square root of semi-major axis (m^(1/2)). */
  sqrtA: number;
  /** Reference time ephemeris (sec of GPS week). */
  toe: number;
  /** Amplitude of cosine harmonic correction term to angle of inclination (rad). */
  cic: number;
  /** Longitude of ascending node of orbit plane at weekly epoch (rad). */
  omega0: number;
  /** Amplitude of sine harmonic correction term to angle of inclination (rad). */
  cis: number;
  /** Inclination angle at reference time (rad). */
  i0: number;
  /** Amplitude of cosine harmonic correction term to orbit radius (m). */
  crc: number;
  /** Argument of perigee (rad). */
  omega: number;
  /** Rate of right ascension (rad/s). */
  omegaDot: number;
  /** Rate of inclination angle (rad/s). */
  idot: number;
  /** Codes on L2 channel. */
  codesL2: number;
  /** GPS week number (continuous). */
  gpsWeek: number;
  /** L2 P data flag. */
  l2pFlag: number;
  /** SV accuracy (m). */
  svAccuracy: number;
  /** SV health (bits 17-22 w 3 sf 1, 0 = healthy). */
  svHealth: number;
  /** Total Group Delay (seconds). */
  tgd: number;
  /** Issue of Data, Clock. */
  iodc: number;
  /** Transmission time of message (sec of GPS week). */
  transmissionTime: number;
  /** Fit interval (hours). */
  fitInterval: number;
  line: number;
}

export interface RinexParseIssue {
  line: number;
  column: number;
  message: string;
}

export interface RinexDocument {
  fileType: RinexFileType;
  header: RinexHeader;
  epochs: RinexObsEpoch[];
  ephemerides: RinexNavEphemeris[];
  parseIssues: RinexParseIssue[];
}

export interface SatelliteEcefState {
  prn: string;
  /** Satellite ECEF position in meters. */
  position: EcefCoords;
  /** Satellite ECEF velocity in m/s (computed via finite difference or analytic derivative). */
  velocity: EcefCoords;
  /** Semi-major axis a = sqrtA^2 in meters. */
  semiMajorAxisM: number;
  /** Orbital radius r_k in meters. */
  orbitalRadiusM: number;
  /** Eccentric anomaly E_k in radians. */
  eccentricAnomalyRad: number;
  /** True anomaly nu_k in radians. */
  trueAnomalyRad: number;
  /** Relativistic clock correction delta_t_r in seconds. */
  relativisticCorrectionSec: number;
  /** Total satellite clock correction delta_t_sv (including relativistic & TGD) in seconds. */
  clockCorrectionSec: number;
  /** GPS time of week used for evaluation (seconds). */
  transmitTimeSec: number;
}

export interface SatellitePseudorange {
  prn: string;
  /** Satellite ECEF position at transmission time (meters). */
  satPos: EcefCoords;
  /** Measured pseudorange in meters (C1 or P1). */
  pseudorangeM: number;
  /** Satellite clock bias correction in seconds (positive = satellite clock ahead). */
  satClockBiasSec?: number | undefined;
  /** Optional weight (default 1.0). */
  weight?: number | undefined;
}

export interface SatelliteGeometryInfo {
  prn: string;
  azimuthDeg: number;
  elevationDeg: number;
  pseudorangeM: number;
  computedRangeM: number;
  residualM: number;
  satPos: EcefCoords;
}

export interface DopMetrics {
  gdop: number;
  pdop: number;
  hdop: number;
  vdop: number;
  tdop: number;
}

export interface RinexPositionSolution {
  converged: boolean;
  iterations: number;
  /** Receiver ECEF coordinates (m). */
  ecef: EcefCoords;
  /** Receiver WGS-84 geodetic coordinates. */
  geodetic: GeodeticCoords;
  /** Receiver clock bias in meters (c * delta_t). */
  clockBiasM: number;
  /** Receiver clock bias in seconds (delta_t). */
  clockBiasSec: number;
  /** Root-mean-square post-fit pseudorange residual in meters. */
  rmseM: number;
  /** Maximum absolute post-fit residual in meters. */
  maxResidualM: number;
  /** Dilution of Precision metrics. */
  dop: DopMetrics;
  /** Per-satellite skyplot geometry and residuals. */
  satellites: SatelliteGeometryInfo[];
  /** Optional timestamp associated with this epoch fix. */
  timestamp?: RinexTimestamp | undefined;
}
