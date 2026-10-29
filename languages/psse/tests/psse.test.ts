// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  analyzeN1Contingencies,
  applyPsseDiagramWriteback,
  calculateShortCircuit,
  createPsseWasmParser,
  extractPowerFlowNetlist,
  lintPsse,
  parseDyr,
  parseRaw,
  psseToEmtNetlist,
  psseToModelica,
  PsseWorkspaceIndex,
  simulatePsseTransient,
  solvePowerFlow,
  writeDyr,
  writeRaw,
} from "../src/index.js";

// Standard IEEE 14-Bus Test Case in PSS/E RAW format
const IEEE_14_RAW = `0, 100.00, 33, 0, 0, 60.00 / PSS/E-33.0 IEEE 14 BUS TEST CASE
IEEE 14 BUS TEST CASE
TRANSMISSION PLANNING MODEL
1, 'BUS 1       ', 0.6900, 3, 1, 1, 1, 1.0600, 0.0000
2, 'BUS 2       ', 0.6900, 2, 1, 1, 1, 1.0450, -4.9800
3, 'BUS 3       ', 0.6900, 2, 1, 1, 1, 1.0100, -12.7200
4, 'BUS 4       ', 0.6900, 1, 1, 1, 1, 1.0190, -10.3300
5, 'BUS 5       ', 0.6900, 1, 1, 1, 1, 1.0200, -8.7800
0 / END OF BUS DATA
2, '1 ', 1, 1, 1, 21.700, 12.700, 0.000, 0.000, 0.000, 0.000, 1, 1, 1
3, '1 ', 1, 1, 1, 94.200, 19.000, 0.000, 0.000, 0.000, 0.000, 1, 1, 1
4, '1 ', 1, 1, 1, 47.800, -3.900, 0.000, 0.000, 0.000, 0.000, 1, 1, 1
5, '1 ', 1, 1, 1, 7.600, 1.600, 0.000, 0.000, 0.000, 0.000, 1, 1, 1
0 / END OF LOAD DATA
0 / END OF FIXED SHUNT DATA
1, '1 ', 232.400, -16.900, 10.000, -9999.000, 1.0600, 0, 100.00, 0.00000, 1.00000, 0.00000, 0.00000, 1.0000, 1, 100.0, 9999.000, -9999.000
2, '1 ', 40.000, 42.400, 50.000, -40.000, 1.0450, 0, 100.00, 0.00000, 1.00000, 0.00000, 0.00000, 1.0000, 1, 100.0, 9999.000, -9999.000
3, '1 ', 0.000, 23.400, 40.000, 0.000, 1.0100, 0, 100.00, 0.00000, 1.00000, 0.00000, 0.00000, 1.0000, 1, 100.0, 9999.000, -9999.000
0 / END OF GENERATOR DATA
1, 2, '1 ', 0.01938, 0.05917, 0.05280, 0.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 0.00
1, 5, '1 ', 0.05403, 0.22304, 0.04920, 0.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 0.00
2, 3, '1 ', 0.04699, 0.19797, 0.04380, 0.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 0.00
2, 4, '1 ', 0.05811, 0.17632, 0.03400, 0.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 0.00
2, 5, '1 ', 0.05695, 0.17388, 0.03460, 0.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 0.00
3, 4, '1 ', 0.06701, 0.17103, 0.01280, 0.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 0.00
4, 5, '1 ', 0.01335, 0.04211, 0.00000, 0.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 0.00
0 / END OF BRANCH DATA
0 / END OF TRANSFORMER DATA
0 / END OF AREA DATA
0 / END OF TWO-TERMINAL DC DATA
0 / END OF VSC DC DATA
0 / END OF SWITCHED SHUNT DATA
`;

