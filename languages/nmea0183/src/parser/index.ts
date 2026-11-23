// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * NMEA 0183 Marine & GPS ASCII Telemetry Parser.
 *
 * Supports `$` and `!` sentences, 2-character talker IDs, 3-character formatters
 * (`GGA`, `RMC`, `GSA`, `GSV`, `VTG`, `HDG`, `DBT`, `MWV`), comma-separated fields,
 * `*XX` hex XOR checksums, and `ddmm.mmmm` / `dddmm.mmmm` coordinate decoding.
 */

import type {
  Nmea0183Document,
  NmeaDbtPayload,
  NmeaDecodedPayload,
  NmeaDelimiter,
  NmeaGgaPayload,
  NmeaGsaPayload,
  NmeaGsvPayload,
  NmeaHdgPayload,
  NmeaMwvPayload,
  NmeaParseError,
  NmeaRmcPayload,
  NmeaSatelliteInfo,
  NmeaSentence,
  NmeaVtgPayload,
} from "../types.js";

export const KNOWN_NMEA_TALKERS: Readonly<Record<string, string>> = {
  GP: "Global Positioning System (GPS)",
  GN: "Combined GNSS (GPS + GLONASS + Galileo + BeiDou)",
  GL: "GLONASS Receiver",
  GA: "Galileo Positioning System",
  GB: "BeiDou Navigation Satellite System",
  BD: "BeiDou Navigation Satellite System (Legacy)",
  GQ: "QZSS Regional Navigation Satellite System",
  HC: "Heading — Magnetic Compass",
  HE: "Heading — North-Seeking Gyro",
  HN: "Heading — Non-North-Seeking Gyro",
  SD: "Depth Sounder",
  II: "Integrated Instrumentation",
  IN: "Integrated Navigation",
  AI: "Automatic Identification System (AIS) Mobile",
  WI: "Weather Instruments",
  EC: "Electronic Chart Display & Information System (ECDIS)",
  VD: "Velocity Sensor — Doppler",
  VW: "Velocity Sensor — Speed Log, Water",
  YX: "Transducer",
};

export const KNOWN_NMEA_FORMATTERS: Readonly<Record<string, string>> = {
  GGA: "Global Positioning System Fix Data",
  RMC: "Recommended Minimum Specific GNSS Data",
  GSA: "GNSS DOP and Active Satellites",
  GSV: "GNSS Satellites in View",
  VTG: "Course Over Ground and Ground Speed",
  HDG: "Heading, Deviation and Variation",
  DBT: "Depth Below Transducer",
  MWV: "Wind Speed and Angle",
};

/**
 * Computes the NMEA 0183 8-bit XOR checksum over all characters in `payload`
 * (everything between `$`/`!` and `*`, exclusive). Returns 2-char uppercase hex.
 */
export function computeNmeaChecksum(payload: string): string {
  let xor = 0;
  for (let i = 0; i < payload.length; i++) {
    xor ^= payload.charCodeAt(i) & 0xff;
  }
  return xor.toString(16).toUpperCase().padStart(2, "0");
}

/**
 * Appends `*XX` XOR checksum to an NMEA 0183 sentence body (with or without leading `$`/`!`).
 */
export function appendNmeaChecksum(sentenceWithoutChecksum: string): string {
  const trimmed = sentenceWithoutChecksum.trim().replace(/\*[0-9A-Fa-f]{0,2}$/, "");
  const delim = trimmed.startsWith("$") || trimmed.startsWith("!") ? trimmed[0]! : "$";
  const body = trimmed.startsWith("$") || trimmed.startsWith("!") ? trimmed.slice(1) : trimmed;
  return `${delim}${body}*${computeNmeaChecksum(body)}`;
}

/**
 * Verifies the `*XX` XOR checksum of a raw NMEA 0183 sentence.
 */
export function verifyNmeaChecksum(raw: string): {
  hasChecksum: boolean;
  valid: boolean;
  expected: string;
  actual?: string | undefined;
} {
  const line = raw.trim();
  const startIdx = line.startsWith("$") || line.startsWith("!") ? 1 : 0;
  const starIdx = line.indexOf("*");
  if (starIdx === -1) {
    const expected = computeNmeaChecksum(line.slice(startIdx));
    return { hasChecksum: false, valid: false, expected };
  }
  const body = line.slice(startIdx, starIdx);
  const actual = line
    .slice(starIdx + 1)
    .trim()
    .toUpperCase();
  const expected = computeNmeaChecksum(body);
  return {
    hasChecksum: true,
    valid: /^[0-9A-F]{2}$/.test(actual) && actual === expected,
    expected,
    actual,
  };
}

