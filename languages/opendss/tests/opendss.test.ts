// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import {
  buildOpenDssYbus,
  computeCarsonImpedance,
  createOpenDssDirect,
  dispatchInvControl,
  evaluateProtection,
  evaluateRecloserSequence,
  evaluateTccCurve,
  evaluateVoltVarCurve,
  evaluateVoltWattCurve,
  kronReduce,
  lintOpenDss,
  lowerOpenDssToDae,
  openDssToModelica,
  OpenDssWorkspaceIndex,
  parseOpenDss,
  serializeOpenDss,
  solveAdmittancePowerFlow,
  solveAdmittanceQsts,
  solveDistributionPowerFlow,
  solveFaultStudy,
  solveFlisr,
  solveGic,
  solveHarmonics,
  solveHostingCapacity,
  solveOpenDssQsts,
  solveReliability,
  synthesizeLineGeometry,
} from "../src/index.js";

const SAMPLE_IEEE_4BUS = `! IEEE 4-Bus Radial Distribution Feeder
Clear

New Circuit.IEEE4Bus basekv=115.0 pu=1.05 phases=3 bus1=SourceBus

New LineCode.100 nphases=3 r1=0.115 x1=0.395 units=km

New Transformer.SubXfmr phases=3 windings=2 buses=[SourceBus, SubBus] kvs=[115, 12.47] kvas=[10000, 10000] %loadloss=0.5 xhl=5.0

New Line.Line1 bus1=SubBus bus2=LoadBus1 phases=3 linecode=100 length=2.5
New Line.Line2 bus1=LoadBus1 bus2=LoadBus2 phases=3 linecode=100 length=1.8

New Load.Load1 bus1=LoadBus1 phases=3 kv=12.47 kw=1800 kvar=600
New Load.Load2 bus1=LoadBus2 phases=3 kv=12.47 kw=1200 kvar=400

New PVSystem.SolarFarm1 bus1=LoadBus2 phases=3 kv=12.47 kva=1500 pmpp=1400

Set VoltageBases = [115, 12.47]
CalcVoltageBases
Solve
`;

const FLAWED_OPENDSS = `! Flawed OpenDSS Circuit
Clear
New Circuit.TestGrid basekv=115.0 pu=1.0 bus1=SourceBus

New Transformer.SubXfmr phases=3 windings=2 buses=[SourceBus, SubBus] kvs=[115, 12.47] kvas=[2000, 2000]

New Line.BadLine bus1=SubBus bus2=KnownBus phases=3 length=-5.0 linecode=MISSING_CODE

New Load.DanglingLoad bus1=UNCONNECTED_BUS_NAME phases=3 kv=12.47 kw=-500 kvar=100

New PVSystem.GiantSolar bus1=SubBus phases=3 kv=12.47 kva=5000 pmpp=4500
`;

test("OpenDSS Parser: parses IEEE 4-bus radial feeder accurately", () => {
  const deck = parseOpenDss(SAMPLE_IEEE_4BUS, "ieee4.dss");

  assert(deck.circuit !== undefined);
  assert.strictEqual(deck.circuit.name, "IEEE4Bus");
  assert.strictEqual(deck.circuit.baseKv, 115.0);
  assert.strictEqual(deck.circuit.pu, 1.05);
  assert.strictEqual(deck.circuit.bus1, "SourceBus");

  assert.strictEqual(deck.lineCodes.size, 1);
  const lc = deck.lineCodes.get("100");
  assert(lc !== undefined);
  assert.strictEqual(lc.r1, 0.115);
  assert.strictEqual(lc.x1, 0.395);

  assert.strictEqual(deck.transformers.size, 1);
  const xfmr = deck.transformers.get("SubXfmr");
  assert(xfmr !== undefined);
  assert.strictEqual(xfmr.buses[0], "SourceBus");
  assert.strictEqual(xfmr.buses[1], "SubBus");
  assert.strictEqual(xfmr.kvs[1], 12.47);

  assert.strictEqual(deck.lines.size, 2);
  assert.strictEqual(deck.loads.size, 2);
  assert.strictEqual(deck.pvSystems.size, 1);
});

test("OpenDSS Serializer: round-trips deck back to valid .dss script", () => {
  const deck = parseOpenDss(SAMPLE_IEEE_4BUS);
  const serialized = serializeOpenDss(deck);

  assert(serialized.includes("New Circuit.IEEE4Bus"));
  assert(serialized.includes("New Transformer.SubXfmr"));
  assert(serialized.includes("New Line.Line1"));
  assert(serialized.includes("New PVSystem.SolarFarm1"));

  const reparsed = parseOpenDss(serialized);
  assert.strictEqual(reparsed.lines.size, 2);
  assert.strictEqual(reparsed.loads.size, 2);
});

test("OpenDSS Linter: detects negative line length and missing line code (M8407, M8408)", () => {
  const deck = parseOpenDss(FLAWED_OPENDSS);
  const diags = lintOpenDss(deck);

  const lenDiag = diags.find((d) => d.code === 8407);
  const codeDiag = diags.find((d) => d.code === 8408);

  assert(lenDiag !== undefined, "Expected M8407 for negative length");
  assert(codeDiag !== undefined, "Expected M8408 for missing line code");
});

test("OpenDSS Linter: detects unconnected bus and negative load power (M8401, M8406)", () => {
  const deck = parseOpenDss(FLAWED_OPENDSS);
  const diags = lintOpenDss(deck);

  const busDiag = diags.find((d) => d.code === 8401);
  const kwDiag = diags.find((d) => d.code === 8406);

  assert(busDiag !== undefined, "Expected M8401 for unconnected bus");
  assert(kwDiag !== undefined, "Expected M8406 for negative load kW");
});

