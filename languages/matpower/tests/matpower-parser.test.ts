// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseMatpowerCase } from "../src/index.js";

const IEEE14_MATPOWER = `function mpc = case14
mpc.version = '2';
mpc.baseMVA = 100.0;

%% bus data
% bus_i type Pd Qd Gs Bs area Vm Va baseKV zone Vmax Vmin
mpc.bus = [
	1	3	0.0	0.0	0.0	0.0	1	1.06	0.0	0.0	1	1.06	0.94;
	2	2	21.7	12.7	0.0	0.0	1	1.045	-4.98	0.0	1	1.06	0.94;
	3	2	94.2	19.0	0.0	0.0	1	1.01	-12.72	0.0	1	1.06	0.94;
	4	1	47.8	-3.9	0.0	0.0	1	1.019	-10.33	0.0	1	1.06	0.94;
	5	1	7.6	1.6	0.0	0.0	1	1.02	-8.78	0.0	1	1.06	0.94;
	6	2	11.2	7.5	0.0	0.0	1	1.07	-14.22	0.0	1	1.06	0.94;
	7	1	0.0	0.0	0.0	0.0	1	1.062	-13.37	0.0	1	1.06	0.94;
	8	2	0.0	0.0	0.0	0.0	1	1.09	-13.36	0.0	1	1.06	0.94;
	9	1	29.5	16.6	0.0	19.0	1	1.056	-14.94	0.0	1	1.06	0.94;
	10	1	9.0	5.8	0.0	0.0	1	1.051	-15.1	0.0	1	1.06	0.94;
	11	1	3.5	1.8	0.0	0.0	1	1.057	-14.79	0.0	1	1.06	0.94;
	12	1	6.1	1.6	0.0	0.0	1	1.055	-15.07	0.0	1	1.06	0.94;
	13	1	13.5	5.8	0.0	0.0	1	1.05	-15.15	0.0	1	1.06	0.94;
	14	1	14.9	5.0	0.0	0.0	1	1.036	-16.04	0.0	1	1.06	0.94;
];

%% generator data
% bus Pg Qg Qmax Qmin Vg mBase status Pmax Pmin
mpc.gen = [
	1	232.4	-16.9	10.0	0.0	1.06	100.0	1	332.4	0.0;
	2	40.0	42.4	50.0	-40.0	1.045	100.0	1	140.0	0.0;
	3	0.0	23.4	40.0	0.0	1.01	100.0	1	100.0	0.0;
	6	0.0	12.2	24.0	-6.0	1.07	100.0	1	100.0	0.0;
	8	0.0	17.4	24.0	-6.0	1.09	100.0	1	100.0	0.0;
];

%% branch data
% fbus tbus r x b rateA rateB rateC ratio angle status angmin angmax
mpc.branch = [
	1	2	0.01938	0.05917	0.0528	9900.0	0.0	0.0	0.0	0.0	1	-360.0	360.0;
	1	5	0.05403	0.22304	0.0492	9900.0	0.0	0.0	0.0	0.0	1	-360.0	360.0;
	2	3	0.04699	0.19797	0.0438	9900.0	0.0	0.0	0.0	0.0	1	-360.0	360.0;
	2	4	0.05811	0.17632	0.034	9900.0	0.0	0.0	0.0	0.0	1	-360.0	360.0;
	2	5	0.05695	0.17388	0.0346	9900.0	0.0	0.0	0.0	0.0	1	-360.0	360.0;
	3	4	0.06701	0.17103	0.0128	9900.0	0.0	0.0	0.0	0.0	1	-360.0	360.0;
	4	5	0.01335	0.04211	0.0	9900.0	0.0	0.0	0.0	0.0	1	-360.0	360.0;
	4	7	0.0	0.20912	0.0	9900.0	0.0	0.0	0.978	0.0	1	-360.0	360.0;
	4	9	0.0	0.55618	0.0	9900.0	0.0	0.0	0.969	0.0	1	-360.0	360.0;
	5	6	0.0	0.25202	0.0	9900.0	0.0	0.0	0.932	0.0	1	-360.0	360.0;
	6	11	0.09498	0.1989	0.0	9900.0	0.0	0.0	0.0	0.0	1	-360.0	360.0;
	6	12	0.12291	0.25581	0.0	9900.0	0.0	0.0	0.0	0.0	1	-360.0	360.0;
	6	13	0.06615	0.13027	0.0	9900.0	0.0	0.0	0.0	0.0	1	-360.0	360.0;
	7	8	0.0	0.17615	0.0	9900.0	0.0	0.0	0.0	0.0	1	-360.0	360.0;
	7	9	0.0	0.11001	0.0	9900.0	0.0	0.0	0.0	0.0	1	-360.0	360.0;
	9	10	0.03181	0.0845	0.0	9900.0	0.0	0.0	0.0	0.0	1	-360.0	360.0;
	9	14	0.12711	0.27038	0.0	9900.0	0.0	0.0	0.0	0.0	1	-360.0	360.0;
	10	11	0.08205	0.19207	0.0	9900.0	0.0	0.0	0.0	0.0	1	-360.0	360.0;
	12	13	0.22092	0.19988	0.0	9900.0	0.0	0.0	0.0	0.0	1	-360.0	360.0;
	13	14	0.17093	0.34802	0.0	9900.0	0.0	0.0	0.0	0.0	1	-360.0	360.0;
];
`;

test("MATPOWER Parser: parses IEEE 14-bus case correctly", () => {
  const mpc = parseMatpowerCase(IEEE14_MATPOWER);

  assert.equal(mpc.caseName, "case14");
  assert.equal(mpc.version, "2");
  assert.equal(mpc.baseMVA, 100.0);
  assert.equal(mpc.bus.length, 14, "Should parse 14 buses");
  assert.equal(mpc.gen.length, 5, "Should parse 5 generators");
  assert.equal(mpc.branch.length, 20, "Should parse 20 branches");

  // Check Bus 1 (Slack)
  const bus1 = mpc.bus[0]!;
  assert.equal(bus1.bus_i, 1);
  assert.equal(bus1.type, 3, "Bus 1 should be Slack bus (type 3)");
  assert.equal(bus1.vm, 1.06);
  assert.equal(bus1.va, 0.0);

  // Check Generator 1
  const gen1 = mpc.gen[0]!;
  assert.equal(gen1.bus, 1);
  assert.equal(gen1.pg, 232.4);
  assert.equal(gen1.status, 1);

  // Check Branch 4->7 (Transformer with ratio 0.978)
  const tr = mpc.branch.find((b) => b.fbus === 4 && b.tbus === 7)!;
  assert.ok(tr);
  assert.equal(tr.ratio, 0.978);
});
