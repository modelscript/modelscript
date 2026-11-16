// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clearPscxIncrementalCache,
  evaluateIeee2800StlRobustness,
  extractEmtNetlist,
  getPscxIncrementalCacheStats,
  lintPscx,
  parsePscx,
  verifyControlDelayStability,
  verifyConverterReachability,
  verifyIeee2800Compliance,
  verifyProtectionRelayBmc,
} from "../src/index.js";

describe("PSCAD Batch 5 Formal Verification & OEM Preflight (M6068, M6080-M6083)", () => {
  it("M6068 flags external OEM DLL components missing dongle/binary preflight metadata", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<project name="OemDllTest" version="5.0.0">
  <param name="time_step" value="50.0"/>
  <param name="f_base" value="60.0"/>
  <definitions><definition name="Main" type="module"><schematic>
    <Bus name="POI" id="B1" x="100" y="100" length="20" vbase="230.0"/>
    <User classid="UserCmp" defn="vendor:oem_ibr_dll" id="OEM1" x="160" y="100">
      <param name="Name" value="OEM1"/>
      <param name="dll_path" value="C:/oem/vendor_ctrl_v2.dll"/>
      <param name="requireHardwareDongle" value="1"/>
    </User>
  </schematic></definition></definitions>
</project>`;
    const diags = lintPscx(parsePscx(xml));
    assert.ok(
      diags.some((d) => d.code === "M6068"),
      `Expected M6068, got: ${diags.map((d) => d.code).join(", ")}`,
    );
  });

  it("M6080 proves contradictory breaker timings and dual-driver trip/close race via CDCL SAT", () => {
    const diags = verifyProtectionRelayBmc([
      {
        id: "tb_bad",
        kind: "tbreakn",
        inputs: [],
        params: { NUMS: 2, TO1: 0.25, TO2: 0.15 },
      },
      {
        id: "trip_drv",
        kind: "logic",
        inputs: [],
        params: {},
        actuator: { type: "breaker_status", targetId: "BRK_MAIN" },
      },
      {
        id: "close_drv",
        kind: "logic",
        inputs: [],
        params: {},
        actuator: { type: "breaker_status", targetId: "BRK_MAIN" },
      },
    ]);
    assert.equal(diags.filter((d) => d.code === "M6080").length, 2);
  });

  it("M6081 detects delay-induced feedback instability via DdeFlowpipeSolver", () => {
    const diags = verifyControlDelayStability(
      [
        { id: "g1", kind: "gain", inputs: ["td"], params: { K: 2.5 } },
        { id: "td", kind: "tdelay", inputs: ["g1"], params: { T: 0.02 } },
      ],
      50e-6,
    );
    assert.ok(
      diags.some((d) => d.code === "M6081"),
      `Expected M6081, got ${diags.map((d) => d.code).join(", ")}`,
    );
  });

  it("M6082 certifies converter overcurrent/DC-overvoltage reachability using ZonotopeReachabilitySolver", () => {
    const weakXml = `<?xml version="1.0" encoding="UTF-8"?>
<project name="WeakConv" version="5.0.0">
  <param name="time_step" value="50.0"/>
  <param name="f_base" value="60.0"/>
  <definitions><definition name="Main" type="module"><schematic>
    <Bus name="POI" id="B1" x="100" y="100" length="20" vbase="230.0"/>
    <User classid="UserCmp" defn="master:source_3p" id="SRC1" x="60" y="100">
      <param name="Name" value="SRC1"/><param name="V" value="230"/><param name="R" value="1.0"/><param name="L" value="2.5"/>
      <port name="out" pos="[20,0]"/>
    </User>
    <Wire><vertex x="80" y="100"/><vertex x="100" y="100"/></Wire>
    <User classid="UserCmp" defn="master:vsc_pwm" id="VSC1" x="140" y="100">
      <param name="Name" value="VSC1"/><param name="V" value="230"/><param name="MVA" value="200"/>
      <port name="ac" pos="[-20,0]"/>
    </User>
    <Wire><vertex x="120" y="100"/><vertex x="120" y="100"/></Wire>
  </schematic></definition></definitions>
</project>`;
    const netlist = extractEmtNetlist(parsePscx(weakXml));
    const unsafe = verifyConverterReachability(netlist, { vStepDisturbancePu: 0.5, iMaxPu: 1.2 });
    assert.equal(unsafe.safe, false);
    assert.ok(unsafe.diagnostics.some((d) => d.code === "M6082"));

    const safe = verifyConverterReachability(netlist, { vStepDisturbancePu: 0.02, iMaxPu: 1.5, vDcMaxPu: 1.5 });
    assert.equal(safe.safe, true);
    assert.equal(safe.isCertifiedSafe, true);
  });

  it("M6083 computes quantitative IEEE 2800 STL robustness margins via StlMonitor", () => {
    const t = [0, 0.1, 0.2, 1.3, 1.5];
    const vPass = [1.0, 0.85, 1.05, 1.02, 1.0];
    const pPass = [1.0, 0.4, 0.85, 0.96, 1.0];
    const fPass = [60.0, 59.8, 59.9, 60.0, 60.0];
    const passRep = evaluateIeee2800StlRobustness(t, vPass, pPass, fPass, { faultClearSec: 0.2 });
    assert.equal(passRep.satisfied, true);
    assert.ok(passRep.overallRobustness > 0);

    const vFail = [1.0, 1.28, 1.05, 1.02, 1.0];
    const failRep = evaluateIeee2800StlRobustness(t, vFail, pPass, fPass, { faultClearSec: 0.2 });
    assert.equal(failRep.satisfied, false);
    assert.ok(failRep.diagnostics.some((d) => d.code === "M6083"));
  });

  it("reuses cached submodule definitions across incremental re-parses and relocates line numbers", () => {
    clearPscxIncrementalCache();
    const makeDoc = (extraComment: string, gainVal: string) => `<?xml version="1.0" encoding="UTF-8"?>
<project name="IncTest" version="5.0.0">
  <param name="time_step" value="50.0"/>
  <definitions>
    <definition name="SubA" type="module"><schematic>
      ${extraComment}
      <User classid="UserCmp" defn="master:gain" id="GA" x="40" y="40"><param name="K" value="${gainVal}"/></User>
    </schematic></definition>
    <definition name="SubB" type="module"><schematic>
      <User classid="UserCmp" defn="master:gain" id="GB" x="80" y="80"><param name="K" value="2.0"/></User>
    </schematic></definition>
    <definition name="Main" type="module"><schematic>
      <User classid="UserCmp" defn="IncTest:SubA" id="U1" x="100" y="100"><param name="Name" value="U1"/></User>
      <User classid="UserCmp" defn="IncTest:SubB" id="U2" x="200" y="100"><param name="Name" value="U2"/></User>
    </schematic></definition>
  </definitions>
</project>`;

    const p1 = parsePscx(makeDoc("", "1.0"));
    const stats1 = getPscxIncrementalCacheStats();
    assert.equal(stats1.misses, 2);
    assert.equal(stats1.hits, 0);
    const subBLine1 = p1.subModules.get("SubB")!.components[0]!.line!;

    // Edit SubA (insert newlines before SubB & change K), leaving SubB byte-identical
    const p2 = parsePscx(makeDoc("\n\n", "3.0"));
    const stats2 = getPscxIncrementalCacheStats();
    assert.equal(stats2.misses, 3, "Only edited SubA should miss cache");
    assert.equal(stats2.hits, 1, "Untouched SubB should hit incremental cache");
    assert.equal(p2.subModules.get("SubA")!.components[0]!.parameters["K"], 3.0);
    assert.equal(p2.subModules.get("SubB")!.components[0]!.line, subBLine1 + 2);
  });

  it("populates M6083 stlRobustness inside verifyIeee2800Compliance when evaluateStlRobustness is enabled", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<project name="Ieee2800Stl" version="5.0.0">
  <param name="time_step" value="50.0"/>
  <param name="f_base" value="60.0"/>
  <definitions><definition name="Main" type="module"><schematic>
    <Bus name="POI" id="B1" x="100" y="100" length="20" vbase="230.0"/>
  </schematic></definition></definitions>
</project>`;
    const netlist = extractEmtNetlist(parsePscx(xml));
    const dt = 0.01;
    const n = 150;
    const time = Float64Array.from({ length: n }, (_, k) => k * dt);
    const vPoi = Float64Array.from(time, (t) => (t >= 0.05 && t <= 0.15 ? 230e3 * 0.5 : 230e3));
    const iIbr = Float64Array.from(time, (t) => (t >= 0.05 && t <= 0.15 ? 1100 : 1000));

    const report = verifyIeee2800Compliance(
      "Ieee2800Stl",
      netlist,
      { time, vPoi, iIbr },
      {
        faultStartSec: 0.05,
        faultDurationSec: 0.1,
        vPreFaultKv: 230.0,
        vFaultKv: 115.0,
        ratedCurrentAmp: 1000,
        evaluateStlRobustness: true,
      },
    );
    assert.ok(report.stlRobustness);
    assert.equal(report.stlRobustness.satisfied, true);
    assert.ok(report.stlRobustness.overallRobustness > 0);
    assert.ok(report.summary.includes("STL Formal Robustness"));
  });
});