test("OpenDSS Linter: detects reverse power hosting capacity risk (M8404)", () => {
  const deck = parseOpenDss(FLAWED_OPENDSS);
  const diags = lintOpenDss(deck);

  const hostingDiag = diags.find((d) => d.code === 8404);
  assert(hostingDiag !== undefined, "Expected M8404 for DER > transformer rating");
});

test("OpenDSS Linter: detects isolated island, non-positive-definite Z-matrix, and capacitor overvoltage (M8411, M8412, M8413)", () => {
  const dss = `
New Circuit.GridTest basekv=12.47 pu=1.00 phases=3 bus1=SourceBus
New Line.LineMain Bus1=SourceBus Bus2=BusA Length=1.0 units=km r1=0.1 x1=0.3
New Line.LineIsland Bus1=Island1 Bus2=Island2 Length=1.0 units=km r1=-0.05 x1=0.2
New Load.SmallLoad Bus1=BusA Phases=3 kV=12.47 kW=100 kvar=50
New Capacitor.BigCap Bus1=BusA Phases=3 kvar=600 kV=12.47
`;
  const deck = parseOpenDss(dss);
  const diags = lintOpenDss(deck);

  const m8411 = diags.find((d) => d.code === 8411);
  const m8412 = diags.find((d) => d.code === 8412);
  const m8413 = diags.find((d) => d.code === 8413);

  assert(m8411 !== undefined, "Expected M8411 for isolated island without slack bus");
  assert(m8412 !== undefined, "Expected M8412 for non-positive-definite line impedance");
  assert(m8413 !== undefined, "Expected M8413 for capacitor kVAR exceeding feeder load");
});

test("OpenDSS Power Flow: solves distribution power flow and bus voltages", () => {
  const deck = parseOpenDss(SAMPLE_IEEE_4BUS);
  const result = solveDistributionPowerFlow(deck);

  assert.strictEqual(result.converged, true);
  assert(result.iterations <= 10);
  assert.strictEqual(result.totalLoadKw, 3000);
  assert.strictEqual(result.totalGenKw, 1400);

  const subBus = result.buses.get("SubBus");
  const loadBus2 = result.buses.get("LoadBus2");

  assert(subBus !== undefined);
  assert(loadBus2 !== undefined);
  // Source bus is 1.05 pu, downstream voltage should be around 0.95 - 1.05 pu
  assert(subBus.voltagePu > 0.9 && subBus.voltagePu <= 1.05);
  assert(loadBus2.voltagePu > 0.85 && loadBus2.voltagePu <= subBus.voltagePu);
});

test("OpenDSS DAE Lowering: compiles distribution grid into DAEBuilder linear memory", () => {
  const deck = parseOpenDss(SAMPLE_IEEE_4BUS);
  const dae = lowerOpenDssToDae(deck);

  const vars = dae.variables();
  const eqs = dae.equations();

  assert(vars.length >= 10, `Expected at least 10 DAE variables, got ${vars.length}`);
  assert(eqs.length >= 4, `Expected at least 4 equations, got ${eqs.length}`);
  assert.strictEqual(
    vars.length,
    eqs.length,
    `Expected structurally square OpenDSS DAE (N_vars=${vars.length} === N_eqs=${eqs.length})`,
  );

  // Check bus voltage and component current variables exist
  assert.notStrictEqual(dae.lookupVariable("V_SourceBus"), -1);
  assert.notStrictEqual(dae.lookupVariable("V_SubBus"), -1);
  assert.notStrictEqual(dae.lookupVariable("V_LoadBus1"), -1);
  assert.notStrictEqual(dae.lookupVariable("I_line_Line1"), -1);
  assert.notStrictEqual(dae.lookupVariable("I_xfmr_SubXfmr"), -1);
  assert.notStrictEqual(dae.lookupVariable("I_pv_SolarFarm1"), -1);
});

test("OpenDSS Modelica Projection: generates syntactically valid Modelica 3.x code", () => {
  const deck = parseOpenDss(SAMPLE_IEEE_4BUS);
  const mo = openDssToModelica(deck, "IEEE4BusFeeder");

  assert(mo.includes("model IEEE4BusFeeder"));
  assert(mo.includes("SineVoltage source"));
  assert(mo.includes("IdealTransformer Xfmr_SubXfmr"));
  assert(mo.includes("Resistor R_Line1"));
  assert(mo.includes("Inductor L_Line1"));
  assert(mo.includes("Resistor Load_Load1"));
  assert(mo.includes("ConstantCurrent PV_SolarFarm1"));
  assert(mo.includes("connect(R_Line1.p, bus_SubBus);"));
  assert(mo.includes("end IEEE4BusFeeder;"));
});

test("OpenDSS Linter: detects zero transformer impedance (M8402) and out-of-range load power factor (M8403)", () => {
  const dss = `
    Clear
    New Circuit.TestM8402 basekv=115.0 pu=1.0 bus1=SourceBus
    New Transformer.ZeroX phases=3 windings=2 buses=[SourceBus, SubBus] kvs=[115, 12.47] kvas=[5000, 5000] xhl=0
    New Load.BadPfLoad bus1=SubBus phases=3 kv=12.47 kw=500 kvar=100 pf=1.25
  `;
  const deck = parseOpenDss(dss);
  const diags = lintOpenDss(deck);
  assert(
    diags.some((d) => d.code === 8402),
    "Expected M8402 for xhl <= 0",
  );
  assert(
    diags.some((d) => d.code === 8403),
    "Expected M8403 for pf > 1.0",
  );
});