/**
 * Parses an optional finite floating-point field.
 */
export function parseOptionalFloat(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const s = raw.trim();
  if (!s) return undefined;
  const v = Number(s);
  return Number.isFinite(v) ? v : undefined;
}

/**
 * Parses an optional base-10 integer field.
 */
export function parseOptionalInt(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const s = raw.trim();
  if (!s || !/^[+-]?\d+$/.test(s)) return undefined;
  const v = Number.parseInt(s, 10);
  return Number.isFinite(v) ? v : undefined;
}

/**
 * Converts NMEA 0183 `ddmm.mmmm` (latitude) or `dddmm.mmmm` (longitude) + hemisphere (`N`/`S`/`E`/`W`)
 * to signed decimal degrees. Returns `undefined` if empty or invalid.
 */
export function ddmmToDecimalDegrees(
  ddmm: string | undefined,
  hemisphere: string | undefined,
  isLongitude: boolean = false,
): number | undefined {
  if (!ddmm || !hemisphere) return undefined;
  const s = ddmm.trim();
  const h = hemisphere.trim().toUpperCase();
  if (!s || !h) return undefined;

  if (isLongitude) {
    if (h !== "E" && h !== "W") return undefined;
  } else {
    if (h !== "N" && h !== "S") return undefined;
  }

  if (!/^\d{4,5}(?:\.\d+)?$/.test(s)) return undefined;

  const dotIdx = s.indexOf(".");
  const intPart = dotIdx === -1 ? s : s.slice(0, dotIdx);
  if (intPart.length < 3) return undefined;

  const degDigits = intPart.length - 2;
  const deg = Number.parseInt(intPart.slice(0, degDigits), 10);
  const min = Number.parseFloat(s.slice(degDigits));

  if (!Number.isFinite(deg) || !Number.isFinite(min)) return undefined;
  if (min < 0 || min >= 60) return undefined;

  const decimal = deg + min / 60;
  const maxAbs = isLongitude ? 180 : 90;
  if (decimal > maxAbs) return undefined;

  return h === "S" || h === "W" ? -decimal : decimal;
}

/**
 * Converts signed decimal degrees to NMEA 0183 `ddmm.mmmm` / `dddmm.mmmm` + hemisphere.
 */
export function decimalDegreesToDdmm(
  deg: number,
  isLongitude: boolean = false,
  decimals: number = 4,
): { value: string; hemisphere: string } {
  const hemisphere = isLongitude ? (deg < 0 ? "W" : "E") : deg < 0 ? "S" : "N";
  const absDeg = Math.abs(deg);
  const d = Math.floor(absDeg);
  const m = (absDeg - d) * 60;
  const dStr = String(d).padStart(isLongitude ? 3 : 2, "0");
  const mInt = Math.floor(m);
  const mFrac = m - mInt;
  const mStr = String(mInt).padStart(2, "0") + mFrac.toFixed(decimals).slice(1);
  return { value: `${dStr}${mStr}`, hemisphere };
}

/**
 * Parses NMEA 0183 UTC timestamp `hhmmss` or `hhmmss.sss` into seconds since midnight UTC.
 */
export function parseUtcTime(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  const m = /^(\d{2})(\d{2})(\d{2}(?:\.\d+)?)$/.exec(s);
  if (!m) return undefined;
  const hh = Number.parseInt(m[1]!, 10);
  const mm = Number.parseInt(m[2]!, 10);
  const ss = Number.parseFloat(m[3]!);
  if (hh > 23 || mm > 59 || ss >= 61) return undefined;
  return hh * 3600 + mm * 60 + ss;
}

function decodeGga(fields: string[]): NmeaGgaPayload {
  const utcRaw = fields[0] ?? "";
  const latRaw = fields[1] ?? "";
  const latHemi = fields[2] ?? "";
  const lonRaw = fields[3] ?? "";
  const lonHemi = fields[4] ?? "";
  const fixQuality = parseOptionalInt(fields[5]) ?? 0;
  const satellitesUsed = parseOptionalInt(fields[6]);
  const hdop = parseOptionalFloat(fields[7]);
  const altitudeM = parseOptionalFloat(fields[8]);
  const geoidSeparationM = parseOptionalFloat(fields[10]);

  return {
    kind: "GGA",
    utcRaw,
    utcSeconds: parseUtcTime(utcRaw),
    latRaw,
    latHemi,
    latitudeDeg: ddmmToDecimalDegrees(latRaw, latHemi, false),
    lonRaw,
    lonHemi,
    longitudeDeg: ddmmToDecimalDegrees(lonRaw, lonHemi, true),
    fixQuality,
    satellitesUsed,
    hdop,
    altitudeM,
    geoidSeparationM,
  };
}

