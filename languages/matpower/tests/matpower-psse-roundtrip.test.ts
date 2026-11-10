// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { matpowerToPsseRaw, parseMatpowerCase, psseRawToMatpower } from "../src/index.js";

const IEEE14_MATPOWER = `function mpc = case14
mpc.version = '2';
mpc.baseMVA = 100.0;

mpc.bus = [
	1	3	0.0	0.0	0.0	0.0	1	1.06	0.0	138.0	1	1.06	0.94;
	2	2	21.7	12.7	0.0	0.0	1	1.045	-4.98	138.0	1	1.06	0.94;
	3	2	94.2	19.0	0.0	0.0	1	1.01	-12.72	138.0	1	1.06	0.94;
	4	1	47.8	-3.9	0.0	0.0	1	1.019	-10.33	138.0	1	1.06	0.94;
];

mpc.gen = [
	1	232.4	-16.9	10.0	0.0	1.06	100.0	1	332.4	0.0;
	2	40.0	42.4	50.0	-40.0	1.045	100.0	1	140.0	0.0;
];

mpc.branch = [
	1	2	0.01938	0.05917	0.0528	9900.0	0.0	0.0	0.0	0.0	1	-360.0	360.0;
	2	3	0.04699	0.19797	0.0438	9900.0	0.0	0.0	0.0	0.0	1	-360.0	360.0;
	3	4	0.06701	0.17103	0.0128	9900.0	0.0	0.0	0.0	0.0	1	-360.0	360.0;
	1	4	0.0	0.20912	0.0	9900.0	0.0	0.0	0.978	0.0	1	-360.0	360.0;
];
`;

test("MATPOWER <-> PSS/E Projections: lossless bidirectional mapping", () => {
  const mpc = parseMatpowerCase(IEEE14_MATPOWER);
  const psseCase = matpowerToPsseRaw(mpc);

  assert.equal(psseCase.buses.size, 4);
  assert.equal(psseCase.generators.length, 2);
  assert.equal(psseCase.branches.length, 3, "Lines without tap ratio");
  assert.equal(psseCase.transformers.length, 1, "Branch 1->4 is a transformer");

  const roundtripMpc = psseRawToMatpower(psseCase);
  assert.equal(roundtripMpc.bus.length, 4);
  assert.equal(roundtripMpc.gen.length, 2);
  assert.equal(roundtripMpc.branch.length, 4);

  // Check transformer ratio was preserved
  const tr = roundtripMpc.branch.find((b) => b.fbus === 1 && b.tbus === 4);
  assert.ok(tr);
  assert.equal(tr.ratio, 0.978);
});
