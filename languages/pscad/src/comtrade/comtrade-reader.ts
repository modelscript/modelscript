// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * IEEE C37.111-1999 / 2013 & IEC 60255-24 COMTRADE File Reader.
 *
 * Parses standard COMTRADE configuration (.cfg), ASCII and Binary (.dat) files
 * (`ASCII`, `BINARY`, `BINARY32`, `FLOAT32`), and single-file (`.cff`) containers,
 * recovering true scaled physical engineering measurements (kV, A, MW).
 */

import type {
  ComtradeAnalogChannel,
  ComtradeConfig,
  ComtradeDataFormat,
  ComtradeDigitalChannel,
  ComtradeRecord,
  ComtradeSamplingRate,
} from "./comtrade-types.js";

/**
 * Parses COMTRADE .cfg and .dat (ASCII string or Binary `Uint8Array`) into a ComtradeRecord.
 */
export function readComtrade(cfgContent: string, datContent: string | Uint8Array): ComtradeRecord {
  const cfgLines = cfgContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (cfgLines.length < 5) {
    throw new Error("Invalid COMTRADE .cfg file: insufficient lines.");
  }

  // Line 1: Station name, recording device ID, version year
  const line1Parts = cfgLines[0]!.split(",").map((s) => s.trim());
  const stationName = line1Parts[0] || "UnknownStation";
  const recordingDeviceId = line1Parts[1] || "DEV01";
  const versionYear = parseInt(line1Parts[2] || "1999", 10) as 1991 | 1999 | 2013;

  // Line 2: Channel totals: total, ##A, ##D
  const line2Parts = cfgLines[1]!.split(",").map((s) => s.trim());
  const nAnalog = parseInt(line2Parts[1]?.replace(/[^0-9]/g, "") || "0", 10);
  const nDigital = parseInt(line2Parts[2]?.replace(/[^0-9]/g, "") || "0", 10);

  let lineIdx = 2;

  // Parse Analog Channels
  const analogChannels: ComtradeAnalogChannel[] = [];
  for (let i = 0; i < nAnalog; i++) {
    const parts = cfgLines[lineIdx++]!.split(",").map((s) => s.trim());
    analogChannels.push({
      index: parseInt(parts[0] || String(i + 1), 10),
      name: parts[1] || `A_${i + 1}`,
      phase: parts[2] || "",
      circuitComponent: parts[3] || undefined,
      unit: parts[4] || "V",
      multiplierA: parseFloat(parts[5] || "1.0"),
      offsetB: parseFloat(parts[6] || "0.0"),
      skew: parseFloat(parts[7] || "0.0"),
      min: parseFloat(parts[8] || "-32768"),
      max: parseFloat(parts[9] || "32767"),
      primaryRatio: parseFloat(parts[10] || "1.0"),
      secondaryRatio: parseFloat(parts[11] || "1.0"),
      scalingIdentifier: (parts[12]?.toUpperCase() === "S" ? "S" : "P") as "P" | "S",
    });
  }

  // Parse Digital Channels
  const digitalChannels: ComtradeDigitalChannel[] = [];
  for (let i = 0; i < nDigital; i++) {
    const parts = cfgLines[lineIdx++]!.split(",").map((s) => s.trim());
    digitalChannels.push({
      index: parseInt(parts[0] || String(i + 1), 10),
      name: parts[1] || `D_${i + 1}`,
      phase: parts[2] || undefined,
      circuitComponent: parts[3] || undefined,
      normalState: (parseInt(parts[4] || "0", 10) === 1 ? 1 : 0) as 0 | 1,
    });
  }

  // Line Frequency
  const lineFrequencyHz = parseFloat(cfgLines[lineIdx++] || "60.0");

  // Number of Sampling Rates
  const nSamplingRates = parseInt(cfgLines[lineIdx++] || "1", 10);
  const samplingRates: ComtradeSamplingRate[] = [];
  for (let i = 0; i < nSamplingRates; i++) {
    const parts = cfgLines[lineIdx++]!.split(",").map((s) => s.trim());
    samplingRates.push({
      rateHz: parseFloat(parts[0] || "50000.0"),
      lastSampleNumber: parseInt(parts[1] || "1000", 10),
    });
  }

  function parseComtradeTimestamp(line?: string): Date {
    if (!line) return new Date();
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}),\s*(\d{1,2}):(\d{1,2}):(\d{1,2})(?:\.(\d+))?$/.exec(line.trim());
    if (!m) return new Date();
    const day = parseInt(m[1]!, 10);
    const month = parseInt(m[2]!, 10) - 1;
    const year = parseInt(m[3]!, 10);
    const hours = parseInt(m[4]!, 10);
    const minutes = parseInt(m[5]!, 10);
    const seconds = parseInt(m[6]!, 10);
    const fracStr = (m[7] || "0").padEnd(3, "0").slice(0, 3);
    const ms = parseInt(fracStr, 10);
    return new Date(year, month, day, hours, minutes, seconds, ms);
  }

  const startTime = parseComtradeTimestamp(cfgLines[lineIdx++]);
  const triggerTime = parseComtradeTimestamp(cfgLines[lineIdx++]);
  const rawFormat = (cfgLines[lineIdx++]?.trim().toUpperCase() || "ASCII") as ComtradeDataFormat;
  const dataFormat: ComtradeDataFormat =
    rawFormat === "BINARY" || rawFormat === "BINARY32" || rawFormat === "FLOAT32" ? rawFormat : "ASCII";
  const rawTimeMult = parseFloat(cfgLines[lineIdx++] || "1.0");
  const timeMultiplicationFactor = !Number.isNaN(rawTimeMult) && rawTimeMult > 0 ? rawTimeMult : 1.0;

  // Optional IEEE C37.111-2013 extended trailer lines
  let timeCode: string | undefined;
  let localCode: string | undefined;
  let timeQualityIndicatorCode: string | undefined;
  let leapSecIndicator: number | undefined;
  if (lineIdx < cfgLines.length) {
    const tcParts = cfgLines[lineIdx++]!.split(",").map((s) => s.trim());
    timeCode = tcParts[0] || "+00:00";
    localCode = tcParts[1] || "+00:00";
  }
  if (lineIdx < cfgLines.length) {
    const tmqParts = cfgLines[lineIdx++]!.split(",").map((s) => s.trim());
    timeQualityIndicatorCode = tmqParts[0] || "0";
    leapSecIndicator = parseInt(tmqParts[1] || "0", 10);
  }

  const config: ComtradeConfig = {
    stationName,
    recordingDeviceId,
    standardVersionYear: versionYear,
    analogChannels,
    digitalChannels,
    lineFrequencyHz,
    samplingRates,
    startTime,
    triggerTime,
    dataFormat,
    timeMultiplicationFactor,
    timeCode,
    localCode,
    timeQualityIndicatorCode,
    leapSecIndicator,
  };

  if (typeof datContent !== "string") {
    return parseBinaryDat(config, datContent);
  }

  // Parse ASCII .dat file
  const datLines = datContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const nSamples = datLines.length;
  const timeSec = new Float64Array(nSamples);
  const analogData = new Map<string, Float64Array>();
  for (const ch of analogChannels) {
    analogData.set(ch.name, new Float64Array(nSamples));
  }

  const digitalData = new Map<string, Uint8Array>();
  for (const ch of digitalChannels) {
    digitalData.set(ch.name, new Uint8Array(nSamples));
  }

  for (let i = 0; i < nSamples; i++) {
    const parts = datLines[i]!.split(",").map((s) => s.trim());
    const timeUs = parseFloat(parts[1] || "0");
    // Convert timestamp from scaled microseconds to seconds: t_sec = t_raw * timeMult * 1e-6
    timeSec[i] = timeUs * timeMultiplicationFactor * 1e-6;

    let col = 2;
    for (const ch of analogChannels) {
      const rawVal = parseFloat(parts[col++] || "0");
      // IEEE C37.111 linear scaling conversion: y = a * x + b
      const physicalVal = ch.multiplierA * rawVal + ch.offsetB;
      analogData.get(ch.name)![i] = physicalVal;
    }

    for (const ch of digitalChannels) {
      const digVal = parseInt(parts[col++] || "0", 10);
      digitalData.get(ch.name)![i] = digVal === 1 ? 1 : 0;
    }
  }

  return {
    config,
    timeSec,
    analogData,
    digitalData,
  };
}

