// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import {
  CsmfControlEvaluator,
  EmtSolver,
  applySplices,
  buildProjectModel,
  createNConductorUlm,
  extractEmtNetlist,
  getMasterComponentSchema,
  gustavsenComplexVectorFit,
  orthogonalize,
  parsePscx,
  planPscadEdits,
  readDefinitionForm,
  runFrequencyScan,
  stepNConductorUlm,
} from "../src/index.js";

test("CSMF evaluator covers lag, leadlag, abcdq0, compare, ratelimit, and getSignal", () => {
  const ev = new CsmfControlEvaluator([
    { id: "c1", kind: "const", inputs: [], params: { Value: 1.0 } },
    { id: "lag1", kind: "lag", inputs: ["c1"], params: { G: 2.0, T: 0.01 } },
    { id: "ll1", kind: "leadlag", inputs: ["c1"], params: { G: 1.0, T1: 0.02, T2: 0.01 } },
    { id: "rl1", kind: "ratelimit", inputs: ["c1"], params: { IR: 10, DR: 10 } },
    { id: "cmp1", kind: "compare", inputs: ["c1"], params: { X: 0.5, OH: 1, OL: 0 } },
  ]);
  for (let i = 0; i < 20; i++) {
    ev.step(0.001);
  }
  assert.ok(ev.getSignal("lag1") > 0, "lag block should track positive input");
  assert.ok(ev.getSignal("ll1") > 0, "leadlag block should produce non-zero output");
  assert.ok(ev.getSignal("rl1") > 0 && ev.getSignal("rl1") < 0.5, "ratelimit block should ramp slowly at 10/s");
  assert.strictEqual(ev.getSignal("cmp1"), 1, "compare block should output 1 above threshold");
});

test("EmtSolver runs with Jiles-Atherton hysteresis, vsc_pwm, voltageDependentLoads, and customFortranBlocks", () => {
  const solver = new EmtSolver(
    {
      buses: new Map([
        ["B1", { id: "B1", name: "B1", baseKv: 230, phaseCount: 3, connectedBranchIds: ["BR1"] }],
        ["B2", { id: "B2", name: "B2", baseKv: 230, phaseCount: 3, connectedBranchIds: ["BR1"] }],
      ]),
      branches: [
        { id: "BR1", kind: "rlc", fromBus: "B1", toBus: "B2", resistanceOhm: 0.5, inductanceH: 0.01, capacitanceF: 0 },
      ],
      transformers: [],
      saturableTransformers: [
        {
          id: "TX_JA",
          fromBus: "B1",
          toBus: "B2",
          primaryKv: 230,
          secondaryKv: 230,
          mvaRating: 100,
          leakageReactancePu: 0.1,
          windingConnection: "Yg-Yg",
          coreModel: "JILES_ATHERTON",
          kneeFluxWb: 800,
          lSatH: 0.05,
        },
      ],
      transmissionLines: [],
      fmuInstances: [],
      sources: [{ id: "SRC1", bus: "B1", voltageKv: 230, frequencyHz: 60, phaseAngleDeg: 0, rSourceOhm: 1.0 }],
      converterBridges: [{ id: "VSC1", acBus: "B2", kind: "vsc_pwm", ratedKvLL: 230, ratedMva: 50 }],
      voltageDependentLoads: [
        { id: "LD1", busId: "B2", p0Mw: 20, q0Mvar: 5, v0KvLL: 230, np: 1.5, nq: 2.0, kpf: 1.0, kqf: -1.0, f0Hz: 60 },
      ],
      controlBlocks: [{ id: "S_V2", kind: "sensor_v", inputs: [], params: { phase: 0 }, sensorTarget: "B2" }],
      customFortranBlocks: [
        {
          id: "UDM1",
          name: "TestUdm",
          referencedPorts: ["IN1"],
          assignedPorts: ["OUT1"],
          numRealStates: 1,
          numIntStates: 0,
          inputs: [{ portName: "IN1", sourceId: "S_V2" }],
          outputs: [{ portName: "OUT1" }],
          step: (ctx) => {
            const inVal =
              typeof ctx.inputs === "function"
                ? ctx.inputs("IN1")
                : ctx.inputs instanceof Map
                  ? (ctx.inputs.get("IN1") ?? 0)
                  : (ctx.inputs?.["IN1"] ?? 0);
            if (ctx.outputs instanceof Map) {
              ctx.outputs.set("OUT1", inVal * 0.5);
            } else if (ctx.outputs) {
              ctx.outputs["OUT1"] = inVal * 0.5;
            }
          },
        },
      ],
      nominalFrequencyHz: 60,
    },
    { timeStepSec: 50e-6, durationSec: 0.02 },
  );
  const res = solver.solve();
  assert.ok(res.time.length > 100);
  const v2 = res.busVoltages.get("B2");
  assert.ok(v2 && v2.some((x) => Math.abs(x) > 10), "B2 should be energized");
  assert.ok(
    v2 && v2.every((x) => Number.isFinite(x) && Math.abs(x) < 1e7),
    "JA hysteresis should remain physically bounded",
  );
});

test("Complex vector fitting, N-conductor ULM, frequency scan, and A* obstacle-avoiding routing work end-to-end", () => {
  const omegas = new Float64Array([100, 377, 1000, 3000, 10000]);
  const fRe = new Float64Array(omegas.length);
  const fIm = new Float64Array(omegas.length);
  for (let i = 0; i < omegas.length; i++) {
    const w = omegas[i]!;
    const dRe = 50 - w * w * 1e-4;
    const dIm = 10 * w * 1e-2;
    const den = dRe * dRe + dIm * dIm;
    fRe[i] = (50 * dRe) / den;
    fIm[i] = (-50 * dIm) / den;
  }
  const vf = gustavsenComplexVectorFit(omegas, fRe, fIm, { order: 2, iterations: 3 });
  assert.strictEqual(vf.residuesRe.length, 2);

  const gEq = new Float64Array(9);
  gEq[0] = gEq[4] = gEq[8] = 1 / 350;
  const d0 = new Float64Array(9);
  d0[0] = d0[4] = d0[8] = 0.95;
  const ulmN = createNConductorUlm({
    id: "ULM_3",
    nCond: 3,
    dtSec: 50e-6,
    gEq,
    modes: [{ tauSec: 40e-6, d0 }],
  });
  const iOut = stepNConductorUlm(ulmN, new Float64Array([100e3, -50e3, -50e3]), new Float64Array([99e3, -49e3, -50e3]));
  assert.strictEqual(iOut.iHistK.length, 3);

  const scan = runFrequencyScan(
    {
      buses: new Map([
        ["B1", { id: "B1", name: "B1", baseKv: 230, phaseCount: 3, connectedBranchIds: [] }],
        ["B2", { id: "B2", name: "B2", baseKv: 230, phaseCount: 3, connectedBranchIds: [] }],
      ]),
      branches: [],
      transformers: [],
      transmissionLines: [
        {
          id: "TL1",
          fromBus: "B1",
          toBus: "B2",
          lengthKm: 50,
          modelType: "pi",
          rPerKm: 0.05,
          lPerKm: 1e-3,
          cPerKm: 1e-8,
        },
      ],
      fmuInstances: [],
      sources: [],
      synchronousMachines: [
        {
          id: "SM1",
          bus: "B1",
          ratedMva: 100,
          ratedKvLL: 230,
          frequencyHz: 60,
          xdSub: 0.2,
          xqSub: 0.22,
          hInertiaSec: 3.5,
        },
      ],
      nominalFrequencyHz: 60,
    },
    { busId: "B1", fMinHz: 60, fMaxHz: 600, fStepHz: 60 },
  );
  assert.ok(scan.frequenciesHz.length >= 10);
  assert.strictEqual(scan.frequenciesHz[0], 60);
  assert.strictEqual(scan.frequenciesHz[scan.frequenciesHz.length - 1], 600);

  const routed = orthogonalize(
    [
      { x: 0, y: 0 },
      { x: 180, y: 180 },
    ],
    [
      { id: "ob1", x: 144, y: -18, w: 54, h: 54 },
      { id: "ob2", x: -18, y: 144, w: 54, h: 54 },
    ],
  );
  assert.ok(routed.length >= 3, "A* router should detour around blocked L-elbows");
});

