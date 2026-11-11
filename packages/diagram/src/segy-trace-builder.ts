// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/diagram — SEG-Y Seismic Reflection Survey Builder & WVA Visualizer
 *
 * Implements Society of Exploration Geophysicists (SEG-Y Rev 1 / Rev 2) seismic survey
 * data representation, multi-trace Wiggle-Variable-Area (WVA) SVG rendering, and geophysical linting:
 * - 3200-byte EBCDIC/ASCII card textual reel headers (C01 - C32)
 * - 400-byte binary reel header (sample interval dt, samples per trace, format code)
 * - 240-byte standard trace headers (trace sequence, CDP, inline, crossline, X/Y coordinates)
 * - Multi-trace Wiggle-Variable-Area (WVA) rendering: baseline + wiggle curve + positive lobe filled polygons
 * - Automatic Gain Control (AGC) window scaling & normal/reverse polarity
 * - Quality linter: sample count consistency, sample interval validity, amplitude spike & clipping detection
 */

export interface SegyBinaryHeader {
  jobId?: number;
  lineSequenceNumber?: number;
  sampleIntervalUs: number; // e.g. 1000 µs (1 ms), 2000 µs (2 ms), 4000 µs (4 ms)
  samplesPerTrace: number;
  formatCode: number; // 1=IBM float, 5=IEEE float, 3=2-byte integer, 8=1-byte integer
  cdpFold?: number;
  traceSortingCode?: number;
}

export interface SegyTraceHeader {
  traceNumber: number;
  cdp: number;
  inline: number;
  crossline: number;
  sourceX: number;
  sourceY: number;
  receiverX: number;
  receiverY: number;
  elevation: number;
  delayMs: number;
}

export interface SegyTrace {
  header: SegyTraceHeader;
  samples: Float32Array | number[];
}

export interface SegySurvey {
  id: string;
  title: string;
  textHeaders: string[]; // 32 lines of 80 ASCII characters
  binaryHeader: SegyBinaryHeader;
  traces: SegyTrace[];
}

export interface SegyRenderOptions {
  width?: number;
  height?: number;
  gain?: number; // e.g. 1.0 (default), 2.0 (boosted)
  applyAgc?: boolean;
  agcWindowSamples?: number;
  polarity?: "normal" | "reverse";
  showVariableArea?: boolean;
  wvaFillColor?: string;
  wiggleColor?: string;
  baselineColor?: string;
  darkMode?: boolean;
  maxTimeMs?: number;
}

export interface SegyLintDiagnostic {
  code: string;
  message: string;
  severity: "error" | "warning" | "info";
  traceIndex?: number;
}

// ---------------------------------------------------------------------------
// Synthetic & ASCII SEG-Y Parser / Generator
// ---------------------------------------------------------------------------

/**
 * Creates a synthetic multi-trace seismic reflection survey (e.g. geological layers with Ricker wavelets).
 */