/**
 * Decodes an IEEE C37.111 binary `.dat` payload (`BINARY` 16-bit int, `BINARY32` 32-bit int, or `FLOAT32`)
 * into scaled physical engineering units and unpacked digital status channels.
 */
function parseBinaryDat(config: ComtradeConfig, bytes: Uint8Array): ComtradeRecord {
  const format = config.dataFormat === "ASCII" ? "BINARY" : config.dataFormat;
  const nAnalog = config.analogChannels.length;
  const nDigital = config.digitalChannels.length;
  // Each sample contains: 4B sample index + 4B timestamp + nAnalog*(2B or 4B) + ceil(nDigital/16)*2B status words
  const analogBytesPerCh = format === "BINARY" ? 2 : 4;
  const statusWordsPerSample = Math.ceil(nDigital / 16);
  const bytesPerSample = 8 + nAnalog * analogBytesPerCh + statusWordsPerSample * 2;

  const nSamples = bytesPerSample > 0 ? Math.floor(bytes.byteLength / bytesPerSample) : 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const timeSec = new Float64Array(nSamples);
  const analogData = new Map<string, Float64Array>();
  for (const ch of config.analogChannels) {
    analogData.set(ch.name, new Float64Array(nSamples));
  }
  const digitalData = new Map<string, Uint8Array>();
  for (const ch of config.digitalChannels) {
    digitalData.set(ch.name, new Uint8Array(nSamples));
  }

  let offset = 0;
  for (let i = 0; i < nSamples; i++) {
    // Skip 4-byte little-endian sample number (uint32) and read 4-byte timestamp (uint32)
    offset += 4;
    const timeUs = view.getUint32(offset, true);
    offset += 4;

    timeSec[i] = timeUs * config.timeMultiplicationFactor * 1e-6;

    for (let c = 0; c < nAnalog; c++) {
      const ch = config.analogChannels[c]!;
      let rawVal = 0;
      if (format === "BINARY") {
        rawVal = view.getInt16(offset, true);
        offset += 2;
      } else if (format === "BINARY32") {
        rawVal = view.getInt32(offset, true);
        offset += 4;
      } else {
        rawVal = view.getFloat32(offset, true);
        offset += 4;
      }
      analogData.get(ch.name)![i] = ch.multiplierA * rawVal + ch.offsetB;
    }

    // Unpack 16-bit little-endian status words (LSB = first digital channel in group of 16)
    for (let w = 0; w < statusWordsPerSample; w++) {
      const word = view.getUint16(offset, true);
      offset += 2;
      for (let bit = 0; bit < 16; bit++) {
        const dIdx = w * 16 + bit;
        if (dIdx < nDigital) {
          const chName = config.digitalChannels[dIdx]!.name;
          digitalData.get(chName)![i] = (word & (1 << bit)) !== 0 ? 1 : 0;
        }
      }
    }
  }

  return {
    config,
    timeSec,
    analogData,
    digitalData,
  };
}

