// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computePsth,
  lintNeuralRecording,
  parseNeuralRecording,
  renderNeuralSpikeSvg,
  type NeuralRecordingData,
} from "../src/neural-spike-builder.js";

const SAMPLE_NEURAL_DECK = `
SESSION: Visually Evoked Neuropixels Phase 3A Recording
SUBJECT: Mouse V1 Primary Visual Cortex / Layer 4
DURATION: 1.0s

EVENT Visual_Flash 0.30 0.20
EVENT Auditory_Cue 0.70 0.10

UNIT 1 CH1 pyramidal 0.05 0.12 0.31 0.33 0.36 0.39 0.45 0.72 0.85
UNIT 2 CH1 pyramidal 0.08 0.15 0.32 0.34 0.38 0.73 0.91
UNIT 3 CH2 interneuron 0.02 0.06 0.10 0.14 0.19 0.23 0.31 0.32 0.35 0.37 0.40 0.44 0.50 0.71 0.82 0.95

CH CH1 Electrode-1 1000 CA1
 12.5  15.2  18.0  22.1  19.5  14.2   8.0  -2.1  -12.0  -24.5  -15.0  -5.0
CH CH2 Electrode-2 1000 V1
 25.0  28.2  32.0  35.1  30.5  22.2  12.0   1.1  -18.0  -35.5  -22.0  -8.0
`;

describe("Neuroscience & Neural Spike Electrophysiology Diagram Builders (Path H)", () => {
  it("parses neural recording deck with channels, units, and stimulus events", () => {
    const data = parseNeuralRecording(SAMPLE_NEURAL_DECK);
    assert.strictEqual(data.sessionTitle, "Visually Evoked Neuropixels Phase 3A Recording");
    assert.strictEqual(data.subject, "Mouse V1 Primary Visual Cortex / Layer 4");
    assert.strictEqual(data.durationSeconds, 1.0);
    assert.strictEqual(data.channels.length, 2);
    assert.strictEqual(data.units.length, 3);
    assert.strictEqual(data.stimulusEvents?.length, 2);

    const u1 = data.units.find((u) => u.unitId === 1)!;
    assert.strictEqual(u1.cellType, "pyramidal");
    assert.ok(u1.spikeTimesSeconds.length >= 8);

    const u3 = data.units.find((u) => u.unitId === 3)!;
    assert.strictEqual(u3.cellType, "interneuron");
    assert.ok(u3.spikeTimesSeconds.length >= 15);

    const ch1 = data.channels.find((c) => c.id === "CH1")!;
    assert.strictEqual(ch1.samplingRateHz, 1000);
    assert.strictEqual(ch1.samples.length, 12);
  });

  it("calculates Peristimulus Time Histogram (PSTH) population firing rates", () => {
    const data = parseNeuralRecording(SAMPLE_NEURAL_DECK);
    const psth = computePsth(data.units, data.durationSeconds, 0.05);

    assert.strictEqual(psth.bins.length, 20); // 1.0s / 0.05s = 20 bins
    assert.ok(psth.totalSpikes >= 30);
    assert.ok(psth.maxFiringRateHz > 20.0);
    assert.ok(psth.meanFiringRateHz > 5.0);

    // Bins around stimulus flash (0.30 - 0.50s) should have high firing rate
    const flashBin = psth.bins.find((b) => b.binStartSec >= 0.3 && b.binEndSec <= 0.4);
    assert.ok(flashBin !== undefined && flashBin.spikeCount >= 6);
  });

  it("renders publication-grade SVG with 2D spike raster, PSTH, and LFP waveforms", () => {
    const data = parseNeuralRecording(SAMPLE_NEURAL_DECK);
    const psth = computePsth(data.units, data.durationSeconds);

    const svg = renderNeuralSpikeSvg(data, psth, {
      width: 960,
      height: 620,
      showLfp: true,
      showPsth: true,
      showStimuli: true,
    });

    assert.ok(svg.includes("<svg"), "Should output valid SVG root");
    assert.ok(svg.includes("Visually Evoked Neuropixels"), "Should include session title");
    assert.ok(svg.includes("Sorted Multi-Unit Spike Raster"), "Should render spike raster subplot");
    assert.ok(svg.includes("Unit #1"), "Should render unit labels");
    assert.ok(svg.includes("Population Firing Rate (PSTH"), "Should render PSTH subplot");
    assert.ok(svg.includes("Local Field Potential (LFP) Oscilloscope"), "Should render LFP oscilloscope");
    assert.ok(svg.includes("Visual_Flash"), "Should render stimulus banner label");
  });

  it("evaluates neural signal integrity linter and detects saturation, flatline, and refractory violations", () => {
    const validData = parseNeuralRecording(SAMPLE_NEURAL_DECK);

    // 1. Clean data: valid physiological signals
    const cleanDiags = lintNeuralRecording(validData);
    assert.strictEqual(cleanDiags.filter((d) => d.severity === "error").length, 0);

    // 2. Voltage saturation / amplifier clipping (|V| >= 4000 uV)
    const clippedData: NeuralRecordingData = {
      ...validData,
      channels: [
        {
          ...validData.channels[0]!,
          samples: [10, 20, 4500, -5000, 10], // saturated rail voltages
        },
      ],
    };
    const clipDiags = lintNeuralRecording(clippedData);
    assert.ok(clipDiags.some((d) => d.code === "NEURO1002" && d.severity === "error"));

    // 3. Flatline / dead electrode (std < 0.05 uV)
    const flatlineData: NeuralRecordingData = {
      ...validData,
      channels: [
        {
          ...validData.channels[0]!,
          samples: new Array(60).fill(0.001), // flatline 0
        },
      ],
    };
    const flatDiags = lintNeuralRecording(flatlineData);
    assert.ok(flatDiags.some((d) => d.code === "NEURO1003" && d.severity === "error"));

    // 4. Refractory period violation (ISI < 1.0 ms)
    const badUnitData: NeuralRecordingData = {
      ...validData,
      units: [
        {
          unitId: 99,
          channelId: "CH1",
          spikeTimesSeconds: [0.1, 0.1003, 0.2, 0.2004], // 0.3ms and 0.4ms ISI -> violates 1ms refractory period!
        },
      ],
    };
    const refDiags = lintNeuralRecording(badUnitData);
    assert.ok(refDiags.some((d) => d.code === "NEURO1004" && d.severity === "warning"));
  });
});