export function createSyntheticSeismicSurvey(options: {
  numTraces?: number;
  numSamples?: number;
  sampleIntervalUs?: number;
  reflectorDepthsMs?: number[];
}): SegySurvey {
  const numTraces = options.numTraces ?? 24;
  const numSamples = options.numSamples ?? 500;
  const dtUs = options.sampleIntervalUs ?? 2000; // 2 ms
  const reflectors = options.reflectorDepthsMs ?? [200, 450, 700];

  const textHeaders: string[] = [
    "C01 MODELCRIPT SYNTHETIC SEISMIC SURVEY — MARINE 2D REFLECTION",
    "C02 ACQUISITION: 24-CHANNEL AIRGUN ARRAY, 2.0 MS SAMPLE INTERVAL",
    "C03 PROCESSED: POST-STACK ZERO-PHASE MIGRATED TIME SECTION",
    "C04 GEOPHYSICAL TARGET: SEDIMENTARY HORIZONS & FAULT DISPLACEMENT",
  ];
  while (textHeaders.length < 32) {
    textHeaders.push(`C${(textHeaders.length + 1).toString().padStart(2, "0")} ...`);
  }

  const traces: SegyTrace[] = [];
  const dtMs = dtUs / 1000;

  for (let tr = 0; tr < numTraces; tr++) {
    const samples = new Float32Array(numSamples);
    const inline = 100;
    const crossline = 1000 + tr;
    const cdp = 500 + tr;

    for (let s = 0; s < numSamples; s++) {
      const tMs = s * dtMs;
      let amp = 0;

      for (let rIdx = 0; rIdx < reflectors.length; rIdx++) {
        const baseDepth = reflectors[rIdx]!;
        // Dip / fault structure across traces
        const dip = rIdx === 1 ? tr * 4.5 : tr * 1.5;
        const targetT = baseDepth + dip;
        const tau = (tMs - targetT) / 15; // 30 Hz Ricker wavelet envelope
        if (Math.abs(tau) < 4) {
          const ricker = (1 - 2 * Math.PI * Math.PI * tau * tau) * Math.exp(-Math.PI * Math.PI * tau * tau);
          const reflectivity = rIdx === 0 ? 0.6 : rIdx === 1 ? -0.85 : 0.45;
          amp += reflectivity * ricker;
        }
      }

      // Add small ambient acoustic noise
      amp += Math.sin(s * 0.3 + tr * 0.7) * 0.05;
      samples[s] = amp;
    }

    traces.push({
      header: {
        traceNumber: tr + 1,
        cdp,
        inline,
        crossline,
        sourceX: 500000 + tr * 25,
        sourceY: 4100000,
        receiverX: 500000 + tr * 25,
        receiverY: 4100000,
        elevation: -15,
        delayMs: 0,
      },
      samples,
    });
  }

  return {
    id: "synthetic_segy_survey",
    title: "Synthetic 2D Seismic Section",
    textHeaders,
    binaryHeader: {
      sampleIntervalUs: dtUs,
      samplesPerTrace: numSamples,
      formatCode: 5, // IEEE Float32
      cdpFold: 24,
    },
    traces,
  };
}

// ---------------------------------------------------------------------------
// Multi-Trace Wiggle-Variable-Area (WVA) SVG Renderer
// ---------------------------------------------------------------------------

