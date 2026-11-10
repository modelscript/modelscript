// SPDX-License-Identifier: AGPL-3.0-or-later

import { solvePowerFlow } from "@modelscript/psse";
import assert from "node:assert/strict";
import test from "node:test";
import {
  parsePslfDyd,
  parsePslfEpc,
  pslfDydToPsseDyr,
  pslfEpcToPsseRaw,
  psseDyrToPslfDyd,
  psseRawToPslfEpc,
} from "../src/index.js";

const WSCC_9BUS_EPC = `case 'WSCC 9-Bus System'
b 1 'BUS_1' 16.5 3 1 1 1.0400 0.00 1.100 0.900
b 2 'BUS_2' 18.0 2 1 1 1.0250 9.28 1.100 0.900
b 3 'BUS_3' 13.8 2 1 1 1.0250 4.66 1.100 0.900
b 4 'BUS_4' 230.0 1 1 1 1.0258 -2.22 1.100 0.900
b 5 'BUS_5' 230.0 1 1 1 0.9956 -3.99 1.100 0.900
b 6 'BUS_6' 230.0 1 1 1 1.0044 -3.69 1.100 0.900
b 7 'BUS_7' 230.0 1 1 1 1.0258 3.72 1.100 0.900
b 8 'BUS_8' 230.0 1 1 1 1.0159 0.73 1.100 0.900
b 9 'BUS_9' 230.0 1 1 1 1.0324 1.97 1.100 0.900
g 1 '1' 1 71.60 27.00 300.00 -300.00 1.0400 100.0 0.0000 0.0608 250.0 10.0
g 2 '1' 1 163.00 6.70 300.00 -300.00 1.0250 100.0 0.0000 0.1198 300.0 10.0
g 3 '1' 1 85.00 -10.90 300.00 -300.00 1.0250 100.0 0.0000 0.1813 150.0 10.0
ld 5 '1' 1 125.00 50.00 0.0 0.0 0.0 0.0 1 1
ld 6 '1' 1 90.00 30.00 0.0 0.0 0.0 0.0 1 1
ld 8 '1' 1 100.00 35.00 0.0 0.0 0.0 0.0 1 1
ln 4 5 '1' 1 0.01000 0.08500 0.17600 250.0 250.0 250.0
ln 4 6 '1' 1 0.01700 0.09200 0.15800 250.0 250.0 250.0
ln 5 7 '1' 1 0.03200 0.16100 0.30600 250.0 250.0 250.0
ln 6 9 '1' 1 0.03900 0.17000 0.35800 250.0 250.0 250.0
ln 7 8 '1' 1 0.00850 0.07200 0.14900 250.0 250.0 250.0
ln 8 9 '1' 1 0.01190 0.10080 0.20900 250.0 250.0 250.0
t 1 4 '1' 1 0.00000 0.05760 1.0000 0.00 200.0 200.0 200.0
t 2 7 '1' 1 0.00000 0.06250 1.0000 0.00 200.0 200.0 200.0
t 3 9 '1' 1 0.00000 0.05860 1.0000 0.00 150.0 150.0 150.0
`;

test("PSLF-to-PSSE Projection: converts EPC to RAW and solves AC power flow", () => {
  const epc = parsePslfEpc(WSCC_9BUS_EPC);
  const psseCase = pslfEpcToPsseRaw(epc);

  assert.equal(psseCase.buses.size, 9);
  assert.equal(psseCase.generators.length, 3);
  assert.equal(psseCase.loads.length, 3);
  assert.equal(psseCase.branches.length, 6);
  assert.equal(psseCase.transformers.length, 3);

  // Solve AC power flow on the projected PSS/E model
  const sol = solvePowerFlow(psseCase, { algorithm: "newton_raphson", tolerance: 1e-4 });
  assert.equal(sol.converged, true, "AC Power Flow should converge on projected case");
  assert.ok(sol.iterations <= 5, `Should converge in <= 5 iterations, took ${sol.iterations}`);
  assert.ok(sol.totalLossMw > 0.0 && sol.totalLossMw < 10.0, `Losses should be realistic: ${sol.totalLossMw} MW`);

  // Convert back from PSS/E to PSLF EPC
  const roundtripEpc = psseRawToPslfEpc(psseCase);
  assert.equal(roundtripEpc.buses.size, epc.buses.size);
  assert.equal(roundtripEpc.generators.length, epc.generators.length);
  assert.equal(roundtripEpc.branches.length, epc.branches.length);
});

test("PSLF-to-PSSE Dynamic Model Projection: converts DYD to DYR and back", () => {
  const dydText = `
gencls 1 "1" 16.50 : #9 0.0 5.0 0.0 0.20 0.0 0.0 0.0 0.0
gentpf 2 "1" 18.00 : #14 6.0 0.05 1.50 0.40 0.20 0.08 0.15 0.25 0.10 0.20 0.0 0.0 0.0 0.0
exst1  2 "1" 18.00 : #12 0.0 0.0 200.0 0.05 5.0 -5.0 0.0 0.0 0.0 0.0 0.0 0.0
regca1 3 "1" 0.69  : #9 0.02 0.90 1.10 1.20 0.0 0.0 0.0 0.0 0.0
`;
  const pslfDyd = parsePslfDyd(dydText);
  const psseDyr = pslfDydToPsseDyr(pslfDyd);

  assert.equal(psseDyr.records.length, 4);
  assert.equal(psseDyr.records[0]!.model, "GENCLS");
  assert.equal(psseDyr.records[0]!.category, "generator");
  assert.equal(psseDyr.records[1]!.model, "GENROU");
  assert.equal(psseDyr.records[2]!.model, "EXST1");
  assert.equal(psseDyr.records[2]!.category, "exciter");
  assert.equal(psseDyr.records[3]!.model, "REGCAU1");
  assert.equal(psseDyr.records[3]!.category, "generator");

  // Roundtrip back to PSLF DYD
  const backToDyd = psseDyrToPslfDyd(psseDyr);
  assert.equal(backToDyd.models.length, 4);
  assert.equal(backToDyd.models[0]!.modelType, "gencls");
  assert.equal(backToDyd.models[1]!.modelType, "gentpf");
  assert.equal(backToDyd.models[3]!.modelType, "regca1");
});
