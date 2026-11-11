// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  attachActionPotentialTrajectory,
  buildNmodlDiagram,
  renderNmodlDiagramSvg,
} from "../src/nmodl-diagram-builder.js";
import {
  attachSimulationTrajectoryToPkDiagram,
  buildPkDiagramFromGeneric,
  reconcilePkDiagramChangeToMlxtran,
  renderPkDiagramSvg,
} from "../src/pk-diagram-builder.js";

describe("Scientific & Electrophysiology Diagrams Convergence", () => {
  it("builds PK/PD diagram, attaches simulation trajectories, and renders sparklines", () => {
    const graph = buildPkDiagramFromGeneric({
      title: "Warfarin 2-Compartment Model",
      hasDepot: true,
      hasPeripheral: true,
    });

    assert.equal(graph.compartments.length, 4); // depot, central, peripheral, excretion

    const trajectories = {
      depot: {
        times: [0, 1, 2, 4, 8, 12, 24],
        values: [100, 45, 20, 5, 0.8, 0.1, 0.0],
      },
      central: {
        times: [0, 1, 2, 4, 8, 12, 24],
        values: [0, 15.2, 18.4, 14.1, 8.5, 4.2, 0.9],
      },
      peripheral: {
        times: [0, 1, 2, 4, 8, 12, 24],
        values: [0, 3.1, 7.5, 9.8, 6.2, 3.1, 0.5],
      },
    };

    attachSimulationTrajectoryToPkDiagram(graph, trajectories);

    const centralNode = graph.compartments.find((c) => c.id === "central");
    assert.ok(centralNode?.sparklineSvg);
    assert.ok(centralNode.sparklineSvg.includes("<polyline"));
    assert.ok(centralNode.peakConcentration && centralNode.peakConcentration > 18.0);

    const svg = renderPkDiagramSvg(graph, "dark");
    assert.ok(svg.includes("Warfarin 2-Compartment Model"));
    assert.ok(svg.includes("Cmax: 18.40"));
  });

  it("reconciles visual diagram modifications back into MLXTRAN source code", () => {
    const originalMlxtran = `[LONGITUDINAL]
input = {ka = 0.5, V = 10.0, Cl = 1.2}

EQUATION:
ddt_A_depot = -ka * A_depot
ddt_A_central = ka * A_depot - (Cl / V) * A_central
Cc = A_central / V
`;

    // 1. Add peripheral compartment
    const withPeripheral = reconcilePkDiagramChangeToMlxtran(originalMlxtran, {
      type: "add_peripheral",
      v2Param: "V2",
      qParam: "Q",
    });

    assert.ok(withPeripheral.includes("V2 = 20.0"));
    assert.ok(withPeripheral.includes("Q = 5.0"));
    assert.ok(withPeripheral.includes("ddt_A_peripheral = (Q / V) * A_central - (Q / V2) * A_peripheral"));
    assert.ok(
      withPeripheral.includes("-(Q / V) * A_central + (Q / V2) * A_peripheral") ||
        withPeripheral.includes("(Q / V) * A_central"),
    );

    // 2. Update parameter
    const updatedParam = reconcilePkDiagramChangeToMlxtran(originalMlxtran, {
      type: "update_parameter",
      name: "ka",
      value: 1.25,
    });
    assert.ok(updatedParam.includes("ka = 1.25"));

    // 3. Add dosing
    const withDosing = reconcilePkDiagramChangeToMlxtran(originalMlxtran, {
      type: "add_dosing",
      targetId: "central",
      route: "iv",
    });
    assert.ok(withDosing.includes("iv(cmt=1)"));
  });

  it("builds NMODL membrane circuit diagram and renders action potential sparkline with AP metrics", () => {
    const graph = buildNmodlDiagram({
      mechanismName: "SquidAxonHH",
      membraneCapacitanceUf: 1.0,
      hasElectrode: true,
    });

    assert.equal(graph.channels.length, 3); // Nav, Kv, Leak
    assert.equal(graph.electrodes.length, 1);

    // Simulate Hodgkin-Huxley action potential spike
    const times: number[] = [];
    const vm: number[] = [];
    for (let t = 0; t <= 20; t += 0.5) {
      times.push(t);
      // Spike centered around t=5ms
      const spike = t >= 3 && t <= 10 ? -65 + 105 * Math.exp(-Math.pow(t - 5.5, 2) / 2.5) : -65;
      vm.push(spike);
    }

    attachActionPotentialTrajectory(graph, { times, vm });

    assert.ok(graph.peakVoltageMv && graph.peakVoltageMv > 30.0); // Peak around +40 mV
    assert.ok(graph.apDurationMs && graph.apDurationMs > 0);

    const svg = renderNmodlDiagramSvg(graph, "dark");
    assert.ok(svg.includes("SquidAxonHH Membrane Circuit"));
    assert.ok(svg.includes("Intracellular (Vm)"));
    assert.ok(svg.includes("Extracellular (Ground 0 mV)"));
    assert.ok(svg.includes("Action Potential Vm(t)"));
    assert.ok(svg.includes("Peak Vm: 40.0 mV"));
  });
});
