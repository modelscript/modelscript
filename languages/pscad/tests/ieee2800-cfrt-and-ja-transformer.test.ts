// SPDX-License-Identifier: AGPL-3.0-or-later

import { EmtSolver } from "@modelscript/simulate";
import assert from "node:assert";
import test from "node:test";
import { extractEmtNetlist, netlistToEmtCircuit } from "../src/netlist/emt-netlist.js";
import { parsePscx } from "../src/parser/pscx-parser.js";
import { verifyIeee2800Compliance } from "../src/verification/ieee2800.js";

test("IEEE 2800 Clause 7.2.2.7: Consecutive Fault Ride-Through (CFRT) compliance verification", () => {
  const fNominal = 60.0;
  const omega = 2 * Math.PI * fNominal;
  const dt = 50e-6; // 50 us
  const tEnd = 0.6; // 600 ms
  const n = Math.round(tEnd / dt);

  const time = new Float64Array(n);
  const vPoi = new Float64Array(n);
  const iIbr = new Float64Array(n);

  const vNominal = 230e3 * Math.sqrt(2 / 3); // Peak phase-to-ground
  const iRatedPeak = 1000.0;

  // Fault 1: 0.05s to 0.10s (50 ms sag to 0.20 pu)
  // Reclose/Clear: 0.10s to 0.20s (recovery)
  // Fault 2: 0.20s to 0.25s (50 ms sag to 0.10 pu)
  // Final Clear: 0.25s onwards (full recovery)
  for (let k = 0; k < n; k++) {
    const t = k * dt;
    time[k] = t;

    let vScale = 1.0;
    let iScale = 1.0;

    if (t >= 0.05 && t <= 0.1) {
      vScale = 0.2;
      iScale = 1.15; // Dynamic reactive current injection boost during fault 1
    } else if (t > 0.1 && t < 0.2) {
      vScale = 0.98;
      iScale = 0.95; // Partial recovery
    } else if (t >= 0.2 && t <= 0.25) {
      vScale = 0.1;
      iScale = 1.2; // Dynamic reactive current boost during fault 2 (<= 1.30 pu)
    } else if (t > 0.25) {
      vScale = 1.0;
      iScale = 1.0; // Post-fault active power restored to 100%
    }

    vPoi[k] = vNominal * vScale * Math.sin(omega * t);
    iIbr[k] = iRatedPeak * iScale * Math.sin(omega * t - 0.2);
  }

  const dummyNetlist = extractEmtNetlist(
    parsePscx(`<?xml version="1.0" encoding="UTF-8"?>
<project name="CFRT_Test" version="5.0.0">
  <Bus name="POI" id="B1" vbase="230.0" />
</project>`),
  );

  // Case 1: Pass compliant consecutive faults
  const passReport = verifyIeee2800Compliance(
    "CFRT_Compliant_IBR",
    dummyNetlist,
    { time, vPoi, iIbr },
    {
      faultStartSec: 0.05,
      faultDurationSec: 0.05,
      vPreFaultKv: 230.0,
      vFaultKv: 46.0,
      ratedCurrentAmp: iRatedPeak,
      consecutiveFaults: [
        { faultStartSec: 0.05, faultDurationSec: 0.05, vFaultKv: 46.0 },
        { faultStartSec: 0.2, faultDurationSec: 0.05, vFaultKv: 23.0 },
      ],
      evaluateConsecutiveFaults: true,
      maxTransientCurrentPu: 1.3,
    },
  );

  const cfrtCheck = passReport.checks.find((c) => c.clause === "7.2.2.7");
  assert.ok(cfrtCheck, "Report must include Clause 7.2.2.7 check");
  assert.strictEqual(cfrtCheck.status, "PASS", "Compliant IBR must pass CFRT");
  assert.ok(cfrtCheck.measuredValue.includes("2 consecutive fault(s) evaluated"));
  assert.strictEqual(passReport.overallStatus, "PASS");

  // Case 2: Inverter trips or enters momentary cessation on second fault
  const iIbrTrip = new Float64Array(iIbr);
  for (let k = 0; k < n; k++) {
    const t = time[k]!;
    if (t >= 0.22) {
      iIbrTrip[k] = 0.0; // Inverter collapses on second fault
    }
  }

  const failReport = verifyIeee2800Compliance(
    "CFRT_Tripping_IBR",
    dummyNetlist,
    { time, vPoi, iIbr: iIbrTrip },
    {
      faultStartSec: 0.05,
      faultDurationSec: 0.05,
      vPreFaultKv: 230.0,
      vFaultKv: 46.0,
      ratedCurrentAmp: iRatedPeak,
      consecutiveFaults: [
        { faultStartSec: 0.05, faultDurationSec: 0.05, vFaultKv: 46.0 },
        { faultStartSec: 0.2, faultDurationSec: 0.05, vFaultKv: 23.0 },
      ],
      evaluateConsecutiveFaults: true,
    },
  );

  const cfrtFailCheck = failReport.checks.find((c) => c.clause === "7.2.2.7");
  assert.ok(cfrtFailCheck);
  assert.strictEqual(cfrtFailCheck.status, "FAIL", "Cessation/trip on consecutive fault must FAIL Clause 7.2.2.7");
  assert.ok(
    cfrtFailCheck.details.includes("Momentary cessation on fault #2") ||
      cfrtFailCheck.details.includes("Post-consecutive recovery"),
  );
  assert.strictEqual(failReport.overallStatus, "FAIL");
});

