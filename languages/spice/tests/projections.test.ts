// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { modelicaToSpice, parseSpice, spiceToModelica, spiceToNetlistGraph } from "../src/index.js";

describe("SPICE Projections (@modelscript/spice)", () => {
  it("should project SPICE netlist to idiomatic Modelica 3.x", () => {
    const netlist = `* RLC Filter
V1 in 0 DC 5
R1 in out 100
C1 out 0 10u
.END`;
    const circuit = parseSpice(netlist);
    const modelica = spiceToModelica(circuit, "RlcFilter");

    assert.ok(modelica.includes("model RlcFilter"));
    assert.ok(modelica.includes("Modelica.Electrical.Analog.Basic.Resistor R1(R=100);"));
    assert.ok(modelica.includes("Modelica.Electrical.Analog.Basic.Capacitor C1("));
    assert.ok(modelica.includes("Modelica.Electrical.Analog.Basic.Ground ground;"));
    assert.ok(modelica.includes("connect("));
    assert.ok(modelica.includes("end RlcFilter;"));
  });

  it("should roundtrip Modelica electrical circuit back to SPICE", () => {
    const modelicaText = `model SimpleCircuit
  Modelica.Electrical.Analog.Basic.Resistor R1(R=500);
  Modelica.Electrical.Analog.Basic.Capacitor C1(C=0.001);
  Modelica.Electrical.Analog.Basic.Ground ground;
equation
  connect(R1.p, C1.p);
  connect(C1.n, ground.p);
end SimpleCircuit;`;

    const circuit = modelicaToSpice(modelicaText);
    assert.strictEqual(circuit.components.length, 2);
    const r1 = circuit.components.find((c) => c.name === "R1");
    const c1 = circuit.components.find((c) => c.name === "C1");

    assert.ok(r1 && c1);
    assert.strictEqual(r1.value, 500);
    assert.strictEqual(c1.value, 0.001);
    // They share node R1.p and C1.p
    assert.strictEqual(r1.nodes[0], c1.nodes[0]);
  });

  it("should project SPICE netlist to ECAD NetlistGraph for PCB layout and DRC", () => {
    const netlist = `* PCB Circuit
R1 vcc out 1k
C1 out 0 100n
R2 out 0 10k
.END`;
    const circuit = parseSpice(netlist);
    const graph = spiceToNetlistGraph(circuit);

    assert.strictEqual(graph.components.length, 3);
    assert.strictEqual(graph.totalPins, 6);
    assert.ok(graph.totalConnections >= 2);

    const netOut = graph.nets.find((n) => n.id === "NET_OUT");
    assert.ok(netOut);
    // Pins attached to OUT net: R1.n, C1.p, R2.p
    assert.strictEqual(netOut.pins.length, 3);
  });
});
