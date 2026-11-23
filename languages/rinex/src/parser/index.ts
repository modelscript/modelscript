// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fixed-column RINEX v2 (v2.10 / v2.11) Observation (OBS) & Navigation (NAV) parser.
 *
 * Implements Gurtner et al. (1989) / IGS RINEX v2.11 specification:
 * - 60-character data field + 20-character header label (columns 61-80)
 * - Observation epoch headers with continuation lines (>12 satellites)
 * - Observation data rows (5 values per line, 14.3F + 1I LLI + 1I SSI = 16 chars each)
 * - 8-line GPS broadcast Keplerian ephemeris records (Fortran D/E exponents)
 */

import type {
  RinexDocument,
  RinexFileType,
  RinexHeader,
  RinexNavEphemeris,
  RinexObsEpoch,
  RinexObservationValue,
  RinexParseIssue,
  RinexSatelliteObservation,
  RinexSatelliteSystem,
  RinexTimestamp,
} from "../types.js";

const GPS_EPOCH_UNIX_SEC = Date.UTC(1980, 0, 6, 0, 0, 0) / 1000;
const SECONDS_PER_WEEK = 604800;

/**
 * Converts a 2-digit RINEX v2 year into a 4-digit year per RINEX v2.11 convention:
 * 80..99 -> 1980..1999, 00..79 -> 2000..2079.
 */
export function expandRinexYear(year: number): number {
  if (year >= 100) return year;
  return year >= 80 ? 1900 + year : 2000 + year;
}

/**
 * Builds a `RinexTimestamp` including Unix epoch seconds and GPS week / time-of-week.
 */
export function buildRinexTimestamp(
  rawYear: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): RinexTimestamp {
  const year = expandRinexYear(rawYear);
  const wholeSec = Math.floor(second);
  const fracSec = second - wholeSec;
  const epochSec = Date.UTC(year, month - 1, day, hour, minute, wholeSec) / 1000 + fracSec;
  const gpsSec = epochSec - GPS_EPOCH_UNIX_SEC;
  const gpsWeek = Math.floor(gpsSec / SECONDS_PER_WEEK);
  const gpsTow = gpsSec - gpsWeek * SECONDS_PER_WEEK;
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    epochSec,
    gpsTow,
    gpsWeek,
  };
}

/**
 * Formats a `RinexTimestamp` as an ISO-8601-like string.
 */
export function formatRinexTimestamp(ts: RinexTimestamp): string {
  const pad2 = (n: number) => String(Math.floor(n)).padStart(2, "0");
  const secStr = ts.second.toFixed(3).padStart(6, "0");
  return `${ts.year}-${pad2(ts.month)}-${pad2(ts.day)}T${pad2(ts.hour)}:${pad2(ts.minute)}:${secStr}Z`;
}

/**
 * Parses a Fortran-formatted floating-point field supporting `D`/`d` exponent notation.
 */
export function parseFortranFloat(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return Number.NaN;
  return Number(trimmed.replace(/[dD]/g, "e"));
}

function parseFixedFloats(line: string, startCol: number, fieldWidth: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const start = startCol + i * fieldWidth;
    const slice = line.slice(start, start + fieldWidth);
    const val = parseFortranFloat(slice);
    out.push(val);
  }
  return out;
}

function normalizeSystem(ch: string, fallback: RinexSatelliteSystem = "G"): RinexSatelliteSystem {
  const u = ch.trim().toUpperCase();
  if (u === "G" || u === "R" || u === "E" || u === "S" || u === "M" || u === "C" || u === "J") {
    return u;
  }
  return fallback;
}

/**
 * Detects whether a RINEX text buffer is an Observation (`O`) or Navigation (`N`) file.
 */
export function detectRinexFileType(content: string): RinexFileType {
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const label = line.slice(60).trim().toUpperCase();
    if (label === "RINEX VERSION / TYPE") {
      const ch = line.slice(20, 21).trim().toUpperCase();
      if (ch === "O" || ch === "N" || ch === "M" || ch === "G" || ch === "H" || ch === "B" || ch === "C") {
        return ch;
      }
      const dataUpper = line.slice(0, 60).toUpperCase();
      if (dataUpper.includes("OBSERVATION")) return "O";
      if (dataUpper.includes("NAV")) return "N";
      return "UNKNOWN";
    }
    if (label === "END OF HEADER") break;
  }
  return "UNKNOWN";
}

