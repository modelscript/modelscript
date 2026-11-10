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
} from "../types.js";

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

/**
 * Parses COMTRADE .cfg header content into a strongly-typed ComtradeConfig object.
 */
export function parseComtradeConfig(cfgContent: string): ComtradeConfig {
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
  const totalChannelsDeclared = parseInt(line2Parts[0] || "0", 10);
  const nAnalog = parseInt(line2Parts[1]?.replace(/[^0-9]/g, "") || "0", 10);
  const nDigital = parseInt(line2Parts[2]?.replace(/[^0-9]/g, "") || "0", 10);

  let lineIdx = 2;

  // Parse Analog Channels
  const analogChannels: ComtradeAnalogChannel[] = [];
  for (let i = 0; i < nAnalog; i++) {
    const parts = cfgLines[lineIdx++]!.split(",").map((s) => s.trim());
    const chName = parts[1] || `A_${i + 1}`;
    const unit = parts[4] || "V";
    const multA = parseFloat(parts[5] || "1.0");
    const offB = parseFloat(parts[6] || "0.0");
    const minVal = parseFloat(parts[8] || "-32768");
    const maxVal = parseFloat(parts[9] || "32767");
    const primary = parseFloat(parts[10] || "1.0");
    const secondary = parseFloat(parts[11] || "1.0");
    const scaling = (parts[12]?.toUpperCase() === "S" ? "S" : "P") as "P" | "S";

    analogChannels.push({
      index: parseInt(parts[0] || String(i + 1), 10),
      name: chName,
      chId: chName,
      phase: parts[2] || "",
      circuitComponent: parts[3] || undefined,
      ccbm: parts[3] || undefined,
      unit,
      uu: unit,
      multiplierA: multA,
      a: multA,
      offsetB: offB,
      b: offB,
      skew: parseFloat(parts[7] || "0.0"),
      min: minVal,
      minVal,
      max: maxVal,
      maxVal,
      primaryRatio: primary,
      primary,
      secondaryRatio: secondary,
      secondary,
      scalingIdentifier: scaling,
      scaling,
    });
  }

  // Parse Digital Channels
  const digitalChannels: ComtradeDigitalChannel[] = [];
  for (let i = 0; i < nDigital; i++) {
    const parts = cfgLines[lineIdx++]!.split(",").map((s) => s.trim());
    const dName = parts[1] || `D_${i + 1}`;
    const norm = (parseInt(parts[4] || "0", 10) === 1 ? 1 : 0) as 0 | 1;
    digitalChannels.push({
      index: parseInt(parts[0] || String(i + 1), 10),
      name: dName,
      chId: dName,
      phase: parts[2] || undefined,
      circuitComponent: parts[3] || undefined,
      ccbm: parts[3] || undefined,
      normalState: norm,
    });
  }

  // Line Frequency
  const lineFrequencyHz = parseFloat(cfgLines[lineIdx++] || "60.0");

  // Number of Sampling Rates
  const nSamplingRates = parseInt(cfgLines[lineIdx++] || "1", 10);
  const samplingRates: ComtradeSamplingRate[] = [];
  for (let i = 0; i < nSamplingRates; i++) {
    const parts = cfgLines[lineIdx++]!.split(",").map((s) => s.trim());
    const rateHz = parseFloat(parts[0] || "50000.0");
    const lastSampleNumber = parseInt(parts[1] || "1000", 10);
    samplingRates.push({
      rateHz,
      rate: rateHz,
      lastSampleNumber,
    });
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
    recDevId: recordingDeviceId,
    standardVersionYear: versionYear,
    revYear: versionYear,
    totalChannels: totalChannelsDeclared > 0 ? totalChannelsDeclared : nAnalog + nDigital,
    analogCount: nAnalog,
    digitalCount: nDigital,
    analogChannels,
    analogs: analogChannels,
    digitalChannels,
    digitals: digitalChannels,
    lineFrequencyHz,
    nominalFrequency: lineFrequencyHz,
    samplingRates,
    sampleRates: samplingRates,
    sampleRateCount: samplingRates.length,
    startTime,
    triggerTime,
    dataFormat,
    fileType: dataFormat,
    timeMultiplicationFactor,
    timeMult: timeMultiplicationFactor,
    timeCode,
    localCode,
    timeQualityIndicatorCode,
    leapSecIndicator,
  };

  return config;
}

export const parseComtradeCfg = parseComtradeConfig;

/**
 * Parses ASCII .dat file using a parsed ComtradeConfig.
 */