export function renderSegyWvaSvg(survey: SegySurvey, options: SegyRenderOptions = {}): string {
  const width = options.width ?? 960;
  const height = options.height ?? 640;
  const gain = options.gain ?? 1.5;
  const applyAgc = options.applyAgc ?? false;
  const polarity = options.polarity ?? "normal";
  const showVariableArea = options.showVariableArea ?? true;
  const darkMode = options.darkMode ?? true;

  const bg = darkMode ? "#090d16" : "#ffffff";
  const fg = darkMode ? "#f1f5f9" : "#0f172a";
  const gridColor = darkMode ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.12)";
  const textColor = darkMode ? "#94a3b8" : "#64748b";
  const baselineColor = options.baselineColor ?? (darkMode ? "rgba(255, 255, 255, 0.2)" : "rgba(0, 0, 0, 0.2)");
  const wiggleColor = options.wiggleColor ?? (darkMode ? "#38bdf8" : "#0284c7");
  const wvaColor = options.wvaFillColor ?? (darkMode ? "rgba(56, 189, 248, 0.75)" : "rgba(2, 132, 199, 0.85)");

  const marginLeft = 70;
  const marginRight = 40;
  const marginTop = 60;
  const marginBottom = 50;

  const plotWidth = width - marginLeft - marginRight;
  const plotHeight = height - marginTop - marginBottom;

  const nTraces = survey.traces.length;
  if (nTraces === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><text x="${width / 2}" y="${height / 2}" fill="${fg}" text-anchor="middle">No seismic traces available.</text></svg>`;
  }

  const dtMs = survey.binaryHeader.sampleIntervalUs / 1000;
  const nSamples = survey.binaryHeader.samplesPerTrace;
  const totalDurationMs = options.maxTimeMs ?? nSamples * dtMs;

  const tracePitch = plotWidth / (nTraces || 1);

  const tracesMarkup: string[] = [];

  for (let tr = 0; tr < nTraces; tr++) {
    const trace = survey.traces[tr]!;
    const baselineX = marginLeft + (tr + 0.5) * tracePitch;

    // Draw baseline
    tracesMarkup.push(
      `<line x1="${baselineX.toFixed(1)}" y1="${marginTop}" x2="${baselineX.toFixed(1)}" y2="${marginTop + plotHeight}" stroke="${baselineColor}" stroke-width="0.75" />`,
    );

    // Compute normalized or AGC-scaled samples
    const samples = trace.samples;
    const len = Math.min(samples.length, nSamples);
    const scaledSamples = new Float32Array(len);

    let rms = 0;
    for (let s = 0; s < len; s++) rms += samples[s]! * samples[s]!;
    rms = Math.sqrt(rms / (len || 1)) || 1.0;

    const polMul = polarity === "reverse" ? -1 : 1;
    const agcWin = options.agcWindowSamples ?? 40;

    if (applyAgc && len > agcWin) {
      for (let s = 0; s < len; s++) {
        const start = Math.max(0, s - Math.floor(agcWin / 2));
        const end = Math.min(len, s + Math.floor(agcWin / 2));
        let winRms = 0;
        for (let w = start; w < end; w++) winRms += samples[w]! * samples[w]!;
        winRms = Math.sqrt(winRms / (end - start || 1)) || 1.0;
        const raw = samples[s]! * polMul;
        scaledSamples[s] = (raw / winRms) * (tracePitch * 0.45 * gain);
      }
    } else {
      for (let s = 0; s < len; s++) {
        const raw = samples[s]! * polMul;
        scaledSamples[s] = (raw / rms) * (tracePitch * 0.45 * gain);
      }
    }

    // Build wiggle polyline path and positive variable-area polygons
    const points: [number, number][] = [];
    for (let s = 0; s < len; s++) {
      const tMs = s * dtMs;
      if (tMs > totalDurationMs) break;
      const y = marginTop + (tMs / totalDurationMs) * plotHeight;
      const x = Math.max(marginLeft, Math.min(width - marginRight, baselineX + scaledSamples[s]!));
      points.push([x, y]);
    }

    if (points.length < 2) continue;

    // 1. Variable-Area (WVA) positive lobe polygons
    if (showVariableArea) {
      const wvaPaths: string[] = [];
      let inLobe = false;
      let lobePoints: [number, number][] = [];

      for (let i = 0; i < points.length; i++) {
        const [x, y] = points[i]!;
        const isPos = x > baselineX;

        if (isPos) {
          if (!inLobe) {
            inLobe = true;
            lobePoints = [[baselineX, y]];
          }
          lobePoints.push([x, y]);
        } else {
          if (inLobe) {
            inLobe = false;
            lobePoints.push([baselineX, y]);
            if (lobePoints.length >= 3) {
              const d = `M ${lobePoints.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(" L ")} Z`;
              wvaPaths.push(`<path d="${d}" fill="${wvaColor}" stroke="none" />`);
            }
            lobePoints = [];
          }
        }
      }

      if (inLobe && lobePoints.length >= 3) {
        lobePoints.push([baselineX, points[points.length - 1]![1]]);
        const d = `M ${lobePoints.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(" L ")} Z`;
        wvaPaths.push(`<path d="${d}" fill="${wvaColor}" stroke="none" />`);
      }

      tracesMarkup.push(...wvaPaths);
    }

    // 2. Wiggle curve
    const wigglePath = `M ${points.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(" L ")}`;
    tracesMarkup.push(
      `<path d="${wigglePath}" fill="none" stroke="${wiggleColor}" stroke-width="1.2" stroke-linecap="round" />`,
    );

    // Top trace number label
    tracesMarkup.push(
      `<text x="${baselineX.toFixed(1)}" y="${marginTop - 10}" fill="${textColor}" font-size="10" font-family="sans-serif" text-anchor="middle">${trace.header.traceNumber}</text>`,
    );
  }

  // Time Axis (Vertical descending)
  const timeAxisMarkup: string[] = [];
  const timeStepMs = totalDurationMs <= 500 ? 50 : totalDurationMs <= 1000 ? 100 : 200;

  for (let t = 0; t <= totalDurationMs; t += timeStepMs) {
    const y = marginTop + (t / totalDurationMs) * plotHeight;
    timeAxisMarkup.push(
      `<line x1="${marginLeft - 6}" y1="${y.toFixed(1)}" x2="${marginLeft + plotWidth}" y2="${y.toFixed(1)}" stroke="${gridColor}" stroke-width="1" stroke-dasharray="2,2" />`,
    );
    timeAxisMarkup.push(
      `<text x="${marginLeft - 12}" y="${(y + 4).toFixed(1)}" fill="${textColor}" font-size="11" font-family="sans-serif" text-anchor="end">${t} ms</text>`,
    );
  }

  // Border & Axis Titles
  const borderMarkup = `<rect x="${marginLeft}" y="${marginTop}" width="${plotWidth}" height="${plotHeight}" fill="none" stroke="${gridColor}" stroke-width="1.5" />`;

  const headerMarkup = `
    <text x="${marginLeft}" y="${marginTop - 32}" fill="${fg}" font-size="16" font-family="sans-serif" font-weight="bold">${survey.title}</text>
    <text x="${marginLeft + plotWidth}" y="${marginTop - 32}" fill="${textColor}" font-size="12" font-family="sans-serif" text-anchor="end">SEG-Y Rev 1 | Traces: ${nTraces} | Δt: ${dtMs} ms | N_s: ${nSamples} | Polarity: ${polarity.toUpperCase()}</text>
    <text x="${marginLeft - 12}" y="${marginTop - 10}" fill="${textColor}" font-size="11" font-family="sans-serif" font-weight="600" text-anchor="end">Time</text>
    <text x="${marginLeft + plotWidth / 2}" y="${height - 15}" fill="${textColor}" font-size="12" font-family="sans-serif" text-anchor="middle">Trace / CDP Sequence</text>
  `;

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="background-color: ${bg}; user-select: none;">
  ${headerMarkup}
  <g class="time-grid">
    ${timeAxisMarkup.join("\n    ")}
  </g>
  ${borderMarkup}
  <g class="seismic-traces">
    ${tracesMarkup.join("\n    ")}
  </g>
</svg>
`.trim();
}