function parseHeader(lines: string[], parseIssues: RinexParseIssue[]): { header: RinexHeader; bodyStartIndex: number } {
  const header: RinexHeader = {
    version: Number.NaN,
    fileType: "UNKNOWN",
    fileTypeRaw: "",
    satelliteSystem: "G",
    hasVersionHeader: false,
    hasEndOfHeader: false,
    observationTypes: [],
    comments: [],
    rawLines: [],
  };

  let bodyStartIndex = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const lineNo = i + 1;
    if (line.trim().length === 0) continue;

    // Standard RINEX v2: columns 1-60 data, columns 61-80 label
    const data = line.slice(0, 60);
    const label = line.slice(60).trim().toUpperCase();

    if (label.length === 0) {
      // Allow fallback detection if END OF HEADER appears without 60-col padding
      if (line.trim().toUpperCase() === "END OF HEADER") {
        header.hasEndOfHeader = true;
        header.endOfHeaderLine = lineNo;
        bodyStartIndex = i + 1;
        break;
      }
      parseIssues.push({
        line: lineNo,
        column: 61,
        message: "Header line is missing column 61-80 RINEX label",
      });
      continue;
    }

    header.rawLines.push({ label, data, line: lineNo });

    if (label === "END OF HEADER") {
      header.hasEndOfHeader = true;
      header.endOfHeaderLine = lineNo;
      bodyStartIndex = i + 1;
      break;
    }

    switch (label) {
      case "RINEX VERSION / TYPE": {
        header.hasVersionHeader = true;
        header.version = parseFortranFloat(data.slice(0, 9));
        header.fileTypeRaw = data.slice(20, 40).trim();
        const typeChar = data.slice(20, 21).trim().toUpperCase();
        if (
          typeChar === "O" ||
          typeChar === "N" ||
          typeChar === "M" ||
          typeChar === "G" ||
          typeChar === "H" ||
          typeChar === "B" ||
          typeChar === "C"
        ) {
          header.fileType = typeChar;
        } else if (header.fileTypeRaw.toUpperCase().includes("OBS")) {
          header.fileType = "O";
        } else if (header.fileTypeRaw.toUpperCase().includes("NAV")) {
          header.fileType = "N";
        }
        header.satelliteSystem = normalizeSystem(data.slice(40, 41), "G");
        break;
      }
      case "PGM / RUN BY / DATE": {
        header.program = data.slice(0, 20).trim();
        header.runBy = data.slice(20, 40).trim();
        header.date = data.slice(40, 60).trim();
        break;
      }
      case "MARKER NAME": {
        header.markerName = data.trim();
        break;
      }
      case "MARKER NUMBER": {
        header.markerNumber = data.trim();
        break;
      }
      case "OBSERVER / AGENCY": {
        header.observer = data.slice(0, 20).trim();
        header.agency = data.slice(20, 60).trim();
        break;
      }
      case "REC # / TYPE / VERS": {
        header.receiverNumber = data.slice(0, 20).trim();
        header.receiverType = data.slice(20, 40).trim();
        header.receiverVersion = data.slice(40, 60).trim();
        break;
      }
      case "ANT # / TYPE": {
        header.antennaNumber = data.slice(0, 20).trim();
        header.antennaType = data.slice(20, 40).trim();
        break;
      }
      case "APPROX POSITION XYZ": {
        const x = parseFortranFloat(data.slice(0, 14));
        const y = parseFortranFloat(data.slice(14, 28));
        const z = parseFortranFloat(data.slice(28, 42));
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
          header.approxPositionXyz = { x, y, z };
        } else {
          parseIssues.push({ line: lineNo, column: 1, message: "Malformed APPROX POSITION XYZ coordinates" });
        }
        break;
      }
      case "ANTENNA: DELTA H/E/N": {
        const h = parseFortranFloat(data.slice(0, 14));
        const e = parseFortranFloat(data.slice(14, 28));
        const n = parseFortranFloat(data.slice(28, 42));
        if (Number.isFinite(h) && Number.isFinite(e) && Number.isFinite(n)) {
          header.antennaDeltaHen = { h, e, n };
        }
        break;
      }
      case "# / TYPES OF OBSERV": {
        const tokens = data.slice(6).trim().split(/\s+/).filter(Boolean);
        header.observationTypes.push(...tokens);
        break;
      }
      case "INTERVAL": {
        const val = parseFortranFloat(data.slice(0, 10));
        if (Number.isFinite(val)) header.interval = val;
        break;
      }
      case "TIME OF FIRST OBS": {
        const parts = data.trim().split(/\s+/);
        if (parts.length >= 6) {
          header.timeOfFirstObs = buildRinexTimestamp(
            Number(parts[0]),
            Number(parts[1]),
            Number(parts[2]),
            Number(parts[3]),
            Number(parts[4]),
            Number(parts[5]),
          );
        }
        break;
      }
      case "TIME OF LAST OBS": {
        const parts = data.trim().split(/\s+/);
        if (parts.length >= 6) {
          header.timeOfLastObs = buildRinexTimestamp(
            Number(parts[0]),
            Number(parts[1]),
            Number(parts[2]),
            Number(parts[3]),
            Number(parts[4]),
            Number(parts[5]),
          );
        }
        break;
      }
      case "LEAP SECONDS": {
        const ls = Number.parseInt(data.slice(0, 6).trim(), 10);
        if (Number.isFinite(ls)) header.leapSeconds = ls;
        break;
      }
      case "ION ALPHA": {
        const vals = data.trim().split(/\s+/).map(parseFortranFloat);
        if (vals.length >= 4 && vals.slice(0, 4).every(Number.isFinite)) {
          header.ionAlpha = [vals[0]!, vals[1]!, vals[2]!, vals[3]!];
        }
        break;
      }
      case "ION BETA": {
        const vals = data.trim().split(/\s+/).map(parseFortranFloat);
        if (vals.length >= 4 && vals.slice(0, 4).every(Number.isFinite)) {
          header.ionBeta = [vals[0]!, vals[1]!, vals[2]!, vals[3]!];
        }
        break;
      }
      case "DELTA-UTC: A0,A1,T,W": {
        const a0 = parseFortranFloat(data.slice(3, 22));
        const a1 = parseFortranFloat(data.slice(22, 41));
        const t = Number.parseInt(data.slice(41, 50).trim(), 10);
        const w = Number.parseInt(data.slice(50, 59).trim(), 10);
        if (Number.isFinite(a0) && Number.isFinite(a1)) {
          header.deltaUtc = { a0, a1, t: Number.isFinite(t) ? t : 0, w: Number.isFinite(w) ? w : 0 };
        }
        break;
      }
      case "COMMENT": {
        header.comments.push(data.trim());
        break;
      }
      default:
        break;
    }
  }

  return { header, bodyStartIndex };
}

