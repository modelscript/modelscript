// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * IEEE C37.111-1999 / IEC 60255-24 COMTRADE File Writer.
 *
 * Serializes electrical transient simulation trajectories into standard
 * COMTRADE configuration (.cfg) and data (.dat) ASCII files.
 */

import type { ComtradeRecord } from "./comtrade-types.js";

function formatDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function formatTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const us = String(d.getMilliseconds() * 1000).padStart(6, "0");
  return `${hh}:${mm}:${ss}.${us}`;
}

/**
 * Exports a ComtradeRecord to ASCII .cfg and .dat strings.
 */
export function writeComtrade(record: ComtradeRecord): { cfg: string; dat: string } {
  const cfg = record.config;
  const nAnalog = cfg.analogChannels.length;
  const nDigital = cfg.digitalChannels.length;
  const nTotal = nAnalog + nDigital;
  const nSamples = record.timeSec.length;

  // 1. Build .cfg string
  const cfgLines: string[] = [];
  cfgLines.push(`${cfg.stationName},${cfg.recordingDeviceId},${cfg.standardVersionYear}`);
  cfgLines.push(`${nTotal},${nAnalog}A,${nDigital}D`);

  // Analog channel definitions
  for (const ch of cfg.analogChannels) {
    cfgLines.push(
      `${ch.index},${ch.name},${ch.phase},${ch.circuitComponent ?? ""},${ch.unit},${ch.multiplierA},${ch.offsetB},${ch.skew},${ch.min},${ch.max},${ch.primaryRatio},${ch.secondaryRatio},${ch.scalingIdentifier}`,
    );
  }

  // Digital channel definitions
  for (const ch of cfg.digitalChannels) {
    cfgLines.push(`${ch.index},${ch.name},${ch.phase ?? ""},${ch.circuitComponent ?? ""},${ch.normalState}`);
  }

  // Line frequency
  cfgLines.push(`${cfg.lineFrequencyHz.toFixed(1)}`);

  // Sampling rates
  cfgLines.push(`${cfg.samplingRates.length}`);
  for (const sr of cfg.samplingRates) {
    cfgLines.push(`${sr.rateHz.toFixed(1)},${sr.lastSampleNumber}`);
  }

  // Timestamps
  cfgLines.push(`${formatDate(cfg.startTime)},${formatTime(cfg.startTime)}`);
  cfgLines.push(`${formatDate(cfg.triggerTime)},${formatTime(cfg.triggerTime)}`);

  // Data format & scaling
  cfgLines.push("ASCII");
  cfgLines.push(`${cfg.timeMultiplicationFactor.toFixed(1)}`);

  const cfgContent = cfgLines.join("\n") + "\n";

  // 2. Build .dat string
  const datLines: string[] = [];
  const analogArrays: Float64Array[] = cfg.analogChannels.map(
    (ch) => record.analogData.get(ch.name) ?? new Float64Array(nSamples),
  );

  for (let i = 0; i < nSamples; i++) {
    const sampleNum = i + 1;
    const timeUs = Math.round(record.timeSec[i]! * 1e6); // Microseconds
    const rowVals: string[] = [String(sampleNum), String(timeUs)];

    for (let c = 0; c < nAnalog; c++) {
      const ch = cfg.analogChannels[c]!;
      const val = analogArrays[c]![i]!;
      // Unscale to raw integer if multiplier != 1, or keep standard precision
      const rawVal = ch.multiplierA !== 0 ? Math.round((val - ch.offsetB) / ch.multiplierA) : Math.round(val);
      rowVals.push(String(rawVal));
    }

    datLines.push(rowVals.join(","));
  }

  const datContent = datLines.join("\n") + "\n";

  return {
    cfg: cfgContent,
    dat: datContent,
  };
}

export interface SimulationResultLike {
  time: Float64Array;
  busVoltages: Map<string, Float64Array>;
  branchCurrents?: Map<string, Float64Array>;
}

/**
 * Converts an EMT simulation result directly into a ComtradeRecord.
 */
export function emtResultToComtrade(
  result: SimulationResultLike,
  stationName: string = "ModelScript_Station",
  recordingDevId: string = "EMT01",
): ComtradeRecord {
  const analogChannels: any[] = [];
  const analogData = new Map<string, Float64Array>();
  let chIdx = 1;

  for (const [busName, vArray] of result.busVoltages) {
    const chName = `V_${busName}`;
    analogChannels.push({
      index: chIdx++,
      name: chName,
      phase: "A",
      circuitComponent: busName,
      unit: "V",
      multiplierA: 1.0,
      offsetB: 0.0,
      skew: 0.0,
      min: -1e6,
      max: 1e6,
      primaryRatio: 1.0,
      secondaryRatio: 1.0,
      scalingIdentifier: "P",
    });
    analogData.set(chName, vArray);
  }

  if (result.branchCurrents) {
    for (const [branchId, iArray] of result.branchCurrents) {
      const chName = `I_${branchId}`;
      analogChannels.push({
        index: chIdx++,
        name: chName,
        phase: "A",
        circuitComponent: branchId,
        unit: "A",
        multiplierA: 1.0,
        offsetB: 0.0,
        skew: 0.0,
        min: -1e5,
        max: 1e5,
        primaryRatio: 1.0,
        secondaryRatio: 1.0,
        scalingIdentifier: "P",
      });
      analogData.set(chName, iArray);
    }
  }

  const nSamples = result.time.length;
  const dt = nSamples > 1 ? result.time[1]! - result.time[0]! : 20e-6;
  const rateHz = dt > 0 ? 1 / dt : 50000;

  return {
    config: {
      stationName,
      recordingDeviceId: recordingDevId,
      standardVersionYear: 1999,
      analogChannels,
      digitalChannels: [],
      lineFrequencyHz: 60.0,
      samplingRates: [{ rateHz, lastSampleNumber: nSamples }],
      startTime: new Date(),
      triggerTime: new Date(),
      dataFormat: "ASCII",
      timeMultiplicationFactor: 1.0,
    },
    timeSec: result.time,
    analogData,
    digitalData: new Map(),
  };
}
