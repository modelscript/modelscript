// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDefaultNeuronMorphology,
  renderMorphologicalCableSvg,
  renderPhasePlaneSvg,
} from "../src/nmodl-diagram-builder.js";

describe("NMODL Morphological Cable Visualizer & Action Potential Phase Plane", () => {
  it("builds multi-compartment neuron morphology with anatomical segments and ion channel badges", () => {
    const cable = buildDefaultNeuronMorphology("SquidAxonHH", {
      injAmp: 15.0,
      somaVm: -65.0,
    });

    assert.equal(cable.mechanismName, "SquidAxonHH");
    assert.ok(cable.nodes.length >= 7, "Should contain at least 7 multi-compartment nodes");

    const soma = cable.nodes.find((n) => n.id === "soma");
    assert.ok(soma);
    assert.equal(soma.kind, "soma");
    assert.equal(soma.diameterUm, 20.0);
    assert.ok(soma.electrode && soma.electrode.ampNa === 15.0);
    assert.ok(soma.channels.some((c) => c.ion === "na"));
    assert.ok(soma.channels.some((c) => c.ion === "k"));
    assert.ok(soma.channels.some((c) => c.ion === "leak"));

    const ais = cable.nodes.find((n) => n.id === "ais");
    assert.ok(ais);
    assert.equal(ais.kind, "axon_initial_segment");
    const naBadge = ais.channels.find((c) => c.ion === "na");
    assert.ok(naBadge && naBadge.density > 2.0, "AIS should have dense Nav channels");

    const apical = cable.nodes.find((n) => n.id === "apical_trunk");
    assert.ok(apical);
    assert.equal(apical.parentId, "soma");
  });

  it("renders publication-grade anatomical cable SVG with channel badges and voltage heatmap", () => {
    const cable = buildDefaultNeuronMorphology("CorticalPyramidal", {
      injAmp: 10.0,
      somaVm: 35.0, // Depolarized action potential peak
    });

    const svgDark = renderMorphologicalCableSvg(cable, {
      theme: "dark",
      showChannelBadges: true,
      showVoltageHeatmap: true,
    });

    assert.ok(svgDark.includes("<svg"), "Should output valid SVG root");
    assert.ok(svgDark.includes("CorticalPyramidal Multi-Compartment Cable"), "Should include title");
    assert.ok(svgDark.includes("<ellipse"), "Should render anatomical soma ellipse body");
    assert.ok(svgDark.includes("Nav1.6"), "Should render Nav channel badge text");
    assert.ok(svgDark.includes("Kv4.2") || svgDark.includes("Kv"), "Should render Kv channel badge text");
    assert.ok(svgDark.includes("I_inj = 10.0 nA"), "Should render electrode pipet injection badge");
    assert.ok(svgDark.includes("50 µm"), "Should render anatomical scale bar");
    assert.ok(svgDark.includes("Membrane Vm"), "Should render voltage heatmap colormap legend");
    assert.ok(svgDark.includes("+40 mV (Peak)"), "Should show peak voltage marker in colormap");

    const svgLight = renderMorphologicalCableSvg(cable, {
      theme: "light",
      showChannelBadges: false,
    });
    assert.ok(svgLight.includes('style="background-color: #ffffff;'), "Should support light theme");
  });

  it("renders 2D limit cycle phase plane in Vm vs m mode", () => {
    // Generate synthetic action potential trajectory
    const times: number[] = [];
    const vm: number[] = [];
    const m: number[] = [];

    for (let t = 0; t <= 20; t += 0.2) {
      times.push(t);
      const v = t >= 3 && t <= 9 ? -65 + 100 * Math.exp(-Math.pow(t - 5.5, 2) / 2.0) : -65;
      vm.push(v);
      m.push(1 / (1 + Math.exp(-(v + 40) / 9)));
    }

    const svg = renderPhasePlaneSvg(
      { times, vm, m },
      {
        mode: "vm_vs_m",
        theme: "dark",
        vThreshMv: -55.0,
        vRestMv: -65.0,
      },
    );

    assert.ok(svg.includes("<svg"), "Should generate valid SVG");
    assert.ok(svg.includes("Phase Plane: Vm vs m"), "Should include phase plane title");
    assert.ok(svg.includes("V_th (-55 mV)"), "Should render threshold nullcline");
    assert.ok(svg.includes("Resting Point"), "Should render resting fixed point marker");
    assert.ok(svg.includes("Peak Vm"), "Should render peak depolarization point");
    assert.ok(svg.includes("<polyline"), "Should render limit cycle trajectory orbit");
    assert.ok(svg.includes("Activation Gating Variable m"), "Should label Y axis with m");
  });

  it("renders 2D action potential phase portrait in Vm vs dVm/dt mode", () => {
    const times: number[] = [];
    const vm: number[] = [];

    for (let t = 0; t <= 20; t += 0.2) {
      times.push(t);
      const v = t >= 3 && t <= 9 ? -65 + 100 * Math.exp(-Math.pow(t - 5.5, 2) / 2.0) : -65;
      vm.push(v);
    }

    const svg = renderPhasePlaneSvg(
      { times, vm },
      {
        mode: "vm_vs_dvdt",
        theme: "dark",
      },
    );

    assert.ok(svg.includes("Phase Portrait: Vm vs dVm/dt"));
    assert.ok(svg.includes("dVm/dt (mV / ms)"), "Should label Y axis with dVm/dt");
    assert.ok(svg.includes("Membrane Voltage Vm (mV)"), "Should label X axis with Vm");
    assert.ok(svg.includes("<polyline"), "Should render phase orbit");
  });
});
