// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import {
  lintOpenDss,
  lowerOpenDssToDae,
  openDssToModelica,
  OpenDssWorkspaceIndex,
  parseOpenDss,
  serializeOpenDss,
  solveDistributionPowerFlow,
  solveOpenDssQsts,
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
