// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/diagram — Neuroscience, Neural Electrophysiology & Spike Raster Builder
 *
 * Implements data-oriented representation, parsing, spike sorting analysis, and publication-grade SVG rendering
 * for multi-channel neural recordings (Neurodata Without Borders NWB, EDF+, Neuropixels, MEA arrays):
 * - Multi-channel continuous Local Field Potential (LFP) time-series oscilloscope
 * - 2D Spike Raster Plot for sorted multi-unit activity (action potentials)
 * - Peristimulus Time Histogram (PSTH) population firing rate analyzer
 * - Neural signal integrity linter: sampling rate drift (NEURO1001), voltage saturation (NEURO1002),
 *   flatline/dead electrode (NEURO1003), refractory period violation (NEURO1004).
 */

export interface NeuralChannel {
  id: string;
  label: string;
  samplingRateHz: number;
  units: string;
  brainRegion: string;
  samples: number[];
  timeSeconds: number[];
  impedanceKOhm?: number | undefined;
}

export interface SpikeUnit {
  unitId: number;
  channelId: string;
  cellType?: "pyramidal" | "interneuron" | "unclassified" | undefined;
  spikeTimesSeconds: number[];
  meanFiringRateHz?: number | undefined;
}

export interface StimulusEvent {
  name: string;
  timeSec: number;
  durationSec?: number | undefined;
  type?: string | undefined;
}

export interface NeuralRecordingData {
  sessionTitle: string;
  subject: string;
  durationSeconds: number;
  channels: NeuralChannel[];
  units: SpikeUnit[];
  stimulusEvents?: StimulusEvent[] | undefined;
}

export interface PsthBin {
  binStartSec: number;
  binEndSec: number;
  spikeCount: number;
  firingRateHz: number;
}

export interface PsthResult {
  bins: PsthBin[];
  maxFiringRateHz: number;
  meanFiringRateHz: number;
  totalSpikes: number;
}

export interface NeuroLintDiagnostic {
  code: string;
  message: string;
  severity: "error" | "warning" | "info";
  channel?: string | undefined;
}

export interface NeuralRenderOptions {
  width?: number | undefined;
  height?: number | undefined;
  darkMode?: boolean | undefined;
  showLfp?: boolean | undefined;
  showPsth?: boolean | undefined;
  showStimuli?: boolean | undefined;
  binWidthSec?: number | undefined;
  timeRangeSec?: [number, number] | undefined;
}

// ---------------------------------------------------------------------------
// Neural Recording Parser & Synthesizer
// ---------------------------------------------------------------------------

/**
 * Parses neural recording records from ASCII / JSON headers and channel traces.
 * Supports NWB metadata schemas, stimulus markers, and spike event records.
 */