test("PSS/E Parser: Parses IEEE 14-bus test case correctly", () => {
  const parsed = parseRaw(IEEE_14_RAW);

  assert.equal(parsed.header.sbase, 100.0);
  assert.equal(parsed.header.rev, 33);
  assert.equal(parsed.header.basfrq, 60.0);
  assert.equal(parsed.title1, "IEEE 14 BUS TEST CASE");

  // Verify bus counts
  assert.equal(parsed.buses.size, 5);
  const bus1 = parsed.buses.get(1);
  assert.ok(bus1);
  assert.equal(bus1.name, "BUS 1");
  assert.equal(bus1.ide, 3); // Swing
  assert.equal(bus1.vm, 1.06);

  // Verify load counts
  assert.equal(parsed.loads.length, 4);
  assert.equal(parsed.loads[0]?.i, 2);
  assert.equal(parsed.loads[0]?.pl, 21.7);

  // Verify generator counts
  assert.equal(parsed.generators.length, 3);
  assert.equal(parsed.generators[0]?.i, 1);
  assert.equal(parsed.generators[0]?.pg, 232.4);

  // Verify branch counts
  assert.equal(parsed.branches.length, 7);
  assert.equal(parsed.branches[0]?.i, 1);
  assert.equal(parsed.branches[0]?.j, 2);
  assert.equal(parsed.branches[0]?.r, 0.01938);
});

test("PSS/E Formatter: Round-trip serialization preserves model structure", () => {
  const parsed1 = parseRaw(IEEE_14_RAW);
  const formatted = writeRaw(parsed1);
  const parsed2 = parseRaw(formatted);

  assert.equal(parsed2.buses.size, parsed1.buses.size);
  assert.equal(parsed2.loads.length, parsed1.loads.length);
  assert.equal(parsed2.generators.length, parsed1.generators.length);
  assert.equal(parsed2.branches.length, parsed1.branches.length);

  for (const [id, b1] of parsed1.buses.entries()) {
    const b2 = parsed2.buses.get(id);
    assert.ok(b2);
    assert.equal(b2.name, b1.name);
    assert.equal(b2.ide, b1.ide);
    assert.equal(b2.baseKv, b1.baseKv);
  }
});

test("PSS/E Linter: Identifies clean case with 0 diagnostic errors", () => {
  const parsed = parseRaw(IEEE_14_RAW);
  const diags = lintPsse(parsed);
  const errors = diags.filter((d) => d.severity === "error");
  assert.equal(errors.length, 0);
});

test("PSS/E Linter: Detects missing bus references and inverted generator bounds", () => {
  const badCase = `0, 100.00, 33, 0, 0, 60.00
CORRUPTED CASE
TITLE 2
1, 'BUS 1', 138.0, 3, 1, 1, 1, 1.0, 0.0
0 / END OF BUS DATA
0 / END OF LOAD DATA
0 / END OF FIXED SHUNT DATA
1, '1 ', 50.0, 10.0, -10.0, 20.0, 1.0, 0, 100.0, 0, 1, 0, 0, 1, 1, 100.0, 10.0, 20.0
0 / END OF GENERATOR DATA
1, 999, '1 ', 0.01, 0.05, 0.0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0.0
0 / END OF BRANCH DATA
0 / END OF TRANSFORMER DATA
0 / END OF AREA DATA
0 / END OF TWO-TERMINAL DC DATA
0 / END OF VSC DC DATA
0 / END OF SWITCHED SHUNT DATA
`;

  const parsed = parseRaw(badCase);
  const diags = lintPsse(parsed);

  // Should detect P1001 for bus 999
  const p1001 = diags.find((d) => d.code === "P1001" && d.message.includes("999"));
  assert.ok(p1001, "Expected P1001 for non-existent bus 999");

  // Should detect P3001 for inverted Qmin > Qmax (qb=20 > qt=-10)
  const p3001 = diags.find((d) => d.code === "P3001");
  assert.ok(p3001, "Expected P3001 for inverted reactive limits");

  // Should detect P3002 for inverted Pmin > Pmax (pb=20 > pt=10)
  const p3002 = diags.find((d) => d.code === "P3002");
  assert.ok(p3002, "Expected P3002 for inverted active power limits");
});