test("OpenDSS Workspace Index: indexes multi-file symbols accurately", () => {
  const indexer = new OpenDssWorkspaceIndex();
  const uri = "file:///models/ieee4.dss";
  indexer.indexFile(uri, SAMPLE_IEEE_4BUS);

  assert.strictEqual(indexer.has(uri), true);
  const fileIdx = indexer.getFileIndex(uri);
  assert(fileIdx !== undefined);

  const circuitSyms = fileIdx.byName.get("IEEE4Bus");
  assert(circuitSyms !== undefined && circuitSyms.length > 0);

  const lineSyms = fileIdx.byName.get("Line1");
  assert(lineSyms !== undefined && lineSyms.length > 0);
});

test("OpenDSS 3-Phase Unbalanced Power Flow: single-phase lateral load on phase A creates voltage unbalance", () => {
  const dss = `
    Clear
    New Circuit.UnbalFeeder basekv=12.47 pu=1.00 phases=3 bus1=SourceBus
    New LineCode.Overhead3P nphases=3 r1=0.25 x1=0.65 r0=0.65 x0=1.80 units=km
    New Line.MainLine bus1=SourceBus.1.2.3 bus2=LateralBus.1.2.3 phases=3 linecode=Overhead3P length=3.0
    New Load.SinglePhaseA bus1=LateralBus.1 phases=1 kv=7.2 kw=650 kvar=250
  `;
  const deck = parseOpenDss(dss);
  const load = deck.loads.get("SinglePhaseA");
  assert(load !== undefined);
  assert.deepStrictEqual(load.phaseNodes, [1]);

  const res = solveDistributionPowerFlow(deck);
  assert.strictEqual(res.converged, true);
  const latBus = res.buses.get("LateralBus");
  assert(latBus !== undefined);
  assert(
    latBus.vMagPuA < latBus.vMagPuB && latBus.vMagPuA < latBus.vMagPuC,
    `Expected phase A voltage (${latBus.vMagPuA}) < phase B (${latBus.vMagPuB}) and phase C (${latBus.vMagPuC})`,
  );
  assert(
    latBus.voltageUnbalanceFactor > 0.005,
    `Expected non-zero voltage unbalance factor, got ${latBus.voltageUnbalanceFactor}`,
  );
});

test("OpenDSS QSTS: evaluates LoadShape time-series multipliers across daily feeder profile", () => {
  const dss = `
    Clear
    New Circuit.QstsFeeder basekv=12.47 pu=1.02 phases=3 bus1=SourceBus
    New LoadShape.DailyProfile npts=4 interval=1.0 mult=[0.5, 0.8, 1.2, 0.6]
    New Line.Feeder1 bus1=SourceBus bus2=Bus2 phases=3 r1=0.2 x1=0.5 length=2.5
    New Load.ResLoad bus1=Bus2 phases=3 kv=12.47 kw=1200 kvar=400 daily=DailyProfile
  `;
  const deck = parseOpenDss(dss);
  assert(deck.loadShapes !== undefined);
  assert.strictEqual(deck.loadShapes.size, 1);

  const qsts = solveOpenDssQsts(deck, "DailyProfile");
  assert.strictEqual(qsts.steps.length, 4);
  assert.deepStrictEqual(qsts.multipliers, [0.5, 0.8, 1.2, 0.6]);
  // Peak load at step 2 (mult=1.2) produces highest losses and lowest bus voltage
  assert(qsts.lossesKwSeries[2]! > qsts.lossesKwSeries[0]!);
  assert(qsts.minVoltagePuSeries[2]! < qsts.minVoltagePuSeries[0]!);
});

test("OpenDSS Sparse Ybus: solves IEEE 4-bus radial feeder with nodal admittance matrix and AMD sparse LU", () => {
  const deck = parseOpenDss(SAMPLE_IEEE_4BUS);
  const model = buildOpenDssYbus(deck);
  assert(model.nNodes > 0);
  assert(model.yMatrix.nnz > 0);

  const res = solveAdmittancePowerFlow(deck);
  assert.strictEqual(res.converged, true);
  assert(res.iterations <= 5);
  assert.strictEqual(res.totalLoadKw, 3000);
  assert.strictEqual(res.totalGenKw, 1400);

  const subBus = res.buses.get("SubBus");
  const loadBus1 = res.buses.get("LoadBus1");
  const loadBus2 = res.buses.get("LoadBus2");

  assert(subBus !== undefined);
  assert(loadBus1 !== undefined);
  assert(loadBus2 !== undefined);

  assert(subBus.voltagePu > 1.0 && subBus.voltagePu <= 1.05);
  assert(loadBus1.voltagePu > 1.0 && loadBus1.voltagePu <= subBus.voltagePu);
  assert(loadBus2.voltagePu > 1.0);
  assert(res.lossesKw > 0 && res.lossesKw < 50);
});

