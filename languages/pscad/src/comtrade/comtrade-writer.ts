// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * IEEE C37.111-1999 / 2013 & IEC 60255-24 COMTRADE File Writer.
 *
 * Serializes electrical transient simulation trajectories into standard
 * COMTRADE configuration (.cfg), ASCII/Binary data (.dat), and single-file (.cff) containers.
 */

import type { ComtradeDataFormat, ComtradeRecord } from "./comtrade-types.js";

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

function buildCfgString(record: ComtradeRecord, dataFormatOverride?: ComtradeDataFormat): string {
  const cfg = record.config;
  const nAnalog = cfg.analogChannels.length;
  const nDigital = cfg.digitalChannels.length;
  const nTotal = nAnalog + nDigital;
  const fmt = dataFormatOverride ?? cfg.dataFormat ?? "ASCII";

  const cfgLines: string[] = [];
  cfgLines.push(`${cfg.stationName},${cfg.recordingDeviceId},${cfg.standardVersionYear}`);
  cfgLines.push(`${nTotal},${nAnalog}A,${nDigital}D`);

  for (const ch of cfg.analogChannels) {
    cfgLines.push(
      `${ch.index},${ch.name},${ch.phase},${ch.circuitComponent ?? ""},${ch.unit},${ch.multiplierA},${ch.offsetB},${ch.skew},${ch.min},${ch.max},${ch.primaryRatio},${ch.secondaryRatio},${ch.scalingIdentifier}`,
    );
  }

  for (const ch of cfg.digitalChannels) {
    cfgLines.push(`${ch.index},${ch.name},${ch.phase ?? ""},${ch.circuitComponent ?? ""},${ch.normalState}`);
  }

  cfgLines.push(`${cfg.lineFrequencyHz.toFixed(1)}`);

  cfgLines.push(`${cfg.samplingRates.length}`);
  for (const sr of cfg.samplingRates) {
    cfgLines.push(`${sr.rateHz.toFixed(1)},${sr.lastSampleNumber}`);
  }

  cfgLines.push(`${formatDate(cfg.startTime)},${formatTime(cfg.startTime)}`);
  cfgLines.push(`${formatDate(cfg.triggerTime)},${formatTime(cfg.triggerTime)}`);

  cfgLines.push(fmt);
  cfgLines.push(`${cfg.timeMultiplicationFactor.toFixed(1)}`);

  // IEEE C37.111-2013 extended trailer lines
  if (cfg.standardVersionYear === 2013 || cfg.timeCode !== undefined || cfg.timeQualityIndicatorCode !== undefined) {
    cfgLines.push(`${cfg.timeCode ?? "+00:00"},${cfg.localCode ?? "+00:00"}`);
    cfgLines.push(`${cfg.timeQualityIndicatorCode ?? "0"},${cfg.leapSecIndicator ?? 0}`);
  }

  return cfgLines.join("\n") + "\n";
}

/**
 * Exports a ComtradeRecord to ASCII .cfg and .dat strings.
 */
export function writeComtrade(record: ComtradeRecord): { cfg: string; dat: string } {
  const cfg = record.config;
  const nAnalog = cfg.analogChannels.length;
  const nDigital = cfg.digitalChannels.length;
  const nSamples = record.timeSec.length;

  const cfgContent = buildCfgString(record, "ASCII");

  // Build ASCII .dat string
  const datLines: string[] = [];
  const analogArrays: Float64Array[] = cfg.analogChannels.map(
    (ch) => record.analogData.get(ch.name) ?? new Float64Array(nSamples),
  );
  const digitalArrays: Uint8Array[] = cfg.digitalChannels.map(
    (ch) => record.digitalData.get(ch.name) ?? new Uint8Array(nSamples),
  );
  const timeMult = cfg.timeMultiplicationFactor > 0 ? cfg.timeMultiplicationFactor : 1.0;

  for (let i = 0; i < nSamples; i++) {
    const sampleNum = i + 1;
    const timeUs = Math.round((record.timeSec[i]! * 1e6) / timeMult);
    const rowVals: string[] = [String(sampleNum), String(timeUs)];

    for (let c = 0; c < nAnalog; c++) {
      const ch = cfg.analogChannels[c]!;
      const val = analogArrays[c]![i]!;
      const rawVal = ch.multiplierA !== 0 ? Math.round((val - ch.offsetB) / ch.multiplierA) : Math.round(val);
      rowVals.push(String(rawVal));
    }

    for (let d = 0; d < nDigital; d++) {
      const dVal = digitalArrays[d]![i]! ? 1 : 0;
      rowVals.push(String(dVal));
    }

    datLines.push(rowVals.join(","));
  }

  const datContent = datLines.join("\n") + "\n";

  return {
    cfg: cfgContent,
    dat: datContent,
  };
}