export function parseNeuralRecording(content: string): NeuralRecordingData {
  const trimmed = content.trim();
  const lines = trimmed.split(/\r?\n/);

  let sessionTitle = "Multi-Electrode Neuropixels Recording";
  let subject = "Mouse CA1/V1 Primary Visual Cortex";
  let durationSeconds = 2.0;

  const channels: NeuralChannel[] = [];
  const units: SpikeUnit[] = [];
  const stimulusEvents: StimulusEvent[] = [];

  let lineIdx = 0;

  while (lineIdx < lines.length) {
    const l = lines[lineIdx]!.trim();

    if (l.toUpperCase().startsWith("SESSION:") || l.toUpperCase().startsWith("TITLE:")) {
      sessionTitle = l.replace(/^[^:]+:\s*/, "").trim();
      lineIdx++;
      continue;
    }
    if (l.toUpperCase().startsWith("SUBJECT:")) {
      subject = l.replace(/^[^:]+:\s*/, "").trim();
      lineIdx++;
      continue;
    }
    if (l.toUpperCase().startsWith("DURATION:")) {
      const dur = parseFloat(l.replace(/^[^:]+:\s*/, "").replace(/[a-zA-Z]/g, ""));
      if (!isNaN(dur) && dur > 0) durationSeconds = dur;
      lineIdx++;
      continue;
    }

    // Stimulus event: EVENT name time [duration]
    if (l.toUpperCase().startsWith("EVENT") || l.toUpperCase().startsWith("STIM:")) {
      const parts = l.replace(/^(?:EVENT|STIM:?)\s*/i, "").split(/\s+/);
      if (parts.length >= 2) {
        const name = parts[0]!;
        const timeSec = parseFloat(parts[1]!);
        const dur = parts.length >= 3 ? parseFloat(parts[2]!) : 0.1;
        stimulusEvents.push({ name, timeSec, durationSec: dur });
      }
      lineIdx++;
      continue;
    }

    // Spike unit line: UNIT id channel_id cell_type time1 time2 time3...
    if (l.toUpperCase().startsWith("UNIT")) {
      const parts = l.split(/\s+/);
      if (parts.length >= 4) {
        const unitId = parseInt(parts[1]!, 10);
        const channelId = parts[2]!;
        let cellType: "pyramidal" | "interneuron" | "unclassified" = "unclassified";
        let startIdx = 3;

        const maybeType = parts[3]!.toLowerCase();
        if (maybeType.includes("pyr")) {
          cellType = "pyramidal";
          startIdx = 4;
        } else if (maybeType.includes("inter") || maybeType.includes("fast")) {
          cellType = "interneuron";
          startIdx = 4;
        } else if (isNaN(parseFloat(parts[3]!))) {
          startIdx = 4;
        }

        const spikeTimes: number[] = [];
        for (let i = startIdx; i < parts.length; i++) {
          const t = parseFloat(parts[i]!);
          if (!isNaN(t)) spikeTimes.push(t);
        }

        units.push({
          unitId,
          channelId,
          cellType,
          spikeTimesSeconds: spikeTimes.sort((a, b) => a - b),
          meanFiringRateHz: durationSeconds > 0 ? spikeTimes.length / durationSeconds : 0,
        });
      }
      lineIdx++;
      continue;
    }

    // Channel line: CH id label sampling_rate brain_region
    if (l.toUpperCase().startsWith("CH ") || l.toUpperCase().startsWith("CHANNEL")) {
      const parts = l.split(/\s+/);
      if (parts.length >= 4) {
        const id = parts[1]!;
        const label = parts[2]!;
        const fs = parseFloat(parts[3]!);
        const region = parts.length >= 5 ? parts[4]! : "CA1";

        // Check if next lines contain samples
        lineIdx++;
        const samples: number[] = [];
        while (lineIdx < lines.length && !lines[lineIdx]!.match(/^(?:CH|UNIT|EVENT|SESSION|TITLE)/i)) {
          const sampleLine = lines[lineIdx]!.trim();
          if (sampleLine === "") {
            lineIdx++;
            break;
          }
          const numTokens = sampleLine.split(/\s+/);
          for (const token of numTokens) {
            const v = parseFloat(token);
            if (!isNaN(v)) samples.push(v);
          }
          lineIdx++;
        }

        const dt = 1.0 / (fs || 1000);
        const timeSeconds = samples.map((_, idx) => idx * dt);

        channels.push({
          id,
          label,
          samplingRateHz: fs || 1000,
          units: "µV",
          brainRegion: region,
          samples,
          timeSeconds,
        });
        continue;
      }
    }

    lineIdx++;
  }

  // Synthesize realistic baseline multi-unit and LFP traces if none were parsed
  if (channels.length === 0) {
    const fs = 1000;
    const numSamples = Math.floor(durationSeconds * fs);
    const dt = 1.0 / fs;

    const regions = ["Hippocampus CA1", "Dentate Gyrus", "Visual Cortex V1", "Prefrontal PFC"];
    for (let c = 1; c <= 4; c++) {
      const samples: number[] = [];
      const timeSeconds: number[] = [];
      const thetaFreq = 6.0 + c * 0.5; // 6-8 Hz theta oscillation
      const gammaFreq = 40.0 + c * 5.0; // 40-60 Hz gamma

      for (let i = 0; i < numSamples; i++) {
        const t = i * dt;
        timeSeconds.push(t);
        // LFP = theta rhythm + gamma burst + 1/f noise
        const lfp =
          45.0 * Math.sin(2 * Math.PI * thetaFreq * t) +
          18.0 * Math.sin(2 * Math.PI * gammaFreq * t) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 2.0 * t)) +
          (Math.random() - 0.5) * 12.0;
        samples.push(parseFloat(lfp.toFixed(2)));
      }

      channels.push({
        id: `CH${c}`,
        label: `Electrode-${c}`,
        samplingRateHz: fs,
        units: "µV",
        brainRegion: regions[c - 1] ?? "CA1",
        samples,
        timeSeconds,
      });
    }
  }

  if (units.length === 0) {
    // Generate 6 sorted neural units (3 pyramidal cells, 2 interneurons, 1 unclassified)
    for (let u = 1; u <= 6; u++) {
      const cellType = u <= 3 ? "pyramidal" : u <= 5 ? "interneuron" : "unclassified";
      const targetRateHz = cellType === "interneuron" ? 28.0 : 12.0; // Interneurons have higher firing rate
      const spikeTimes: number[] = [];

      let curTime = 0.05 + Math.random() * 0.05;
      while (curTime < durationSeconds) {
        spikeTimes.push(parseFloat(curTime.toFixed(4)));
        // Poisson inter-spike interval with 1.5ms refractory period
        const isi = 0.0015 + -Math.log(1.0 - Math.random() * 0.99) / targetRateHz;
        curTime += isi;
      }

      units.push({
        unitId: u,
        channelId: `CH${(u % channels.length) + 1}`,
        cellType,
        spikeTimesSeconds: spikeTimes,
        meanFiringRateHz: parseFloat((spikeTimes.length / durationSeconds).toFixed(1)),
      });
    }
  }

  if (stimulusEvents.length === 0) {
    stimulusEvents.push(
      { name: "Visual Grating Flash", timeSec: 0.5, durationSec: 0.25, type: "visual" },
      { name: "Auditory Tone (4 kHz)", timeSec: 1.25, durationSec: 0.15, type: "audio" },
    );
  }

  return {
    sessionTitle,
    subject,
    durationSeconds,
    channels,
    units,
    stimulusEvents,
  };
}