test("OpenDSS Sparse Ybus: solves meshed / looped distribution grid with closed loop tie-lines", () => {
  const MESHED_FEEDER = `! Meshed Loop Distribution Feeder
    Clear
    New Circuit.MeshedGrid basekv=115.0 pu=1.05 phases=3 bus1=SourceBus
    New LineCode.100 nphases=3 r1=0.115 x1=0.395 units=km
    New Transformer.SubXfmr phases=3 windings=2 buses=[SourceBus, SubBus] kvs=[115, 12.47] kvas=[10000, 10000] %loadloss=0.5 xhl=5.0
    New Line.Line1 bus1=SubBus bus2=LoadBus1 phases=3 linecode=100 length=2.5
    New Line.Line2 bus1=LoadBus1 bus2=LoadBus2 phases=3 linecode=100 length=1.8
    ! Closed loop tie-line between SubBus and LoadBus2 creating mesh loop
    New Line.TieLine bus1=SubBus bus2=LoadBus2 phases=3 linecode=100 length=3.0
    New Load.Load1 bus1=LoadBus1 phases=3 kv=12.47 kw=1800 kvar=600
    New Load.Load2 bus1=LoadBus2 phases=3 kv=12.47 kw=1200 kvar=400
    New PVSystem.SolarFarm1 bus1=LoadBus2 phases=3 kv=12.47 kva=1500 pmpp=1400
  `;

  const deckRadial = parseOpenDss(SAMPLE_IEEE_4BUS);
  const deckMeshed = parseOpenDss(MESHED_FEEDER);

  const resRadial = solveAdmittancePowerFlow(deckRadial);
  const resMeshed = solveAdmittancePowerFlow(deckMeshed);

  assert.strictEqual(resMeshed.converged, true);
  assert(resMeshed.iterations <= 5);

  const radialLb2 = resRadial.buses.get("LoadBus2")!;
  const meshedLb2 = resMeshed.buses.get("LoadBus2")!;

  // Parallel tie-line reduces impedance and improves downstream voltage profile
  assert(meshedLb2.voltagePu >= radialLb2.voltagePu);
  // Total feeder losses are reduced due to mesh current sharing
  assert(resMeshed.lossesKw < resRadial.lossesKw);
});

test("OpenDSS Sparse Ybus: solves voltage-dependent ZIP loads (constant impedance Z model)", () => {
  const ZIP_FEEDER = `! ZIP Load Feeder
    Clear
    New Circuit.ZipGrid basekv=12.47 pu=1.02 phases=3 bus1=SourceBus
    New Line.Feeder1 bus1=SourceBus bus2=Bus2 phases=3 r1=0.2 x1=0.5 length=2.0
    New Load.ConstZLoad bus1=Bus2 phases=3 kv=12.47 kw=1200 kvar=400 model=2
  `;
  const deck = parseOpenDss(ZIP_FEEDER);
  const res = solveAdmittancePowerFlow(deck);

  assert.strictEqual(res.converged, true);
  assert(res.iterations <= 3);
  const bus2 = res.buses.get("Bus2");
  assert(bus2 !== undefined);
  assert(bus2.voltagePu > 0.98 && bus2.voltagePu < 1.02);
});

test("OpenDSS Sparse Ybus QSTS: evaluates daily profile with pre-factored Ybus acceleration", () => {
  const dss = `
    Clear
    New Circuit.QstsFeeder basekv=12.47 pu=1.02 phases=3 bus1=SourceBus
    New LoadShape.DailyProfile npts=4 interval=1.0 mult=[0.5, 0.8, 1.2, 0.6]
    New Line.Feeder1 bus1=SourceBus bus2=Bus2 phases=3 r1=0.2 x1=0.5 length=2.5
    New Load.ResLoad bus1=Bus2 phases=3 kv=12.47 kw=1200 kvar=400 daily=DailyProfile
  `;
  const deck = parseOpenDss(dss);
  const qsts = solveAdmittanceQsts(deck, "DailyProfile");

  assert.strictEqual(qsts.steps.length, 4);
  assert.deepStrictEqual(qsts.multipliers, [0.5, 0.8, 1.2, 0.6]);
  // Peak load at step 2 (mult=1.2) produces highest losses and lowest bus voltage
  const loss2 = qsts.lossesKwSeries[2] ?? 0;
  const loss0 = qsts.lossesKwSeries[0] ?? 0;
  const vMin2 = qsts.minVoltagePuSeries[2] ?? 0;
  const vMin0 = qsts.minVoltagePuSeries[0] ?? 0;
  assert(loss2 > loss0);
  assert(vMin2 < vMin0);
});

test("OpenDSS Controls: RegControl automatically steps transformer taps to regulate low voltage", () => {
  const dss = `
    Clear
    New Circuit.RegFeeder basekv=115.0 pu=1.00 phases=3 bus1=SourceBus
    New Transformer.RegXfmr phases=3 windings=2 buses=[SourceBus, SubBus] kvs=[115, 12.47] kvas=[5000, 5000] xhl=4.0 taps=[1.0, 1.0]
    New RegControl.Reg1 transformer=RegXfmr winding=2 vreg=120 band=2 ptratio=60
    New Line.Line1 bus1=SubBus bus2=LoadBus phases=3 r1=0.4 x1=0.8 length=5.0
    New Load.HeavyLoad bus1=LoadBus phases=3 kv=12.47 kw=4500 kvar=2000
  `;
  const deck = parseOpenDss(dss);
  assert.strictEqual(deck.regControls.size, 1);
  const res = solveAdmittancePowerFlow(deck);
  assert.strictEqual(res.converged, true);
  assert(res.controlActions !== undefined && res.controlActions.length > 0);
  const tap = res.tapPositions?.get("RegXfmr")?.[1] ?? 1.0;
  assert(tap > 1.0, `Expected tap > 1.0, got ${tap}`);
});

test("OpenDSS Controls: CapControl switches capacitor ON when feeder voltage drops", () => {
  const dss = `
    Clear
    New Circuit.CapFeeder basekv=12.47 pu=1.00 phases=3 bus1=SourceBus
    New Line.Line1 bus1=SourceBus bus2=MidBus phases=3 r1=0.3 x1=0.6 length=4.0
    New Capacitor.CapBank bus1=MidBus phases=3 kvar=1200 kv=12.47
    New CapControl.Ctrl1 capacitor=CapBank type=voltage onsetting=119 offsetting=125 ptratio=60
    New Load.HeavyLoad bus1=MidBus phases=3 kv=12.47 kw=3000 kvar=1500
  `;
  const deck = parseOpenDss(dss);
  assert.strictEqual(deck.capControls.size, 1);
  const res = solveAdmittancePowerFlow(deck, { switchedOffCapacitors: new Set(["CapBank"]) });
  assert.strictEqual(res.converged, true);
  const capState = res.capacitorStates?.get("CapBank");
  assert.strictEqual(capState, true, "Capacitor should have switched ON");
});

