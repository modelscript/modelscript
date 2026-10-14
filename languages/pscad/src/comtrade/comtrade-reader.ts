// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * IEEE C37.111 / IEC 60255-24 COMTRADE File Reader.
 *
 * Parses standard COMTRADE configuration (.cfg) and data (.dat) ASCII files,
 * recovering true scaled physical engineering measurements (kV, A, MW).
 */

import type {
  ComtradeAnalogChannel,
  ComtradeConfig,
  ComtradeDigitalChannel,
  ComtradeRecord,
  ComtradeSamplingRate,
} from "./comtrade-types.js";

/**
 * Parses COMTRADE .cfg and .dat ASCII files into a ComtradeRecord.
 */
export function readComtrade(cfgContent: string, datContent: string): ComtradeRecord {
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
  const _nTotal = parseInt(line2Parts[0] || "0", 10);
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

  const config: ComtradeConfig = {
    stationName,
    recordingDeviceId,
    standardVersionYear: versionYear,
    analogChannels,
    digitalChannels,
    lineFrequencyHz,
    samplingRates,
    startTime: new Date(),
    triggerTime: new Date(),
    dataFormat: "ASCII",
    timeMultiplicationFactor: 1.0,
  };

  // Parse .dat file
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
    // Col 0: sample number, Col 1: time in microseconds
    const timeUs = parseFloat(parts[1] || "0");
    timeSec[i] = timeUs * 1e-6; // convert us to seconds

    let col = 2;
    for (const ch of analogChannels) {
      const rawVal = parseFloat(parts[col++] || "0");
      // Scale: Y = a * X + b
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
