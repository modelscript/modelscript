// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { lintPslfEpc, parsePslfEpc, writePslfEpc } from "../src/index.js";

const WSCC_9BUS_EPC = `c =========================================================================
c WSCC 9-Bus WECC Test System in GE PSLF EPC format
c =========================================================================
case 'WSCC 9-Bus WECC Benchmark System'

c --- BUS DATA ---
b 1 'BUS_1' 16.5 3 1 1 1.0400 0.00 1.100 0.900
b 2 'BUS_2' 18.0 2 1 1 1.0250 9.28 1.100 0.900
b 3 'BUS_3' 13.8 2 1 1 1.0250 4.66 1.100 0.900
b 4 'BUS_4' 230.0 1 1 1 1.0258 -2.22 1.100 0.900
b 5 'BUS_5' 230.0 1 1 1 0.9956 -3.99 1.100 0.900
b 6 'BUS_6' 230.0 1 1 1 1.0044 -3.69 1.100 0.900
b 7 'BUS_7' 230.0 1 1 1 1.0258 3.72 1.100 0.900
b 8 'BUS_8' 230.0 1 1 1 1.0159 0.73 1.100 0.900
b 9 'BUS_9' 230.0 1 1 1 1.0324 1.97 1.100 0.900

c --- GENERATOR DATA ---
g 1 '1' 1 71.60 27.00 300.00 -300.00 1.0400 100.0 0.0000 0.0608 250.0 10.0
g 2 '1' 1 163.00 6.70 300.00 -300.00 1.0250 100.0 0.0000 0.1198 300.0 10.0
g 3 '1' 1 85.00 -10.90 300.00 -300.00 1.0250 100.0 0.0000 0.1813 150.0 10.0

c --- LOAD DATA ---
ld 5 '1' 1 125.00 50.00 0.0 0.0 0.0 0.0 1 1
ld 6 '1' 1 90.00 30.00 0.0 0.0 0.0 0.0 1 1
ld 8 '1' 1 100.00 35.00 0.0 0.0 0.0 0.0 1 1

c --- TRANSMISSION LINE DATA ---
ln 4 5 '1' 1 0.01000 0.08500 0.17600 250.0 250.0 250.0
ln 4 6 '1' 1 0.01700 0.09200 0.15800 250.0 250.0 250.0
ln 5 7 '1' 1 0.03200 0.16100 0.30600 250.0 250.0 250.0
ln 6 9 '1' 1 0.03900 0.17000 0.35800 250.0 250.0 250.0
ln 7 8 '1' 1 0.00850 0.07200 0.14900 250.0 250.0 250.0
ln 8 9 '1' 1 0.01190 0.10080 0.20900 250.0 250.0 250.0

c --- TRANSFORMER DATA ---
t 1 4 '1' 1 0.00000 0.05760 1.0000 0.00 200.0 200.0 200.0
t 2 7 '1' 1 0.00000 0.06250 1.0000 0.00 200.0 200.0 200.0
t 3 9 '1' 1 0.00000 0.05860 1.0000 0.00 150.0 150.0 150.0
`;

test("PSLF EPC Parser: parses WSCC 9-bus benchmark system correctly", () => {
  const epc = parsePslfEpc(WSCC_9BUS_EPC);

  assert.equal(epc.buses.size, 9, "Should parse 9 buses");
  assert.equal(epc.generators.length, 3, "Should parse 3 generators");
  assert.equal(epc.loads.length, 3, "Should parse 3 loads");
  assert.equal(epc.branches.length, 6, "Should parse 6 transmission lines");
  assert.equal(epc.transformers.length, 3, "Should parse 3 step-up transformers");

  const bus1 = epc.buses.get(1);
  assert.ok(bus1, "Bus 1 should exist");
  assert.equal(bus1.name, "BUS_1");
  assert.equal(bus1.baseKv, 16.5);
  assert.equal(bus1.busType, 3, "Bus 1 should be Slack (type 3)");

  const gen2 = epc.generators.find((g) => g.busNumber === 2);
  assert.ok(gen2);
  assert.equal(gen2.pgMw, 163.0);
  assert.equal(gen2.vschedPu, 1.025);

  const load5 = epc.loads.find((l) => l.busNumber === 5);
  assert.ok(load5);
  assert.equal(load5.plMw, 125.0);
  assert.equal(load5.qlMvar, 50.0);
});

test("PSLF EPC Serializer: serializes and roundtrips without loss", () => {
  const epc1 = parsePslfEpc(WSCC_9BUS_EPC);
  const serialized = writePslfEpc(epc1);

  assert.ok(serialized.includes("b 1 'BUS_1' 16.50 3"));
  assert.ok(serialized.includes("g 2 '1' 1 163.00 6.70"));
  assert.ok(serialized.includes("ld 5 '1' 1 125.00 50.00"));
  assert.ok(serialized.includes("ln 4 5 '1' 1 0.01000 0.08500"));
  assert.ok(serialized.includes("t 1 4 '1' 1 0.00000 0.05760"));

  const epc2 = parsePslfEpc(serialized);
  assert.equal(epc2.buses.size, epc1.buses.size);
  assert.equal(epc2.generators.length, epc1.generators.length);
  assert.equal(epc2.loads.length, epc1.loads.length);
  assert.equal(epc2.branches.length, epc1.branches.length);
  assert.equal(epc2.transformers.length, epc1.transformers.length);
});

test("PSLF EPC Linter: verifies clean case and detects topological errors", () => {
  const cleanEpc = parsePslfEpc(WSCC_9BUS_EPC);
  const cleanDiags = lintPslfEpc(cleanEpc);
  assert.equal(cleanDiags.filter((d) => d.severity === "error").length, 0, "Clean case should have 0 errors");

  // Corrupted case with dangling branch and missing slack
  const badEpcText = `
b 1 'BUS_1' 16.5 1 1 1 1.0 0.0 1.1 0.9
b 2 'BUS_2' 230.0 1 1 1 1.0 0.0 1.1 0.9
ln 1 999 '1' 1 0.01 0.05 0.0 100 100 100
g 1 '1' 1 100 50 10 50 1.0 100 0 0.2 100 0
`;
  const badEpc = parsePslfEpc(badEpcText);
  const badDiags = lintPslfEpc(badEpc);

  const errorCodes = badDiags.map((d) => d.code);
  assert.ok(errorCodes.includes("PSLF-E001"), "Should detect missing slack bus");
  assert.ok(errorCodes.includes("PSLF-E002"), "Should detect dangling branch to bus 999");
  assert.ok(errorCodes.includes("PSLF-E005"), "Should detect generator qmin > qmax");
});