test("OpenDSS Generator: Model 3 PV bus dynamically regulates voltage to target", () => {
  const dss = `
    Clear
    New Circuit.GenFeeder basekv=12.47 pu=1.00 phases=3 bus1=SourceBus
    New Line.Line1 bus1=SourceBus bus2=GenBus phases=3 r1=0.2 x1=0.4 length=3.0
    New Generator.Cogen bus1=GenBus phases=3 kv=12.47 kw=1500 model=3 vpu=1.02 maxkvar=1000 minkvar=-1000
    New Load.LocalLoad bus1=GenBus phases=3 kv=12.47 kw=800 kvar=300
  `;
  const deck = parseOpenDss(dss);
  assert.strictEqual(deck.generators.size, 1);
  const res = solveAdmittancePowerFlow(deck);
  assert.strictEqual(res.converged, true);
  const genBus = res.buses.get("GenBus");
  assert(genBus !== undefined);
  assert(Math.abs(genBus.voltagePu - 1.02) < 0.02, `Expected ~1.02 pu, got ${genBus.voltagePu}`);
});

test("OpenDSS Short-Circuit: computes Thevenin impedances, 3P, SLG, and LL fault currents", () => {
  const deck = parseOpenDss(SAMPLE_IEEE_4BUS);
  const faultRes = solveFaultStudy(deck);
  assert(faultRes.buses.size >= 4);
  assert(faultRes.maxFaultCurrentAmps > 0);
  assert.strictEqual(faultRes.maxFaultBus, "SourceBus");
  const loadBus2 = faultRes.buses.get("LoadBus2");
  assert(loadBus2 !== undefined);
  assert(loadBus2.theveninZ > 0);
  assert(loadBus2.iFault3PhaseAmps > 0);
  assert(loadBus2.iFaultSlgAmps > 0);
  assert(loadBus2.iFaultLlAmps > 0);
  assert(loadBus2.shortCircuitMva > 0);
  // Symmetrical 3P current is larger than Line-to-Line fault current
  assert(loadBus2.iFault3PhaseAmps > loadBus2.iFaultLlAmps);
});

test("OpenDSS Harmonics: computes harmonic voltage propagation and THD across spectrum", () => {
  const deck = parseOpenDss(SAMPLE_IEEE_4BUS);
  const harmRes = solveHarmonics(deck);
  assert(harmRes.buses.size >= 4);
  assert(harmRes.harmonicOrders.length >= 6);
  const loadBus2 = harmRes.buses.get("LoadBus2");
  assert(loadBus2 !== undefined);
  assert(loadBus2.thdPercent > 0 && loadBus2.thdPercent < 20);
  const h5 = loadBus2.harmonics.get(5);
  assert(h5 !== undefined);
  assert(h5.vMag > 0);
});

test("OpenDSS Protection: evaluates TCC curves and checks relay-fuse coordination margins", () => {
  const dss = `
    Clear
    New Circuit.ProtFeeder basekv=12.47 pu=1.0 phases=3 bus1=SourceBus
    New TCC_Curve.RelayCurve npts=4 c_array=[1.5, 2.0, 5.0, 10.0] t_array=[10.0, 5.0, 1.2, 0.4]
    New TCC_Curve.FuseCurve npts=4 c_array=[1.5, 2.0, 5.0, 10.0] t_array=[5.0, 2.0, 0.4, 0.08]
    New Relay.MainBreaker monitoredobj=Line.MainLine terminal=1 type=current phasecurve=RelayCurve phasetrip=400 tdphase=1.0
    New Fuse.BranchFuse monitoredobj=Line.TapLine terminal=1 fusecurve=FuseCurve ratedcurrent=100
  `;
  const deck = parseOpenDss(dss);
  assert.strictEqual(deck.tccCurves.size, 2);
  assert.strictEqual(deck.relays.size, 1);
  assert.strictEqual(deck.fuses.size, 1);

  // Directly verify log-log TCC curve interpolation
  const curve = deck.tccCurves.get("FuseCurve");
  assert(curve !== undefined);
  const tAt2 = evaluateTccCurve(curve, 2.0);
  assert(Math.abs(tAt2 - 2.0) < 0.1);

  // Simulate a 1200 A downstream fault
  const currents = new Map<string, number>([
    ["Line.MainLine", 1200],
    ["Line.TapLine", 1200],
  ]);
  const study = evaluateProtection(deck, currents, 0.2);
  const fuseRes = study.devices.get("BranchFuse");
  const relayRes = study.devices.get("MainBreaker");
  assert(fuseRes !== undefined && fuseRes.tripped);
  assert(relayRes !== undefined && relayRes.tripped);
  // Downstream fuse must trip faster than upstream breaker relay
  assert(fuseRes.tripTimeSeconds < relayRes.tripTimeSeconds);
  assert(study.coordinations.length > 0);
  assert.strictEqual(study.allCoordinated, true);
});