/**
 * Exports a ComtradeRecord to IEEE C37.111-1999/2013 Binary .dat (`BINARY`, `BINARY32`, or `FLOAT32`).
 *
 * Binary record layout per sample (little-endian):
 * - Bytes 0..3: Sample number (`uint32`)
 * - Bytes 4..7: Timestamp in microseconds / timeMult (`uint32`)
 * - Analog channels:
 *   - `BINARY`: `nAnalog * 2` bytes (`int16` each)
 *   - `BINARY32`: `nAnalog * 4` bytes (`int32` each)
 *   - `FLOAT32`: `nAnalog * 4` bytes (`float32` each)
 * - Digital channels: `ceil(nDigital / 16) * 2` bytes (`uint16` packed 16-bit status words)
 */
export function writeComtradeBinary(
  record: ComtradeRecord,
  format: "BINARY" | "BINARY32" | "FLOAT32" = "BINARY",
): { cfg: string; dat: Uint8Array } {
  // For 16-bit BINARY, ensure analog channel multipliers fit within [-32767, 32767] without clipping
  const effectiveChannels = record.config.analogChannels.map((ch) => {
    if (format === "BINARY") {
      const arr = record.analogData.get(ch.name);
      let maxAbs = 0;
      if (arr) {
        for (let i = 0; i < arr.length; i++) {
          const a = Math.abs(arr[i]! - ch.offsetB);
          if (a > maxAbs) maxAbs = a;
        }
      }
      if (ch.multiplierA > 0 && maxAbs / ch.multiplierA > 32767) {
        const newMult = maxAbs / 32767;
        return { ...ch, multiplierA: newMult, min: -32767, max: 32767 };
      }
    }
    return ch;
  });

  const effectiveRecord: ComtradeRecord = {
    ...record,
    config: {
      ...record.config,
      analogChannels: effectiveChannels,
      dataFormat: format,
    },
  };

  const cfg = effectiveRecord.config;
  const nAnalog = cfg.analogChannels.length;
  const nDigital = cfg.digitalChannels.length;
  const nSamples = record.timeSec.length;

  const cfgContent = buildCfgString(effectiveRecord, format);

  const analogBytesPerCh = format === "BINARY" ? 2 : 4;
  const statusWordsPerSample = Math.ceil(nDigital / 16);
  const bytesPerSample = 8 + nAnalog * analogBytesPerCh + statusWordsPerSample * 2;

  const buffer = new ArrayBuffer(nSamples * bytesPerSample);
  const view = new DataView(buffer);

  const analogArrays: Float64Array[] = cfg.analogChannels.map(
    (ch) => record.analogData.get(ch.name) ?? new Float64Array(nSamples),
  );
  const digitalArrays: Uint8Array[] = cfg.digitalChannels.map(
    (ch) => record.digitalData.get(ch.name) ?? new Uint8Array(nSamples),
  );
  const timeMult = cfg.timeMultiplicationFactor > 0 ? cfg.timeMultiplicationFactor : 1.0;

  let offset = 0;
  for (let i = 0; i < nSamples; i++) {
    const sampleNum = i + 1;
    const timeUs = Math.max(0, Math.round((record.timeSec[i]! * 1e6) / timeMult)) >>> 0;

    view.setUint32(offset, sampleNum, true);
    offset += 4;
    view.setUint32(offset, timeUs, true);
    offset += 4;

    for (let c = 0; c < nAnalog; c++) {
      const ch = cfg.analogChannels[c]!;
      const val = analogArrays[c]![i]!;
      const unscaled = ch.multiplierA !== 0 ? (val - ch.offsetB) / ch.multiplierA : val;

      if (format === "BINARY") {
        const clamped = Math.max(-32767, Math.min(32767, Math.round(unscaled)));
        view.setInt16(offset, clamped, true);
        offset += 2;
      } else if (format === "BINARY32") {
        const clamped = Math.max(-2147483647, Math.min(2147483647, Math.round(unscaled)));
        view.setInt32(offset, clamped, true);
        offset += 4;
      } else {
        view.setFloat32(offset, unscaled, true);
        offset += 4;
      }
    }

    for (let w = 0; w < statusWordsPerSample; w++) {
      let word = 0;
      for (let bit = 0; bit < 16; bit++) {
        const dIdx = w * 16 + bit;
        if (dIdx < nDigital && digitalArrays[dIdx]![i]!) {
          word |= 1 << bit;
        }
      }
      view.setUint16(offset, word, true);
      offset += 2;
    }
  }

  return {
    cfg: cfgContent,
    dat: new Uint8Array(buffer),
  };
}

/**
 * Exports a ComtradeRecord as an IEEE C37.111-2013 Annex B Single-File Common Format (`.cff`) string.
 */
export function writeComtradeCff(record: ComtradeRecord): string {
  const { cfg, dat } = writeComtrade(record);
  const inf = record.infoText ?? `[Public Record_Information]\nStation=${record.config.stationName}\n`;
  return `--- file type: CFG ---\n` + cfg + `--- file type: INF ---\n` + inf + `--- file type: DAT ASCII ---\n` + dat;
}

/**
 * Minimal structural interface representing an EMT simulation result for COMTRADE conversion.
 */