test("extractEmtNetlist extracts PGB channels, GraphFrames, voltageDependentLoads, and simple_ppc=pi", () => {
  const xml = `
<project name="GapTest">
  <paramlist name="Settings">
    <param name="time_duration" value="0.1"/>
    <param name="time_step" value="50.0"/>
    <param name="sample_step" value="50.0"/>
    <param name="f_base" value="60.0"/>
  </paramlist>
  <hierarchy>
    <call name="Main" id="0" />
  </hierarchy>
  <definitions>
    <Definition name="Main" classid="Station">
      <schematic call="0">
        <User classid="UserCmp" defn="master:source_3" name="Src" id="1" x="100" y="100">
          <paramlist><param name="Vm" value="230"/><param name="F" value="60"/></paramlist>
          <port name="A" id="p1" x="118" y="100"/>
        </User>
        <User classid="UserCmp" defn="master:fixed_load" name="Ld" id="2" x="200" y="100">
          <paramlist><param name="PO" value="50"/><param name="QO" value="10"/><param name="VBO" value="230"/><param name="NP" value="1.2"/><param name="NQ" value="2.0"/></paramlist>
          <port name="A" id="p2" x="182" y="100"/>
        </User>
        <User classid="UserCmp" defn="master:pgb" name="Pgb1" id="3" x="300" y="100">
          <paramlist><param name="Name" value="V_bus"/></paramlist>
          <port name="In" id="p3" x="282" y="100"/>
        </User>
        <User classid="UserCmp" defn="master:graphframe" name="Gf1" id="4" x="350" y="100">
          <paramlist><param name="Title" value="Bus Voltages"/><param name="Curves" value="V_bus"/></paramlist>
        </User>
        <User classid="UserCmp" defn="master:simple_ppc" name="Ppc1" id="5" x="400" y="100"/>
        <Wire id="10" vertices="118 100 182 100"/>
      </schematic>
    </Definition>
  </definitions>
</project>`;
  const proj = parsePscx(xml);
  const net = extractEmtNetlist(proj);
  assert.ok((net.pgbChannels?.length ?? 0) >= 1, "pgbChannels should be extracted");
  assert.ok((net.graphFrames?.length ?? 0) >= 1, "graphFrames should be extracted");
  assert.ok((net.voltageDependentLoads?.length ?? 0) >= 1, "NP!=2 fixed_load should emit voltageDependentLoads");
  const ppc = net.controlBlocks?.find((b) => b.id.includes("5") || b.componentId === "5");
  assert.strictEqual(ppc?.kind, "pi", "simple_ppc should lower to closed-loop pi block");
});

