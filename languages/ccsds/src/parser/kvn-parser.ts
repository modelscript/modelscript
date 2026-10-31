// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ccsds — Zero-Regex CCSDS KVN Parser.
 *
 * Ingests CCSDS Keyword-Value Notation (KVN) Orbit Ephemeris Message (OEM),
 * Orbit Parameter Message (OPM), and Orbit Mean-Elements Message (OMM) decks.
 */

import type {
  CcsdsDocument,
  CcsdsEphemerisPoint,
  CcsdsKeplerianElements,
  CcsdsMetadata,
  CcsdsOemDocument,
  CcsdsOmmDocument,
  CcsdsOpmDocument,
  CcsdsRange,
  CcsdsSpacecraftParameters,
} from "../types.js";

function parseEpochSeconds(epochStr: string): number {
  const ts = Date.parse(epochStr);
  return Number.isNaN(ts) ? 0 : ts / 1000.0;
}

export function parseKvn(source: string): CcsdsDocument {
  const lines = source.split(/\r?\n/);
  const totalLength = source.length;

  let format: "OEM" | "OPM" | "OMM" = "OEM";
  let version = "2.0";
  const header: Record<string, string> = {};
  const metadata: CcsdsMetadata = {
    objectName: "UNKNOWN",
    refFrame: "EME2000",
    timeSystem: "UTC",
  };

  const points: CcsdsEphemerisPoint[] = [];
  const stateVector: Partial<CcsdsEphemerisPoint> = {
    epoch: "2000-01-01T00:00:00.000",
    epochSeconds: 946684800,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
  };
  const keplerian: Partial<CcsdsKeplerianElements> = {};
  const spacecraft: Partial<CcsdsSpacecraftParameters> = {};

  let inMeta = false;
  let inData = false;
  let offset = 0;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx]!;
    const lineStartOffset = offset;
    offset += rawLine.length + 1; // + newline
    const line = rawLine.trim();

    if (!line || line.startsWith("COMMENT") || line.startsWith("#")) {
      continue;
    }

    // Check version line: CCSDS_xxx_VERS = y.y
    const eqIdx = line.indexOf("=");
    if (eqIdx !== -1) {
      const key = line.slice(0, eqIdx).trim().toUpperCase();
      const val = line.slice(eqIdx + 1).trim();

      if (key === "CCSDS_OEM_VERS") {
        format = "OEM";
        version = val;
        header[key] = val;
        continue;
      }
      if (key === "CCSDS_OPM_VERS") {
        format = "OPM";
        version = val;
        header[key] = val;
        continue;
      }
      if (key === "CCSDS_OMM_VERS") {
        format = "OMM";
        version = val;
        header[key] = val;
        continue;
      }

      if (key === "META_START") {
        inMeta = true;
        continue;
      }
      if (key === "META_STOP") {
        inMeta = false;
        continue;
      }
      if (key === "DATA_START") {
        inData = true;
        continue;
      }
      if (key === "DATA_STOP") {
        inData = false;
        continue;
      }

      // Metadata keys
      switch (key) {
        case "OBJECT_NAME":
          metadata.objectName = val;
          break;
        case "OBJECT_ID":
          metadata.objectId = val;
          break;
        case "CENTER_NAME":
          metadata.centerName = val;
          break;
        case "REF_FRAME":
          metadata.refFrame = val;
          break;
        case "TIME_SYSTEM":
          metadata.timeSystem = val;
          break;
        case "START_TIME":
          metadata.startTime = val;
          break;
        case "STOP_TIME":
          metadata.stopTime = val;
          break;
        case "USEABLE_START_TIME":
          metadata.usableStartTime = val;
          break;
        case "USEABLE_STOP_TIME":
          metadata.usableStopTime = val;
          break;
        case "INTERPOLATION":
          metadata.interpolation = val;
          break;
        case "INTERPOLATION_DEGREE":
          metadata.interpolationDegree = parseInt(val, 10);
          break;

        // State vector components (for OPM)
        case "EPOCH":
          stateVector.epoch = val;
          stateVector.epochSeconds = parseEpochSeconds(val);
          break;
        case "X":
          stateVector.x = parseFloat(val);
          break;
        case "Y":
          stateVector.y = parseFloat(val);
          break;
        case "Z":
          stateVector.z = parseFloat(val);
          break;
        case "X_DOT":
          stateVector.vx = parseFloat(val);
          break;
        case "Y_DOT":
          stateVector.vy = parseFloat(val);
          break;
        case "Z_DOT":
          stateVector.vz = parseFloat(val);
          break;

        // Keplerian elements
        case "SEMI_MAJOR_AXIS":
          keplerian.semiMajorAxisKm = parseFloat(val);
          break;
        case "ECCENTRICITY":
          keplerian.eccentricity = parseFloat(val);
          break;
        case "INCLINATION":
          keplerian.inclinationDeg = parseFloat(val);
          break;
        case "RA_OF_ASC_NODE":
          keplerian.raanDeg = parseFloat(val);
          break;
        case "ARG_OF_PERICENTER":
          keplerian.argOfPericenterDeg = parseFloat(val);
          break;
        case "TRUE_ANOMALY":
          keplerian.trueAnomalyDeg = parseFloat(val);
          break;
        case "MEAN_ANOMALY":
          keplerian.meanAnomalyDeg = parseFloat(val);
          break;
        case "MEAN_MOTION":
          keplerian.meanMotionRevsPerDay = parseFloat(val);
          break;
        case "BSTAR":
          keplerian.bstar = parseFloat(val);
          break;

        // Spacecraft parameters
        case "MASS":
          spacecraft.massKg = parseFloat(val);
          break;
        case "SOLAR_RAD_AREA":
          spacecraft.solarRadAreaM2 = parseFloat(val);
          break;
        case "SOLAR_RAD_COEFF":
          spacecraft.solarRadCoeff = parseFloat(val);
          break;
        case "DRAG_AREA":
          spacecraft.dragAreaM2 = parseFloat(val);
          break;
        case "DRAG_COEFF":
          spacecraft.dragCoeff = parseFloat(val);
          break;

        default:
          if (inMeta) {
            header[key] = val;
          } else {
            header[key] = val;
          }
      }
      continue;
    }

    // In DATA section of OEM: lines of the form:
    // EPOCH X Y Z X_DOT Y_DOT Z_DOT [X_DDOT Y_DDOT Z_DDOT]
    if (format === "OEM" || inData) {
      const tokens = line.split(/\s+/);
      if (tokens.length >= 7) {
        const epStr = tokens[0]!;
        const x = parseFloat(tokens[1]!);
        const y = parseFloat(tokens[2]!);
        const z = parseFloat(tokens[3]!);
        const vx = parseFloat(tokens[4]!);
        const vy = parseFloat(tokens[5]!);
        const vz = parseFloat(tokens[6]!);

        if (!Number.isNaN(x) && !Number.isNaN(y) && !Number.isNaN(z)) {
          const ptRange: CcsdsRange = {
            startLine: lineIdx + 1,
            startColumn: 1,
            endLine: lineIdx + 1,
            endColumn: line.length,
            startOffset: lineStartOffset,
            endOffset: lineStartOffset + line.length,
          };

          const pt: CcsdsEphemerisPoint = {
            epoch: epStr,
            epochSeconds: parseEpochSeconds(epStr),
            x,
            y,
            z,
            vx,
            vy,
            vz,
            range: ptRange,
          };

          if (tokens.length >= 10) {
            pt.ax = parseFloat(tokens[7]!);
            pt.ay = parseFloat(tokens[8]!);
            pt.az = parseFloat(tokens[9]!);
          }

          points.push(pt);
        }
      }
    }
  }

  const docRange: CcsdsRange = {
    startLine: 1,
    startColumn: 1,
    endLine: lines.length,
    endColumn: (lines[lines.length - 1]?.length ?? 0) + 1,
    startOffset: 0,
    endOffset: totalLength,
  };

  // Normalize Keplerian elements when MEAN_MOTION or MEAN_ANOMALY are provided
  if (
    keplerian.semiMajorAxisKm === undefined &&
    keplerian.meanMotionRevsPerDay !== undefined &&
    keplerian.meanMotionRevsPerDay > 0
  ) {
    const nRadPerSec = (keplerian.meanMotionRevsPerDay * 2.0 * Math.PI) / 86400.0;
    keplerian.semiMajorAxisKm = Math.cbrt(398600.4418 / (nRadPerSec * nRadPerSec));
  }
  if (keplerian.trueAnomalyDeg === undefined && keplerian.meanAnomalyDeg !== undefined) {
    const e = Math.max(0.0, Math.min(0.999999, keplerian.eccentricity ?? 0.0));
    const M = (keplerian.meanAnomalyDeg * Math.PI) / 180.0;
    let E = M;
    for (let iter = 0; iter < 30; iter++) {
      const f = E - e * Math.sin(E) - M;
      const fPrime = 1.0 - e * Math.cos(E);
      const dE = f / Math.max(1e-12, fPrime);
      E -= dE;
      if (Math.abs(dE) < 1e-12) break;
    }
    const nu = 2.0 * Math.atan2(Math.sqrt(1.0 + e) * Math.sin(E * 0.5), Math.sqrt(1.0 - e) * Math.cos(E * 0.5));
    keplerian.trueAnomalyDeg = ((nu * 180.0) / Math.PI + 360.0) % 360.0;
  }

  if (format === "OPM") {
    const sv: CcsdsEphemerisPoint = {
      epoch: stateVector.epoch ?? "2000-01-01T00:00:00.000",
      epochSeconds: stateVector.epochSeconds ?? 946684800,
      x: stateVector.x ?? 0,
      y: stateVector.y ?? 0,
      z: stateVector.z ?? 0,
      vx: stateVector.vx ?? 0,
      vy: stateVector.vy ?? 0,
      vz: stateVector.vz ?? 0,
      range: docRange,
    };

    const doc: CcsdsOpmDocument = {
      format: "OPM",
      version,
      header,
      metadata,
      stateVector: sv,
      keplerian: keplerian.semiMajorAxisKm !== undefined ? (keplerian as CcsdsKeplerianElements) : undefined,
      spacecraft: spacecraft.massKg !== undefined ? (spacecraft as CcsdsSpacecraftParameters) : undefined,
      range: docRange,
    };
    return doc;
  }

  if (format === "OMM") {
    const normalizedMean: CcsdsKeplerianElements = {
      semiMajorAxisKm: keplerian.semiMajorAxisKm ?? 7000,
      eccentricity: keplerian.eccentricity ?? 0.001,
      inclinationDeg: keplerian.inclinationDeg ?? 28.5,
      raanDeg: keplerian.raanDeg ?? 0,
      argOfPericenterDeg: keplerian.argOfPericenterDeg ?? 0,
      trueAnomalyDeg: keplerian.trueAnomalyDeg ?? 0,
      meanAnomalyDeg: keplerian.meanAnomalyDeg,
      meanMotionRevsPerDay: keplerian.meanMotionRevsPerDay,
      bstar: keplerian.bstar,
    };
    const doc: CcsdsOmmDocument = {
      format: "OMM",
      version,
      header,
      metadata,
      meanElements: normalizedMean,
      spacecraft: spacecraft.massKg !== undefined ? (spacecraft as CcsdsSpacecraftParameters) : undefined,
      range: docRange,
    };
    return doc;
  }

  const doc: CcsdsOemDocument = {
    format: "OEM",
    version,
    header,
    metadata,
    points,
    range: docRange,
  };
  return doc;
}