function parseSatPrn(
  raw3: string,
  defaultSys: RinexSatelliteSystem,
): { prn: string; system: RinexSatelliteSystem; prnNumber: number } {
  const s = raw3.padEnd(3, " ");
  const sysChar = s[0] ?? " ";
  const system: RinexSatelliteSystem =
    sysChar === " " ? (defaultSys === "M" ? "G" : defaultSys) : normalizeSystem(sysChar, "G");
  const numStr = s.slice(1, 3).trim();
  const prnNumber = Number.parseInt(numStr, 10);
  const prn = Number.isFinite(prnNumber) ? `${system}${String(prnNumber).padStart(2, "0")}` : raw3.trim();
  return { prn, system, prnNumber: Number.isFinite(prnNumber) ? prnNumber : -1 };
}

function parseObsBody(
  lines: string[],
  startIndex: number,
  header: RinexHeader,
  parseIssues: RinexParseIssue[],
): RinexObsEpoch[] {
  const epochs: RinexObsEpoch[] = [];
  const obsTypes = header.observationTypes;
  const linesPerSat = Math.max(1, Math.ceil(obsTypes.length / 5));
  let i = startIndex;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim().length === 0) {
      i++;
      continue;
    }

    const epochLineNo = i + 1;
    // RINEX v2 epoch header format:
    //  1X,I2.2,1X,I2,1X,I2,1X,I2,1X,I2,F11.7,2X,I1,I3,12(A1,I2),F12.9
    const yy = Number.parseInt(line.slice(0, 3).trim(), 10);
    const mm = Number.parseInt(line.slice(3, 6).trim(), 10);
    const dd = Number.parseInt(line.slice(6, 9).trim(), 10);
    const hh = Number.parseInt(line.slice(9, 12).trim(), 10);
    const min = Number.parseInt(line.slice(12, 15).trim(), 10);
    const sec = parseFortranFloat(line.slice(15, 26));
    const epochFlag = Number.parseInt(line.slice(26, 29).trim(), 10);
    const numSats = Number.parseInt(line.slice(29, 32).trim(), 10);

    if (
      !Number.isFinite(yy) ||
      !Number.isFinite(mm) ||
      !Number.isFinite(dd) ||
      !Number.isFinite(hh) ||
      !Number.isFinite(min) ||
      !Number.isFinite(sec) ||
      !Number.isFinite(numSats)
    ) {
      parseIssues.push({
        line: epochLineNo,
        column: 1,
        message: `Malformed RINEX v2 observation epoch header: '${line.slice(0, 32).trim()}'`,
      });
      i++;
      continue;
    }

    const timestamp = buildRinexTimestamp(yy, mm, dd, hh, min, sec);
    const clkStr = line.slice(68, 80).trim();
    const receiverClockOffset = clkStr.length > 0 ? parseFortranFloat(clkStr) : undefined;

    // Collect PRN list across epoch line (up to 12) + continuation lines (cols 32-68)
    const satPrns: Array<{ prn: string; system: RinexSatelliteSystem; prnNumber: number }> = [];
    const firstLineSats = Math.min(numSats, 12);
    for (let s = 0; s < firstLineSats; s++) {
      const rawPrn = line.slice(32 + s * 3, 35 + s * 3);
      satPrns.push(parseSatPrn(rawPrn, header.satelliteSystem));
    }
    i++;

    while (satPrns.length < numSats && i < lines.length) {
      const cont = lines[i] ?? "";
      const remaining = Math.min(numSats - satPrns.length, 12);
      for (let s = 0; s < remaining; s++) {
        const rawPrn = cont.slice(32 + s * 3, 35 + s * 3);
        satPrns.push(parseSatPrn(rawPrn, header.satelliteSystem));
      }
      i++;
    }

    // Special event flags (2..5) skip numSats comment/header lines rather than satellite obs
    if (epochFlag > 1) {
      i += numSats;
      continue;
    }

    const satellites: RinexSatelliteObservation[] = [];
    for (let s = 0; s < satPrns.length; s++) {
      const satMeta = satPrns[s]!;
      const satLineNo = i + 1;
      const obsRecord: Record<string, RinexObservationValue> = {};

      for (let l = 0; l < linesPerSat && i < lines.length; l++) {
        const obsLine = lines[i] ?? "";
        for (let k = 0; k < 5; k++) {
          const obsIdx = l * 5 + k;
          if (obsIdx >= obsTypes.length) break;
          const obsType = obsTypes[obsIdx]!;
          const baseCol = k * 16;
          const valRaw = obsLine.slice(baseCol, baseCol + 14);
          if (valRaw.trim().length > 0) {
            const val = parseFortranFloat(valRaw);
            if (Number.isFinite(val)) {
              const lliRaw = obsLine.slice(baseCol + 14, baseCol + 15).trim();
              const ssiRaw = obsLine.slice(baseCol + 15, baseCol + 16).trim();
              obsRecord[obsType] = {
                value: val,
                lli: lliRaw ? Number.parseInt(lliRaw, 10) : undefined,
                ssi: ssiRaw ? Number.parseInt(ssiRaw, 10) : undefined,
              };
            }
          }
        }
        i++;
      }

      satellites.push({
        prn: satMeta.prn,
        system: satMeta.system,
        prnNumber: satMeta.prnNumber,
        observations: obsRecord,
        line: satLineNo,
      });
    }

    epochs.push({
      timestamp,
      epochFlag: Number.isFinite(epochFlag) ? epochFlag : 0,
      numSatellites: numSats,
      receiverClockOffset: Number.isFinite(receiverClockOffset) ? receiverClockOffset : undefined,
      satellites,
      line: epochLineNo,
    });
  }

  return epochs;
}

