// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ccsds — Spacecraft Astrodynamics & Satellite Telemetry Domain Model.
 *
 * Implements CCSDS 502.0-B-3 (Orbit Ephemeris/Parameters Messages: OEM, OPM, OMM)
 * and OMG XTCE v1.2 (XML Telemetric and Command Exchange).
 */

export interface CcsdsRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export type CcsdsRefFrame = "EME2000" | "GCRF" | "ITRF" | "TEME" | "TOD" | "J2000" | string;

export type CcsdsTimeSystem = "UTC" | "TAI" | "TT" | "UT1" | "GPS" | string;

export interface CcsdsMetadata {
  objectName: string;
  objectId?: string | undefined;
  centerName?: string | undefined;
  refFrame: CcsdsRefFrame;
  timeSystem: CcsdsTimeSystem;
  startTime?: string | undefined;
  stopTime?: string | undefined;
  usableStartTime?: string | undefined;
  usableStopTime?: string | undefined;
  interpolation?: string | undefined;
  interpolationDegree?: number | undefined;
}

export interface CcsdsEphemerisPoint {
  epoch: string;
  epochSeconds: number; // Unix epoch seconds
  // Position in km
  x: number;
  y: number;
  z: number;
  // Velocity in km/s
  vx: number;
  vy: number;
  vz: number;
  // Optional acceleration in km/s^2
  ax?: number | undefined;
  ay?: number | undefined;
  az?: number | undefined;
  range: CcsdsRange;
}

export interface CcsdsKeplerianElements {
  semiMajorAxisKm: number;
  eccentricity: number;
  inclinationDeg: number;
  raanDeg: number; // Right Ascension of the Ascending Node
  argOfPericenterDeg: number; // Argument of Pericenter (or perigee)
  trueAnomalyDeg: number;
  meanAnomalyDeg?: number | undefined;
  meanMotionRevsPerDay?: number | undefined;
  bstar?: number | undefined;
}

export interface CcsdsSpacecraftParameters {
  massKg?: number | undefined;
  solarRadAreaM2?: number | undefined;
  solarRadCoeff?: number | undefined; // Cr (1.0 = absorbing, 2.0 = reflecting)
  dragAreaM2?: number | undefined;
  dragCoeff?: number | undefined; // Cd (~2.2 for LEO)
}

export interface CcsdsOemDocument {
  format: "OEM";
  version: string;
  header: Record<string, string>;
  metadata: CcsdsMetadata;
  points: CcsdsEphemerisPoint[];
  range: CcsdsRange;
}

export interface CcsdsOpmDocument {
  format: "OPM";
  version: string;
  header: Record<string, string>;
  metadata: CcsdsMetadata;
  stateVector: CcsdsEphemerisPoint;
  keplerian?: CcsdsKeplerianElements | undefined;
  spacecraft?: CcsdsSpacecraftParameters | undefined;
  range: CcsdsRange;
}

export interface CcsdsOmmDocument {
  format: "OMM";
  version: string;
  header: Record<string, string>;
  metadata: CcsdsMetadata;
  meanElements: CcsdsKeplerianElements;
  spacecraft?: CcsdsSpacecraftParameters | undefined;
  range: CcsdsRange;
}

// ─────────────────────────────────────────────────────────────────────────────
// OMG XTCE Telemetry and Command Exchange
// ─────────────────────────────────────────────────────────────────────────────

export type XtceParameterType = "integer" | "float" | "string" | "boolean" | "enumeration";

export interface XtceParameter {
  name: string;
  paramType: XtceParameterType;
  bitLength: number;
  signed?: boolean | undefined;
  units?: string | undefined;
  calibrationCoeffs?: number[] | undefined; // Polynomial calibration: c0 + c1*x + c2*x^2
  range: CcsdsRange;
}

export interface XtceContainerEntry {
  parameterRef: string;
  bitOffset: number;
  bitLength: number;
}

export interface XtceContainer {
  name: string;
  entries: XtceContainerEntry[];
  range: CcsdsRange;
}

export interface XtceCommandArgument {
  name: string;
  argType: string;
  bitLength: number;
}

export interface XtceCommand {
  name: string;
  opcode?: number | undefined;
  arguments: XtceCommandArgument[];
  range: CcsdsRange;
}

export interface XtceDocument {
  format: "XTCE";
  name: string;
  parameters: XtceParameter[];
  containers: XtceContainer[];
  commands: XtceCommand[];
  range: CcsdsRange;
}

export type CcsdsDocument = CcsdsOemDocument | CcsdsOpmDocument | CcsdsOmmDocument | XtceDocument;