function decodeRmc(fields: string[]): NmeaRmcPayload {
  const utcRaw = fields[0] ?? "";
  const status = (fields[1] ?? "").trim().toUpperCase();
  const latRaw = fields[2] ?? "";
  const latHemi = fields[3] ?? "";
  const lonRaw = fields[4] ?? "";
  const lonHemi = fields[5] ?? "";
  const speedKnots = parseOptionalFloat(fields[6]);
  const courseDeg = parseOptionalFloat(fields[7]);
  const dateRaw = fields[8] ?? "";
  const magneticVariationDeg = parseOptionalFloat(fields[9]);
  const magneticVariationDir = fields[10] ? fields[10].trim().toUpperCase() : undefined;
  const modeIndicator = fields[11] ? fields[11].trim().toUpperCase() : undefined;

  return {
    kind: "RMC",
    utcRaw,
    utcSeconds: parseUtcTime(utcRaw),
    status,
    latRaw,
    latHemi,
    latitudeDeg: ddmmToDecimalDegrees(latRaw, latHemi, false),
    lonRaw,
    lonHemi,
    longitudeDeg: ddmmToDecimalDegrees(lonRaw, lonHemi, true),
    speedKnots,
    courseDeg,
    dateRaw,
    magneticVariationDeg,
    magneticVariationDir,
    modeIndicator,
  };
}

function decodeGsa(fields: string[]): NmeaGsaPayload {
  const selectionMode = (fields[0] ?? "").trim().toUpperCase();
  const fixType = parseOptionalInt(fields[1]) ?? 1;
  const satellitePrns: number[] = [];
  for (let i = 2; i <= 13 && i < fields.length; i++) {
    const prn = parseOptionalInt(fields[i]);
    if (prn !== undefined) satellitePrns.push(prn);
  }
  const pdop = parseOptionalFloat(fields[14]);
  const hdop = parseOptionalFloat(fields[15]);
  const vdop = parseOptionalFloat(fields[16]);

  return {
    kind: "GSA",
    selectionMode,
    fixType,
    satellitePrns,
    pdop,
    hdop,
    vdop,
  };
}

function decodeGsv(talker: string, fields: string[], line: number): NmeaGsvPayload {
  const totalMessages = parseOptionalInt(fields[0]) ?? 1;
  const messageNumber = parseOptionalInt(fields[1]) ?? 1;
  const satellitesInView = parseOptionalInt(fields[2]) ?? 0;
  const satellites: NmeaSatelliteInfo[] = [];

  for (let i = 3; i + 3 < fields.length; i += 4) {
    const prn = parseOptionalInt(fields[i]);
    if (prn === undefined) continue;
    const elevationDeg = parseOptionalFloat(fields[i + 1]);
    const azimuthDeg = parseOptionalFloat(fields[i + 2]);
    const snrDbHz = parseOptionalFloat(fields[i + 3]);
    satellites.push({
      talker,
      prn,
      elevationDeg,
      azimuthDeg,
      snrDbHz,
      line,
    });
  }

  return {
    kind: "GSV",
    totalMessages,
    messageNumber,
    satellitesInView,
    satellites,
  };
}

function decodeVtg(fields: string[]): NmeaVtgPayload {
  return {
    kind: "VTG",
    courseTrueDeg: parseOptionalFloat(fields[0]),
    courseMagneticDeg: parseOptionalFloat(fields[2]),
    speedKnots: parseOptionalFloat(fields[4]),
    speedKmh: parseOptionalFloat(fields[6]),
    modeIndicator: fields[8] ? fields[8].trim().toUpperCase() : undefined,
  };
}

function decodeHdg(fields: string[]): NmeaHdgPayload {
  return {
    kind: "HDG",
    headingMagneticDeg: parseOptionalFloat(fields[0]),
    deviationDeg: parseOptionalFloat(fields[1]),
    deviationDir: fields[2] ? fields[2].trim().toUpperCase() : undefined,
    variationDeg: parseOptionalFloat(fields[3]),
    variationDir: fields[4] ? fields[4].trim().toUpperCase() : undefined,
  };
}