test("PSS/E Netlist: Constructs Ybus matrix and power injection vectors", () => {
  const parsed = parseRaw(IEEE_14_RAW);
  const netlist = extractPowerFlowNetlist(parsed);

  assert.equal(netlist.nBuses, 5);
  assert.equal(netlist.busNumbers.length, 5);

  // Check metrics
  assert.ok(netlist.metrics.totalGenMw > 270.0);
  assert.ok(netlist.metrics.totalLoadMw > 170.0);

  // Check Ybus symmetry
  const g12 = netlist.ybus.g.get(0)?.get(1);
  const g21 = netlist.ybus.g.get(1)?.get(0);
  assert.ok(g12 !== undefined);
  assert.ok(g21 !== undefined);
  assert.equal(g12, g21);

  // Diagonal element G11 should be positive
  const g11 = netlist.ybus.g.get(0)?.get(0);
  assert.ok(g11 !== undefined && g11 > 0);
});

test("PSS/E WorkspaceIndex: Indexes case and equipment symbols", () => {
  const indexer = new PsseWorkspaceIndex();
  const uri = "file:///workspace/ieee14.raw";
  const index = indexer.indexFile(uri, IEEE_14_RAW);

  assert.ok(indexer.has(uri));
  assert.ok(index.symbols.size > 10);

  // Query bus symbol by name
  const bus1Syms = index.byName.get("Bus_1");
  assert.ok(bus1Syms && bus1Syms.length > 0);

  // Query generator symbol
  const gen1Syms = index.byName.get("Gen_1_1");
  assert.ok(gen1Syms && gen1Syms.length > 0);

  // Query branch symbol
  const br12Syms = index.byName.get("Branch_1_2_1");
  assert.ok(br12Syms && br12Syms.length > 0);
});

test("PSS/E IEEE 30-Bus: Benchmark parsing, linting, and netlist extraction", () => {
  const ieee30Path = fileURLToPath(new URL("../testsuite/ieee30.raw", import.meta.url));
  const rawText = readFileSync(ieee30Path, "utf-8");

  const parsed = parseRaw(rawText);

  assert.equal(parsed.buses.size, 30);
  assert.equal(parsed.generators.length, 6);
  assert.equal(parsed.loads.length, 20);
  assert.equal(parsed.transformers.length, 4);

  // Linting should find 0 errors
  const diags = lintPsse(parsed);
  const errors = diags.filter((d) => d.severity === "error");
  assert.equal(errors.length, 0);

  // Netlist extraction
  const netlist = extractPowerFlowNetlist(parsed);
  assert.equal(netlist.nBuses, 30);
  assert.ok(netlist.metrics.totalGenMw > 280);
  assert.ok(netlist.metrics.totalLoadMw > 180);
});

test("PSS/E IEEE 118-Bus: Benchmark parsing, scaling, and netlist extraction", () => {
  const ieee118Path = fileURLToPath(new URL("../testsuite/ieee118.raw", import.meta.url));
  const rawText = readFileSync(ieee118Path, "utf-8");
  const parsed = parseRaw(rawText);

  assert.equal(parsed.buses.size, 118);
  assert.equal(parsed.generators.length, 54);
  assert.equal(parsed.transformers.length, 9);
  assert.equal(parsed.branches.length, 177);

  // Linting should find 0 errors
  const diags = lintPsse(parsed);
  const errors = diags.filter((d) => d.severity === "error");
  assert.equal(errors.length, 0);

  // Netlist extraction
  const netlist = extractPowerFlowNetlist(parsed);
  assert.equal(netlist.nBuses, 118);
  assert.ok(netlist.metrics.totalGenMw > 4000);
  assert.ok(netlist.metrics.totalLoadMw > 4000);
});