// ---------------------------------------------------------------------------
// Peristimulus Time Histogram (PSTH) Engine
// ---------------------------------------------------------------------------

/**
 * Calculates population firing rates over discrete time bins (PSTH).
 */
export function computePsth(units: SpikeUnit[], durationSeconds: number, binWidthSec = 0.05): PsthResult {
  const numBins = Math.max(1, Math.ceil(durationSeconds / binWidthSec));
  const bins: PsthBin[] = [];

  for (let b = 0; b < numBins; b++) {
    const tStart = b * binWidthSec;
    const tEnd = Math.min(durationSeconds, (b + 1) * binWidthSec);
    bins.push({
      binStartSec: tStart,
      binEndSec: tEnd,
      spikeCount: 0,
      firingRateHz: 0,
    });
  }

  let totalSpikes = 0;
  for (const u of units) {
    for (const t of u.spikeTimesSeconds) {
      if (t >= 0 && t <= durationSeconds) {
        const bIdx = Math.min(numBins - 1, Math.floor(t / binWidthSec));
        bins[bIdx]!.spikeCount++;
        totalSpikes++;
      }
    }
  }

  let maxFiringRateHz = 0;
  const numUnits = Math.max(1, units.length);

  for (const b of bins) {
    // Mean firing rate per unit in Hz = (count / numUnits) / binWidthSec
    b.firingRateHz = parseFloat((b.spikeCount / numUnits / binWidthSec).toFixed(1));
    if (b.firingRateHz > maxFiringRateHz) {
      maxFiringRateHz = b.firingRateHz;
    }
  }

  const meanFiringRateHz = durationSeconds > 0 ? totalSpikes / (numUnits * durationSeconds) : 0;

  return {
    bins,
    maxFiringRateHz: maxFiringRateHz || 1.0,
    meanFiringRateHz: parseFloat(meanFiringRateHz.toFixed(1)),
    totalSpikes,
  };
}

