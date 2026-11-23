// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core TypeScript types for @modelscript/nmea0183 (NMEA 0183 Marine & GPS ASCII Telemetry).
 */

export type NmeaDelimiter = "$" | "!";

export type KnownNmeaTalker =
  | "GP" // GPS
  | "GN" // Combined GNSS
  | "GL" // GLONASS
  | "GA" // Galileo
  | "GB" // BeiDou
  | "BD" // BeiDou (legacy)
  | "HC" // Magnetic Heading Compass
  | "HE" // Gyro North-Seeking
  | "SD" // Depth Sounder
  | "II" // Integrated Instrumentation
  | "AI" // AIS Mobile Class A/B
  | "WI"; // Weather Instruments

export type KnownNmeaFormatter = "GGA" | "RMC" | "GSA" | "GSV" | "VTG" | "HDG" | "DBT" | "MWV";

export interface NmeaGgaPayload {
  kind: "GGA";
  utcRaw: string;
  utcSeconds?: number | undefined;
  latRaw: string;
  latHemi: string;
  latitudeDeg?: number | undefined;
  lonRaw: string;
  lonHemi: string;
  longitudeDeg?: number | undefined;
  fixQuality: number; // 0=invalid, 1=GPS, 2=DGPS, 4=RTK, 5=Float RTK
  satellitesUsed?: number | undefined;
  hdop?: number | undefined;
  altitudeM?: number | undefined;
  geoidSeparationM?: number | undefined;
}

export interface NmeaRmcPayload {
  kind: "RMC";
  utcRaw: string;
  utcSeconds?: number | undefined;
  status: "A" | "V" | string; // A=Active, V=Void
  latRaw: string;
  latHemi: string;
  latitudeDeg?: number | undefined;
  lonRaw: string;
  lonHemi: string;
  longitudeDeg?: number | undefined;
  speedKnots?: number | undefined;
  courseDeg?: number | undefined;
  dateRaw: string; // ddmmyy
  magneticVariationDeg?: number | undefined;
  magneticVariationDir?: string | undefined;
  modeIndicator?: string | undefined;
}

export interface NmeaGsaPayload {
  kind: "GSA";
  selectionMode: string; // A=Auto, M=Manual
  fixType: number; // 1=no fix, 2=2D, 3=3D
  satellitePrns: number[];
  pdop?: number | undefined;
  hdop?: number | undefined;
  vdop?: number | undefined;
}

export interface NmeaSatelliteInfo {
  talker: string;
  prn: number;
  elevationDeg?: number | undefined;
  azimuthDeg?: number | undefined;
  snrDbHz?: number | undefined;
  line: number;
}

export interface NmeaGsvPayload {
  kind: "GSV";
  totalMessages: number;
  messageNumber: number;
  satellitesInView: number;
  satellites: NmeaSatelliteInfo[];
}

export interface NmeaVtgPayload {
  kind: "VTG";
  courseTrueDeg?: number | undefined;
  courseMagneticDeg?: number | undefined;
  speedKnots?: number | undefined;
  speedKmh?: number | undefined;
  modeIndicator?: string | undefined;
}

export interface NmeaHdgPayload {
  kind: "HDG";
  headingMagneticDeg?: number | undefined;
  deviationDeg?: number | undefined;
  deviationDir?: string | undefined;
  variationDeg?: number | undefined;
  variationDir?: string | undefined;
}

export interface NmeaDbtPayload {
  kind: "DBT";
  depthFeet?: number | undefined;
  depthMeters?: number | undefined;
  depthFathoms?: number | undefined;
}

export interface NmeaMwvPayload {
  kind: "MWV";
  windAngleDeg?: number | undefined;
  reference: "R" | "T" | string; // R=Relative, T=True
  windSpeed?: number | undefined;
  windSpeedUnits: "K" | "M" | "N" | string; // km/h, m/s, knots
  status: "A" | "V" | string;
}

export interface NmeaGenericPayload {
  kind: "GENERIC";
  fields: string[];
}

export type NmeaDecodedPayload =
  | NmeaGgaPayload
  | NmeaRmcPayload
  | NmeaGsaPayload
  | NmeaGsvPayload
  | NmeaVtgPayload
  | NmeaHdgPayload
  | NmeaDbtPayload
  | NmeaMwvPayload
  | NmeaGenericPayload;

export interface NmeaSentence {
  index: number;
  line: number; // 1-based line number
  startOffset: number;
  endOffset: number;
  raw: string;
  delimiter: NmeaDelimiter;
  talker: string;
  formatter: string;
  address: string; // talker + formatter, e.g. "GPGGA"
  fields: string[];
  checksumProvided?: string | undefined;
  checksumComputed: string;
  checksumValid: boolean;
  payload: NmeaDecodedPayload;
}

export interface NmeaParseError {
  line: number;
  startOffset: number;
  endOffset: number;
  raw: string;
  message: string;
}

export interface Nmea0183Document {
  sentences: NmeaSentence[];
  parseErrors: NmeaParseError[];
  satellites: NmeaSatelliteInfo[];
  talkers: string[];
  formatters: string[];
}

export interface EcefCoord {
  x: number;
  y: number;
  z: number;
}

export interface EnuCoord {
  e: number;
  n: number;
  u: number;
}

export interface GeodeticCoord {
  latDeg: number;
  lonDeg: number;
  altM: number;
}

export interface VincentyResult {
  distanceM: number;
  initialBearingDeg: number;
  finalBearingDeg: number;
  converged: boolean;
  iterations: number;
}

export interface NmeaTrackEpoch {
  index: number;
  line: number;
  sentenceAddress: string;
  utcRaw?: string | undefined;
  utcSeconds?: number | undefined;
  dateRaw?: string | undefined;
  latDeg: number;
  lonDeg: number;
  altM: number;
  ecef: EcefCoord;
  enu: EnuCoord;
  fixQuality?: number | undefined;
  status?: string | undefined;
  hdop?: number | undefined;
  satellitesUsed?: number | undefined;
  sogKnots?: number | undefined;
  sogMps?: number | undefined;
  cogDeg?: number | undefined;
  segmentDistanceM: number;
  cumulativeDistanceM: number;
  computedSpeedMps?: number | undefined;
  computedBearingDeg?: number | undefined;
}

export interface NmeaTrackSolution {
  origin?: GeodeticCoord | undefined;
  epochs: NmeaTrackEpoch[];
  totalDistanceVincentyM: number;
  totalDistanceHaversineM: number;
  durationSec: number;
  meanSpeedMps: number;
  maxSpeedMps: number;
  meanSpeedKnots: number;
  maxSpeedKnots: number;
  meanCourseDeg?: number | undefined;
  minAltM?: number | undefined;
  maxAltM?: number | undefined;
  bounds?:
    | {
        minLat: number;
        maxLat: number;
        minLon: number;
        maxLon: number;
        minE: number;
        maxE: number;
        minN: number;
        maxN: number;
      }
    | undefined;
  latestHeadingDeg?: number | undefined;
  latestDepthM?: number | undefined;
  latestWindSpeed?: number | undefined;
  latestWindAngleDeg?: number | undefined;
  satelliteCount: number;
}