export interface SimulationResultLike {
  /** Uniformly sampled simulation time vector in seconds. */
  time: Float64Array;
  /** Map from bus identifier to primary (phase A or single-phase) voltage waveform in Volts. */
  busVoltages: Map<string, Float64Array>;
  /** Optional map from bus identifier to 3-phase (`a`, `b`, `c`) instantaneous voltage waveforms in Volts. */
  busPhaseVoltages?: Map<string, { a: Float64Array; b: Float64Array; c: Float64Array }> | undefined;
  /** Optional map from branch/component identifier to primary (phase A) current waveform in Amperes. */
  branchCurrents?: Map<string, Float64Array> | undefined;
  /** Optional map from branch/component identifier to 3-phase (`a`, `b`, `c`) instantaneous current waveforms in Amperes. */
  branchPhaseCurrents?: Map<string, { a: Float64Array; b: Float64Array; c: Float64Array }> | undefined;
  /** Optional map from CSMF control signal identifier to sampled trajectory values. */
  controlSignals?: Map<string, Float64Array> | undefined;
}

/**
 * Computes an optimal 16-bit integer quantization multiplier `multiplierA` and symmetric `[min, max]` sample bounds
 * so that small-amplitude waveforms retain full dynamic range in integer COMTRADE `.dat` files.
 */
function computeChannelScale(arr: Float64Array): { multiplierA: number; min: number; max: number } {
  let maxAbs = 0;
  for (let i = 0; i < arr.length; i++) {
    const a = Math.abs(arr[i]!);
    if (a > maxAbs) maxAbs = a;
  }
  const multiplierA = maxAbs > 0 && maxAbs < 32767 ? maxAbs / 32767 : 1.0;
  const bound = maxAbs > 0 ? Math.ceil(maxAbs / multiplierA) : 32767;
  return { multiplierA, min: -bound, max: bound };
}

/**
 * Converts an EMT simulation result directly into a ComtradeRecord.
 */
export function emtResultToComtrade(
  result: SimulationResultLike,
  stationName: string = "ModelScript_Station",
  recordingDevId: string = "EMT01",
): ComtradeRecord {
  const analogChannels: ComtradeRecord["config"]["analogChannels"] = [];
  const analogData = new Map<string, Float64Array>();
  let chIdx = 1;

  for (const [busName, vArray] of result.busVoltages) {
    const chName = `V_${busName}`;
    const scale = computeChannelScale(vArray);
    analogChannels.push({
      index: chIdx++,
      name: chName,
      phase: "A",
      circuitComponent: busName,
      unit: "V",
      multiplierA: scale.multiplierA,
      offsetB: 0.0,
      skew: 0.0,
      min: scale.min,
      max: scale.max,
      primaryRatio: 1.0,
      secondaryRatio: 1.0,
      scalingIdentifier: "P",
    });
    analogData.set(chName, vArray);

    const phWf = result.busPhaseVoltages?.get(busName);
    if (phWf) {
      for (const [phLabel, arr] of [
        ["B", phWf.b],
        ["C", phWf.c],
      ] as const) {
        const phChName = `V_${busName}_${phLabel}`;
        const phScale = computeChannelScale(arr);
        analogChannels.push({
          index: chIdx++,
          name: phChName,
          phase: phLabel,
          circuitComponent: busName,
          unit: "V",
          multiplierA: phScale.multiplierA,
          offsetB: 0.0,
          skew: 0.0,
          min: phScale.min,
          max: phScale.max,
          primaryRatio: 1.0,
          secondaryRatio: 1.0,
          scalingIdentifier: "P",
        });
        analogData.set(phChName, arr);
      }
    }
  }

  if (result.branchCurrents) {
    for (const [branchId, iArray] of result.branchCurrents) {
      const chName = `I_${branchId}`;
      const scale = computeChannelScale(iArray);
      analogChannels.push({
        index: chIdx++,
        name: chName,
        phase: "A",
        circuitComponent: branchId,
        unit: "A",
        multiplierA: scale.multiplierA,
        offsetB: 0.0,
        skew: 0.0,
        min: scale.min,
        max: scale.max,
        primaryRatio: 1.0,
        secondaryRatio: 1.0,
        scalingIdentifier: "P",
      });
      analogData.set(chName, iArray);

      const phWf = result.branchPhaseCurrents?.get(branchId);
      if (phWf) {
        for (const [phLabel, arr] of [
          ["B", phWf.b],
          ["C", phWf.c],
        ] as const) {
          const phChName = `I_${branchId}_${phLabel}`;
          const phScale = computeChannelScale(arr);
          analogChannels.push({
            index: chIdx++,
            name: phChName,
            phase: phLabel,
            circuitComponent: branchId,
            unit: "A",
            multiplierA: phScale.multiplierA,
            offsetB: 0.0,
            skew: 0.0,
            min: phScale.min,
            max: phScale.max,
            primaryRatio: 1.0,
            secondaryRatio: 1.0,
            scalingIdentifier: "P",
          });
          analogData.set(phChName, arr);
        }
      }
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