function parseNavBody(lines: string[], startIndex: number, parseIssues: RinexParseIssue[]): RinexNavEphemeris[] {
  const ephemerides: RinexNavEphemeris[] = [];
  let i = startIndex;

  while (i < lines.length) {
    const l0 = lines[i] ?? "";
    if (l0.trim().length === 0) {
      i++;
      continue;
    }

    const startLineNo = i + 1;
    if (i + 7 >= lines.length) {
      parseIssues.push({
        line: startLineNo,
        column: 1,
        message: "Incomplete 8-line GPS broadcast ephemeris record at end of NAV file",
      });
      break;
    }

    // Line 0: PRN(I2) YY(I3) MM(I3) DD(I3) HH(I3) MIN(I3) SEC(F5.1) af0(D19.12) af1(D19.12) af2(D19.12)
    const prnNum = Number.parseInt(l0.slice(0, 2).trim(), 10);
    const yy = Number.parseInt(l0.slice(2, 5).trim(), 10);
    const mm = Number.parseInt(l0.slice(5, 8).trim(), 10);
    const dd = Number.parseInt(l0.slice(8, 11).trim(), 10);
    const hh = Number.parseInt(l0.slice(11, 14).trim(), 10);
    const min = Number.parseInt(l0.slice(14, 17).trim(), 10);
    const sec = parseFortranFloat(l0.slice(17, 22));
    const [af0, af1, af2] = parseFixedFloats(l0, 22, 19, 3);

    if (!Number.isFinite(prnNum) || !Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) {
      parseIssues.push({
        line: startLineNo,
        column: 1,
        message: `Malformed GPS NAV ephemeris header line: '${l0.slice(0, 22).trim()}'`,
      });
      i++;
      continue;
    }

    const [iode, crs, deltaN, m0] = parseFixedFloats(lines[i + 1] ?? "", 3, 19, 4);
    const [cuc, e, cus, sqrtA] = parseFixedFloats(lines[i + 2] ?? "", 3, 19, 4);
    const [toe, cic, omega0, cis] = parseFixedFloats(lines[i + 3] ?? "", 3, 19, 4);
    const [i0, crc, omega, omegaDot] = parseFixedFloats(lines[i + 4] ?? "", 3, 19, 4);
    const [idot, codesL2, gpsWeek, l2pFlag] = parseFixedFloats(lines[i + 5] ?? "", 3, 19, 4);
    const [svAccuracy, svHealth, tgd, iodc] = parseFixedFloats(lines[i + 6] ?? "", 3, 19, 4);
    const [transmissionTime, fitInterval] = parseFixedFloats(lines[i + 7] ?? "", 3, 19, 2);

    const prn = `G${String(prnNum).padStart(2, "0")}`;
    const toc = buildRinexTimestamp(yy, mm, dd, hh, min, Number.isFinite(sec) ? sec : 0);

    ephemerides.push({
      prn,
      prnNumber: prnNum,
      toc,
      af0: af0 ?? 0,
      af1: af1 ?? 0,
      af2: af2 ?? 0,
      iode: iode ?? 0,
      crs: crs ?? 0,
      deltaN: deltaN ?? 0,
      m0: m0 ?? 0,
      cuc: cuc ?? 0,
      e: e ?? 0,
      cus: cus ?? 0,
      sqrtA: sqrtA ?? 0,
      toe: toe ?? 0,
      cic: cic ?? 0,
      omega0: omega0 ?? 0,
      cis: cis ?? 0,
      i0: i0 ?? 0,
      crc: crc ?? 0,
      omega: omega ?? 0,
      omegaDot: omegaDot ?? 0,
      idot: idot ?? 0,
      codesL2: codesL2 ?? 0,
      gpsWeek: gpsWeek ?? toc.gpsWeek,
      l2pFlag: l2pFlag ?? 0,
      svAccuracy: svAccuracy ?? 0,
      svHealth: svHealth ?? 0,
      tgd: tgd ?? 0,
      iodc: iodc ?? 0,
      transmissionTime: transmissionTime ?? 0,
      fitInterval: Number.isFinite(fitInterval) ? fitInterval! : 4,
      line: startLineNo,
    });

    i += 8;
  }

  return ephemerides;
}

/**
 * Parses a RINEX v2 Observation (OBS) or Navigation (NAV) file.
 */
export function parseRinex(content: string): RinexDocument {
  const lines = content.split(/\r?\n/);
  const parseIssues: RinexParseIssue[] = [];
  const { header, bodyStartIndex } = parseHeader(lines, parseIssues);

  let epochs: RinexObsEpoch[] = [];
  let ephemerides: RinexNavEphemeris[] = [];

  if (header.hasEndOfHeader) {
    if (header.fileType === "O") {
      epochs = parseObsBody(lines, bodyStartIndex, header, parseIssues);
    } else if (header.fileType === "N") {
      ephemerides = parseNavBody(lines, bodyStartIndex, parseIssues);
    }
  }

  return {
    fileType: header.fileType,
    header,
    epochs,
    ephemerides,
    parseIssues,
  };
}

/**
 * Parses a RINEX v2 Observation (OBS) file specifically.
 */
export function parseRinexObs(content: string): RinexDocument {
  return parseRinex(content);
}

/**
 * Parses a RINEX v2 Navigation (NAV) file specifically.
 */
export function parseRinexNav(content: string): RinexDocument {
  return parseRinex(content);
}