test("OpenDSS Multiphase: parses explicit neutral 0 and arbitrary phase notation (Bus1.1.2.3.0)", () => {
  const dss = `
    Clear
    New Circuit.NeutralFeeder basekv=12.47 pu=1.0 phases=3 bus1=SourceBus.1.2.3.0
    New Line.Line1 bus1=SourceBus.1.2.3.0 bus2=LoadBus.1.2.3.0 phases=3 length=1.0 r1=0.2 x1=0.4
    New Load.Load1 bus1=LoadBus.1.0 phases=1 kv=7.2 kw=50 kvar=10
    New Load.Load2 bus1=LoadBus.2.3 phases=2 kv=12.47 kw=80 kvar=20
  `;
  const deck = parseOpenDss(dss);
  const line = deck.lines.get("Line1");
  assert(line !== undefined);
  assert.deepStrictEqual(line.phaseNodes1, [1, 2, 3, 0]);
  assert.deepStrictEqual(line.phaseNodes2, [1, 2, 3, 0]);
  const load1 = deck.loads.get("Load1");
  assert(load1 !== undefined);
  assert.deepStrictEqual(load1.phaseNodes, [1, 0]);
  const load2 = deck.loads.get("Load2");
  assert(load2 !== undefined);
  assert.deepStrictEqual(load2.phaseNodes, [2, 3]);
});

test("OpenDSS Physics: computes Carson earth-return impedances and Kron reduction", () => {
  const spacing = {
    name: "Pole500",
    nconds: 4,
    nphases: 3,
    x: [-1.0, 0.0, 1.0, 0.5],
    y: [10.0, 10.0, 10.0, 8.5],
    range: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
  };
  const wires = [
    {
      name: "PhaseWire",
      diam: 0.015,
      rdac: 0.18,
      gmrac: 0.004,
      range: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
    },
    {
      name: "PhaseWire",
      diam: 0.015,
      rdac: 0.18,
      gmrac: 0.004,
      range: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
    },
    {
      name: "PhaseWire",
      diam: 0.015,
      rdac: 0.18,
      gmrac: 0.004,
      range: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
    },
    {
      name: "NeutralWire",
      diam: 0.01,
      rdac: 0.45,
      gmrac: 0.002,
      range: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
    },
  ];

  const prim = computeCarsonImpedance(spacing, wires, 60, 100);
  assert.strictEqual(prim.r.length, 4);
  assert.strictEqual(prim.x.length, 4);
  // Carson diagonal resistance = rdac + deltaR (0.18 + ~0.0592 = ~0.2392)
  assert((prim.r[0]?.[0] ?? 0) > 0.2);
  assert((prim.x[0]?.[0] ?? 0) > 0.5);

  // Kron reduction eliminates 4th conductor (neutral) down to 3x3 active phase matrix
  const reduced = kronReduce(prim, 3);
  assert.strictEqual(reduced.r.length, 3);
  assert.strictEqual(reduced.x.length, 3);
  // Self impedance after Kron reduction must be strictly positive
  assert((reduced.r[0]?.[0] ?? 0) > 0);
  assert((reduced.x[0]?.[0] ?? 0) > 0);
});

test("OpenDSS Sparse Ybus: solves distribution power flow using physical LineGeometry conductor layout", () => {
  const dss = `
    Clear
    New Circuit.GeometryFeeder basekv=12.47 pu=1.0 phases=3 bus1=SourceBus
    New WireData.ACSR diam=0.015 rdac=0.18 gmrac=0.004
    New WireData.Neutral diam=0.01 rdac=0.45 gmrac=0.002
    New LineSpacing.Pole500 nconds=4 nphases=3 x=[-1.0, 0.0, 1.0, 0.5] y=[10.0, 10.0, 10.0, 8.5]
    New LineGeometry.3PhaseOH nconds=4 nphases=3 wires=[ACSR, ACSR, ACSR, Neutral] spacing=Pole500 reduce=yes
    New Line.Line1 bus1=SourceBus bus2=LoadBus phases=3 length=3.0 geometry=3PhaseOH
    New Load.Load1 bus1=LoadBus phases=3 kv=12.47 kw=900 kvar=300
  `;
  const deck = parseOpenDss(dss);
  assert.strictEqual(deck.wireData.size, 2);
  assert.strictEqual(deck.lineSpacings.size, 1);
  assert.strictEqual(deck.lineGeometries.size, 1);
  const line = deck.lines.get("Line1");
  assert(line !== undefined);
  assert.strictEqual(line.geometry, "3PhaseOH");

  const geom = deck.lineGeometries.get("3PhaseOH");
  assert(geom !== undefined);
  const synth = synthesizeLineGeometry(geom, deck);
  assert.strictEqual(synth.rmatrix.length, 3);
  assert.strictEqual(synth.xmatrix.length, 3);

  const pf = solveAdmittancePowerFlow(deck);
  assert.strictEqual(pf.converged, true);
  const loadBusRes = pf.buses.get("LoadBus");
  assert(loadBusRes !== undefined);
  assert(loadBusRes.vMagPu > 0.9 && loadBusRes.vMagPu < 1.05);
});

test("OpenDSS Transformers: models vector groups with Delta-Wye 30-degree phase shift", () => {
  const dss = `
    Clear
    New Circuit.DyCircuit basekv=115.0 pu=1.0 phases=3 bus1=SourceBus
    New Transformer.SubXfmr phases=3 windings=2 buses=[SourceBus, SubBus] kvs=[115, 12.47] kvas=[10000, 10000] conns=[delta, wye] leadlag=lag %loadloss=0.5 xhl=5.0
    New Load.Load1 bus1=SubBus phases=3 kv=12.47 kw=600 kvar=200
  `;
  const deck = parseOpenDss(dss);
  const xfmr = deck.transformers.get("SubXfmr");
  assert(xfmr !== undefined);
  assert.deepStrictEqual(xfmr.conn, ["delta", "wye"]);
  assert.strictEqual(xfmr.leadLag, "lag");

  const pf = solveAdmittancePowerFlow(deck);
  assert.strictEqual(pf.converged, true);
  const subBusRes = pf.buses.get("SubBus");
  assert(subBusRes !== undefined);
  assert(subBusRes.vMagPu > 0.95 && subBusRes.vMagPu < 1.05);
  // SourceBus is at 0 deg, SubBus on phase A should exhibit phase shift
  assert(Math.abs(subBusRes.vAngleDeg) > 5.0);
});

