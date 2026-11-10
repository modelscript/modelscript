// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseMatpowerCase, writeMatpowerCase } from "../src/index.js";

const SIMPLE_3BUS_CASE = `function mpc = case3
mpc.version = '2';
mpc.baseMVA = 100.0;

mpc.bus = [
	1	3	0.0	0.0	0.0	0.0	1	1.05	0.0	138.0	1	1.1	0.9;
	2	2	100.0	50.0	0.0	0.0	1	1.02	0.0	138.0	1	1.1	0.9;
	3	1	50.0	20.0	0.0	0.0	1	1.00	0.0	138.0	1	1.1	0.9;
];

mpc.gen = [
	1	80.0	20.0	100.0	-50.0	1.05	100.0	1	200.0	0.0;
	2	80.0	35.0	100.0	-50.0	1.02	100.0	1	150.0	0.0;
];

mpc.branch = [
	1	2	0.01	0.05	0.02	150.0	0.0	0.0	0.0	0.0	1	-360.0	360.0;
	2	3	0.02	0.08	0.03	150.0	0.0	0.0	0.0	0.0	1	-360.0	360.0;
	1	3	0.03	0.12	0.04	150.0	0.0	0.0	0.0	0.0	1	-360.0	360.0;
];
`;

test("MATPOWER Writer: serializes and roundtrips case cleanly", () => {
  const parsed1 = parseMatpowerCase(SIMPLE_3BUS_CASE);
  const serialized = writeMatpowerCase(parsed1);

  assert.ok(serialized.includes("function mpc = case3"));
  assert.ok(serialized.includes("mpc.version = '2';"));
  assert.ok(serialized.includes("mpc.baseMVA = 100.0;"));
  assert.ok(serialized.includes("mpc.bus = ["));
  assert.ok(serialized.includes("mpc.gen = ["));
  assert.ok(serialized.includes("mpc.branch = ["));

  const parsed2 = parseMatpowerCase(serialized);
  assert.equal(parsed2.bus.length, 3);
  assert.equal(parsed2.gen.length, 2);
  assert.equal(parsed2.branch.length, 3);

  // Check roundtrip data preservation
  assert.equal(parsed2.bus[0]?.vm, 1.05);
  assert.equal(parsed2.gen[0]?.pg, 80.0);
  assert.equal(parsed2.branch[0]?.x, 0.05);
});
