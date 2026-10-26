// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { parseSpice, parseSpiceNumber, serializeSpice } from "../src/index.js";

const SAMPLE_CIRCUIT = `* RC Low-Pass Filter with OpAmp Subcircuit
.PARAM R_val=1k C_val={100n} V_in=5

* Top-level sources and components
V1 in 0 DC {V_in} AC 1 PULSE(0 5 0 1u 1u 10u 20u)
R1 in n1 {R_val}
C1 n1 0 {C_val}
D1 n1 0 D1N4148

* Active devices
Q1 col base emit 0 2N2222
M1 vd vg vs 0 NMOS_MODEL L=1u W=10u

* Subcircuit call
X1 n1 out OPAMP_BUFFER

* Models
.MODEL D1N4148 D (IS=2.52n RS=0.568 N=1.752)
.MODEL 2N2222 NPN (IS=1e-14 BF=200 VAF=100)
.MODEL NMOS_MODEL NMOS (VTO=0.7 KP=1e-4)

* Subcircuit definition
.SUBCKT OPAMP_BUFFER in_pin out_pin
  E1 out_pin 0 in_pin 0 1.0
  R_load out_pin 0 10k
.ENDS OPAMP_BUFFER

* Directives
.TRAN 0.1u 50u
.AC DEC 10 10 100k
.GLOBAL vdd vss
.END
`;

describe("SPICE Netlist Parser (@modelscript/spice)", () => {
  it("should parse engineering multipliers and scientific numbers correctly", () => {
    assert.strictEqual(parseSpiceNumber("1k"), 1000);
    assert.strictEqual(parseSpiceNumber("2.5K"), 2500);
    assert.strictEqual(parseSpiceNumber("10m"), 0.01);
    assert.strictEqual(parseSpiceNumber("10MEG"), 10000000);
    assert.ok(Math.abs(parseSpiceNumber("100n") - 1e-7) < 1e-15);
    assert.strictEqual(parseSpiceNumber("4.7u"), 4.7e-6);
    assert.strictEqual(parseSpiceNumber("10p"), 1e-11);
    assert.strictEqual(parseSpiceNumber("100f"), 1e-13);
    assert.strictEqual(parseSpiceNumber("1G"), 1e9);
    assert.strictEqual(parseSpiceNumber("1T"), 1e12);
    assert.strictEqual(parseSpiceNumber("10mil"), 254e-6);
    assert.strictEqual(parseSpiceNumber("1.5e-3"), 0.0015);
  });

  it("should evaluate math expressions in curly braces", () => {
    const params = new Map<string, number>();
    params.set("R_BASE", 500);
    assert.strictEqual(parseSpiceNumber("{R_BASE * 2}", params), 1000);
    assert.strictEqual(parseSpiceNumber("{1k + 200}", params), 1200);
    assert.strictEqual(parseSpiceNumber("{2 * pi * 1k}", params), 2000 * Math.PI);
  });

  it("should parse components, directives, models, and subcircuits", () => {
    const circuit = parseSpice(SAMPLE_CIRCUIT);

    assert.strictEqual(circuit.title, "RC Low-Pass Filter with OpAmp Subcircuit");
    assert.strictEqual(circuit.components.length, 7); // V1, R1, C1, D1, Q1, M1, X1

    // Check V1
    const v1 = circuit.components.find((c) => c.name.toUpperCase() === "V1");
    assert.ok(v1);
    assert.strictEqual(v1.kind, "V");
    assert.strictEqual(v1.nodes[0], "in");
    assert.strictEqual(v1.nodes[1], "0");
    assert.ok(v1.sourceSpec);
    assert.strictEqual(v1.sourceSpec.dc, 5);
    assert.strictEqual(v1.sourceSpec.acMag, 1);
    assert.strictEqual(v1.sourceSpec.waveform?.kind, "PULSE");

    // Check R1 & C1
    const r1 = circuit.components.find((c) => c.name.toUpperCase() === "R1");
    assert.ok(r1);
    assert.strictEqual(r1.value, 1000);

    const c1 = circuit.components.find((c) => c.name.toUpperCase() === "C1");
    assert.ok(c1);
    assert.ok(Math.abs((c1.value ?? 0) - 100e-9) < 1e-15);

    // Check Models
    assert.strictEqual(circuit.models.size, 3);
    const dModel = circuit.models.get("D1N4148");
    assert.ok(dModel);
    assert.strictEqual(dModel.type, "D");
    assert.strictEqual(dModel.params.get("RS"), 0.568);

    // Check Subcircuits
    assert.strictEqual(circuit.subcircuits.size, 1);
    const opamp = circuit.subcircuits.get("OPAMP_BUFFER");
    assert.ok(opamp);
    assert.deepStrictEqual(opamp.ports, ["in_pin", "out_pin"]);
    assert.strictEqual(opamp.components.length, 2);

    // Check Directives
    const tran = circuit.directives.find((d) => d.kind === ".TRAN");
    assert.ok(tran);
    assert.strictEqual(tran.args[0], "0.1u");
    assert.strictEqual(tran.args[1], "50u");

    const ac = circuit.directives.find((d) => d.kind === ".AC");
    assert.ok(ac);
    assert.strictEqual(ac.args[0], "DEC");

    // Check Globals
    assert.ok(circuit.globalNodes.has("0"));
    assert.ok(circuit.globalNodes.has("vdd"));
    assert.ok(circuit.globalNodes.has("vss"));
  });

  it("should handle line continuations (+) and comments (*, ;, //)", () => {
    const netlist = `* Comment header
R1 in out
+ 1k ; inline comment
C1 out 0 10n $ another comment
// C++ style comment
.TRAN
+ 1u
+ 10u
.END`;
    const circuit = parseSpice(netlist);
    assert.strictEqual(circuit.components.length, 2);
    const r1 = circuit.components[0];
    assert.strictEqual(r1?.value, 1000);

    const tran = circuit.directives.find((d) => d.kind === ".TRAN");
    assert.ok(tran);
    assert.strictEqual(tran.args.length, 2);
  });

  it("should perform lossless serialization back to SPICE text", () => {
    const circuit = parseSpice(SAMPLE_CIRCUIT);
    const serialized = serializeSpice(circuit);
    assert.ok(serialized.includes(".SUBCKT OPAMP_BUFFER"));
    assert.ok(serialized.includes(".MODEL D1N4148"));
    assert.ok(serialized.includes(".TRAN"));
    assert.ok(serialized.includes(".END"));

    // Re-parse serialized output
    const roundtrip = parseSpice(serialized);
    assert.strictEqual(roundtrip.components.length, circuit.components.length);
    assert.strictEqual(roundtrip.models.size, circuit.models.size);
    assert.strictEqual(roundtrip.subcircuits.size, circuit.subcircuits.size);
  });
});