test("OpenDSS Inverter Control: IEEE 1547 Volt-VAR and Volt-Watt autonomous curve dispatch", () => {
  // Volt-VAR: Q(V) with breakpoints [0.92, 0.98, 1.02, 1.08]
  const qCap = evaluateVoltVarCurve(0.9, 440);
  assert.strictEqual(qCap, 440); // Max capacitive support
  const qDead = evaluateVoltVarCurve(1.0, 440);
  assert.strictEqual(qDead, 0); // Deadband
  const qInd = evaluateVoltVarCurve(1.1, 440);
  assert.strictEqual(qInd, -440); // Max inductive absorption

  // Volt-Watt: P(V) with curtailment starting at 1.05 p.u.
  const pFull = evaluateVoltWattCurve(1.02, 500);
  assert.strictEqual(pFull, 500);
  const pCurtailed = evaluateVoltWattCurve(1.08, 500);
  assert(pCurtailed < 500 && pCurtailed >= 0);

  const dss = `
    Clear
    New Circuit.DERFeeder basekv=12.47 pu=1.0 phases=3 bus1=SourceBus
    New Line.Line1 bus1=SourceBus bus2=PVBus phases=3 length=1.0 r1=0.1 x1=0.4
    New PVSystem.Solar1 bus1=PVBus phases=3 kv=12.47 kva=500 pmpp=450
    New InvControl.InvCtrl1 derlist=[Solar1] mode=COMBINED
  `;
  const deck = parseOpenDss(dss);
  assert.strictEqual(deck.invControls.size, 1);

  // Evaluate under overvoltage condition (e.g. 1.07 p.u.)
  const voltages = new Map<string, number>([["PVBus", 1.07]]);
  const derResults = dispatchInvControl(deck, voltages);
  const solarRes = derResults.get("Solar1");
  assert(solarRes !== undefined);
  // Under overvoltage, inverter absorbs reactive power and curtails active power
  assert(solarRes.qReactiveKvar < 0);
  assert(solarRes.curtailedKw > 0);
});

test("OpenDSS Protection: executes multi-shot recloser trip sequence and lockout evaluation", () => {
  const dss = `
    Clear
    New Circuit.RecloserFeeder basekv=12.47 pu=1.0 phases=3 bus1=SourceBus
    New Line.Line1 bus1=SourceBus bus2=LoadBus phases=3 length=1.0 r1=0.1 x1=0.4
    New TCC_Curve.Fast npts=4 c_array=[1.5, 3.0, 6.0, 10.0] t_array=[0.15, 0.08, 0.04, 0.02]
    New TCC_Curve.Slow npts=4 c_array=[1.5, 3.0, 6.0, 10.0] t_array=[1.5, 0.8, 0.4, 0.2]
    New Recloser.Rec1 monitoredobj=Line.Line1 numfastshots=1 numslowshots=2 fastcurve=Fast slowcurve=Slow phasetrip=200 resettime=15
  `;
  const deck = parseOpenDss(dss);
  const rec = deck.reclosers.get("Rec1");
  assert(rec !== undefined);

  // Temporary fault (clears on fast trip)
  const tempStudy = evaluateRecloserSequence(rec, deck, 800, false);
  assert.strictEqual(tempStudy.finalState, "cleared");
  assert.strictEqual(tempStudy.shots.length, 1);
  assert.strictEqual(tempStudy.shots[0]?.curveType, "fast");

  // Permanent fault (locks out after all 1 + 2 = 3 shots)
  const permStudy = evaluateRecloserSequence(rec, deck, 800, true);
  assert.strictEqual(permStudy.finalState, "locked_out");
  assert.strictEqual(permStudy.shots.length, rec.numFastShots + rec.numSlowShots);
});

test("OpenDSS Reliability: evaluates predictive reliability indices (SAIFI, SAIDI, CAIDI, ASAI, EEN)", () => {
  const dss = `
    Clear
    New Circuit.RelFeeder basekv=12.47 pu=1.0 phases=3 bus1=SubBus
    New Line.MainLine bus1=SubBus bus2=MidBus phases=3 length=3.0 r1=0.2 x1=0.4
    New Line.Branch1 bus1=MidBus bus2=LoadBus1 phases=3 length=1.5 r1=0.3 x1=0.5
    New Line.Branch2 bus1=MidBus bus2=LoadBus2 phases=3 length=2.0 r1=0.3 x1=0.5
    New Load.Load1 bus1=LoadBus1 phases=3 kv=12.47 kw=400 kvar=100
    New Load.Load2 bus1=LoadBus2 phases=3 kv=12.47 kw=600 kvar=150
  `;
  const deck = parseOpenDss(dss);

  const rel = solveReliability(deck);
  assert(rel.system.saifi > 0);
  assert(rel.system.saidi > 0);
  assert(rel.system.caidi > 0);
  assert(rel.system.asai > 0.99 && rel.system.asai <= 1.0);
  assert(rel.system.eenKwh > 0);
  assert(rel.system.totalCustomers > 0);
  assert(rel.criticalBranches.length >= 3);
  // MainLine upstream impacts all customers and should be top ranked
  assert.strictEqual(rel.criticalBranches[0]?.lineName, "MainLine");
});

