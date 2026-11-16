// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintPscx } from "../src/lints/index.js";
import { parsePscx } from "../src/parser/pscx-parser.js";
import { checkRationalPassivity, enforceRationalPassivity } from "../src/solver/vector-fitting.js";

describe("PSCAD M6028/M6032/M6042/M6045/M6047/M6048/M6049 pre-flight checks & ULM passivity", () => {
  it("detects M6028, M6032, M6042, M6045, M6047, M6048, and M6049", () => {
    // Project packing:
    // - sample_step=500 with time_step=25 and bridge -> M6042
    // - Bus B1 vbase=230 with source_3p V=325.27 (sqrt(2)*230) -> M6032
    // - master:thyristor without snubber & no CDA -> M6045
    // - master:xfmr-3p2w saturable with remanentFlux > kneeFlux -> M6048
    // - master:tline explicit non-passive poles/residues -> M6047
    // - series capacitor in series with inductive line at SSR frequency (~20 Hz) -> M6049
    // - unsupported widget component -> M6028
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<project name="Batch4Test" version="5.0.0">
  <param name="time_step" value="25.0"/>
  <param name="sample_step" value="500.0"/>
  <param name="time_duration" value="0.5"/>
  <param name="f_base" value="60.0"/>
  <definitions><definition name="Main" type="module"><schematic>
    <Bus name="B1" id="B1" x="100" y="100" length="20" vbase="230.0"/>
    <Bus name="B2" id="B2" x="220" y="100" length="20" vbase="230.0"/>
    <Bus name="B3" id="B3" x="340" y="100" length="20" vbase="230.0"/>
    <Bus name="B4" id="B4" x="460" y="100" length="20" vbase="230.0"/>
    <User classid="UserCmp" defn="master:source_3p" id="S1" x="60" y="100">
      <param name="Name" value="S1"/><param name="V" value="325.27"/><param name="R" value="1.0"/>
      <port name="out" pos="[20,0]"/>
    </User>
    <Wire><vertex x="80" y="100"/><vertex x="100" y="100"/></Wire>
    <User classid="UserCmp" defn="master:tline" id="L1" x="170" y="100">
      <param name="Name" value="L1"/><param name="Length" value="100"/><param name="L" value="0.002"/>
      <param name="poles" value="-100, -500"/><param name="residues" value="1.0, -5000.0"/><param name="d0" value="0.001"/>
      <port name="in" pos="[-36,0]"/><port name="out" pos="[36,0]"/>
    </User>
    <Wire><vertex x="120" y="100"/><vertex x="134" y="100"/></Wire>
    <Wire><vertex x="206" y="100"/><vertex x="220" y="100"/></Wire>
    <User classid="UserCmp" defn="master:capacitor" id="Cser" x="290" y="100">
      <param name="Name" value="Cser"/><param name="C" value="300e-6"/>
      <port name="p1" pos="[-18,0]"/><port name="p2" pos="[18,0]"/>
    </User>
    <Wire><vertex x="240" y="100"/><vertex x="272" y="100"/></Wire>
    <Wire><vertex x="308" y="100"/><vertex x="340" y="100"/></Wire>
    <User classid="UserCmp" defn="master:xfmr-3p2w" id="Xsat" x="410" y="100">
      <param name="Name" value="Xsat"/><param name="V1" value="230"/><param name="V2" value="230"/>
      <param name="MVA" value="200"/><param name="X" value="0.1"/>
      <param name="Saturation" value="1"/><param name="L_unsat" value="500"/><param name="L_sat" value="10"/>
      <param name="knee_flux" value="400"/><param name="Remanence" value="550"/>
      <port name="N1" pos="[-54,0]"/><port name="N2" pos="[36,0]"/>
    </User>
    <Wire><vertex x="360" y="100"/><vertex x="356" y="100"/></Wire>
    <Wire><vertex x="446" y="100"/><vertex x="460" y="100"/></Wire>
    <User classid="UserCmp" defn="master:vsc_pwm" id="VSC1" x="500" y="100">
      <param name="Name" value="VSC1"/><param name="V" value="230"/><param name="MVA" value="100"/>
      <port name="ac" pos="[-20,0]"/>
    </User>
    <Wire><vertex x="480" y="100"/><vertex x="480" y="100"/></Wire>
    <User classid="UserCmp" defn="master:thyristor" id="THY1" x="500" y="160">
      <param name="Name" value="THY1"/>
      <port name="p1" pos="[-20,0]"/><port name="p2" pos="[20,0]"/>
    </User>
    <User classid="UserCmp" defn="vendor:unsupported_relay" id="REL1" x="150" y="200">
      <param name="Name" value="REL1"/>
    </User>
  </schematic></definition></definitions>
</project>`;
    const project = parsePscx(xml);
    const diags = lintPscx(project);
    const codes = new Set(diags.map((d) => d.code));

    for (const expected of ["M6028", "M6032", "M6042", "M6045", "M6047", "M6048", "M6049"]) {
      assert.ok(codes.has(expected), `Expected ${expected}, got: ${Array.from(codes).join(", ")}`);
    }
  });

  it("checks and enforces ULM rational passivity across frequencies", () => {
    const poles = new Float64Array([-100, -500]);
    const residues = new Float64Array([1.0, -5000.0]);
    const before = checkRationalPassivity(poles, residues, 0.001);
    assert.equal(before.passive, false);

    const fixed = enforceRationalPassivity(new Float64Array(poles), new Float64Array(residues), 0.001);
    const after = checkRationalPassivity(poles, fixed.residues, fixed.d0);
    assert.equal(after.passive, true);
  });
});