test("PSS/E AC Power Flow Solver: Converges on IEEE 14 and IEEE 30 benchmarks", () => {
  // 1. IEEE 14
  const parsed14 = parseRaw(IEEE_14_RAW);
  const sol14 = solvePowerFlow(parsed14);

  assert.equal(sol14.converged, true);
  assert.ok(sol14.iterations <= 5);
  assert.ok(sol14.maxMismatchPu < 1e-4);
  assert.equal(sol14.buses.length, 5);
  assert.ok(sol14.totalLossMw > 0);

  // 2. IEEE 30
  const ieee30Path = fileURLToPath(new URL("../testsuite/ieee30.raw", import.meta.url));
  const parsed30 = parseRaw(readFileSync(ieee30Path, "utf-8"));
  const sol30 = solvePowerFlow(parsed30);

  assert.equal(sol30.converged, true);
  assert.ok(sol30.iterations <= 6);
  assert.ok(sol30.maxMismatchPu < 1e-4);
  assert.equal(sol30.buses.length, 30);

  // 3. Fast Decoupled Power Flow (FDPF)
  const sol30Fd = solvePowerFlow(parsed30, { algorithm: "fast_decoupled" });
  assert.equal(sol30Fd.converged, true);
  assert.ok(sol30Fd.iterations <= 6);
  assert.ok(sol30Fd.maxMismatchPu < 1e-4);

  // 4. IEEE 118 AC Power Flow
  const ieee118Path = fileURLToPath(new URL("../testsuite/ieee118.raw", import.meta.url));
  const parsed118 = parseRaw(readFileSync(ieee118Path, "utf-8"));
  const t0 = performance.now();
  const sol118 = solvePowerFlow(parsed118);
  const duration = performance.now() - t0;

  assert.equal(sol118.converged, true);
  assert.ok(sol118.iterations <= 6);
  assert.ok(sol118.maxMismatchPu < 1e-4);
  assert.equal(sol118.buses.length, 118);
  assert.ok(sol118.totalGenMw > 4200);
  assert.ok(sol118.totalLossMw > 50);
  const maxDuration = process.env.CI ? 2000 : 500;
  assert.ok(duration < maxDuration, `Solve duration took ${duration}ms, expected < ${maxDuration}ms`);
});

test("PSS/E Projection: Translates to native Modelica power system model", () => {
  const parsed = parseRaw(IEEE_14_RAW);
  const modelicaCode = psseToModelica(parsed, { modelName: "Ieee14Test" });

  assert.ok(modelicaCode.startsWith("model Ieee14Test"));
  assert.ok(modelicaCode.includes("Modelica.Electrical.Analog.Basic.Ground ground;"));
  assert.ok(modelicaCode.includes("bus_1"));
  assert.ok(modelicaCode.includes("bus_5"));
  assert.ok(modelicaCode.includes("Modelica.Electrical.Analog.Sources.SineVoltage"));
  assert.ok(modelicaCode.includes("Modelica.Electrical.Analog.Basic.Resistor"));
  assert.ok(modelicaCode.includes("Modelica.Electrical.Analog.Basic.Inductor"));
  assert.ok(modelicaCode.includes("connect("));
  assert.ok(modelicaCode.includes("end Ieee14Test;"));
});

test("PSS/E Projection: Translates to PSCAD / EMT Netlist structure", () => {
  const parsed = parseRaw(IEEE_14_RAW);
  const emtNetlist = psseToEmtNetlist(parsed);

  assert.equal(emtNetlist.buses.size, 5);
  assert.equal(emtNetlist.sources.length, 3);
  assert.equal(emtNetlist.branches.length, 7);
  assert.equal(emtNetlist.loads.length, 4);
  assert.equal(emtNetlist.frequencyHz, 60.0);

  const bus1 = emtNetlist.buses.get("1");
  assert.ok(bus1);
  assert.ok(bus1.connectedBranchIds.length > 0);
});

test("PSS/E WebAssembly Parser: Loads parser.wasm and parses IEEE 14-bus case without syntax errors", async () => {
  const { parser } = await createPsseWasmParser();
  assert.ok(parser);

  const tree = parser.parse(IEEE_14_RAW);
  assert.ok(tree);
  assert.ok(tree.rootNode);
  assert.equal(tree.rootNode.type, "SourceFile");
  assert.equal(tree.rootNode.hasError(), false, "WASM CST should have zero syntax errors on valid .raw files");
  assert.ok(tree.rootNode.children.length > 0);
});