test("OpenDSS GIC: solves quasi-DC network for geomagnetically induced currents and core saturation risk", () => {
  const dss = `
    Clear
    New Circuit.GicGrid basekv=115.0 pu=1.0 phases=3 bus1=Sub1
    New Transformer.T1 phases=3 windings=2 buses=[Sub1, Sub1_12] kvs=[115, 12.47] kvas=[20000, 20000]
    New Line.TransLine bus1=Sub1 bus2=Sub2 phases=3 length=25.0 r1=0.1 x1=0.4
    New Transformer.T2 phases=3 windings=2 buses=[Sub2, Sub2_12] kvs=[115, 12.47] kvas=[20000, 20000]
  `;
  const deck = parseOpenDss(dss);

  const gic = solveGic(deck, {
    eEastVPerKm: 2.5,
    eNorthVPerKm: 1.0,
    substationGroundResistance: 0.2,
  });

  assert(gic.buses.size >= 2);
  assert(gic.maxNeutralCurrentAmps > 0);
  assert(gic.totalGicLossMvar > 0);
  const sub1Gic = gic.buses.get("Sub1");
  assert(sub1Gic !== undefined);
  assert(sub1Gic.neutralCurrentAmps > 0);
});

test("OpenDSS Hosting Capacity: computes max DER penetration limited by ANSI C84.1 voltage rise and thermal capacity", () => {
  const dss = `
    Clear
    New Circuit.FeederHC basekv=12.47 pu=1.0 phases=3 bus1=SubBus
    New Line.Line1 bus1=SubBus bus2=LoadBus phases=3 length=3.0 r1=0.3 x1=0.6 normamps=400
    New Load.Load1 bus1=LoadBus phases=3 kv=12.47 kw=500 kvar=150
  `;
  const deck = parseOpenDss(dss);

  const hcBaseline = solveHostingCapacity(deck, {
    targetBus: "LoadBus",
    enableSmartInverter: false,
    voltageMaxPu: 1.03,
    stepKw: 100,
    maxKw: 10000,
  });

  assert.strictEqual(hcBaseline.targetBus, "LoadBus");
  assert(hcBaseline.hostingCapacityKw > 0);
  assert(hcBaseline.iterations > 0);
  assert(hcBaseline.limitingCriterion.startsWith("voltage") || hcBaseline.limitingCriterion === "thermal");

  // With smart inverter Volt-VAR absorption enabled, hosting capacity should be >= baseline
  const hcSmart = solveHostingCapacity(deck, {
    targetBus: "LoadBus",
    enableSmartInverter: true,
    voltageMaxPu: 1.03,
    stepKw: 100,
    maxKw: 10000,
  });

  assert(hcSmart.hostingCapacityKw >= hcBaseline.hostingCapacityKw);
});

test("OpenDSS FLISR: automates fault isolation, upstream restoration, and tie-line service restoration", () => {
  const dss = `
    Clear
    New Circuit.FlisrFeeder basekv=12.47 pu=1.0 phases=3 bus1=SubBus
    New Line.MainLine bus1=SubBus bus2=SectionBus phases=3 length=2.0 r1=0.2 x1=0.4
    New Line.BranchLine bus1=SectionBus bus2=TailBus phases=3 length=1.5 r1=0.2 x1=0.4
    New Load.LoadSection bus1=SectionBus phases=3 kv=12.47 kw=800 kvar=200
    New Load.LoadTail bus1=TailBus phases=3 kv=12.47 kw=600 kvar=150
  `;
  const deck = parseOpenDss(dss);

  // Fault on BranchLine
  const flisr = solveFlisr(deck, "BranchLine", {
    tieLineName: "TieToFeeder2",
    adjacentFeederCapacityKw: 2000,
    manualRepairHours: 2.5,
    automatedSwitchingHours: 0.0167,
  });

  assert.strictEqual(flisr.faultedLine, "BranchLine");
  assert.strictEqual(flisr.isolatedLineNames[0], "BranchLine");
  assert(flisr.restorationSuccess);
  assert(flisr.upstreamRestoredBuses.includes("SubBus"));
  assert(flisr.upstreamRestoredBuses.includes("SectionBus"));
  assert(flisr.downstreamRestoredBuses.includes("TailBus"));
  assert(flisr.customersRestoredUpstream > 0);
  assert(flisr.customersRestoredDownstream > 0);
  assert(flisr.customerInterruptionHoursSaved > 0);
  assert.strictEqual(flisr.tieSwitchOperated, "TieToFeeder2");
});

test("OpenDSSDirect API: provides stateful COM / Python compatible automation session", () => {
  const dss = createOpenDssDirect();
  dss.Basic.NewCircuit("TestGrid");
  dss.Text.Command("New Line.L1 bus1=SourceBus bus2=Bus2 phases=3 length=2.0 r1=0.2 x1=0.4");
  dss.Text.Command("New Load.Ld1 bus1=Bus2 phases=3 kv=12.47 kw=600 kvar=200");

  assert.strictEqual(dss.Circuit.Name, "TestGrid");
  assert.strictEqual(dss.Lines.Count, 1);
  assert.strictEqual(dss.Loads.Count, 1);
  assert(dss.Circuit.AllBusNames.includes("SourceBus"));
  assert(dss.Circuit.AllBusNames.includes("Bus2"));

  const solved = dss.Solution.Solve();
  assert.strictEqual(solved, true);
  assert.strictEqual(dss.Solution.Converged, true);

  const bus2 = dss.Circuit.Buses("Bus2");
  assert.strictEqual(bus2.Name, "Bus2");
  const v0 = bus2.VMagPu[0] ?? 1.0;
  assert(v0 > 0.9 && v0 < 1.1);
  assert.strictEqual(bus2.Nodes.length, 3);
});
