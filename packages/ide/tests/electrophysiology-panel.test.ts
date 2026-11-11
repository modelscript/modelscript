// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseNmodl, solveNmodlActionPotential } from "@modelscript/nmodl";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ElectrophysiologyPanel,
  NmodlEditorProvider,
  renderElectrophysiologyHtml,
} from "../src/electrophysiology-panel.js";

const SAMPLE_HH_NMODL = `TITLE Squid axon sodium potassium channel
NEURON {
  SUFFIX hh
  USEION na READ ena WRITE ina
  USEION k READ ek WRITE ik
  NONSPECIFIC_CURRENT il
  RANGE gnabar, gkbar, gl, el
}

PARAMETER {
  gnabar = 0.12 (mho/cm2)
  gkbar = 0.036 (mho/cm2)
  gl = 0.0003 (mho/cm2)
  ena = 50.0 (mV)
  ek = -77.0 (mV)
  el = -54.3 (mV)
}

STATE {
  m
  h
  n
}

BREAKPOINT {
  SOLVE states METHOD cnexp
  ina = gnabar * m^3 * h * (v - ena)
  ik = gkbar * n^4 * (v - ek)
  il = gl * (v - el)
}

DERIVATIVE states {
  m' = (minf - m) / mtau
  h' = (hinf - h) / htau
  n' = (ninf - n) / ntau
}
`;

describe("Electrophysiology & Action Potential Oscilloscope Dashboard", () => {
  it("exposes ElectrophysiologyPanel and NmodlEditorProvider viewType identifiers", () => {
    assert.equal(ElectrophysiologyPanel.viewType, "modelscript.electrophysiologyViewer");
    assert.equal(NmodlEditorProvider.viewType, "modelscript.nmodlEditor");
  });

  it("solves Hodgkin-Huxley action potential under current clamp injection", () => {
    const doc = parseNmodl(SAMPLE_HH_NMODL);
    const sim = solveNmodlActionPotential(doc, {
      tEnd: 25.0,
      dt: 0.05,
      stimAmp: 10.0,
      vInit: -65.0,
    });

    assert.ok(sim.time.length > 100);
    assert.ok(sim.v.length === sim.time.length);
    assert.ok(sim.vPeak > 20.0, "Action potential peak should exceed +20 mV");
    assert.ok(sim.states["m"] && sim.states["m"].length > 0);
    assert.ok(sim.states["h"] && sim.states["h"].length > 0);
    assert.ok(sim.states["n"] && sim.states["n"].length > 0);
  });

  it("renders multi-compartment morphological cable and publication phase portrait in HTML", () => {
    const doc = parseNmodl(SAMPLE_HH_NMODL);
    const sim = solveNmodlActionPotential(doc, {
      tEnd: 25.0,
      dt: 0.05,
      stimAmp: 12.5,
      vInit: -65.0,
    });

    const html = renderElectrophysiologyHtml(doc, sim, 12.5);

    // Verify Tab Switching views
    assert.ok(html.includes('id="tab-grid"'), "Should contain All-in-One Grid tab");
    assert.ok(html.includes('id="tab-cable"'), "Should contain Morphological Cable tab");
    assert.ok(html.includes('id="tab-oscilloscope"'), "Should contain Oscilloscope tab");
    assert.ok(html.includes('id="tab-phase"'), "Should contain Phase Portrait tab");

    // Verify Morphological Cable arborization and channel badges
    assert.ok(html.includes('id="cable-svg-container"'), "Should contain morphological cable container");
    assert.ok(html.includes("Multi-Compartment Cable Neuron Arborization"), "Should include cable title");
    assert.ok(html.includes("Soma") && html.includes("AIS"), "Should render anatomical soma and AIS compartments");
    assert.ok(html.includes("Nav1.6") || html.includes("Nav"), "Should display Nav channel badges");
    assert.ok(html.includes("Kv"), "Should display Kv channel badges");

    // Verify Controls (Current clamp slider and time scrubber)
    assert.ok(html.includes('id="amp-slider"'), "Should contain current clamp slider");
    assert.ok(html.includes('id="time-slider"'), "Should contain simulation time scrubber slider");
    assert.ok(html.includes('id="btn-play"'), "Should contain timeline play/pause button");

    // Verify Dual-Trace and Phase Plane Canvases
    assert.ok(html.includes('id="vm-canvas"'), "Should contain Vm(t) oscilloscope canvas");
    assert.ok(html.includes('id="gating-canvas"'), "Should contain gating kinetics canvas");
    assert.ok(html.includes('id="phase-canvas"'), "Should contain phase-plane canvas");
    assert.ok(html.includes('id="phase-svg-container"'), "Should contain publication-grade phase SVG");
  });
});