test("PSS/E Raw Parser: Preserves Bus 1 and Bus 2 in headerless .raw files and parses 0.000 transformer lines", () => {
  const headerlessRaw = `@! Headerless PSS/E case with comments
0, 100.0, 33, 0, 0, 60.0 / PSS/E-33.0
1, 'BUS 1       ', 138.0, 3, 1, 1, 1, 1.060, 0.0
2, 'BUS 2       ', 138.0, 2, 1, 1, 1, 1.045, -4.98
3, 'BUS 3       ',  69.0, 1, 1, 1, 1, 1.010, -12.72
0 / END OF BUS DATA, BEGIN LOAD DATA
3, '1 ', 1, 1, 1, 94.2, 19.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0
0 / END OF LOAD DATA, BEGIN FIXED SHUNT DATA
0 / END OF FIXED SHUNT DATA, BEGIN GENERATOR DATA
1, '1 ', 232.4, -16.9, 10.0, 0.0, 1.060, 0, 100.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1, 100.0, 332.4, 0.0, 1, 1.0
2, '1 ', 40.0, 42.4, 50.0, -40.0, 1.045, 0, 100.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1, 100.0, 140.0, 0.0, 1, 1.0
0 / END OF GENERATOR DATA, BEGIN BRANCH DATA
1, 2, '1 ', 0.01938, 0.05917, 0.0528, 250.0, 250.0, 250.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
0 / END OF BRANCH DATA, BEGIN TRANSFORMER DATA
2, 3, 0, '1 ', 1, 1, 1, 0.0, 0.0, 2, 'T2-3        ', 1, 1, 1.0
0.000, 0.19797, 100.0
1.000, 138.0, 0.0, 100.0, 100.0, 100.0, 0, 0, 1.1, 0.9, 1.1, 0.9, 33, 0, 0.0, 0.0
1.000, 69.0
0 / END OF TRANSFORMER DATA
Q
`;
  const parsed = parseRaw(headerlessRaw);
  assert.equal(parsed.buses.size, 3, "All 3 buses (including Bus 1 and Bus 2) must be preserved");
  assert.equal(parsed.buses.get(1)?.i, 1);
  assert.equal(parsed.buses.get(2)?.i, 2);
  assert.equal(parsed.buses.get(3)?.i, 3);
  assert.equal(
    parsed.transformers.length,
    1,
    "Transformer with 0.000 r12 line must be parsed without prematurely ending section",
  );
  assert.equal(parsed.transformers[0]?.i, 2);
  assert.equal(parsed.transformers[0]?.j, 3);
  assert.ok(Math.abs((parsed.transformers[0]?.x12 ?? 0) - 0.19797) < 1e-6);
});

test("PSS/E DYR Parser: Parses GENROU, EXST1, and TGOV1 dynamic records and couples with transient simulation", () => {
  const sampleDyr = `// IEEE 14 Dynamic Equipment Models
1 'GENROU' '1' 6.50 0.05 0.50 0.06 5.14 2.00 1.80 1.70 0.60 0.80 0.20 0.13 0.09 0.35 /
1 'EXST1'  '1' 0.02 1.15 -1.15 1.00 10.0 200.0 0.05 5.00 -5.00 0.10 0.03 0.0 /
1 'TGOV1'  '1' 0.05 0.15 1.05 0.00 0.30 1.00 0.0 /
2 'GENROU' '1' 5.60 0.05 0.50 0.06 6.54 1.50 1.75 1.65 0.55 0.75 0.22 0.14 0.10 0.32 /
`;
  const dyr = parseDyr(sampleDyr);
  assert.equal(dyr.records.length, 4);
  assert.equal(dyr.records[0]?.model, "GENROU");
  assert.equal(dyr.records[0]?.category, "generator");
  assert.equal(dyr.records[0]?.namedParams["H"], 5.14);
  assert.equal(dyr.records[0]?.namedParams["D"], 2.0);
  assert.equal(dyr.records[0]?.namedParams["Xdp"], 0.6);

  assert.equal(dyr.records[1]?.model, "EXST1");
  assert.equal(dyr.records[1]?.category, "exciter");
  assert.equal(dyr.records[1]?.namedParams["KA"], 200.0);

  assert.equal(dyr.records[2]?.model, "TGOV1");
  assert.equal(dyr.records[2]?.category, "governor");
  assert.equal(dyr.records[2]?.namedParams["R"], 0.05);

  const roundTrip = parseDyr(writeDyr(dyr));
  assert.equal(roundTrip.records.length, 4);
  assert.equal(roundTrip.records[0]?.namedParams["H"], 5.14);

  const parsedCase = parseRaw(IEEE_14_RAW);
  parsedCase.dyr = dyr;
  const sim = simulatePsseTransient(parsedCase, { stopTime: 1.0 });
  assert.equal(sim.summary.convergedPowerFlow, true);
  assert.equal(sim.summary.stable, true);
});

