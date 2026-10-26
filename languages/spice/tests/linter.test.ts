// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { lintSpiceCircuit, parseSpice } from "../src/index.js";

describe("SPICE Pre-Flight Linter (@modelscript/spice)", () => {
  it("M7101: should report floating nodes with only 1 connection and provide a quick-fix", () => {
    const netlist = `* Floating node test
V1 in 0 5
R1 in float_node 1k
.END`;
    const circuit = parseSpice(netlist);
    const diags = lintSpiceCircuit(circuit);

    const floatingDiag = diags.find((d) => d.code === 7101);
    assert.ok(floatingDiag, "Expected M7101 floating node diagnostic");
    assert.ok(floatingDiag.message.includes("'FLOAT_NODE'"));
    assert.ok(floatingDiag.quickFix, "Expected quick-fix for floating node");
    assert.ok(floatingDiag.quickFix.newText.includes("R_bleed_FLOAT_NODE FLOAT_NODE 0 1G"));
  });

  it("M7102: should detect ideal voltage source parallel loops", () => {
    const netlist = `* Parallel voltage sources
V1 in 0 5
V2 in 0 5
R1 in 0 1k
.END`;
    const circuit = parseSpice(netlist);
    const diags = lintSpiceCircuit(circuit);

    const vLoopDiag = diags.find((d) => d.code === 7102);
    assert.ok(vLoopDiag, "Expected M7102 voltage loop diagnostic");
    assert.strictEqual(vLoopDiag.severity, "error");
  });

  it("M7103: should detect ideal current cutsets", () => {
    const netlist = `* Current cutset
I1 in isolated 1m
I2 isolated 0 1m
.END`;
    const circuit = parseSpice(netlist);
    const diags = lintSpiceCircuit(circuit);

    const cutsetDiag = diags.find((d) => d.code === 7103);
    assert.ok(cutsetDiag, "Expected M7103 current cutset diagnostic");
  });

  it("M7104: should detect unresolved subcircuit references", () => {
    const netlist = `* Unresolved subcircuit
X1 in out MISSING_SUBCKT
.END`;
    const circuit = parseSpice(netlist);
    const diags = lintSpiceCircuit(circuit);

    const unresDiag = diags.find((d) => d.code === 7104);
    assert.ok(unresDiag, "Expected M7104 unresolved subcircuit diagnostic");
    assert.ok(unresDiag.message.includes("'MISSING_SUBCKT'"));
  });

  it("M7105: should detect invalid non-positive passive values", () => {
    const netlist = `* Invalid passive values
R1 in 0 -100
C1 in 0 0
.END`;
    const circuit = parseSpice(netlist);
    const diags = lintSpiceCircuit(circuit);

    const r1Diag = diags.find((d) => d.code === 7105 && d.message.includes("'R1'"));
    assert.ok(r1Diag, "Expected M7105 for negative resistor");

    const c1Diag = diags.find((d) => d.code === 7105 && d.message.includes("'C1'"));
    assert.ok(c1Diag, "Expected M7105 for zero capacitor");
  });

  it("M7106: should detect transient analysis timestep violations", () => {
    const netlist = `* Timestep violation
V1 in 0 5
R1 in 0 1k
.TRAN 10m 1m
.END`;
    const circuit = parseSpice(netlist);
    const diags = lintSpiceCircuit(circuit);

    const tranDiag = diags.find((d) => d.code === 7106);
    assert.ok(tranDiag, "Expected M7106 timestep violation diagnostic");
  });

  it("M7107: should detect duplicate component names", () => {
    const netlist = `* Duplicate components
R1 in 0 1k
R1 in 0 2k
.END`;
    const circuit = parseSpice(netlist);
    const diags = lintSpiceCircuit(circuit);

    const dupDiag = diags.find((d) => d.code === 7107);
    assert.ok(dupDiag, "Expected M7107 duplicate device diagnostic");
    assert.ok(dupDiag.message.includes("'R1'"));
  });

  it("M7108: should detect missing active device models", () => {
    const netlist = `* Missing active model
D1 in 0 D_UNDEFINED
.END`;
    const circuit = parseSpice(netlist);
    const diags = lintSpiceCircuit(circuit);

    const modelDiag = diags.find((d) => d.code === 7108);
    assert.ok(modelDiag, "Expected M7108 missing model diagnostic");
    assert.ok(modelDiag.message.includes("'D_UNDEFINED'"));
  });

  it("M7109: should detect subcircuit pin count mismatches", () => {
    const netlist = `* Pin count mismatch
.SUBCKT FILTER in out gnd
  R1 in out 1k
  C1 out gnd 10n
.ENDS FILTER

X1 node1 node2 FILTER
.END`;
    const circuit = parseSpice(netlist);
    const diags = lintSpiceCircuit(circuit);

    const pinDiag = diags.find((d) => d.code === 7109);
    assert.ok(pinDiag, "Expected M7109 pin count mismatch diagnostic");
    assert.ok(pinDiag.message.includes("connects 2 pins but definition 'FILTER' expects 3 ports"));
  });
});