test("IEEE 2800 Clause 7.2.2.8: Phase-Angle Jump Ride-Through compliance verification", () => {
  const fNominal = 60.0;
  const omega = 2 * Math.PI * fNominal;
  const dt = 50e-6;
  const tEnd = 0.2;
  const n = Math.round(tEnd / dt);

  const time = new Float64Array(n);
  const va = new Float64Array(n);
  const vb = new Float64Array(n);
  const vc = new Float64Array(n);
  const ia = new Float64Array(n);
  const ib = new Float64Array(n);
  const ic = new Float64Array(n);

  const vNominal = 230e3 * Math.sqrt(2 / 3);
  const iRatedPeak = 1000.0;
  const jumpRad = (30.0 * Math.PI) / 180.0; // +30 degree phase-angle jump

  for (let k = 0; k < n; k++) {
    const t = k * dt;
    time[k] = t;

    const phiJump = t >= 0.05 ? jumpRad : 0.0;
    // Transient current response: slight damped overshoot upon jump at t=0.05s, settling within 2 cycles
    let iOvershoot = 1.0;
    if (t >= 0.05 && t <= 0.08) {
      iOvershoot = 1.0 + 0.2 * Math.exp(-(t - 0.05) / 0.015); // Peak ~ 1.20 pu <= 1.30 pu
    }

    va[k] = vNominal * Math.sin(omega * t + phiJump);
    vb[k] = vNominal * Math.sin(omega * t - (2 * Math.PI) / 3 + phiJump);
    vc[k] = vNominal * Math.sin(omega * t + (2 * Math.PI) / 3 + phiJump);

    ia[k] = iRatedPeak * iOvershoot * Math.sin(omega * t + phiJump - 0.1);
    ib[k] = iRatedPeak * iOvershoot * Math.sin(omega * t - (2 * Math.PI) / 3 + phiJump - 0.1);
    ic[k] = iRatedPeak * iOvershoot * Math.sin(omega * t + (2 * Math.PI) / 3 + phiJump - 0.1);
  }

  const dummyNetlist = extractEmtNetlist(
    parsePscx(`<?xml version="1.0" encoding="UTF-8"?>
<project name="PAJ_Test" version="5.0.0">
  <Bus name="POI" id="B1" vbase="230.0" />
</project>`),
  );

  // Case 1: Compliant +30 deg phase jump
  const passReport = verifyIeee2800Compliance(
    "PAJ_Compliant_IBR",
    dummyNetlist,
    {
      time,
      vPoi: va,
      iIbr: ia,
      vPoiAbc: { a: va, b: vb, c: vc },
      iIbrAbc: { a: ia, b: ib, c: ic },
    },
    {
      faultStartSec: 0.05,
      faultDurationSec: 0.05,
      vPreFaultKv: 230.0,
      vFaultKv: 230.0,
      ratedCurrentAmp: iRatedPeak,
      phaseJumpDegrees: 30.0,
      evaluatePhaseJump: true,
      maxTransientCurrentPu: 1.3,
    },
  );

  const pajCheck = passReport.checks.find((c) => c.clause === "7.2.2.8");
  assert.ok(pajCheck, "Report must evaluate Clause 7.2.2.8");
  assert.strictEqual(pajCheck.status, "PASS", "Compliant IBR must pass phase-angle jump check");
  assert.ok(pajCheck.measuredValue.includes("Phase jump = 30.0 deg"));
  assert.strictEqual(passReport.overallStatus, "PASS");

  // Case 2: Excessive uncontrolled overcurrent (> 1.30 pu, e.g. 1.85 pu)
  const iaOvercurrent = new Float64Array(ia);
  for (let k = 0; k < n; k++) {
    const t = time[k]!;
    if (t >= 0.05 && t <= 0.07) {
      iaOvercurrent[k] = 1.85 * iRatedPeak * Math.sin(omega * t + jumpRad);
    }
  }

  const failReport = verifyIeee2800Compliance(
    "PAJ_Overcurrent_IBR",
    dummyNetlist,
    {
      time,
      vPoi: va,
      iIbr: iaOvercurrent,
      vPoiAbc: { a: va, b: vb, c: vc },
      iIbrAbc: { a: iaOvercurrent, b: ib, c: ic },
    },
    {
      faultStartSec: 0.05,
      faultDurationSec: 0.05,
      vPreFaultKv: 230.0,
      vFaultKv: 230.0,
      ratedCurrentAmp: iRatedPeak,
      phaseJumpDegrees: 30.0,
      evaluatePhaseJump: true,
      maxTransientCurrentPu: 1.3,
    },
  );

  const pajFailCheck = failReport.checks.find((c) => c.clause === "7.2.2.8");
  assert.ok(pajFailCheck);
  assert.strictEqual(pajFailCheck.status, "FAIL", "Transient overcurrent > 1.30 pu must fail Clause 7.2.2.8");
  assert.ok(pajFailCheck.details.includes("exceeded 1.30 pu"));
  assert.strictEqual(failReport.overallStatus, "FAIL");
});