test("PSS/E 3-Winding Transformer: Parses 5-line 3-winding transformer and stamps Kron-reduced delta admittances", () => {
  const raw3W = `0, 100.0, 33, 0, 0, 60.0 / 3-Winding Transformer Test
3-WINDING TEST CASE
REV 33
1, 'PRIMARY 230 ', 230.0, 3, 1, 1, 1, 1.040, 0.0
2, 'SECONDARY 69',  69.0, 1, 1, 1, 1, 1.000, -3.5
3, 'TERTIARY 13 ',  13.8, 1, 1, 1, 1, 1.000, -2.1
0 / END OF BUS DATA, BEGIN LOAD DATA
2, '1 ', 1, 1, 1, 45.0, 15.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 1
3, '1 ', 1, 1, 1, 12.0,  4.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 1
0 / END OF LOAD DATA, BEGIN FIXED SHUNT DATA
0 / END OF FIXED SHUNT DATA, BEGIN GENERATOR DATA
1, '1 ', 60.0, 20.0, 100.0, -50.0, 1.040, 0, 100.0, 0.0, 0.2, 0.0, 0.0, 1.0, 1, 100.0, 150.0, 0.0
0 / END OF GENERATOR DATA, BEGIN BRANCH DATA
0 / END OF BRANCH DATA, BEGIN TRANSFORMER DATA
1, 2, 3, '1 ', 1, 1, 1, 0.0, 0.0, 2, 'T3W_MAIN    ', 1, 1, 1.0
0.0020, 0.0800, 100.0, 0.0030, 0.1200, 100.0, 0.0025, 0.1000, 100.0, 1.0000, 0.00
1.0200, 230.0, 0.0, 100.0, 100.0, 100.0, 0, 0, 1.1, 0.9, 1.1, 0.9, 33, 0, 0.0, 0.0
1.0000, 69.0, 0.0, 60.0, 60.0, 60.0
1.0000, 13.8, 0.0, 30.0, 30.0, 30.0
0 / END OF TRANSFORMER DATA
Q
`;
  const parsed = parseRaw(raw3W);
  assert.equal(parsed.transformers.length, 1);
  const t = parsed.transformers[0]!;
  assert.equal(t.i, 1);
  assert.equal(t.j, 2);
  assert.equal(t.k, 3);
  assert.equal(t.x12, 0.08);
  assert.equal(t.x23, 0.12);
  assert.equal(t.x31, 0.1);
  assert.equal(t.windv3, 1.0);
  assert.equal(t.nomv3, 13.8);

  const netlist = extractPowerFlowNetlist(parsed);
  assert.equal(netlist.nBuses, 3);
  // All 3 buses should be coupled in Ybus via wye-delta Kron reduction
  assert.ok((netlist.ybus.b.get(0)?.get(1) ?? 0) !== 0, "Expected non-zero Ybus coupling between winding 1 and 2");
  assert.ok((netlist.ybus.b.get(1)?.get(2) ?? 0) !== 0, "Expected non-zero Ybus coupling between winding 2 and 3");
  assert.ok((netlist.ybus.b.get(0)?.get(2) ?? 0) !== 0, "Expected non-zero Ybus coupling between winding 1 and 3");

  const pf = solvePowerFlow(parsed);
  assert.equal(pf.converged, true);
});

