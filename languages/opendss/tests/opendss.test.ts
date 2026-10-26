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

  // Check bus voltage variables exist
  assert.notStrictEqual(dae.lookupVariable("V_SourceBus"), -1);
  assert.notStrictEqual(dae.lookupVariable("V_SubBus"), -1);
  assert.notStrictEqual(dae.lookupVariable("V_LoadBus1"), -1);
  assert.notStrictEqual(dae.lookupVariable("I_line_Line1"), -1);
});

test("OpenDSS Modelica Projection: generates syntactically valid Modelica 3.x code", () => {
  const deck = parseOpenDss(SAMPLE_IEEE_4BUS);
  const mo = openDssToModelica(deck, "IEEE4BusFeeder");

  assert(mo.includes("model IEEE4BusFeeder"));
  assert(mo.includes("SineVoltage source"));
  assert(mo.includes("Resistor R_Line1"));
  assert(mo.includes("Inductor L_Line1"));
  assert(mo.includes("Resistor Load_Load1"));
  assert(mo.includes("end IEEE4BusFeeder;"));
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