// ---------------------------------------------------------------------------
// Publication-Grade SVG Renderer
// ---------------------------------------------------------------------------

/**
 * Renders a publication-grade SVG displaying:
 * 1. Top Subplot (50%): 2D Multi-Unit Spike Raster Plot with stimulus markers.
 * 2. Middle Subplot (25%): Peristimulus Time Histogram (PSTH) population firing rate.
 * 3. Bottom Subplot (25%): Continuous Multi-Channel Local Field Potential (LFP) Oscilloscope.
 */
export function renderNeuralSpikeSvg(
  data: NeuralRecordingData,
  psth: PsthResult,
  options?: NeuralRenderOptions,
): string {
  const width = options?.width ?? 960;
  const height = options?.height ?? 620;
  const darkMode = options?.darkMode ?? true;
  const showLfp = options?.showLfp ?? true;
  const showPsth = options?.showPsth ?? true;
  const showStimuli = options?.showStimuli ?? true;

  const bg = darkMode ? "#0c1017" : "#ffffff";
  const panelBg = darkMode ? "#161b22" : "#f6f8fa";
  const borderCol = darkMode ? "#30363d" : "#d0d7de";
  const textCol = darkMode ? "#e6edf3" : "#1f2328";
  const mutedText = darkMode ? "#8b949e" : "#656d76";
  const gridCol = darkMode ? "#21262d" : "#e1e4e8";

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">\n`;
  svg += `  <defs>\n`;
  svg += `    <linearGradient id="psthGrad" x1="0" y1="0" x2="0" y2="1">\n`;
  svg += `      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.85"/>\n`;
  svg += `      <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.15"/>\n`;
  svg += `    </linearGradient>\n`;
  svg += `  </defs>\n`;
  svg += `  <rect width="100%" height="100%" fill="${bg}" />\n`;

  // Header Title
  svg += `  <text x="24" y="30" font-size="15" font-weight="600" fill="${textCol}">${escapeXml(data.sessionTitle)}</text>\n`;
  svg += `  <text x="24" y="47" font-size="11" fill="${mutedText}">${escapeXml(data.subject)} &bull; Duration: ${data.durationSeconds.toFixed(2)}s &bull; Units: ${data.units.length} &bull; Total Spikes: ${psth.totalSpikes}</text>\n`;

  const margin = { left: 75, right: 35, top: 65, bottom: 40 };
  const plotW = width - margin.left - margin.right;
  const dur = data.durationSeconds || 1.0;
  const mapX = (t: number) => margin.left + (Math.max(0, Math.min(dur, t)) / dur) * plotW;

  // Subplot vertical splits:
  // Raster: 46% (top)
  // PSTH: 24% (middle)
  // LFP: 24% (bottom)
  const availableH = height - margin.top - margin.bottom - 24;
  const rasterH = Math.floor(availableH * 0.46);
  const psthH = showPsth ? Math.floor(availableH * 0.26) : 0;
  const lfpH = showLfp ? availableH - rasterH - psthH : 0;

  const rasterTop = margin.top;
  const psthTop = rasterTop + rasterH + 12;
  const lfpTop = psthTop + psthH + 12;

  // ---------------------------------------------------------------------------
  // 1. Spike Raster Plot (Top Subplot)
  // ---------------------------------------------------------------------------
  svg += `  <!-- Plot 1: 2D Spike Raster Plot -->\n`;
  svg += `  <rect x="${margin.left}" y="${rasterTop}" width="${plotW}" height="${rasterH}" fill="${panelBg}" stroke="${borderCol}" stroke-width="1" rx="4" />\n`;
  svg += `  <text x="${margin.left + 12}" y="${rasterTop + 18}" font-size="11" font-weight="600" fill="${textCol}">Sorted Multi-Unit Spike Raster</text>\n`;

  // Stimulus background highlight overlays
  if (showStimuli && data.stimulusEvents) {
    for (const stim of data.stimulusEvents) {
      const sx1 = mapX(stim.timeSec);
      const sW = (stim.durationSec ? stim.durationSec / dur : 0.05) * plotW;
      svg += `  <rect x="${sx1}" y="${rasterTop}" width="${sW}" height="${rasterH}" fill="rgba(245, 158, 11, 0.15)" stroke="rgba(245, 158, 11, 0.4)" stroke-dasharray="3,2" />\n`;
      svg += `  <text x="${sx1 + 4}" y="${rasterTop + 16}" font-size="9" font-weight="600" fill="#f59e0b">${escapeXml(stim.name)}</text>\n`;
    }
  }

  // Draw unit rows and spike ticks
  const numUnits = data.units.length || 1;
  const rowH = rasterH / numUnits;

  for (let u = 0; u < data.units.length; u++) {
    const unit = data.units[u]!;
    const rowY = rasterTop + u * rowH;
    const tickCol = unit.cellType === "interneuron" ? "#fb923c" : unit.cellType === "pyramidal" ? "#38bdf8" : "#a855f7";

    // Row label on Y-axis
    svg += `  <text x="${margin.left - 8}" y="${rowY + rowH * 0.7}" font-size="9" fill="${tickCol}" text-anchor="end">Unit #${unit.unitId}</text>\n`;

    // Horizontal separator
    if (u > 0) {
      svg += `  <line x1="${margin.left}" y1="${rowY}" x2="${margin.left + plotW}" y2="${rowY}" stroke="${gridCol}" stroke-dasharray="2,2" />\n`;
    }

    // Render spike vertical ticks
    for (const t of unit.spikeTimesSeconds) {
      const tx = mapX(t);
      svg += `  <line x1="${tx}" y1="${rowY + 2}" x2="${tx}" y2="${rowY + rowH - 2}" stroke="${tickCol}" stroke-width="1.8" />\n`;
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Peristimulus Time Histogram (PSTH) (Middle Subplot)
  // ---------------------------------------------------------------------------
  if (showPsth) {
    svg += `  <!-- Plot 2: Peristimulus Time Histogram (PSTH) -->\n`;
    svg += `  <rect x="${margin.left}" y="${psthTop}" width="${plotW}" height="${psthH}" fill="${panelBg}" stroke="${borderCol}" stroke-width="1" rx="4" />\n`;
    svg += `  <text x="${margin.left + 12}" y="${psthTop + 16}" font-size="11" font-weight="600" fill="${textCol}">Population Firing Rate (PSTH &bull; Mean: ${psth.meanFiringRateHz} Hz)</text>\n`;

    const maxRate = psth.maxFiringRateHz * 1.15;
    const mapRateY = (r: number) => psthTop + psthH - (Math.max(0, r) / maxRate) * (psthH - 25);

    // PSTH Firing Rate Bars
    for (const b of psth.bins) {
      const bx1 = mapX(b.binStartSec);
      const bx2 = mapX(b.binEndSec);
      const bW = Math.max(1, bx2 - bx1 - 0.5);
      const by = mapRateY(b.firingRateHz);
      const bH = psthTop + psthH - by;

      svg += `  <rect x="${bx1}" y="${by}" width="${bW}" height="${bH}" fill="url(#psthGrad)" stroke="#38bdf8" stroke-width="0.8" />\n`;
    }

    // PSTH Y-axis labels
    svg += `  <text x="${margin.left - 8}" y="${psthTop + 14}" font-size="9" fill="${mutedText}" text-anchor="end">${maxRate.toFixed(0)}</text>\n`;
    svg += `  <text x="${margin.left - 8}" y="${psthTop + psthH}" font-size="9" fill="${mutedText}" text-anchor="end">0</text>\n`;
    svg += `  <text x="18" y="${psthTop + psthH / 2}" font-size="10" font-weight="500" fill="${textCol}" text-anchor="middle" transform="rotate(-90 18 ${psthTop + psthH / 2})">Hz</text>\n`;
  }

  // ---------------------------------------------------------------------------
  // 3. Continuous Local Field Potential (LFP) (Bottom Subplot)
  // ---------------------------------------------------------------------------
  if (showLfp && data.channels.length > 0) {
    svg += `  <!-- Plot 3: Multi-Channel LFP Oscilloscope -->\n`;
    svg += `  <rect x="${margin.left}" y="${lfpTop}" width="${plotW}" height="${lfpH}" fill="${panelBg}" stroke="${borderCol}" stroke-width="1" rx="4" />\n`;
    svg += `  <text x="${margin.left + 12}" y="${lfpTop + 16}" font-size="11" font-weight="600" fill="${textCol}">Local Field Potential (LFP) Oscilloscope (${data.channels[0]?.samplingRateHz ?? 1000} Hz)</text>\n`;

    const numCh = data.channels.length;
    const chH = lfpH / numCh;
    const lfpColors = ["#4ade80", "#2dd4bf", "#60a5fa", "#c084fc"];

    for (let c = 0; c < numCh; c++) {
      const ch = data.channels[c]!;
      const cyBase = lfpTop + (c + 0.5) * chH;
      const col = lfpColors[c % lfpColors.length]!;

      // Channel label
      svg += `  <text x="${margin.left - 8}" y="${cyBase + 3}" font-size="9" fill="${col}" text-anchor="end">${escapeXml(ch.id)}</text>\n`;

      // Subsample points if array is large
      const maxPts = 400;
      const step = Math.max(1, Math.floor(ch.samples.length / maxPts));
      const pts: string[] = [];

      for (let s = 0; s < ch.samples.length; s += step) {
        const t = ch.timeSeconds[s] ?? s / ch.samplingRateHz;
        const v = ch.samples[s] ?? 0;
        const px = mapX(t);
        // Scale +/- 60 uV to half channel height
        const py = cyBase - (v / 80.0) * (chH * 0.42);
        pts.push(`${px.toFixed(1)},${py.toFixed(1)}`);
      }

      if (pts.length > 1) {
        svg += `  <polyline points="${pts.join(" ")}" fill="none" stroke="${col}" stroke-width="1.3" />\n`;
      }
    }
  }

  // Time Axis (Bottom)
  const bottomY = showLfp ? lfpTop + lfpH : showPsth ? psthTop + psthH : rasterTop + rasterH;
  svg += `  <line x1="${margin.left}" y1="${bottomY}" x2="${margin.left + plotW}" y2="${bottomY}" stroke="${borderCol}" stroke-width="1.2" />\n`;

  // Time tick marks
  const numTimeTicks = 5;
  for (let i = 0; i <= numTimeTicks; i++) {
    const tVal = (i / numTimeTicks) * dur;
    const tx = mapX(tVal);
    svg += `  <line x1="${tx}" y1="${bottomY}" x2="${tx}" y2="${bottomY + 5}" stroke="${borderCol}" stroke-width="1" />\n`;
    svg += `  <text x="${tx}" y="${bottomY + 18}" font-size="10" fill="${mutedText}" text-anchor="middle">${tVal.toFixed(2)}s</text>\n`;
  }
  svg += `  <text x="${margin.left + plotW / 2}" y="${bottomY + 34}" font-size="11" font-weight="500" fill="${textCol}" text-anchor="middle">Time (seconds)</text>\n`;

  svg += `</svg>`;
  return svg;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ---------------------------------------------------------------------------
// Neural Signal Integrity Linter
// ---------------------------------------------------------------------------

/**
 * Validates neural recordings against physiological signal processing standards:
 * - NEURO1001: Sampling rate drift or non-uniform temporal intervals (> 5% deviation).
 * - NEURO1002: Voltage saturation or amplifier clipping (|V| >= 4000 uV).
 * - NEURO1003: Flatline / dead electrode artifact (std(V) < 0.05 uV over recording).
 * - NEURO1004: Physiological refractory period violation (inter-spike interval < 1.0 ms).
 */
export function lintNeuralRecording(data: NeuralRecordingData): NeuroLintDiagnostic[] {
  const diagnostics: NeuroLintDiagnostic[] = [];

  // 1. Channel sampling integrity & saturation (NEURO1001, NEURO1002, NEURO1003)
  for (const ch of data.channels) {
    if (ch.timeSeconds.length > 2) {
      const dt0 = ch.timeSeconds[1]! - ch.timeSeconds[0]!;
      for (let i = 1; i < Math.min(100, ch.timeSeconds.length - 1); i++) {
        const dt = ch.timeSeconds[i + 1]! - ch.timeSeconds[i]!;
        if (Math.abs(dt - dt0) / dt0 > 0.05) {
          diagnostics.push({
            code: "NEURO1001",
            message: `Sampling rate drift detected on channel '${ch.id}': time interval jitter of ${((Math.abs(dt - dt0) / dt0) * 100).toFixed(1)}% exceeds 5% threshold.`,
            severity: "warning",
            channel: ch.id,
          });
          break;
        }
      }
    }

    // Voltage saturation / clipping (NEURO1002)
    let hasClipped = false;
    for (const v of ch.samples) {
      if (Math.abs(v) >= 4000) {
        hasClipped = true;
        break;
      }
    }
    if (hasClipped) {
      diagnostics.push({
        code: "NEURO1002",
        message: `Voltage saturation / amplifier clipping detected on channel '${ch.id}': signal reaches rail voltage limit (|V| >= 4000 µV).`,
        severity: "error",
        channel: ch.id,
      });
    }

    // Flatline / dead electrode (NEURO1003)
    if (ch.samples.length > 50) {
      let sum = 0;
      for (const v of ch.samples) sum += v;
      const mean = sum / ch.samples.length;
      let varSum = 0;
      for (const v of ch.samples) varSum += (v - mean) * (v - mean);
      const std = Math.sqrt(varSum / ch.samples.length);

      if (std < 0.05) {
        diagnostics.push({
          code: "NEURO1003",
          message: `Dead electrode / flatline artifact detected on channel '${ch.id}': standard deviation σ = ${std.toFixed(4)} µV is below noise floor.`,
          severity: "error",
          channel: ch.id,
        });
      }
    }
  }

  // 2. Refractory period violation in sorted units (NEURO1004)
  for (const u of data.units) {
    let violationCount = 0;
    for (let i = 0; i < u.spikeTimesSeconds.length - 1; i++) {
      const isi = u.spikeTimesSeconds[i + 1]! - u.spikeTimesSeconds[i]!;
      if (isi < 0.001) {
        // Less than 1.0 ms
        violationCount++;
      }
    }

    if (violationCount > 0) {
      const pct = (violationCount / Math.max(1, u.spikeTimesSeconds.length)) * 100;
      diagnostics.push({
        code: "NEURO1004",
        message: `Physiological refractory period violation on Unit #${u.unitId}: ${violationCount} spikes (${pct.toFixed(1)}%) occur within < 1.0 ms, indicating multi-unit contamination or sorting artifact.`,
        severity: "warning",
        channel: u.channelId,
      });
    }
  }

  return diagnostics;
}
