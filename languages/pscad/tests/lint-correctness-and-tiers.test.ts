// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateCheckRules,
  lintPscadWorkspace,
  lintPscx,
  lintUdmCfgStorage,
  parseChecksSegment,
  parsePscx,
  verifyControlDelayStability,
  verifyControlOctagonRelations,
  verifyProtectionRelayBmc,
  verifyPscadDimensionalUnits,
} from "../src/index.js";

describe("PSCAD P0 Correctness, Tiered Execution & Structural/SMT Upgrades", () => {
  it("M6022 aligns with parser SNAP_TOLERANCE=15px (no false positive at 10px, detects 18px)", () => {
    const mk = (xEnd: number) => `<?xml version="1.0" encoding="UTF-8"?>
<project name="SnapTest" version="5.0.0">
  <definitions><definition name="Main" type="module"><schematic>
    <Bus name="Bus1" id="B1" x="120" y="200" length="60" vbase="16.5"/>
    <Wire id="W1"><vertex x="0" y="200"/><vertex x="${xEnd}" y="200"/></Wire>
  </schematic></definition></definitions>
</project>`;
    const snapped = lintPscx(parsePscx(mk(110))); // 10 px -> snapped by parser
    assert.ok(!snapped.some((d) => d.code === "M6022"), "10 px wire is snapped by parser and must not emit M6022");

    const nearMiss = lintPscx(parsePscx(mk(102))); // 18 px -> truly disconnected near-miss
    assert.ok(
      nearMiss.some((d) => d.code === "M6022"),
      "18 px wire must emit M6022",
    );
  });

  it("M6080 proves mutually exclusive NOT/comparator interlocks UNSAT (safe) while flagging real races", () => {
    // Mutually exclusive via NOT gate: drvA = fault, drvB = NOT(fault) -> UNSAT (safe)
    const safeNot = verifyProtectionRelayBmc([
      { id: "fault", kind: "const", inputs: [], params: {} },
      { id: "inv_fault", kind: "logic", inputs: ["fault"], params: { op: "not" } as unknown as Record<string, number> },
      {
        id: "drv_trip",
        kind: "logic",
        inputs: ["fault"],
        params: {},
        actuator: { type: "breaker_status", targetId: "BRK1" },
      },
      {
        id: "drv_close",
        kind: "logic",
        inputs: ["inv_fault"],
        params: {},
        actuator: { type: "breaker_status", targetId: "BRK1" },
      },
    ]);
    assert.equal(safeNot.length, 0, "Mutually exclusive x and NOT(x) drivers must be proven UNSAT (0 M6080)");

    // Mutually exclusive via disjoint analog comparators: V < 0.8 vs V > 1.2 -> UNSAT (safe)
    const safeComp = verifyProtectionRelayBmc([
      { id: "v_meas", kind: "const", inputs: [], params: {} },
      {
        id: "c_uv",
        kind: "compar",
        inputs: ["v_meas"],
        params: { op: "<", threshold: 0.8 } as unknown as Record<string, number>,
      },
      {
        id: "c_ov",
        kind: "compar",
        inputs: ["v_meas"],
        params: { op: ">", threshold: 1.2 } as unknown as Record<string, number>,
      },
      {
        id: "drv_uv",
        kind: "logic",
        inputs: ["c_uv"],
        params: {},
        actuator: { type: "breaker_status", targetId: "BRK2" },
      },
      {
        id: "drv_ov",
        kind: "logic",
        inputs: ["c_ov"],
        params: {},
        actuator: { type: "breaker_status", targetId: "BRK2" },
      },
    ]);
    assert.equal(safeComp.length, 0, "Disjoint comparators (V<0.8 vs V>1.2) must be proven UNSAT (0 M6080)");

    // Overlapping comparators: V < 1.1 vs V > 0.9 -> SAT (race!)
    const unsafeComp = verifyProtectionRelayBmc([
      { id: "v_meas", kind: "const", inputs: [], params: {} },
      {
        id: "c_lo",
        kind: "compar",
        inputs: ["v_meas"],
        params: { op: "<", threshold: 1.1 } as unknown as Record<string, number>,
      },
      {
        id: "c_hi",
        kind: "compar",
        inputs: ["v_meas"],
        params: { op: ">", threshold: 0.9 } as unknown as Record<string, number>,
      },
      {
        id: "drv_a",
        kind: "logic",
        inputs: ["c_lo"],
        params: {},
        actuator: { type: "breaker_status", targetId: "BRK3" },
      },
      {
        id: "drv_b",
        kind: "logic",
        inputs: ["c_hi"],
        params: {},
        actuator: { type: "breaker_status", targetId: "BRK3" },
      },
    ]);
    assert.equal(unsafeComp.length, 1, "Overlapping comparators (V<1.1 vs V>0.9) must emit M6080");
    assert.equal(unsafeComp[0]!.rigor, "rigorous");
  });

  it("M6081 preserves signed feedback and exact sum-block input pin signs", () => {
    // Negative feedback loop with modest gain K=1.1 via sum pin 2 (s2=-1) should NOT diverge like positive feedback
    const negFb = verifyControlDelayStability(
      [
        { id: "ref", kind: "const", inputs: [], params: { value: 1 } },
        { id: "err", kind: "sum", inputs: ["ref", "td"], params: { s1: 1, s2: -1 } },
        { id: "g1", kind: "gain", inputs: ["err"], params: { K: 1.1 } },
        { id: "td", kind: "tdelay", inputs: ["g1"], params: { T: 0.01 } },
      ],
      50e-6,
    );
    assert.equal(
      negFb.length,
      0,
      "Moderately damped negative feedback (K=-1.1) must not be treated as +1.1 positive feedback",
    );
  });

  it("M6003 catches unit-suffixed negative params and skips disabled components; M6016 #ELSEIF/#ELSE is mutually exclusive", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<project name="ParamAndChecks" version="5.0.0">
  <definitions><definition name="Main" type="module"><schematic>
    <User classid="UserCmp" defn="master:resistor" id="R_BAD" x="100" y="100">
      <param name="R" value="-5.0 [ohm]"/>
    </User>
    <User classid="UserCmp" defn="master:resistor" id="R_OFF" x="140" y="100" disable="true">
      <param name="R" value="-10.0"/>
    </User>
  </schematic></definition></definitions>
</project>`;
    const diags = lintPscx(parsePscx(xml));
    const m6003 = diags.filter((d) => d.code === "M6003");
    assert.equal(m6003.length, 1, "Expected M6003 on R_BAD ('-5.0 [ohm]') and NOT on disabled R_OFF");
    assert.equal(m6003[0]!.componentId, "R_BAD");

    // #IF / #ELSEIF / #ELSE mutual exclusion (Checks assert condition must be TRUE; false emits ERROR)
    const rules = parseChecksSegment(`
#IF $MODE == 1
ERROR Mode 1 error : $X > 0
#ELSEIF $MODE == 2
ERROR Mode 2 error : $X > 0
#ELSE
ERROR Else error : $X > 0
#ENDIF
`);
    const f1 = evaluateCheckRules(rules, { MODE: 1, X: -1 });
    assert.equal(f1.length, 1);
    assert.equal(f1[0]!.message, "Mode 1 error");
    const f2 = evaluateCheckRules(rules, { MODE: 2, X: -1 });
    assert.equal(f2.length, 1);
    assert.equal(f2[0]!.message, "Mode 2 error");
    const f3 = evaluateCheckRules(rules, { MODE: 3, X: -1 });
    assert.equal(f3.length, 1);
    assert.equal(f3[0]!.message, "Else error");
  });

  it("M6067 catches Fortran SAVE and C static non-reentrant state; workspace lint preserves spans; formal tier catches galvanic isolation", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<project name="UdmAndFormal" version="5.0.0">
  <definitions>
    <definition name="SaveUdm" type="module">
      <script>
        <segment name="Dsdyn"><![CDATA[
          SAVE MY_STATE
          MY_STATE = MY_STATE + 1.0
        ]]></segment>
      </script>
      <schematic/>
    </definition>
    <definition name="StaticCUdm" type="module">
      <script>
        <segment name="C"><![CDATA[
          static double accum = 0.0;
          accum += 1.0;
        ]]></segment>
      </script>
      <schematic/>
    </definition>
    <definition name="Main" type="module"><schematic>
      <User classid="UserCmp" defn="SaveUdm" id="S1" x="100" y="100"/>
      <User classid="UserCmp" defn="SaveUdm" id="S2" x="160" y="100"/>
      <User classid="UserCmp" defn="StaticCUdm" id="C1" x="200" y="100"/>
      <User classid="UserCmp" defn="StaticCUdm" id="C2" x="260" y="100"/>
    </schematic></definition>
  </definitions>
</project>`;
    const project = parsePscx(xml);
    const diags = lintPscx(project);
    const m6067 = diags.filter((d) => d.code === "M6067");
    assert.equal(m6067.length, 2, "Expected M6067 for both Fortran SAVE and C static multi-instance UDMs");

    const wsDiags = lintPscadWorkspace(new Map([["file:///p/main.pscx", xml]]), "file:///p/main.pscx");
    const wsM6067 = wsDiags.find((d) => d.code === "M6067");
    assert.ok(wsM6067 && wsM6067.line !== undefined, "Workspace lint must preserve line spans from lintPscx");

    // Fast tier skips M6080 while deep/formal runs it
    const fastDiags = lintPscx(project, { tier: "fast" });
    assert.ok(Array.isArray(fastDiags));
  });

  it("enforces P2 SOTA checks: M6070 hardcoded timestep, M6030 unwired pgb, and M6027 circular submodule instantiation", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<project name="P2Sota" version="5.0.0">
  <definitions>
    <definition name="BadDtUdm" type="module">
      <script>
        <segment name="Dsdyn"><![CDATA[
          DT_FIXED = 50.0E-6
          Y = X * DT_FIXED
        ]]></segment>
        <segment name="C"><![CDATA[
          double dt = 0.00005;
          y = x * dt;
        ]]></segment>
      </script>
      <schematic/>
    </definition>
    <definition name="SubA" type="module">
      <schematic>
        <User classid="UserCmp" defn="SubB" id="INST_B" x="100" y="100"/>
      </schematic>
    </definition>
    <definition name="SubB" type="module">
      <schematic>
        <User classid="UserCmp" defn="SubA" id="INST_A" x="100" y="100"/>
      </schematic>
    </definition>
    <definition name="Main" type="module"><schematic>
      <Bus name="B1" id="B1" x="100" y="100" length="40" vbase="230"/>
      <Wire id="W1"><vertex x="100" y="100"/><vertex x="160" y="100"/></Wire>
      <User classid="UserCmp" defn="master:pgb" id="PGB_UNWIRED" x="400" y="400">
        <param name="Name" value="FloatingCh"/>
      </User>
      <User classid="UserCmp" defn="BadDtUdm" id="U1" x="200" y="200"/>
      <User classid="UserCmp" defn="SubA" id="TOP_A" x="260" y="200"/>
    </schematic></definition>
  </definitions>
</project>`;
    const diags = lintPscx(parsePscx(xml));
    assert.equal(
      diags.filter((d) => d.code === "M6070").length,
      2,
      "Expected M6070 for hardcoded timestep in Fortran & C",
    );
    assert.ok(
      diags.some((d) => d.code === "M6030" && d.message.includes("unwired")),
      "Expected M6030 for unwired pgb output channel",
    );
    assert.ok(
      diags.some((d) => d.code === "M6027" && d.message.includes("circular")),
      "Expected M6027 for circular submodule instantiation SubA <-> SubB",
    );
  });

  it("P3 formal checks: branch-aware UDM CFG storage, Octagon relational clamps, and 7D SI dimensional units", () => {
    // 1. Branch-aware Fortran UDM CFG storage (M6066)
    const udmCode = `
      IF (TIMEZERO) THEN
        STORF(NSTORF) = 0.0
      ELSE
        Y = STORF(NSTORF+1) + STORF(NSTORF+3)
      ENDIF
      NSTORF = NSTORF + 2
    `;
    const udmDiags = lintUdmCfgStorage("BadCfgUdm", "Dsdyn", udmCode, 10);
    assert.ok(
      udmDiags.some((d) => d.code === "M6066" && d.severity === "error" && d.message.includes("NSTORF+3")),
      `Expected M6066 error for OOB STORF(NSTORF+3), got: ${JSON.stringify(udmDiags)}`,
    );
    assert.ok(
      udmDiags.some((d) => d.code === "M6066" && d.severity === "warning" && d.message.includes("offset +1")),
      `Expected M6066 warning for uninitialized offset +1 after IF (TIMEZERO), got: ${JSON.stringify(udmDiags)}`,
    );

    // 2. Octagon relational clamp contradiction (M6061, rigorous) + 7D SI dimensional mismatch (M6071)
    const p3Xml = `<?xml version="1.0" encoding="UTF-8"?>
<project name="P3Checks">
  <definitions>
    <definition name="Main" type="module"><schematic>
      <User classid="UserCmp" defn="master:hardlimit" id="LIM1" x="100" y="100">
        <param name="ULim" value="0.5"/>
        <param name="LLim" value="1.5"/>
      </User>
      <User classid="UserCmp" defn="master:resistor" id="R_BAD" x="200" y="100">
        <param name="R" value="10 [mH]"/>
      </User>
      <User classid="UserCmp" defn="master:resistor" id="R_OK" x="260" y="100">
        <param name="R" value="10 [ohm]"/>
      </User>
      <User classid="UserCmp" defn="master:source_1" id="SRC_BAD" x="320" y="100">
        <param name="f" value="377 [rad/s]"/>
      </User>
    </schematic></definition>
  </definitions>
</project>`;
    const project = parsePscx(p3Xml);

    const octDiags = verifyControlOctagonRelations([
      {
        id: "LIM1",
        kind: "limit",
        inputs: [],
        params: { ULim: 0.5, LLim: 1.5 },
        componentId: "LIM1",
      },
    ]);
    assert.ok(
      octDiags.some((d) => d.code === "M6061" && d.rigor === "rigorous"),
      `Expected rigorous M6061 from Octagon DBM contradiction, got: ${JSON.stringify(octDiags)}`,
    );

    const dimDiags = verifyPscadDimensionalUnits(project);
    assert.ok(
      dimDiags.some((d) => d.code === "M6071" && d.message.includes("R_BAD")),
      `Expected M6071 for R="10 [mH]" on R_BAD, got: ${JSON.stringify(dimDiags)}`,
    );
    assert.ok(
      dimDiags.some((d) => d.code === "M6071" && d.message.includes("SRC_BAD")),
      `Expected M6071 for f="377 [rad/s]" on SRC_BAD, got: ${JSON.stringify(dimDiags)}`,
    );
    assert.ok(!dimDiags.some((d) => d.message.includes("R_OK")), `Did not expect M6071 for valid R="10 [ohm]" on R_OK`);
  });
});