/**
 * Parses an IEEE C37.111-2013 Annex B Single-File Common Format (`.cff`) string into a ComtradeRecord.
 */
export function readComtradeCff(cffContent: string): ComtradeRecord {
  const sectionLines: { CFG: string[]; INF: string[]; DAT: string[] } = { CFG: [], INF: [], DAT: [] };
  let currentSection: "CFG" | "INF" | "DAT" | null = null;

  for (const rawLine of cffContent.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    const headerMatch = /^---\s*file\s+type:\s*([A-Za-z0-9]+)(?:\s+ASCII)?\s*---$/i.exec(trimmed);
    if (headerMatch) {
      const type = headerMatch[1]!.toUpperCase();
      currentSection = type === "CFG" || type === "INF" || type === "DAT" ? type : null;
      continue;
    }
    if (currentSection) {
      sectionLines[currentSection].push(rawLine);
    }
  }

  const cfgText = sectionLines.CFG.join("\n");
  const infText = sectionLines.INF.join("\n");
  const datText = sectionLines.DAT.join("\n");

  if (!cfgText.trim() || !datText.trim()) {
    throw new Error("Invalid COMTRADE .cff file: missing CFG or DAT section.");
  }

  const record = readComtrade(cfgText, datText);
  if (infText.trim()) {
    record.infoText = infText.trim();
  }
  return record;
}
