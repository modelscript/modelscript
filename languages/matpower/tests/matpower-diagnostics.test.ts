// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { lintMatpowerCase, MatpowerErrorCode, parseMatpowerCase } from "../src/index.js";

test("MATPOWER Linter: detects missing reference / slack bus (MP3001)", () => {
  const code = `function mpc = case_noslack
mpc.version = '2';
mpc.baseMVA = 100.0;
mpc.bus = [
	1	1	0.0	0.0	0.0	0.0	1	1.0	0.0	138.0	1	1.1	0.9;
	2	1	10.0	5.0	0.0	0.0	1	1.0	0.0	138.0	1	1.1	0.9;
];
mpc.gen = [];
mpc.branch = [
	1	2	0.01	0.05	0.0	100.0	0.0	0.0	0.0	0.0	1	-360.0	360.0;
];
`;
  const mpc = parseMatpowerCase(code);
  const diags = lintMatpowerCase(mpc);
  assert.ok(diags.some((d) => d.code === MatpowerErrorCode.NO_SLACK_BUS));
});

test("MATPOWER Linter: detects duplicate bus IDs (MP2001)", () => {
  const code = `function mpc = case_dup
mpc.version = '2';
mpc.baseMVA = 100.0;
mpc.bus = [
	1	3	0.0	0.0	0.0	0.0	1	1.0	0.0	138.0	1	1.1	0.9;
	1	1	10.0	5.0	0.0	0.0	1	1.0	0.0	138.0	1	1.1	0.9;
];
mpc.gen = [];
mpc.branch = [];
`;
  const mpc = parseMatpowerCase(code);
  const diags = lintMatpowerCase(mpc);
  assert.ok(diags.some((d) => d.code === MatpowerErrorCode.DUPLICATE_BUS));
});

test("MATPOWER Linter: detects branches and generators with nonexistent bus (MP2002, MP2003)", () => {
  const code = `function mpc = case_unknown_bus
mpc.version = '2';
mpc.baseMVA = 100.0;
mpc.bus = [
	1	3	0.0	0.0	0.0	0.0	1	1.0	0.0	138.0	1	1.1	0.9;
];
mpc.gen = [
	99	50.0	10.0	100.0	-50.0	1.0	100.0	1	100.0	0.0;
];
mpc.branch = [
	1	42	0.01	0.05	0.0	100.0	0.0	0.0	0.0	0.0	1	-360.0	360.0;
];
`;
  const mpc = parseMatpowerCase(code);
  const diags = lintMatpowerCase(mpc);
  assert.ok(diags.some((d) => d.code === MatpowerErrorCode.GEN_UNKNOWN_BUS));
  assert.ok(diags.some((d) => d.code === MatpowerErrorCode.BRANCH_UNKNOWN_BUS));
});

test("MATPOWER Linter: detects zero impedance branches (MP3003)", () => {
  const code = `function mpc = case_zero_z
mpc.version = '2';
mpc.baseMVA = 100.0;
mpc.bus = [
	1	3	0.0	0.0	0.0	0.0	1	1.0	0.0	138.0	1	1.1	0.9;
	2	1	10.0	5.0	0.0	0.0	1	1.0	0.0	138.0	1	1.1	0.9;
];
mpc.gen = [];
mpc.branch = [
	1	2	0.0	0.0	0.0	100.0	0.0	0.0	0.0	0.0	1	-360.0	360.0;
];
`;
  const mpc = parseMatpowerCase(code);
  const diags = lintMatpowerCase(mpc);
  assert.ok(diags.some((d) => d.code === MatpowerErrorCode.ZERO_IMPEDANCE));
});

test("MATPOWER Linter: detects inverted limits (MP3004, MP3005, MP3006)", () => {
  const code = `function mpc = case_inverted
mpc.version = '2';
mpc.baseMVA = 100.0;
mpc.bus = [
	1	3	0.0	0.0	0.0	0.0	1	1.0	0.0	138.0	1	0.9	1.1;
];
mpc.gen = [
	1	50.0	10.0	-10.0	50.0	1.0	100.0	1	10.0	100.0;
];
mpc.branch = [];
`;
  const mpc = parseMatpowerCase(code);
  const diags = lintMatpowerCase(mpc);
  assert.ok(diags.some((d) => d.code === MatpowerErrorCode.VOLTAGE_LIMITS_INVERTED));
  assert.ok(diags.some((d) => d.code === MatpowerErrorCode.GEN_PLIMITS_INVERTED));
  assert.ok(diags.some((d) => d.code === MatpowerErrorCode.GEN_QLIMITS_INVERTED));
});
