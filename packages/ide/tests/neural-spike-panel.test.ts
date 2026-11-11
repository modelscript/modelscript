// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  computePsth,
  lintNeuralRecording,
  parseNeuralRecording,
  renderNeuralSpikeSvg,
} from "@modelscript/diagram/neural-spike";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NeuralSpikeViewerEditorProvider, NeuralSpikeViewerPanel } from "../src/neural-spike-panel.js";

const SAMPLE_NEURAL_FIXTURE = `
SESSION: Optogenetically Modulated Hippocampal LFP & Units
SUBJECT: Rodent CA1 Pyramidal Layer
DURATION: 1.5s

EVENT Opto_Laser 0.50 0.25
EVENT Reward_Delivery 1.10 0.10

UNIT 1 CH1 pyramidal 0.05 0.12 0.51 0.53 0.56 0.60 0.65 0.72 1.15
UNIT 2 CH2 interneuron 0.02 0.08 0.15 0.22 0.35 0.51 0.52 0.54 0.58 0.62 0.68 0.74 1.12 1.25

CH CH1 CA1-Tetrode-1 1000 CA1
 10.0  14.0  18.5  12.0  -5.0  -18.0  -28.0  -15.0  5.0  12.0
CH CH2 CA1-Tetrode-2 1000 CA1
 15.0  22.0  29.5  18.0  -8.0  -25.0  -38.0  -20.0  8.0  18.0
`;

describe("Neuroscience & Neural Spike Electrophysiology IDE Panels (Path H)", () => {
  it("exposes NeuralSpikeViewerPanel and NeuralSpikeViewerEditorProvider viewType identifiers", () => {
    assert.equal(NeuralSpikeViewerPanel.viewType, "modelscript.neuralSpikeViewer");
    assert.equal(NeuralSpikeViewerEditorProvider.viewType, "modelscript.neuralSpikeEditor");
  });

  it("constructs neural recording from deck and renders spike raster, PSTH, and LFP oscilloscope", () => {
    const data = parseNeuralRecording(SAMPLE_NEURAL_FIXTURE);
    assert.equal(data.sessionTitle, "Optogenetically Modulated Hippocampal LFP & Units");
    assert.equal(data.subject, "Rodent CA1 Pyramidal Layer");
    assert.equal(data.durationSeconds, 1.5);
    assert.equal(data.channels.length, 2);
    assert.equal(data.units.length, 2);

    const diags = lintNeuralRecording(data);
    assert.equal(diags.filter((d) => d.severity === "error").length, 0);

    const psth = computePsth(data.units, data.durationSeconds, 0.05);
    assert.ok(psth.bins.length > 20);

    const svg = renderNeuralSpikeSvg(data, psth, {
      width: 960,
      height: 600,
      showLfp: true,
      showPsth: true,
      showStimuli: true,
      darkMode: true,
    });

    assert.ok(svg.includes("<svg"), "Should output valid SVG root");
    assert.ok(svg.includes("Optogenetically Modulated Hippocampal"), "Should include session title");
    assert.ok(svg.includes("Sorted Multi-Unit Spike Raster"), "Should render spike raster plot");
    assert.ok(svg.includes("Unit #1"), "Should include unit 1 label");
    assert.ok(svg.includes("Population Firing Rate (PSTH"), "Should render PSTH subplot");
    assert.ok(svg.includes("Local Field Potential (LFP) Oscilloscope"), "Should render LFP oscilloscope");
    assert.ok(svg.includes("Opto_Laser"), "Should render stimulus event banner");
  });
});