export function parseComtradeDatAscii(datContent: string, config: ComtradeConfig): ComtradeRecord {
  const datLines = datContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const nSamples = datLines.length;
  const timeSec = new Float64Array(nSamples);
  const timeMult = config.timeMultiplicationFactor > 0 ? config.timeMultiplicationFactor : 1.0;

  const analogMap = new Map<string, Float64Array>();
  const analogArrays: Float64Array[] = [];
  for (const ch of config.analogChannels) {
    const arr = new Float64Array(nSamples);
    analogMap.set(ch.name, arr);
    analogArrays.push(arr);
  }

  const digitalMap = new Map<string, Uint8Array>();
  const digitalArrays: Uint8Array[] = [];
  for (const ch of config.digitalChannels) {
    const arr = new Uint8Array(nSamples);
    digitalMap.set(ch.name, arr);
    digitalArrays.push(arr);
  }

  const analogList: number[][] = config.analogChannels.map(() => []);
  const digitalList: number[][] = config.digitalChannels.map(() => []);
  const timestamps: number[] = [];

  for (let i = 0; i < nSamples; i++) {
    const parts = datLines[i]!.split(",").map((s) => s.trim());
    const timeUs = parseFloat(parts[1] || "0");
    const tSec = timeUs * timeMult * 1e-6;
    timeSec[i] = tSec;
    timestamps.push(tSec);

    let col = 2;
    for (let a = 0; a < config.analogChannels.length; a++) {
      const ch = config.analogChannels[a]!;
      const rawVal = parseFloat(parts[col++] || "0");
      const physicalVal = ch.multiplierA * rawVal + ch.offsetB;
      analogArrays[a]![i] = physicalVal;
      analogList[a]!.push(physicalVal);
    }

    for (let d = 0; d < config.digitalChannels.length; d++) {
      const digVal = parseInt(parts[col++] || "0", 10);
      const val = digVal === 1 ? 1 : 0;
      digitalArrays[d]![i] = val;
      digitalList[d]!.push(val);
    }
  }

  const record: ComtradeRecord = {
    config,
    cfg: config,
    timeSec,
    timestamps,
    analogData: analogMap,
    digitalData: digitalMap,
  };

  // Provide array-like access on analogData / digitalData for backward compatibility
  for (let a = 0; a < analogList.length; a++) {
    (record.analogData as any)[a] = analogList[a];
  }
  for (let d = 0; d < digitalList.length; d++) {
    (record.digitalData as any)[d] = digitalList[d];
  }

  return record;
}

/**
 * Decodes an IEEE C37.111 binary `.dat` payload (`BINARY` 16-bit int, `BINARY32` 32-bit int, or `FLOAT32`).
 */
export function parseComtradeDatBinary(bytes: Uint8Array, config: ComtradeConfig): ComtradeRecord {
  const format = config.dataFormat === "ASCII" ? "BINARY" : config.dataFormat;
  const nAnalog = config.analogChannels.length;
  const nDigital = config.digitalChannels.length;
  const analogBytesPerCh = format === "BINARY" ? 2 : 4;
  const statusWordsPerSample = Math.ceil(nDigital / 16);
  const bytesPerSample = 8 + nAnalog * analogBytesPerCh + statusWordsPerSample * 2;

  const nSamples = bytesPerSample > 0 ? Math.floor(bytes.byteLength / bytesPerSample) : 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const timeSec = new Float64Array(nSamples);
  const timestamps: number[] = [];
  const timeMult = config.timeMultiplicationFactor > 0 ? config.timeMultiplicationFactor : 1.0;

  const analogMap = new Map<string, Float64Array>();
  const analogList: number[][] = config.analogChannels.map(() => []);
  for (const ch of config.analogChannels) {
    analogMap.set(ch.name, new Float64Array(nSamples));
  }
  const digitalMap = new Map<string, Uint8Array>();
  const digitalList: number[][] = config.digitalChannels.map(() => []);
  for (const ch of config.digitalChannels) {
    digitalMap.set(ch.name, new Uint8Array(nSamples));
  }

  let offset = 0;
  for (let i = 0; i < nSamples; i++) {
    offset += 4; // skip sample number
    const timeUs = view.getUint32(offset, true);
    offset += 4;

    const tSec = timeUs * timeMult * 1e-6;
    timeSec[i] = tSec;
    timestamps.push(tSec);

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
      const val = ch.multiplierA * rawVal + ch.offsetB;
      analogMap.get(ch.name)![i] = val;
      analogList[c]!.push(val);
    }

    for (let w = 0; w < statusWordsPerSample; w++) {
      const word = view.getUint16(offset, true);
      offset += 2;
      for (let bit = 0; bit < 16; bit++) {
        const dIdx = w * 16 + bit;
        if (dIdx < nDigital) {
          const chName = config.digitalChannels[dIdx]!.name;
          const val: 0 | 1 = (word & (1 << bit)) !== 0 ? 1 : 0;
          digitalMap.get(chName)![i] = val;
          digitalList[dIdx]!.push(val);
        }
      }
    }
  }

  const record: ComtradeRecord = {
    config,
    cfg: config,
    timeSec,
    timestamps,
    analogData: analogMap,
    digitalData: digitalMap,
  };

  for (let a = 0; a < analogList.length; a++) {
    (record.analogData as any)[a] = analogList[a];
  }
  for (let d = 0; d < digitalList.length; d++) {
    (record.digitalData as any)[d] = digitalList[d];
  }

  return record;
}

/**
 * Parses COMTRADE .cfg and .dat (ASCII string or Binary `Uint8Array`) into a ComtradeRecord.
 */
export function readComtrade(cfgContent: string, datContent: string | Uint8Array): ComtradeRecord {
  const config = parseComtradeConfig(cfgContent);
  if (typeof datContent === "string") {
    return parseComtradeDatAscii(datContent, config);
  }
  return parseComtradeDatBinary(datContent, config);
}

export const parseComtrade = readComtrade;

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

export const parseComtradeCff = readComtradeCff;