test("PSCAD Netlist extraction with Jiles-Atherton saturable transformer and EMT simulation", () => {
  const pscxSource = `<?xml version="1.0" encoding="UTF-8"?>
<project name="JilesAtherton_Substation" version="5.0.0">
  <paramlist name="Settings">
    <param name="time_step" value="20.0"/>
    <param name="time_duration" value="0.05"/>
    <param name="f_base" value="60.0"/>
  </paramlist>
  <definitions>
    <Definition classid="UserCmpDefn" name="Main">
      <schematic>
        <User classid="UserCmp" name="master:source_1" id="S1" x="100" y="100">
          <paramlist>
            <param name="Name" value="GridSource"/>
            <param name="V" value="230.0"/>
            <param name="f" value="60.0"/>
            <param name="R" value="0.1"/>
          </paramlist>
          <port name="p1" pos="[10,0]"/>
        </User>
        <User classid="UserCmp" name="master:xfmr_sat" id="T1" x="200" y="100">
          <paramlist>
            <param name="Name" value="GenStepUp"/>
            <param name="MVA" value="250.0"/>
            <param name="Vpri" value="230.0"/>
            <param name="Vsec" value="22.0"/>
            <param name="leakage" value="0.10"/>
            <param name="Saturation" value="1"/>
            <param name="CoreModel" value="JILES_ATHERTON"/>
            <param name="Ms" value="1.6e6"/>
            <param name="a" value="1100.0"/>
            <param name="alpha" value="1.6e-3"/>
            <param name="k" value="400.0"/>
            <param name="c" value="0.2"/>
            <param name="remanence" value="120.0"/>
            <param name="coreAreaM2" value="0.6"/>
            <param name="magneticLengthM" value="3.5"/>
            <param name="primaryTurns" value="600"/>
          </paramlist>
          <port name="p1" pos="[-10,0]"/>
          <port name="p2" pos="[10,0]"/>
        </User>
        <Wire classid="Wire" id="W1">
          <vertex x="110" y="100"/>
          <vertex x="190" y="100"/>
        </Wire>
      </schematic>
    </Definition>
  </definitions>
</project>`;

  const project = parsePscx(pscxSource);
  const netlist = extractEmtNetlist(project);

  assert.strictEqual(netlist.transformers.length, 1);
  const xf = netlist.transformers[0]!;
  assert.strictEqual(xf.saturation, true, "Transformer must have saturation flag enabled");
  assert.strictEqual(xf.coreModel, "JILES_ATHERTON", "Transformer core model must be JILES_ATHERTON");
  assert.ok(xf.jaParams, "J-A parameters must be parsed");
  assert.strictEqual(xf.jaParams?.ms, 1.6e6);
  assert.strictEqual(xf.jaParams?.a, 1100.0);
  assert.strictEqual(xf.jaParams?.remanentFluxWb, undefined);
  assert.strictEqual(xf.remanentFluxWb, 120.0);
  assert.strictEqual(xf.jaParams?.coreAreaM2, 0.6);
  assert.strictEqual(xf.jaParams?.magneticLengthM, 3.5);
  assert.strictEqual(xf.jaParams?.primaryTurns, 600);

  assert.ok(netlist.saturableTransformers, "Netlist must expose saturableTransformers");
  assert.strictEqual(netlist.saturableTransformers?.length, 1);

  // Convert netlist to circuit definition
  const circuit = netlistToEmtCircuit(netlist);
  assert.ok(circuit.saturableTransformers, "Circuit definition must include saturableTransformers");
  assert.strictEqual(circuit.saturableTransformers?.length, 1);
  assert.strictEqual(circuit.saturableTransformers?.[0]?.coreModel, "JILES_ATHERTON");
  assert.strictEqual(
    circuit.transformers,
    undefined,
    "Linear transformers array must be undefined since the only xfmr is saturable",
  );

  // Run EMT simulation directly on circuit
  const solver = new EmtSolver(circuit as any, {
    timeStepSec: 20e-6,
    durationSec: 0.02,
  });
  const res = solver.solve();

  assert.ok(res.metrics.totalSteps > 100, "Simulation must produce timesteps");
  assert.strictEqual(res.metrics.totalSteps, Math.ceil(0.02 / 20e-6));
});