function decodeDbt(fields: string[]): NmeaDbtPayload {
  return {
    kind: "DBT",
    depthFeet: parseOptionalFloat(fields[0]),
    depthMeters: parseOptionalFloat(fields[2]),
    depthFathoms: parseOptionalFloat(fields[4]),
  };
}

function decodeMwv(fields: string[]): NmeaMwvPayload {
  return {
    kind: "MWV",
    windAngleDeg: parseOptionalFloat(fields[0]),
    reference: (fields[1] ?? "").trim().toUpperCase(),
    windSpeed: parseOptionalFloat(fields[2]),
    windSpeedUnits: (fields[3] ?? "").trim().toUpperCase(),
    status: (fields[4] ?? "").trim().toUpperCase(),
  };
}

function decodePayload(talker: string, formatter: string, fields: string[], line: number): NmeaDecodedPayload {
  switch (formatter) {
    case "GGA":
      return decodeGga(fields);
    case "RMC":
      return decodeRmc(fields);
    case "GSA":
      return decodeGsa(fields);
    case "GSV":
      return decodeGsv(talker, fields, line);
    case "VTG":
      return decodeVtg(fields);
    case "HDG":
      return decodeHdg(fields);
    case "DBT":
      return decodeDbt(fields);
    case "MWV":
      return decodeMwv(fields);
    default:
      return { kind: "GENERIC", fields };
  }
}

/**
 * Parses an NMEA 0183 ASCII telemetry stream into a typed `Nmea0183Document`.
 */
export function parseNmea0183(source: string): Nmea0183Document {
  const sentences: NmeaSentence[] = [];
  const parseErrors: NmeaParseError[] = [];
  const satelliteMap = new Map<string, NmeaSatelliteInfo>();
  const talkerSet = new Set<string>();
  const formatterSet = new Set<string>();

  let offset = 0;
  const rawLines = source.split(/\r?\n/);

  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i] ?? "";
    const lineNum = i + 1;
    const lineStart = offset;
    // Account for newline length in original source
    const nextNewlineIdx = source.indexOf("\n", offset);
    const lineEnd = nextNewlineIdx === -1 ? source.length : nextNewlineIdx;
    offset = nextNewlineIdx === -1 ? source.length : nextNewlineIdx + 1;

    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (!trimmed.startsWith("$") && !trimmed.startsWith("!")) {
      parseErrors.push({
        line: lineNum,
        startOffset: lineStart,
        endOffset: lineEnd,
        raw: trimmed,
        message: `Expected NMEA 0183 sentence starting with '$' or '!', found '${trimmed.slice(0, 12)}'.`,
      });
      continue;
    }

    const delimiter = trimmed[0] as NmeaDelimiter;
    const starIdx = trimmed.indexOf("*");
    const body = starIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, starIdx);
    const checksumProvided =
      starIdx === -1
        ? undefined
        : trimmed
            .slice(starIdx + 1)
            .trim()
            .toUpperCase();
    const checksumComputed = computeNmeaChecksum(body);
    const checksumValid =
      checksumProvided !== undefined && /^[0-9A-F]{2}$/.test(checksumProvided) && checksumProvided === checksumComputed;

    const parts = body.split(",");
    const address = (parts[0] ?? "").trim().toUpperCase();

    if (!/^[A-Z0-9]{5}$/.test(address)) {
      parseErrors.push({
        line: lineNum,
        startOffset: lineStart,
        endOffset: lineEnd,
        raw: trimmed,
        message: `Invalid NMEA 0183 address '${address}'; expected 2-char talker + 3-char formatter (e.g. 'GPGGA').`,
      });
      continue;
    }

    const talker = address.slice(0, 2);
    const formatter = address.slice(2, 5);
    const fields = parts.slice(1);
    const payload = decodePayload(talker, formatter, fields, lineNum);

    talkerSet.add(talker);
    formatterSet.add(formatter);

    if (payload.kind === "GSV") {
      for (const sat of payload.satellites) {
        satelliteMap.set(`${sat.talker}:${sat.prn}`, sat);
      }
    }

    sentences.push({
      index: sentences.length,
      line: lineNum,
      startOffset: lineStart,
      endOffset: lineEnd,
      raw: trimmed,
      delimiter,
      talker,
      formatter,
      address,
      fields,
      checksumProvided,
      checksumComputed,
      checksumValid,
      payload,
    });
  }

  return {
    sentences,
    parseErrors,
    satellites: Array.from(satelliteMap.values()),
    talkers: Array.from(talkerSet),
    formatters: Array.from(formatterSet),
  };
}
