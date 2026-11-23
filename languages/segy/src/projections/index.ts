// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projections for `@modelscript/segy`:
 * - CSV trace export
 * - Human-readable ASCII trace header & sample dump
 * - LAS 2.0 well-tie bridge (time-to-depth seismic trace export compatible with `@modelscript/las`)
 */

import type { SegyFile } from "../types.js";

export interface SegyCsvOptions {
  /** Maximum number of traces to include (default: all). */
  maxTraces?: number | undefined;
  /** Decimal precision for amplitude values (default: 6). */
  precision?: number | undefined;
}

/**
 * Exports a `SegyFile` to CSV format with columns `time_ms,trace_1,trace_2,...`.
 */
export function segyToCsv(file: SegyFile, options?: SegyCsvOptions): string {
  const precision = options?.precision ?? 6;
  const maxTraces = options?.maxTraces ?? file.traces.length;
  const traces = file.traces.slice(0, maxTraces);
  const dtMs = (file.binaryHeader.sampleIntervalUs || 2000) / 1000;
  const nSamples = traces.reduce((m, t) => Math.max(m, t.samples.length), 0);

  const headerCols = ["time_ms", ...traces.map((t, idx) => `trace_${t.header.traceSeqLine || idx + 1}`)];
  const lines: string[] = [headerCols.join(",")];

  for (let s = 0; s < nSamples; s++) {
    const timeMs = (s * dtMs).toFixed(3);
    const vals = traces.map((t) => (s < t.samples.length ? t.samples[s]!.toFixed(precision) : "0"));
    lines.push(`${timeMs},${vals.join(",")}`);
  }

  return lines.join("\n") + "\n";
}

export interface SegyAsciiDumpOptions {
  maxTraces?: number | undefined;
  maxSamplesPerTrace?: number | undefined;
}

/**
 * Exports a human-readable ASCII summary dump of reel headers, trace headers, and sample amplitudes.
 */
export function segyToAsciiDump(file: SegyFile, options?: SegyAsciiDumpOptions): string {
  const maxTraces = options?.maxTraces ?? file.traces.length;
  const maxSamples = options?.maxSamplesPerTrace ?? 16;
  const bh = file.binaryHeader;

  const lines: string[] = [
    "=== SEG-Y REEL HEADER ===",
    `Job ID            : ${bh.jobId}`,
    `Line Number       : ${bh.lineNumber}`,
    `Sample Interval   : ${bh.sampleIntervalUs} us`,
    `Samples Per Trace : ${bh.samplesPerTrace}`,
    `Sample Format     : ${bh.sampleFormatCode}`,
    `Measurement System: ${bh.measurementSystem === 2 ? "Feet (2)" : "Meters (1)"}`,
    `SEG-Y Revision    : 0x${bh.segyRevision.toString(16).padStart(4, "0")}`,
    `Total Traces      : ${file.traces.length}`,
    "",
  ];

  for (let i = 0; i < Math.min(maxTraces, file.traces.length); i++) {
    const t = file.traces[i]!;
    const th = t.header;
    lines.push(
      `--- TRACE #${i + 1} (Seq=${th.traceSeqLine}, CDP=${th.cdp}, IL=${th.inline3D}, XL=${th.crossline3D}, Offset=${th.offsetM}m, NS=${t.samples.length}) ---`,
    );
    const nShow = Math.min(maxSamples, t.samples.length);
    const sampleStrs: string[] = [];
    for (let s = 0; s < nShow; s++) {
      sampleStrs.push(t.samples[s]!.toFixed(5));
    }
    lines.push(`  Samples[0..${Math.max(0, nShow - 1)}]: ${sampleStrs.join(", ")}`);
  }

  return lines.join("\n") + "\n";
}

export interface SegyLasWellTieOptions {
  /** Well name for ~W section. */
  wellName?: string | undefined;
  /** Trace index to tie to the well (default 0). */
  traceIndex?: number | undefined;
  /** Constant average interval velocity (m/s) for two-way-time to depth conversion (default 2500 m/s). */
  velocityMps?: number | undefined;
  /** Kelly bushing / datum depth offset in meters (default 0). */
  startDepthM?: number | undefined;
}

/**
 * Bridges a selected seismic trace from a `SegyFile` into a standard LAS 2.0 well-tie log
 * (`~V`, `~W`, `~C`, `~A` with `DEPT`, `TWT`, `SEIS`, `ABSAMP` curves) compatible with `@modelscript/las`.
 */
export function segyToLasWellTie(file: SegyFile, options?: SegyLasWellTieOptions): string {
  const wellName = options?.wellName ?? file.textualHeader.line ?? "SEGY-TIE-01";
  const traceIdx = options?.traceIndex ?? 0;
  const velocityMps = options?.velocityMps ?? 2500.0;
  const startDepthM = options?.startDepthM ?? 0.0;

  const trace = file.traces[traceIdx];
  const dtSec = (trace?.header.sampleIntervalUs || file.binaryHeader.sampleIntervalUs || 2000) * 1e-6;
  const samples = trace?.samples ?? new Float32Array(0);

  // Depth step from two-way traveltime: z = startDepth + 0.5 * v * twt
  const dzM = 0.5 * velocityMps * dtSec;
  const stopDepthM = startDepthM + Math.max(0, samples.length - 1) * dzM;

  const lines: string[] = [
    "~Version Information",
    " VERS.                  2.0 : CWLS LOG ASCII STANDARD - VERSION 2.0",
    " WRAP.                   NO : ONE LINE PER DEPTH STEP",
    "~Well Information",
    ` STRT.M         ${startDepthM.toFixed(4).padStart(11)} : START DEPTH`,
    ` STOP.M         ${stopDepthM.toFixed(4).padStart(11)} : STOP DEPTH`,
    ` STEP.M         ${dzM.toFixed(4).padStart(11)} : STEP`,
    " NULL.            -999.2500 : NULL VALUE",
    ` WELL.          ${wellName.padEnd(11)} : WELL`,
    ` COMP.          ${(file.textualHeader.client ?? "MODELSCRIPT").slice(0, 24)} : COMPANY`,
    "~Curve Information",
    " DEPT.M                     : 1 DEPTH",
    " TWT .MS                    : 2 TWO-WAY TRAVELTIME",
    " SEIS.AMP                   : 3 SEISMIC TRACE AMPLITUDE",
    " ABSAMP.AMP                 : 4 ABSOLUTE AMPLITUDE ENVELOPE",
    "~A  DEPT        TWT         SEIS        ABSAMP",
  ];

  for (let i = 0; i < samples.length; i++) {
    const twtMs = i * dtSec * 1000;
    const depthM = startDepthM + i * dzM;
    const amp = samples[i]!;
    lines.push(
      ` ${depthM.toFixed(4).padStart(10)} ${twtMs.toFixed(3).padStart(10)} ${amp.toFixed(6).padStart(12)} ${Math.abs(amp).toFixed(6).padStart(12)}`,
    );
  }

  return lines.join("\n") + "\n";
}