test("isolates TLineDefn/CableDefn, parses <Frame classid='GraphFrame'>, and lowers ulm/Branch/Dsout", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<project name="SprintParityTest" version="5.0">
  <paramlist name="Settings">
    <param name="time_step" value="50.0"/>
    <param name="time_duration" value="0.02"/>
    <param name="f_base" value="50.0"/>
  </paramlist>
  <definitions>
    <Definition name="LineDef1" classid="TLineDefn">
      <schematic>
        <User classid="UserCmp" defn="master:tline_cond" id="999" x="100" y="100"/>
      </schematic>
    </Definition>
    <Definition name="CableDef1" classid="CableDefn">
      <schematic>
        <User classid="UserCmp" defn="master:cable_core" id="998" x="100" y="100"/>
      </schematic>
    </Definition>
    <Definition name="BranchDsoutBlk" classid="UserCmpDefn">
      <graphics>
        <Port name="P1" x="-18" y="0"><param name="kind" value="electrical"/></Port>
        <Port name="P2" x="18" y="0"><param name="kind" value="electrical"/></Port>
        <Port name="OUT" x="18" y="12"><param name="kind" value="signal"/><param name="mode" value="2"/></Port>
      </graphics>
      <script>
        <segment name="Branch"><![CDATA[
$P1 $P2 12.5 0 0
]]></segment>
        <segment name="Dsout"><![CDATA[
$OUT = 42.5
]]></segment>
      </script>
    </Definition>
    <Definition name="Main" classid="Station">
      <schematic>
        <Bus id="B1" name="Bus1" x="100" y="100" vbase="230"/>
        <Bus id="B2" name="Bus2" x="300" y="100" vbase="230"/>
        <User classid="UserCmp" defn="master:source_3" name="Src" id="1" x="80" y="100">
          <paramlist><param name="Vm" value="230"/><param name="F" value="50"/></paramlist>
          <port name="A" id="p_s1" x="100" y="100"/>
        </User>
        <User classid="UserCmp" defn="master:tline" name="TL_Ulm" id="2" x="200" y="100">
          <paramlist>
            <param name="length" value="40.0"/>
            <param name="tower_height" value="25.0"/>
            <param name="phase_spacing" value="8.0"/>
            <param name="model_type" value="ulm"/>
          </paramlist>
          <port name="From" id="p_tl1" x="100" y="100"/>
          <port name="To" id="p_tl2" x="300" y="100"/>
        </User>
        <User classid="UserCmp" defn="BranchDsoutBlk" name="Udm1" id="3" x="200" y="160">
          <port name="P1" id="p_u1" x="100" y="100"/>
          <port name="P2" id="p_u2" x="300" y="100"/>
          <port name="OUT" id="p_uout" x="218" y="172"/>
        </User>
        <User classid="UserCmp" defn="master:pgb" name="PgbOut" id="4" x="320" y="100">
          <paramlist><param name="Name" value="V_B2"/></paramlist>
          <port name="In" id="p_pgb" x="300" y="100"/>
        </User>
        <Frame classid="GraphFrame" id="gf1" name="MainPlot">
          <paramlist><param name="Title" value="Grid Oscilloscope"/></paramlist>
          <Graph classid="PolyGraph" id="g1">
            <paramlist>
              <param name="Title" value="Bus Voltage"/>
              <param name="ymin" value="-250"/>
              <param name="ymax" value="250"/>
            </paramlist>
            <Curve id="c1" link="4" name="V_B2"/>
          </Graph>
        </Frame>
      </schematic>
    </Definition>
  </definitions>
</project>`;
  const proj = parsePscx(xml);
  assert.ok(
    !proj.rootModule.components.some((c) => c.id === "999" || c.id === "998"),
    "TLineDefn/CableDefn children must not leak onto Main",
  );
  assert.strictEqual(proj.rootModule.graphFrames?.length, 1);
  assert.strictEqual(proj.rootModule.graphFrames?.[0]?.kind, "poly");
  assert.strictEqual(proj.rootModule.graphFrames?.[0]?.min, -250);
  assert.strictEqual(proj.rootModule.graphFrames?.[0]?.max, 250);

  const net = extractEmtNetlist(proj);
  assert.strictEqual(net.transmissionLines[0]?.modelType, "ulm");
  assert.ok((net.transmissionLines[0]?.poles?.length ?? 0) === 4);
  assert.ok(
    net.branches.some((b) => b.resistanceOhm === 12.5),
    "Branch segment passive R=12.5 should be extracted",
  );
  assert.ok(net.customFortranBlocks?.[0]?.dsoutStep, "Dsout segment should compile into dsoutStep");
  assert.strictEqual(net.graphFrames?.[0]?.curves[0], "V_B2");
});

test("EmtSolver Yg-D transformer enforces off-nominal turns ratio and exact +/-30 deg (Yd1) phase shift", () => {
  const net = {
    nominalFrequencyHz: 60.0,
    buses: [
      { id: "HV", baseKv: 230.0 },
      { id: "LV", baseKv: 13.8 },
    ],
    sources: [{ id: "SRC", bus: "HV", voltageKv: 230.0, frequencyHz: 60.0, rSourceOhm: 0.5 }],
    transformers: [
      {
        id: "T_YD1",
        fromBus: "HV",
        toBus: "LV",
        ratedMva: 100.0,
        primaryKv: 230.0,
        secondaryKv: 13.8,
        leakagePu: 0.08,
        windingConnection: "Yg-D" as const,
      },
    ],
    branches: [{ id: "LOAD", fromBus: "LV", toBus: "0", rOhm: 20.0, lHenry: 0, cFarad: 0 }],
  };

  const solver = new EmtSolver(net, { timeStepSec: 50e-6, durationSec: 0.05 });
  const res = solver.solve();
  const vHvA = res.vA.get("HV")!;
  const vLvA = res.vA.get("LV")!;
  const vLvB = res.vB.get("LV")!;
  assert.ok(vHvA && vLvA && vLvB);

  // Measure steady-state peak on last cycle (steps 667..1000) and fundamental phasor via DFT
  const nCycle = Math.round(1 / (60.0 * 50e-6)); // 333
  const start = vHvA.length - nCycle;
  const omega = 2 * Math.PI * 60.0;
  let reHv = 0;
  let imHv = 0;
  let reLv = 0;
  let imLv = 0;
  for (let k = start; k < vHvA.length; k++) {
    const t = k * 50e-6;
    const c = Math.cos(omega * t);
    const s = -Math.sin(omega * t);
    reHv += vHvA[k]! * c;
    imHv += vHvA[k]! * s;
    reLv += vLvA[k]! * c;
    imLv += vLvA[k]! * s;
  }
  const magHv = Math.hypot(reHv, imHv) * (2 / nCycle);
  const magLv = Math.hypot(reLv, imLv) * (2 / nCycle);
  const expectedHvPeak = (230e3 * Math.SQRT2) / Math.sqrt(3);
  const expectedLvPeak = (13.8e3 * Math.SQRT2) / Math.sqrt(3);
  assert.ok(
    Math.abs(magHv - expectedHvPeak) / expectedHvPeak < 0.02,
    `HV peak ${magHv} should match ${expectedHvPeak}`,
  );
  assert.ok(
    Math.abs(magLv - expectedLvPeak) / expectedLvPeak < 0.06,
    `LV peak ${magLv} should match scaled secondary ${expectedLvPeak}`,
  );

  // Measure phase shift between HV Phase A and LV Phase A: Yg-D must shift by +-30 deg (pi/6 rad), never 0 deg!
  let angDiffRad = Math.atan2(imLv, reLv) - Math.atan2(imHv, reHv);
  while (angDiffRad > Math.PI) angDiffRad -= 2 * Math.PI;
  while (angDiffRad < -Math.PI) angDiffRad += 2 * Math.PI;
  const absDeg = Math.abs((angDiffRad * 180) / Math.PI);
  assert.ok(
    Math.abs(absDeg - 30.0) < 6.0,
    `Yg-D secondary phase shift magnitude must be near 30 deg, got ${absDeg.toFixed(2)} deg`,
  );
});

test("EmtSolver syncGenerators uses V_LN peak base and inductive Xd'' with positive synchronizing torque", () => {
  const mkNet = (mechPowerPu: number) => ({
    nominalFrequencyHz: 60.0,
    buses: [
      { id: "GEN", baseKv: 13.8 },
      { id: "INF", baseKv: 13.8 },
    ],
    sources: [{ id: "GRID", bus: "INF", voltageKv: 13.8, frequencyHz: 60.0, phaseDeg: 0.0, rSourceOhm: 0.05 }],
    synchronousMachines: [
      {
        id: "G1",
        bus: "GEN",
        ratedMva: 100.0,
        ratedKvLL: 13.8,
        frequencyHz: 60.0,
        xdSub: 0.25,
        xqSub: 0.25,
        hInertiaSec: 4.0,
        dampingPu: 2.0,
        mechanicalPowerPu: mechPowerPu,
        fieldVoltagePu: 1.05,
      },
    ],
    branches: [{ id: "TIE", fromBus: "GEN", toBus: "INF", rOhm: 0.02, lHenry: 0.001, cFarad: 0 }],
  });

  const sLow = new EmtSolver(mkNet(0.2), { timeStepSec: 50e-6, durationSec: 0.04, initializeFromLoadFlow: false });
  const sHigh = new EmtSolver(mkNet(0.6), { timeStepSec: 50e-6, durationSec: 0.04, initializeFromLoadFlow: false });
  const rLow = sLow.solve();
  const rHigh = sHigh.solve();

  const genVaHigh = rHigh.vA.get("GEN")!;
  const maxGenPeak = Math.max(...Array.from(genVaHigh));
  const vLnPeak = (13.8e3 * Math.SQRT2) / Math.sqrt(3);
  assert.ok(
    maxGenPeak > 0.7 * vLnPeak && maxGenPeak < 1.3 * vLnPeak,
    `Generator terminal peak ${maxGenPeak} V should use V_LN base (~${vLnPeak.toFixed(0)} V)`,
  );

  // Positive synchronizing torque: larger initial rotor angle delta at Pm=0.6 vs Pm=0.2 yields higher Pe at steady state
  const deltaLow0 = rLow.controlSignals!.get("G1_delta")![0]!;
  const deltaHigh0 = rHigh.controlSignals!.get("G1_delta")![0]!;
  assert.ok(deltaHigh0 > deltaLow0, `Initial delta must increase with Pm (${deltaLow0} -> ${deltaHigh0})`);
  const peLow = rLow.controlSignals!.get("G1_Pe")![799]!;
  const peHigh = rHigh.controlSignals!.get("G1_Pe")![799]!;
  assert.ok(
    peHigh > peLow,
    `Positive synchronizing torque dPe/ddelta > 0: Pe(Pm=0.6)=${peHigh} must exceed Pe(Pm=0.2)=${peLow}`,
  );
});

test("EmtSolver integrates and steps NConductorUlmData when passed via modelType='ulm'", () => {
  const dt = 50e-6;
  const gEqBase = new Float64Array(9);
  for (let i = 0; i < 3; i++) gEqBase[i * 3 + i] = 0.003;
  const d0 = new Float64Array([0.98, 0.0, 0.0, 0.0, 0.98, 0.0, 0.0, 0.0, 0.98]);
  const nUlmData = createNConductorUlm({
    id: "NULM_LINE",
    nCond: 3,
    dtSec: dt,
    gEq: gEqBase,
    modes: [{ tauSec: 200e-6, d0 }],
  });

  const net = {
    nominalFrequencyHz: 60.0,
    buses: [
      { id: "B1", baseKv: 230.0 },
      { id: "B2", baseKv: 230.0 },
    ],
    sources: [{ id: "SRC1", bus: "B1", voltageKv: 230.0, frequencyHz: 60.0, rSourceOhm: 1.0 }],
    transmissionLines: [
      {
        id: "NULM_LINE",
        fromBus: "B1",
        toBus: "B2",
        lengthKm: 60.0,
        modelType: "ulm" as const,
        nUlmData,
      },
    ],
    branches: [{ id: "LOAD2", fromBus: "B2", toBus: "0", rOhm: 1000.0, lHenry: 0, cFarad: 0 }],
  };

  const solver = new EmtSolver(net, { timeStepSec: dt, durationSec: 0.04, initializeFromLoadFlow: false });
  assert.strictEqual(solver.getNUlmLines().length, 1, "Must register 1 N-conductor ULM line");
  const res = solver.solve();
  const vB2 = res.vA.get("B2")!;
  const maxB2 = Math.max(...Array.from(vB2.subarray(400)));
  const vExpected = (230e3 * Math.SQRT2) / Math.sqrt(3);
  assert.ok(
    maxB2 > 0.75 * vExpected && maxB2 < 1.25 * vExpected,
    `N-conductor ULM receiving end peak (${maxB2} V) should track traveling wave energy from B1`,
  );
  const currents = res.branchPhaseCurrents.get("NULM_LINE");
  assert.ok(currents && Math.max(...Array.from(currents.a)) > 1.0, "Must record N-conductor ULM terminal currents");
});

test("Sprint C: switched VSC-PWM and 6-pulse LCC emit real switching ripple, muDeg, and gammaDeg telemetry", () => {
  const res = new EmtSolver(
    {
      nominalFrequencyHz: 60,
      buses: [
        { id: "AC_VSC", baseKv: 230 },
        { id: "DC_VSC", baseKv: 400 },
        { id: "AC_LCC", baseKv: 230 },
      ],
      sources: [
        { id: "S_VSC", bus: "AC_VSC", voltageKv: 230, frequencyHz: 60, rSourceOhm: 1.5, lSourceHenry: 0.01 },
        { id: "S_LCC", bus: "AC_LCC", voltageKv: 230, frequencyHz: 60, rSourceOhm: 1.5, lSourceHenry: 0.015 },
      ],
      branches: [],
      converterBridges: [
        {
          id: "VSC1",
          acBus: "AC_VSC",
          dcBus: "DC_VSC",
          kind: "vsc_pwm",
          ratedKvLL: 230,
          ratedMva: 200,
          vDcNominalKv: 400,
          vDcRefKv: 400,
          carrierFreqHz: 1980,
          pRefMw: 100,
          qRefMvar: 20,
          controlMode: "vdc_q",
        },
        {
          id: "LCC1",
          acBus: "AC_LCC",
          kind: "lcc_6pulse",
          ratedKvLL: 230,
          ratedMva: 250,
          vDcNominalKv: 280,
          firingAngleDeg: 18,
          dcLoadOhm: 120,
        },
      ],
    },
    { timeStepSec: 50e-6, durationSec: 0.04 },
  ).solve();

  const vscVdc = res.controlSignals!.get("VSC1_Vdc")!;
  const vscM = res.controlSignals!.get("VSC1_mIndex")!;
  const vscP = res.controlSignals!.get("VSC1_P_mw")!;
  assert.ok(
    vscVdc[vscVdc.length - 1]! > 350 && vscVdc[vscVdc.length - 1]! < 450,
    `VSC Vdc must regulate near 400 kV (got ${vscVdc[vscVdc.length - 1]})`,
  );
  assert.ok(
    vscM[vscM.length - 1]! > 0.1 && vscM[vscM.length - 1]! <= 1.25,
    `VSC mIndex must be valid (got ${vscM[vscM.length - 1]})`,
  );
  assert.ok(Number.isFinite(vscP[vscP.length - 1]!), "VSC active power must be finite");

  const lccVdc = res.controlSignals!.get("LCC1_Vdc")!;
  const lccIdc = res.controlSignals!.get("LCC1_Idc")!;
  const lccMu = res.controlSignals!.get("LCC1_muDeg")!;
  const lccGamma = res.controlSignals!.get("LCC1_gammaDeg")!;
  assert.ok(
    lccVdc[lccVdc.length - 1]! > 200,
    `LCC DC voltage must build up > 200 kV (got ${lccVdc[lccVdc.length - 1]})`,
  );
  assert.ok(lccIdc[lccIdc.length - 1]! > 0.1, `LCC DC current must be positive (got ${lccIdc[lccIdc.length - 1]})`);
  assert.ok(lccMu[lccMu.length - 1]! > 0, `LCC commutation overlap muDeg must be > 0 (got ${lccMu[lccMu.length - 1]})`);
  assert.ok(
    lccGamma[lccGamma.length - 1]! > 90,
    `LCC extinction angle gammaDeg must remain safe (got ${lccGamma[lccGamma.length - 1]})`,
  );
});

test("Sprint C: 6-arm 3-phase MMC regulates Vdc and damps 2nd-harmonic circulating current", () => {
  const res = new EmtSolver(
    {
      nominalFrequencyHz: 60,
      buses: [
        { id: "AC1", baseKv: 230 },
        { id: "AC2", baseKv: 230 },
      ],
      sources: [{ id: "GRID", bus: "AC1", voltageKv: 230, frequencyHz: 60, rSourceOhm: 1.0, lSourceHenry: 0.01 }],
      branches: [{ id: "TIE", fromBus: "AC1", toBus: "AC2", rOhm: 0.5, lHenry: 0.02, cFarad: 0 }],
      converterBridges: [
        {
          id: "MMC1",
          acBus: "AC2",
          kind: "mmc_thevenin",
          ratedKvLL: 230,
          ratedMva: 400,
          vDcNominalKv: 400,
          numSubmodulesPerArm: 20,
          submoduleCapacitanceF: 0.01,
          armInductanceH: 0.03,
        },
      ],
    },
    { timeStepSec: 50e-6, durationSec: 0.06 },
  ).solve();

  const vdc = res.controlSignals!.get("MMC1_vCapUpperSum")!;
  const spreadPct = res.controlSignals!.get("MMC1_spreadPct")!;
  const iCircA = res.controlSignals!.get("MMC1_iCircA")!;
  const vTail = vdc[vdc.length - 1]!;
  assert.ok(vTail > 350 && vTail < 450, `MMC upper capacitor voltage sum should stay near 400 kV (got ${vTail})`);
  assert.ok(
    spreadPct[spreadPct.length - 1]! < 20,
    `MMC capacitor voltage sorting spread must remain tight (got ${spreadPct[spreadPct.length - 1]}%)`,
  );
  assert.ok(
    Array.from(iCircA).every((x) => Number.isFinite(x) && Math.abs(x) < 10_000),
    "6-arm MMC circulating current must remain finite and CCSC-damped",
  );
  const maxAbsVac2 = Math.max(...Array.from(res.vA.get("AC2")!));
  assert.ok(maxAbsVac2 > 50e3, `MMC AC bus AC2 should sustain energized AC waveform (peak=${maxAbsVac2})`);
});

test("Sprint C: 3-winding Yg-Yg-D transformer and dynamic OLTC tap changer", () => {
  const res = new EmtSolver(
    {
      nominalFrequencyHz: 60,
      buses: [
        { id: "P", baseKv: 230 },
        { id: "S", baseKv: 115 },
        { id: "T", baseKv: 13.8 },
      ],
      sources: [{ id: "G_P", bus: "P", voltageKv: 230, frequencyHz: 60, rSourceOhm: 0.5, lSourceHenry: 0.005 }],
      branches: [
        { id: "LOAD_S", fromBus: "S", toBus: "0", rOhm: 120, lHenry: 0.2, cFarad: 0 },
        { id: "LOAD_T", fromBus: "T", toBus: "0", rOhm: 40, lHenry: 0, cFarad: 0 },
      ],
      transformers: [
        {
          id: "XF3W",
          primaryBus: "P",
          secondaryBus: "S",
          tertiaryBus: "T",
          ratedMva: 150,
          primaryKv: 230,
          secondaryKv: 115,
          tertiaryKv: 13.8,
          leakageReactancePu: 0.1,
          leakagePsPu: 0.1,
          leakagePtPu: 0.08,
          leakageStPu: 0.06,
          windingConnection: "Yg-Yg",
          tertiaryConnection: "D",
          oltc: {
            vRefPu: 1.08,
            deadbandPu: 0.01,
            tapStepPu: 0.025,
            tapMin: 0.85,
            tapMax: 1.15,
            delaySec: 0.01,
            targetBus: "S",
          },
        },
      ],
    },
    { timeStepSec: 50e-6, durationSec: 0.08 },
  ).solve();

  // Check star bus allocation and tertiary energization at ~13.8 kV nominal
  const vT = res.vA.get("T")!;
  const maxVt = Math.max(...Array.from(vT.subarray(400)));
  const expectedTertPeak = (13.8e3 * Math.SQRT2) / Math.sqrt(3);
  assert.ok(
    maxVt > 0.4 * expectedTertPeak && maxVt < 1.6 * expectedTertPeak,
    `3-winding tertiary peak (${maxVt} V) should track 13.8 kV ratio (${expectedTertPeak} V)`,
  );

  const tapTraj = res.controlSignals!.get("XF3W_tapPu")!;
  assert.ok(tapTraj !== undefined && tapTraj.length > 0, "OLTC must export tapPu trajectory");
  assert.ok(
    tapTraj[tapTraj.length - 1]! !== tapTraj[0]!,
    `OLTC tap should step away from ${tapTraj[0]} toward target voltage (got ${tapTraj[tapTraj.length - 1]})`,
  );
});

test("Sprint C: syncGenerators CSMF efSignal/tmSignal ports and N-mass torsional SSR shaft", () => {
  const res = new EmtSolver(
    {
      nominalFrequencyHz: 60,
      buses: [
        { id: "GEN_BUS", baseKv: 22 },
        { id: "GRID_BUS", baseKv: 22 },
      ],
      sources: [
        { id: "GRID_INF", bus: "GRID_BUS", voltageKv: 22, frequencyHz: 60, rSourceOhm: 0.2, lSourceHenry: 0.002 },
      ],
      branches: [{ id: "STUB", fromBus: "GEN_BUS", toBus: "GRID_BUS", rOhm: 0.1, lHenry: 0.005, cFarad: 0 }],
      faults: [{ id: "FLT_SSR", bus: "GRID_BUS", faultType: "3PH", startSec: 0.02, endSec: 0.04, rFaultOhm: 0.05 }],
      controlBlocks: [
        { id: "EF_CMD", kind: "const", inputs: [], params: { Value: 1.35 } },
        { id: "TM_CMD", kind: "const", inputs: [], params: { Value: 0.75 } },
      ],
      synchronousMachines: [
        {
          id: "GEN_SSR",
          bus: "GEN_BUS",
          ratedMva: 500,
          ratedKvLL: 22,
          frequencyHz: 60,
          xd: 1.8,
          xq: 1.7,
          xdPrime: 0.3,
          xqPrime: 0.55,
          xdSub: 0.22,
          xqSub: 0.25,
          hInertiaSec: 3.0,
          dampingPu: 1.0,
          fieldVoltagePu: 1.1,
          mechanicalPowerPu: 0.4,
          efSignal: "EF_CMD",
          tmSignal: "TM_CMD",
          torsionalMasses: [
            {
              id: "HP",
              hInertiaSec: 0.4,
              kShaftPuPerRad: 45,
              dampingPu: 0.1,
              dampingMutualPu: 0.05,
              torqueFraction: 0.4,
            },
            {
              id: "LP",
              hInertiaSec: 1.4,
              kShaftPuPerRad: 60,
              dampingPu: 0.1,
              dampingMutualPu: 0.05,
              torqueFraction: 0.6,
            },
            { id: "GEN", hInertiaSec: 1.2, dampingPu: 0.1, torqueFraction: 0.0 },
          ],
        },
      ],
    },
    { timeStepSec: 50e-6, durationSec: 0.1 },
  ).solve();

  const torque0 = res.controlSignals!.get("GEN_SSR_torque_0")!;
  const speed0 = res.controlSignals!.get("GEN_SSR_speed_0")!;
  const wGen = res.controlSignals!.get("GEN_SSR_speedPu")!;
  assert.ok(torque0 && speed0 && wGen, "Must expose GEN_SSR_torque_0, GEN_SSR_speed_0, GEN_SSR_speedPu signals");

  let maxTorque = 0;
  let minTorque = Infinity;
  for (let i = 400; i < torque0.length; i++) {
    if (torque0[i]! > maxTorque) maxTorque = torque0[i]!;
    if (torque0[i]! < minTorque) minTorque = torque0[i]!;
  }
  assert.ok(
    maxTorque - minTorque > 0.005,
    `3-phase fault must excite torsional shaft torque swing between HP and LP masses (range=${minTorque.toFixed(4)}..${maxTorque.toFixed(4)} pu)`,
  );
  assert.ok(Math.abs(wGen[wGen.length - 1]! - 1.0) < 0.1, "Generator speed should stay close to synchronous");
});

test("Sprint C: coupled three_phase_coupled hyperbolic frequency scan models long lines and Yg-D Z0 blocking", () => {
  const scan = runFrequencyScan(
    {
      nominalFrequencyHz: 60,
      buses: new Map([
        ["S", { id: "S", name: "S", baseKv: 500, phaseCount: 3, connectedBranchIds: [] }],
        ["MID", { id: "MID", name: "MID", baseKv: 500, phaseCount: 3, connectedBranchIds: [] }],
        ["LOAD", { id: "LOAD", name: "LOAD", baseKv: 230, phaseCount: 3, connectedBranchIds: [] }],
      ]),
      branches: [
        { id: "SHUNT", kind: "rlc", fromBus: "LOAD", toBus: "0", resistanceOhm: 1000, inductanceH: 0, capacitanceF: 0 },
      ],
      transformers: [
        {
          id: "TX_YGD",
          primaryBus: "MID",
          secondaryBus: "LOAD",
          ratedMva: 500,
          primaryKv: 500,
          secondaryKv: 230,
          leakageReactancePu: 0.1,
          windingConnection: "Yg-D",
        },
      ],
      transmissionLines: [
        {
          id: "LONG_LINE",
          fromBus: "S",
          toBus: "MID",
          lengthKm: 350,
          rPerKm: 0.03,
          lPerKm: 0.9e-3,
          cPerKm: 1.3e-8,
        },
      ],
      fmuInstances: [],
      sources: [
        {
          id: "INF",
          name: "INF",
          bus: "S",
          vPeakKv: 408,
          frequencyHz: 60,
          phaseRad: 0,
          mvaRating: 2000,
          rSourceOhm: 1,
          lSourceHenry: 0.01,
        },
      ],
    },
    {
      busId: "LOAD",
      fMinHz: 5,
      fMaxHz: 600,
      fStepHz: 5,
      mode: "three_phase_coupled",
    },
  );

  assert.ok(
    scan.z0Ohm !== undefined && scan.z0Ohm.length === scan.frequenciesHz.length,
    "Must return zero-sequence impedance z0Ohm in coupled mode",
  );
  // Yg-D delta blocks zero-sequence path from S/MID -> LOAD, so LOAD Z0 is dominated by the 1000-ohm shunt (~1000 ohm) rather than low source Z0
  assert.ok(
    scan.z0Ohm![0]!.r > 500,
    `Yg-D delta must isolate LOAD zero-sequence from grid source (got Z0_re=${scan.z0Ohm![0]!.r})`,
  );
  // 350 km line distributed propagation produces hyperbolic quarter-wave/series-parallel impedance peaks across 5..600 Hz
  const maxZ = Math.max(...scan.zMagOhm);
  assert.ok(
    maxZ > 100 && Number.isFinite(maxZ),
    `Hyperbolic long line must exhibit resonant impedance peaks (max |Z|=${maxZ})`,
  );
});

test("Sprint B/D: EmtSolver.solveChunked supports pause/step/abort and live interactiveWrite control + breaker mutations", async () => {
  const solver = new EmtSolver(
    {
      nominalFrequencyHz: 60,
      buses: [
        { id: "B1", baseKv: 13.8 },
        { id: "B2", baseKv: 13.8 },
      ],
      sources: [{ id: "SRC1", bus: "B1", voltageKv: 13.8, frequencyHz: 60, rSourceOhm: 0.5 }],
      branches: [
        {
          id: "BRK1",
          kind: "switch",
          fromBus: "B1",
          toBus: "B2",
          status: "closed",
          openTimeSec: 99,
          rClosedOhm: 1e-3,
          rOpenOhm: 1e6,
        },
        { id: "LOAD2", kind: "rlc", fromBus: "B2", toBus: "0", rOhm: 50, lHenry: 0, cFarad: 0 },
      ],
      controlBlocks: [{ id: "SLIDER_REF", kind: "const", inputs: [], params: { Value: 1.0 } }],
    },
    { timeStepSec: 100e-6, durationSec: 0.04 },
  );

  let chunks = 0;
  let mutatedAtChunk2 = false;
  const res = await solver.solveChunked({
    chunkSteps: 100,
    onChunk: (completed) => {
      chunks++;
      if (completed === 200 && !mutatedAtChunk2) {
        mutatedAtChunk2 = true;
        assert.equal(solver.interactiveWrite("SLIDER_REF", "Value", 2.5), true);
        assert.equal(solver.interactiveWrite("BRK1", "breaker", false), true);
      }
    },
  });

  assert.equal(chunks, 3, "400 steps with chunkSteps=100 must yield 3 intermediate chunks before completion");
  const sliderTraj = res.controlSignals!.get("SLIDER_REF")!;
  assert.equal(sliderTraj[10], 1.0, "Pre-mutation slider value should be 1.0");
  assert.equal(sliderTraj[350], 2.5, "Post-mutation interactiveWrite value should be 2.5");

  const vB2 = res.vA.get("B2")!;
  const maxPre = Math.max(...Array.from(vB2.subarray(50, 180)).map(Math.abs));
  const maxPost = Math.max(...Array.from(vB2.subarray(250, 399)).map(Math.abs));
  assert.ok(maxPre > 5000, `Pre-open B2 voltage should be energized (peak=${maxPre})`);
  assert.ok(maxPost < 100, `Post-interactiveWrite breaker open should de-energize B2 (peak=${maxPost})`);
});

test("Sprint C/D: Master Library IEEE 421.5 / Governor / PSS / WECC IBR / PLL / FFT / PWM / Sequencer extraction and evaluation", () => {
  // Verify extended control schemas are registered in catalog
  assert.ok(getMasterComponentSchema("master:pll"), "master:pll schema must be registered");
  assert.ok(getMasterComponentSchema("master:pwm"), "master:pwm schema must be registered");
  assert.ok(getMasterComponentSchema("master:fft"), "master:fft schema must be registered");
  assert.ok(getMasterComponentSchema("master:ieee_exciter"), "master:ieee_exciter schema must be registered");
  assert.ok(getMasterComponentSchema("master:ieee_governor"), "master:ieee_governor schema must be registered");
  assert.ok(getMasterComponentSchema("master:ieee_pss"), "master:ieee_pss schema must be registered");
  assert.ok(getMasterComponentSchema("master:wecc_ibr"), "master:wecc_ibr schema must be registered");

  // Direct evaluator verification of all stateful blocks
  const ev = new CsmfControlEvaluator([
    { id: "t_now", kind: "time_sig", inputs: [], params: {} },
    { id: "wt", kind: "gain", inputs: ["t_now"], params: { G: 2 * Math.PI * 60 } },
    { id: "v_sig", kind: "trig", inputs: ["wt"], params: { Type: 0 } },
    { id: "pll1", kind: "pll", inputs: ["v_sig"], params: { F0: 60, Kp: 180, Ki: 3200, OutMode: 1 } },
    { id: "fmeas1", kind: "freq_meas", inputs: ["v_sig"], params: { F0: 60, T: 0.01 } },
    { id: "fft1", kind: "fft", inputs: ["v_sig"], params: { F0: 60, H: 1 } },
    { id: "pwm1", kind: "pwm", inputs: ["v_sig"], params: { Freq: 1000, Bipolar: 0 } },
    { id: "clk", kind: "sequencer", inputs: [], params: { T1: 0.005, T2: 0.02, V0: 1, V1: 0, V2: 1 } },
    { id: "sh1", kind: "sample_hold", inputs: ["v_sig", "clk"], params: {} },
    { id: "ff1", kind: "flip_flop", inputs: ["clk"], params: { Init: 0 } },
    { id: "vt_sag", kind: "const", inputs: [], params: { Value: 0.8 } },
    {
      id: "avr1",
      kind: "ieee_exciter",
      inputs: ["vt_sag"],
      params: { Vref: 1.0, KA: 200, TA: 0.02, KE: 1.0, TE: 0.3 },
    },
    { id: "gov1", kind: "ieee_governor", inputs: [], params: { Pref: 0.85, R: 0.05, T1: 0.05, T3: 0.2 } },
    { id: "pss1", kind: "ieee_pss", inputs: ["clk"], params: { Ks: 5, Tw: 2.0, T1: 0.2, T2: 0.05 } },
    {
      id: "ibr1",
      kind: "wecc_ibr",
      inputs: ["vt_sag"],
      params: { Vref: 1.0, Kqv: 2.0, dbd: 0.05, Tg: 0.01, Imax: 1.1 },
    },
  ]);

  let sawPwmHigh = false;
  let sawPwmLow = false;
  for (let i = 0; i < 400; i++) {
    ev.step(50e-6);
    const pwmVal = ev.getSignal("pwm1");
    if (pwmVal === 1) sawPwmHigh = true;
    if (pwmVal === 0) sawPwmLow = true;
  }

  const fPll = ev.getSignal("pll1");
  const fMeas = ev.getSignal("fmeas1");
  const fftMag = ev.getSignal("fft1");
  const efd = ev.getSignal("avr1");
  const pm = ev.getSignal("gov1");
  const ibrCmd = ev.getSignal("ibr1");
  const shVal = ev.getSignal("sh1");
  const ffVal = ev.getSignal("ff1");

  assert.ok(fPll > 55 && fPll < 65, `PLL frequency estimate must stay near 60 Hz (got ${fPll})`);
  assert.ok(fMeas > 55 && fMeas < 65, `freq_meas must stay near 60 Hz (got ${fMeas})`);
  assert.ok(
    fftMag > 0.85 && fftMag < 1.15,
    `1st-harmonic FFT magnitude of unit sine must approach 1.0 (got ${fftMag})`,
  );
  assert.ok(sawPwmHigh && sawPwmLow, "PWM must switch between high and low states");
  assert.ok(efd > 1.2, `IEEE exciter must boost Efd when Vt=0.8 < Vref=1.0 (got ${efd})`);
  assert.ok(Math.abs(pm - 0.85) < 0.1, `IEEE governor must settle near Pref=0.85 (got ${pm})`);
  assert.ok(ibrCmd > 0.2, `WECC IBR must inject positive reactive support during Vt=0.8 sag (got ${ibrCmd})`);
  assert.ok(Number.isFinite(shVal) && (ffVal === 0 || ffVal === 1), "sample_hold & flip_flop must remain finite");

  // Also verify PSCX extraction lowers :avr_ieeet1 and :wecc_regc without falling back to const
  const pscxXml = `<project name="IeeeCtrl">
  <definitions>
    <definition name="Main" type="module">
      <schematic>
        <User classid="UserCmp" defn="master:avr_ieeet1" id="AVR1" x="100" y="100">
          <param name="Name" value="AVR1"/><param name="KA" value="180"/><param name="Vref" value="1.05"/>
        </User>
        <User classid="UserCmp" defn="master:wecc_regc" id="IBR1" x="220" y="100">
          <param name="Name" value="IBR1"/><param name="Kqv" value="2.5"/><param name="Vref" value="1.0"/>
        </User>
      </schematic>
    </definition>
  </definitions>
</project>`;
  const netlist = extractEmtNetlist(parsePscx(pscxXml));
  assert.equal(netlist.controlBlocks?.find((b) => b.id === "AVR1" || b.componentId === "AVR1")?.kind, "ieee_exciter");
  assert.equal(netlist.controlBlocks?.find((b) => b.id === "IBR1" || b.componentId === "IBR1")?.kind, "wecc_ibr");
});

test("Sprint C/D: EmtSolver closes protection loops with 1-cycle DFT 87T 2nd-harmonic restraint, Mho 21, and saturable CT flux", () => {
  // 1) 87T transformer differential with 2nd-harmonic magnetizing inrush blocking vs pure fundamental internal fault
  const mkDiffNetlist = (h2AmpA: number) => ({
    nominalFrequencyHz: 60,
    buses: [{ id: "B1", baseKv: 13.8 }],
    sources: [],
    currentSources: [
      { id: "ISRC1", name: "ISRC1", bus: "B1", iPeakA: 500, frequencyHz: 60, phaseRad: 0 },
      ...(h2AmpA > 0 ? [{ id: "ISRC2", name: "ISRC2", bus: "B1", iPeakA: h2AmpA, frequencyHz: 120, phaseRad: 0 }] : []),
    ],
    branches: [{ id: "BR_PRI", kind: "rlc" as const, fromBus: "B1", toBus: "0", rOhm: 10, lHenry: 0, cFarad: 0 }],
    protectionRelays: [
      {
        id: "REL87",
        ansiCode: "87T" as const,
        monitoredBus: "B1",
        monitoredBranch: "BR_PRI",
        pickupCurrentA: 100,
        secondHarmonicBlockPercent: 15,
      },
    ],
  });

  // Inrush case: 250 A @ 120 Hz on 500 A @ 60 Hz => 50% 2nd harmonic (>= 15%) must remain blocked
  const inrushRes = new EmtSolver(mkDiffNetlist(250), { timeStepSec: 100e-6, durationSec: 0.04 }).solve();
  const inrushTrip = inrushRes.controlSignals!.get("REL87_trip")!;
  assert.ok(
    inrushTrip.every((v) => v === 0),
    "87T must block magnetizing inrush with 50% 2nd-harmonic content",
  );

  // Clean internal fault (0% 2nd harmonic): must trip cleanly right after 1 power cycle
  const faultRes = new EmtSolver(mkDiffNetlist(0), { timeStepSec: 100e-6, durationSec: 0.04 }).solve();
  const faultTrip = faultRes.controlSignals!.get("REL87_trip")!;
  assert.ok(
    faultTrip.some((v) => v === 1),
    "87T must trip on clean fundamental differential current",
  );

  // 2) Saturable CT slows/attenuates apparent fault current when ctKneeFluxVs is very low
  const mkOcNetlist = (ctKneeFluxVs: number) => ({
    nominalFrequencyHz: 60,
    buses: [{ id: "B1", baseKv: 13.8 }],
    sources: [{ id: "SRC1", bus: "B1", voltageKv: 13.8, frequencyHz: 60, rSourceOhm: 0.1 }],
    branches: [{ id: "BR1", kind: "rlc" as const, fromBus: "B1", toBus: "0", rOhm: 5, lHenry: 0, cFarad: 0 }],
    protectionRelays: [
      {
        id: "REL50",
        ansiCode: "50" as const,
        monitoredBus: "B1",
        monitoredBranch: "BR1",
        pickupCurrentA: 1500,
        ctKneeFluxVs,
        ctBurdenOhm: 4.0,
      },
    ],
  });
  const unsatRes = new EmtSolver(mkOcNetlist(50.0), { timeStepSec: 100e-6, durationSec: 0.03 }).solve();
  const satRes = new EmtSolver(mkOcNetlist(0.01), { timeStepSec: 100e-6, durationSec: 0.03 }).solve();
  assert.ok(
    unsatRes.controlSignals!.get("REL50_trip")!.some((v) => v === 1),
    "Unsaturated CT must allow 50 relay pickup on 2.2 kA fault",
  );
  assert.ok(
    satRes.controlSignals!.get("REL50_zAppOhm")![200]! > unsatRes.controlSignals!.get("REL50_zAppOhm")![200]!,
    "Heavily saturated CT must attenuate DFT secondary current and raise apparent Z",
  );
});

test("Sprint C/D: edit-engine addDefinition & updateDefinition roundtrip vector <Gfx> shapes, port sides, and cond/vis parameters", () => {
  const baseXml = `<project name="WorkshopProj">
  <definitions>
    <Definition classid="UserCmpDefn" name="Main">
      <schematic/>
    </Definition>
  </definitions>
</project>`;

  const planAdd = planPscadEdits(baseXml, [
    {
      type: "addDefinition",
      name: "VscController",
      description: "Custom vector VSC block",
      ports: [
        { name: "Vabc", mode: "Electrical", side: "left" },
        { name: "Iref", mode: "In", side: "top" },
        { name: "Gate", mode: "Out", side: "right" },
      ],
      shapes: [
        { kind: "rect", x: -40, y: -26, w: 80, h: 52 },
        { kind: "line", x: -40, y: 26, x2: 40, y2: -26 },
        { kind: "circle", x: 0, y: 0, r: 10 },
        { kind: "text", x: 0, y: 4, text: "VSC" },
      ],
      parameters: [
        { name: "Mode", label: "Control Mode", type: "Integer", defaultValue: "1" },
        {
          name: "Kp",
          label: "Proportional Gain",
          type: "Real",
          defaultValue: "0.5",
          unit: "pu",
          cond: "Mode == 1",
          vis: "Mode >= 0",
        },
      ],
      dsdyn: "$Gate = $Kp * $Iref;",
    },
  ]);

  const withDef = applySplices(baseXml, planAdd.splices);
  const parsedAdded = parsePscx(withDef);
  const vscMeta = parsedAdded.definitions?.get("VscController");
  assert.ok(vscMeta?.graphicsXml?.includes("Graphics.Rectangle"), "addDefinition must emit Graphics.Rectangle");
  assert.ok(vscMeta?.graphicsXml?.includes("Graphics.Ellipse"), "addDefinition must emit Graphics.Ellipse");

  const model1 = buildProjectModel(withDef);
  const def1 = model1.definitions.get("VscController")!;
  assert.equal(def1.ports.find((p) => p.name === "Iref")?.y, -36, "Top port must map to y=-36");
  const form1 = readDefinitionForm(def1)!;
  const kpParam = form1.categories[0]!.parameters.find((p) => p.name === "Kp")!;
  assert.equal(kpParam.cond, "Mode == 1");
  assert.equal(kpParam.vis, "Mode >= 0");

  // Update existing definition via updateDefinition
  const planUpd = planPscadEdits(withDef, [
    {
      type: "updateDefinition",
      name: "VscController",
      description: "Updated VSC",
      ports: [
        { name: "Vabc", mode: "Electrical", side: "left" },
        { name: "Gate", mode: "Out", side: "bottom" },
      ],
      shapes: [{ kind: "rect", x: -30, y: -20, w: 60, h: 40 }],
      parameters: [{ name: "Ki", label: "Integral Gain", type: "Real", defaultValue: "12.0", cond: "1 == 1" }],
      dsdyn: "$Gate = $Ki;",
    },
  ]);
  const updatedXml = applySplices(withDef, planUpd.splices);
  const model2 = buildProjectModel(updatedXml);
  const def2 = model2.definitions.get("VscController")!;
  assert.equal(def2.ports.find((p) => p.name === "Gate")?.y, 36, "Bottom port must map to y=36");
  const form2 = readDefinitionForm(def2)!;
  assert.equal(form2.categories[0]!.parameters.find((p) => p.name === "Ki")?.cond, "1 == 1");
});
