// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * IEEE C37.111-1999 / 2013 & IEC 60255-24 COMTRADE File Writer.
 *
 * Serializes electrical transient simulation trajectories into standard
 * COMTRADE configuration (.cfg), ASCII/Binary data (.dat), and single-file (.cff) containers.
 */

import type {
  ComtradeAnalogChannel,
  ComtradeConfig,
  ComtradeDataFormat,
  ComtradeDigitalChannel,
  ComtradeRecord,
} from "../types.js";

function formatDate(d: Date | string): string {
  if (typeof d === "string") {
    const parts = d.split(",");
    return parts[0]?.trim() ?? "01/01/2026";
  }
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function formatTime(d: Date | string): string {
  if (typeof d === "string") {
    const parts = d.split(",");
    return parts[1]?.trim() ?? "00:00:00.000000";
  }
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const us = String(d.getMilliseconds() * 1000).padStart(6, "0");
  return `${hh}:${mm}:${ss}.${us}`;
}

function getAnalogChannels(cfg: ComtradeConfig): ComtradeAnalogChannel[] {
  return cfg.analogChannels ?? cfg.analogs ?? [];
}

function getDigitalChannels(cfg: ComtradeConfig): ComtradeDigitalChannel[] {
  return cfg.digitalChannels ?? cfg.digitals ?? [];
}

function buildCfgString(record: ComtradeRecord, dataFormatOverride?: ComtradeDataFormat): string {
  const cfg = record.config ?? record.cfg;
  if (!cfg) throw new Error("Missing config in ComtradeRecord");

  const analogs = getAnalogChannels(cfg);
  const digitals = getDigitalChannels(cfg);
  const nAnalog = cfg.analogCount ?? analogs.length;
  const nDigital = cfg.digitalCount ?? digitals.length;
  const nTotal = cfg.totalChannels ?? nAnalog + nDigital;
  const fmt = dataFormatOverride ?? cfg.dataFormat ?? cfg.fileType ?? "ASCII";
  const stationName = cfg.stationName ?? "SUBSTATION";
  const recDevId = cfg.recordingDeviceId ?? cfg.recDevId ?? "DEV";
  const verYear = cfg.standardVersionYear ?? cfg.revYear ?? 1999;
  const lineFreq = cfg.lineFrequencyHz ?? cfg.nominalFrequency ?? 60.0;
  const sampleRates = cfg.samplingRates ?? cfg.sampleRates ?? [{ rateHz: 10000, lastSampleNumber: 1000 }];
  const startTime = cfg.startTime ?? new Date();
  const triggerTime = cfg.triggerTime ?? new Date();
  const timeMult = cfg.timeMultiplicationFactor ?? cfg.timeMult ?? 1.0;

  const cfgLines: string[] = [];
  cfgLines.push(`${stationName},${recDevId},${verYear}`);
  cfgLines.push(`${nTotal},${nAnalog}A,${nDigital}D`);

  for (const ch of analogs) {
    const chName = ch.name ?? ch.chId ?? `A_${ch.index}`;
    const phase = ch.phase ?? "";
    const ccbm = ch.circuitComponent ?? ch.ccbm ?? "";
    const uu = ch.unit ?? ch.uu ?? "V";
    const multA = ch.multiplierA ?? ch.a ?? 1.0;
    const offB = ch.offsetB ?? ch.b ?? 0.0;
    const skew = ch.skew ?? 0.0;
    const minVal = ch.min ?? ch.minVal ?? -32768;
    const maxVal = ch.max ?? ch.maxVal ?? 32767;
    const primary = ch.primaryRatio ?? ch.primary ?? 1.0;
    const secondary = ch.secondaryRatio ?? ch.secondary ?? 1.0;
    const scaling = ch.scalingIdentifier ?? ch.scaling ?? "P";
    cfgLines.push(
      `${ch.index},${chName},${phase},${ccbm},${uu},${multA},${offB},${skew},${minVal},${maxVal},${primary},${secondary},${scaling}`,
    );
  }

  for (const ch of digitals) {
    const dName = ch.name ?? ch.chId ?? `D_${ch.index}`;
    const phase = ch.phase ?? "";
    const ccbm = ch.circuitComponent ?? ch.ccbm ?? "";
    const norm = ch.normalState ?? 0;
    cfgLines.push(`${ch.index},${dName},${phase},${ccbm},${norm}`);
  }

  cfgLines.push(Number.isInteger(lineFreq) ? `${lineFreq}` : `${lineFreq.toFixed(1)}`);

  cfgLines.push(`${sampleRates.length}`);
  for (const sr of sampleRates) {
    const rate = (sr as any).rateHz ?? (sr as any).rate ?? 10000;
    cfgLines.push(`${rate},${sr.lastSampleNumber}`);
  }

  cfgLines.push(`${formatDate(startTime)},${formatTime(startTime)}`);
  cfgLines.push(`${formatDate(triggerTime)},${formatTime(triggerTime)}`);

  cfgLines.push(String(fmt));
  cfgLines.push(Number.isInteger(timeMult) ? `${timeMult}.0` : `${timeMult}`);

  if (verYear === 2013 || cfg.timeCode !== undefined || cfg.timeQualityIndicatorCode !== undefined) {
    cfgLines.push(`${cfg.timeCode ?? "+00:00"},${cfg.localCode ?? "+00:00"}`);
    cfgLines.push(`${cfg.timeQualityIndicatorCode ?? "0"},${cfg.leapSecIndicator ?? 0}`);
  }

  return cfgLines.join("\n") + "\n";
}

/**
 * Builds standard COMTRADE .cfg content from a ComtradeConfig.
 */
export function writeComtradeCfg(cfg: ComtradeConfig): string {
  const dummy: ComtradeRecord = {
    config: cfg,
    cfg,
    timeSec: new Float64Array(0),
    analogData: new Map(),
    digitalData: new Map(),
  };
  return buildCfgString(dummy);
}

function getAnalogArray(record: ComtradeRecord, ch: ComtradeAnalogChannel, nSamples: number): Float64Array | number[] {
  const chName = ch.name ?? ch.chId ?? "";
  if (record.analogData instanceof Map) {
    return record.analogData.get(chName) ?? new Float64Array(nSamples);
  }
  if (Array.isArray(record.analogData)) {
    const idx = ch.index > 0 ? ch.index - 1 : 0;
    return record.analogData[idx] ?? [];
  }
  return [];
}

function getDigitalArray(record: ComtradeRecord, ch: ComtradeDigitalChannel, nSamples: number): Uint8Array | number[] {
  const dName = ch.name ?? ch.chId ?? "";
  if (record.digitalData instanceof Map) {
    return record.digitalData.get(dName) ?? new Uint8Array(nSamples);
  }
  if (Array.isArray(record.digitalData)) {
    const idx = ch.index > 0 ? ch.index - 1 : 0;
    return record.digitalData[idx] ?? [];
  }
  return [];
}

function getTimestamps(record: ComtradeRecord): Float64Array | number[] {
  return record.timeSec ?? record.timestamps ?? [];
}

/**
 * Exports a ComtradeRecord to ASCII .cfg and .dat strings.
 */
export function writeComtrade(record: ComtradeRecord): { cfg: string; dat: string } {
  const cfg = record.config ?? record.cfg;
  if (!cfg) throw new Error("Missing config in ComtradeRecord");

  const analogs = getAnalogChannels(cfg);
  const digitals = getDigitalChannels(cfg);
  const times = getTimestamps(record);
  const nSamples = times.length;

  const cfgContent = buildCfgString(record, "ASCII");

  const datLines: string[] = [];
  const timeMult = cfg.timeMultiplicationFactor ?? cfg.timeMult ?? 1.0;
  const factor = timeMult > 0 ? timeMult : 1.0;

  for (let i = 0; i < nSamples; i++) {
    const sampleNum = i + 1;
    const tVal = times[i] ?? 0;
    const timeUs = Math.round((tVal * 1e6) / factor);
    const rowVals: string[] = [String(sampleNum), String(timeUs)];

    for (let c = 0; c < analogs.length; c++) {
      const ch = analogs[c]!;
      const arr = getAnalogArray(record, ch, nSamples);
      const val = arr[i] ?? 0;
      const multA = ch.multiplierA ?? ch.a ?? 1.0;
      const offB = ch.offsetB ?? ch.b ?? 0.0;
      const rawVal = multA !== 0 ? Math.round((val - offB) / multA) : Math.round(val);
      rowVals.push(String(rawVal));
    }

    for (let d = 0; d < digitals.length; d++) {
      const ch = digitals[d]!;
      const arr = getDigitalArray(record, ch, nSamples);
      const dVal = (arr[i] ?? 0) ? 1 : 0;
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

export function writeComtradeDatAscii(record: ComtradeRecord): string {
  return writeComtrade(record).dat;
}

/**
 * Exports a ComtradeRecord to IEEE C37.111-1999/2013 Binary .dat (`BINARY`, `BINARY32`, or `FLOAT32`).
 */
export function writeComtradeBinary(
  record: ComtradeRecord,
  format: "BINARY" | "BINARY32" | "FLOAT32" = "BINARY",
): { cfg: string; dat: Uint8Array } {
  const cfg = record.config ?? record.cfg;
  if (!cfg) throw new Error("Missing config in ComtradeRecord");

  const analogs = getAnalogChannels(cfg);
  const digitals = getDigitalChannels(cfg);
  const times = getTimestamps(record);
  const nSamples = times.length;
  const nAnalog = analogs.length;
  const nDigital = digitals.length;
  const timeMult = cfg.timeMultiplicationFactor ?? cfg.timeMult ?? 1.0;

  const analogBytesPerCh = format === "BINARY" ? 2 : 4;
  const statusWordsPerSample = Math.ceil(nDigital / 16);
  const bytesPerSample = 8 + nAnalog * analogBytesPerCh + statusWordsPerSample * 2;
  const buffer = new ArrayBuffer(nSamples * bytesPerSample);
  const view = new DataView(buffer);

  let offset = 0;
  for (let i = 0; i < nSamples; i++) {
    view.setUint32(offset, i + 1, true);
    offset += 4;
    const tVal = times[i] ?? 0;
    const timeUs = Math.round((tVal * 1e6) / (timeMult > 0 ? timeMult : 1.0));
    view.setUint32(offset, timeUs, true);
    offset += 4;

    for (let c = 0; c < nAnalog; c++) {
      const ch = analogs[c]!;
      const arr = getAnalogArray(record, ch, nSamples);
      const val = arr[i] ?? 0;
      const multA = ch.multiplierA ?? ch.a ?? 1.0;
      const offB = ch.offsetB ?? ch.b ?? 0.0;

      if (format === "BINARY") {
        const raw = multA !== 0 ? Math.round((val - offB) / multA) : Math.round(val);
        view.setInt16(offset, Math.max(-32768, Math.min(32767, raw)), true);
        offset += 2;
      } else if (format === "BINARY32") {
        const raw = multA !== 0 ? Math.round((val - offB) / multA) : Math.round(val);
        view.setInt32(offset, raw, true);
        offset += 4;
      } else {
        view.setFloat32(offset, val, true);
        offset += 4;
      }
    }

    for (let w = 0; w < statusWordsPerSample; w++) {
      let word = 0;
      for (let bit = 0; bit < 16; bit++) {
        const dIdx = w * 16 + bit;
        if (dIdx < nDigital) {
          const arr = getDigitalArray(record, digitals[dIdx]!, nSamples);
          if (arr[i]) {
            word |= 1 << bit;
          }
        }
      }
      view.setUint16(offset, word, true);
      offset += 2;
    }
  }

  const cfgContent = buildCfgString(record, format);
  return {
    cfg: cfgContent,
    dat: new Uint8Array(buffer),
  };
}

export function writeComtradeDatBinary(record: ComtradeRecord): Uint8Array {
  return writeComtradeBinary(record, "BINARY").dat;
}

/**
 * Exports a ComtradeRecord as an IEEE C37.111-2013 Annex B Single-File Common Format (`.cff`) string.
 */
export function writeComtradeCff(record: ComtradeRecord): string {
  const { cfg, dat } = writeComtrade(record);
  const inf =
    record.infoText ?? `[Public Record_Information]\nStation=${(record.config ?? record.cfg)?.stationName ?? "SUB"}\n`;
  return `--- file type: CFG ---\n` + cfg + `--- file type: INF ---\n` + inf + `--- file type: DAT ---\n` + dat;
}

function computeChannelScale(arr: Float64Array | number[]): { multiplierA: number; min: number; max: number } {
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
 * Converts EMT simulation results into a COMTRADE disturbance record.
 */
export function emtResultToComtrade(
  result: any,
  optionsOrStationName: string | { stationName: string; recDevId?: string; nominalFrequency?: number },
  recordingDevIdParam?: string,
): ComtradeRecord {
  let stationName = "SUBSTATION_EMT";
  let recDevId = "REC01";
  let nomFreq = 60.0;

  if (typeof optionsOrStationName === "string") {
    stationName = optionsOrStationName;
    recDevId = recordingDevIdParam ?? "REC01";
  } else if (typeof optionsOrStationName === "object" && optionsOrStationName !== null) {
    stationName = optionsOrStationName.stationName;
    recDevId = optionsOrStationName.recDevId ?? "REC01";
    nomFreq = optionsOrStationName.nominalFrequency ?? 60.0;
  }

  const analogChannels: ComtradeAnalogChannel[] = [];
  const digitalChannels: ComtradeDigitalChannel[] = [];
  const analogMap = new Map<string, Float64Array>();
  const digitalMap = new Map<string, Uint8Array>();
  const analogList: number[][] = [];
  const digitalList: number[][] = [];

  let chIdx = 1;
  let dIdx = 1;

  // Case A: result.variables dictionary (e.g. { "Substation.Bus1.Va": [...], "Breaker.Status": [...] })
  if (result.variables && typeof result.variables === "object") {
    for (const [key, vals] of Object.entries(result.variables)) {
      const arr = vals as number[];
      const isDigital =
        key.toLowerCase().includes("status") ||
        key.toLowerCase().includes("trip") ||
        key.toLowerCase().includes("breaker");
      if (isDigital) {
        const u8 = new Uint8Array(arr.map((v) => (v ? 1 : 0)));
        digitalChannels.push({
          index: dIdx++,
          name: key,
          chId: key,
          normalState: 0,
        });
        digitalMap.set(key, u8);
        digitalList.push(arr);
      } else {
        const f64 = new Float64Array(arr);
        const scale = computeChannelScale(f64);
        analogChannels.push({
          index: chIdx++,
          name: key,
          chId: key,
          phase: "A",
          unit: key.includes("V") ? "V" : "A",
          uu: key.includes("V") ? "V" : "A",
          multiplierA: scale.multiplierA,
          a: scale.multiplierA,
          offsetB: 0.0,
          b: 0.0,
          skew: 0.0,
          min: scale.min,
          minVal: scale.min,
          max: scale.max,
          maxVal: scale.max,
          primaryRatio: 1.0,
          secondaryRatio: 1.0,
          scalingIdentifier: "P",
        });
        analogMap.set(key, f64);
        analogList.push(arr);
      }
    }
  }

  // Case B: busVoltages / branchCurrents Maps
  if (result.busVoltages instanceof Map) {
    for (const [busName, vArray] of result.busVoltages) {
      const chName = `V_${busName}`;
      const scale = computeChannelScale(vArray);
      analogChannels.push({
        index: chIdx++,
        name: chName,
        chId: chName,
        phase: "A",
        circuitComponent: busName,
        unit: "V",
        uu: "V",
        multiplierA: scale.multiplierA,
        a: scale.multiplierA,
        offsetB: 0.0,
        b: 0.0,
        skew: 0.0,
        min: scale.min,
        minVal: scale.min,
        max: scale.max,
        maxVal: scale.max,
        primaryRatio: 1.0,
        secondaryRatio: 1.0,
        scalingIdentifier: "P",
      });
      analogMap.set(chName, vArray);
      analogList.push(Array.from(vArray));
    }
  }

  if (result.branchCurrents instanceof Map) {
    for (const [branchId, iArray] of result.branchCurrents) {
      const chName = `I_${branchId}`;
      const scale = computeChannelScale(iArray);
      analogChannels.push({
        index: chIdx++,
        name: chName,
        chId: chName,
        phase: "A",
        circuitComponent: branchId,
        unit: "A",
        uu: "A",
        multiplierA: scale.multiplierA,
        a: scale.multiplierA,
        offsetB: 0.0,
        b: 0.0,
        skew: 0.0,
        min: scale.min,
        minVal: scale.min,
        max: scale.max,
        maxVal: scale.max,
        primaryRatio: 1.0,
        secondaryRatio: 1.0,
        scalingIdentifier: "P",
      });
      analogMap.set(chName, iArray);
      analogList.push(Array.from(iArray));
    }
  }

  const timesRaw = result.time;
  const timeSec = timesRaw instanceof Float64Array ? timesRaw : new Float64Array(timesRaw ?? []);
  const timestamps = Array.from(timeSec);
  const nSamples = timeSec.length;
  const dt = nSamples > 1 ? timeSec[1]! - timeSec[0]! : 1e-4;
  const rateHz = dt > 0 ? 1 / dt : 10000;

  const config: ComtradeConfig = {
    stationName,
    recordingDeviceId: recDevId,
    recDevId,
    standardVersionYear: 1999,
    revYear: 1999,
    totalChannels: analogChannels.length + digitalChannels.length,
    analogCount: analogChannels.length,
    digitalCount: digitalChannels.length,
    analogChannels,
    analogs: analogChannels,
    digitalChannels,
    digitals: digitalChannels,
    lineFrequencyHz: nomFreq,
    nominalFrequency: nomFreq,
    samplingRates: [{ rateHz, rate: rateHz, lastSampleNumber: nSamples }],
    sampleRates: [{ rateHz, rate: rateHz, lastSampleNumber: nSamples }],
    startTime: new Date(),
    triggerTime: new Date(),
    dataFormat: "ASCII",
    fileType: "ASCII",
    timeMultiplicationFactor: 1.0,
    timeMult: 1.0,
  };

  const rec: ComtradeRecord = {
    config,
    cfg: config,
    timeSec,
    timestamps,
    analogData: analogMap,
    digitalData: digitalMap,
  };

  for (let a = 0; a < analogList.length; a++) {
    (rec.analogData as any)[a] = analogList[a];
  }
  for (let d = 0; d < digitalList.length; d++) {
    (rec.digitalData as any)[d] = digitalList[d];
  }

  return rec;
}
