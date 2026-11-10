// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { MatpowerCommand } from "../src/commands/matpower.js";

const IEEE_14_MATPOWER = `function mpc = case14
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
];

%% generator data
% bus Pg Qg Qmax Qmin Vg mBase status Pmax Pmin
mpc.gen = [
	1	232.4	-16.9	10.0	0.0	1.06	100.0	1	332.4	0.0;
	2	40.0	42.4	50.0	-40.0	1.045	100.0	1	140.0	0.0;
	3	0.0	23.4	40.0	0.0	1.01	100.0	1	100.0	0.0;
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
];

%% generator cost data
% 2 startup shutdown n c(n-1) ... c0
mpc.gencost = [
	2	0	0	3	0.0430293	20.0	0.0;
	2	0	0	3	0.025	20.0	0.0;
	2	0	0	3	0.01	40.0	0.0;
];
`;

test("MATPOWER CLI Commands (msx matpower summary, lint, to-psse, to-dae, solve)", async (t) => {
  const tmpDir = path.resolve(process.cwd(), "data/scratch_matpower_cli");
  fs.mkdirSync(tmpDir, { recursive: true });

  const mFile = path.join(tmpDir, "case5.m");
  fs.writeFileSync(mFile, IEEE_14_MATPOWER, "utf-8");

  await t.test("msx matpower summary", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (MatpowerCommand.handler as any)({
        action: "summary",
        files: [mFile],
      });
      assert.ok(logs.some((l) => l.includes("MATPOWER NETWORK SUMMARY: case5")));
      assert.ok(logs.some((l) => l.includes("Buses:                 5")));
      assert.ok(logs.some((l) => l.includes("Branches / Lines:      7")));
      assert.ok(logs.some((l) => l.includes("Generators:            3")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx matpower lint", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (MatpowerCommand.handler as any)({
        action: "lint",
        files: [mFile],
      });
      assert.ok(logs.some((l) => l.includes("[PASS]")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx matpower to-psse", async () => {
    const psseOut = path.join(tmpDir, "case5_exported.raw");
    await (MatpowerCommand.handler as any)({
      action: "to-psse",
      files: [mFile],
      out: psseOut,
    });
    assert.ok(fs.existsSync(psseOut));
    const content = fs.readFileSync(psseOut, "utf-8");
    assert.ok(content.includes("PSS/E RAW Data File") || content.includes("100.00"));
  });

  await t.test("msx matpower to-dae", async () => {
    const daeOut = path.join(tmpDir, "case5_dae.txt");
    await (MatpowerCommand.handler as any)({
      action: "to-dae",
      files: [mFile],
      out: daeOut,
    });
    assert.ok(fs.existsSync(daeOut));
  });

  await t.test("msx matpower solve (DC OPF)", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (MatpowerCommand.handler as any)({
        action: "solve",
        files: [mFile],
        formulation: "dc",
        tier: "direct",
      });
      assert.ok(logs.some((l) => l.includes("OPTIMAL POWER FLOW")));
      assert.ok(logs.some((l) => l.includes("ECONOMIC GENERATION DISPATCH")));
    } finally {
      console.log = origLog;
    }
  });
});