test("PSS/E N-1 Contingency Screening: Evaluates single-element outages and formats security report", () => {
  const parsed = parseRaw(IEEE_14_RAW);
  const report = analyzeN1Contingencies(parsed, "IEEE 14-Bus Test");
  assert.equal(report.baseCaseConverged, true);
  // 7 branches + 2 non-slack generators = 9 contingencies
  assert.equal(report.totalContingencies, 9);
  assert.equal(report.contingencies.length, 9);
  assert.ok(report.reportText.includes("N-1 CONTINGENCY SECURITY SCREENING REPORT"));
});

test("PSS/E IEC 60909 / ANSI C37 Short-Circuit Analysis: Computes 3-phase, 1LG, 2L, and 2LG fault currents", () => {
  const parsed = parseRaw(IEEE_14_RAW);
  const sc = calculateShortCircuit(parsed, "IEEE 14-Bus Test");
  assert.equal(sc.buses.length, 5);
  assert.ok(sc.maxFaultCurrentKa > 0);
  assert.ok(sc.maxFaultBus > 0);
  for (const b of sc.buses) {
    assert.ok(b.ik3PhaseKa > 0);
    assert.ok(b.ik1LineGroundKa > 0);
    assert.ok(b.ikLineToLineKa > 0);
    assert.ok(b.ik2LineGroundKa > 0);
    assert.ok(b.sk3PhaseMva > 0);
  }
  assert.ok(sc.reportText.includes("SHORT-CIRCUIT FAULT DUTY REPORT"));
});

test("PSS/E Multi-State Subtransient + AVR + Governor Simulation: Emits Efd and Pm traces with .dyr models", () => {
  const parsed = parseRaw(IEEE_14_RAW);
  const dyrText = [
    "1 'GENROU' 1 6.50 0.05 0.50 0.06 5.14 2.00 1.80 1.70 0.60 0.80 0.20 0.13 0.09 0.35 /",
    "1 'EXST1'  1 0.02 1.15 -1.15 1.00 10.0 150.0 0.05 5.00 -5.00 0.10 0.03 0.0 /",
    "1 'TGOV1'  1 0.05 0.10 1.05 0.00 1.00 2.10 0.50 /",
    "1 'IEEEST' 1 1 0 0.02 0.02 1.50 1.50 0.15 0.03 0.15 0.03 5.00 0.10 -0.10 0.0 0.0 /",
  ].join("\n");
  parsed.dyr = parseDyr(dyrText);

  const res = simulatePsseTransient(parsed, { stopTime: 1.5, timeStep: 0.01 });
  assert.ok(res.states.includes("Efd_Bus1_pu"));
  assert.ok(res.states.includes("Pm_Bus1_MW"));
  const efdIdx = res.states.indexOf("Efd_Bus1_pu");
  const pmIdx = res.states.indexOf("Pm_Bus1_MW");
  assert.ok(efdIdx >= 0);
  assert.ok(pmIdx >= 0);
  const efdTrace = res.y[efdIdx]!;
  const pmTrace = res.y[pmIdx]!;
  assert.ok(efdTrace.length > 50);
  assert.ok(pmTrace.length > 50);
  // During the fault, AVR boosts Efd above its initial steady-state value
  const maxEfd = Math.max(...efdTrace);
  assert.ok(maxEfd > efdTrace[0]!);
});

test("PSS/E Diagram Bi-Directional Writeback: Mutates Bus, Generator, Load, and Branch parameters cleanly", () => {
  const updatedGen = applyPsseDiagramWriteback(IEEE_14_RAW, "gen_2_1", { pg: 55.5, vs: 1.05 });
  const reparsed1 = parseRaw(updatedGen);
  const gen2 = reparsed1.generators.find((g) => g.i === 2);
  assert.ok(gen2);
  assert.ok(Math.abs(gen2.pg - 55.5) < 1e-3);
  assert.ok(Math.abs(gen2.vs - 1.05) < 1e-3);

  const updatedBus = applyPsseDiagramWriteback(updatedGen, "bus_4", { baseKv: 138.0, vm: 1.025 });
  const reparsed2 = parseRaw(updatedBus);
  const bus4 = reparsed2.buses.get(4);
  assert.ok(bus4);
  assert.equal(bus4.baseKv, 138.0);
  assert.ok(Math.abs(bus4.vm - 1.025) < 1e-3);
});