// ---------------------------------------------------------------------------
// Geophysical Linter & Quality Rules
// ---------------------------------------------------------------------------

export function lintSegySurvey(survey: SegySurvey): SegyLintDiagnostic[] {
  const diagnostics: SegyLintDiagnostic[] = [];

  // SEGY1001: Sample count match
  const expectedSamples = survey.binaryHeader.samplesPerTrace;
  for (let i = 0; i < survey.traces.length; i++) {
    const tr = survey.traces[i]!;
    if (tr.samples.length !== expectedSamples) {
      diagnostics.push({
        code: "SEGY1001",
        message: `Trace #${tr.header.traceNumber} sample length (${tr.samples.length}) mismatches binary header expected samples (${expectedSamples}).`,
        severity: "error",
        traceIndex: i,
      });
      break;
    }
  }

  // SEGY1002: Sample interval validity
  const dtUs = survey.binaryHeader.sampleIntervalUs;
  if (dtUs <= 0 || dtUs > 20000) {
    diagnostics.push({
      code: "SEGY1002",
      message: `Invalid seismic sample interval dt = ${dtUs} µs. Must be positive and <= 20,000 µs (20 ms).`,
      severity: "error",
    });
  }

  // SEGY1003: Severe amplitude clipping or NaN/Inf values
  for (let i = 0; i < survey.traces.length; i++) {
    const tr = survey.traces[i]!;
    let hasNan = false;
    let maxAmp = 0;

    for (let s = 0; s < tr.samples.length; s++) {
      const v = tr.samples[s]!;
      if (isNaN(v) || !isFinite(v)) {
        hasNan = true;
        break;
      }
      if (Math.abs(v) > maxAmp) maxAmp = Math.abs(v);
    }

    if (hasNan) {
      diagnostics.push({
        code: "SEGY1003",
        message: `Trace #${tr.header.traceNumber} contains NaN or infinite sample values.`,
        severity: "error",
        traceIndex: i,
      });
      break;
    }

    if (maxAmp > 1e7) {
      diagnostics.push({
        code: "SEGY1003",
        message: `Trace #${tr.header.traceNumber} has unscaled physical amplitude (${maxAmp.toExponential(2)}) indicating missing coordinate or amplitude gain divisor.`,
        severity: "warning",
        traceIndex: i,
      });
      break;
    }
  }

  // SEGY1004: Monotonic CDP / Trace numbers
  for (let i = 1; i < survey.traces.length; i++) {
    const prev = survey.traces[i - 1]!;
    const curr = survey.traces[i]!;
    if (curr.header.traceNumber <= prev.header.traceNumber) {
      diagnostics.push({
        code: "SEGY1004",
        message: `Trace numbering is non-monotonic: trace #${curr.header.traceNumber} follows trace #${prev.header.traceNumber}.`,
        severity: "warning",
        traceIndex: i,
      });
      break;
    }
  }

  return diagnostics;
}
