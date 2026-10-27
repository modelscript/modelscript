// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { IbisCommand } from "../src/commands/ibis.js";

const CLI_IBIS_IBS = `[IBIS Ver] 3.2
[Component] CLI_CHIP
[Package]
R_pkg 0.10 0.05 0.20
L_pkg 2.5nH 1.0nH 4.0nH
C_pkg 1.0pF 0.5pF 2.0pF
[Pin]
1 OUT1 LVCMOS_OUT

[Model] LVCMOS_OUT
Model_type Output
C_comp 2.0pF 1.5pF 3.0pF
[Voltage Range] 3.3V 3.0V 3.6V
[Pulldown]
0.0 0.000 0.000 0.000
0.4 0.016 0.010 0.024
3.3 0.050 0.035 0.070
[Pullup]
0.0 0.000 0.000 0.000
0.4 0.015 0.009 0.022
3.3 0.048 0.032 0.065
[End]
`;

test("IBIS CLI Commands (msx ibis inspect, lint, to-dae, to-modelica, eval)", async (t) => {
  const tmpDir = path.resolve(process.cwd(), "data/scratch_ibis_cli");
  fs.mkdirSync(tmpDir, { recursive: true });

  const ibsFile = path.join(tmpDir, "buffer.ibs");
  fs.writeFileSync(ibsFile, CLI_IBIS_IBS, "utf-8");

  await t.test("msx ibis inspect / summary", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (IbisCommand.handler as any)({
        action: "inspect",
        files: [ibsFile],
      });
      assert.ok(logs.some((l) => l.includes("IBIS Document Summary")));
      assert.ok(logs.some((l) => l.includes("Component 'CLI_CHIP'")));
      assert.ok(logs.some((l) => l.includes("Model 'LVCMOS_OUT'")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx ibis lint", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (IbisCommand.handler as any)({
        action: "lint",
        files: [ibsFile],
      });
      assert.ok(logs.some((l) => l.includes("0 diagnostics") || l.includes("Lint Results")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx ibis to-dae", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (IbisCommand.handler as any)({
        action: "to-dae",
        files: [ibsFile],
      });
      assert.ok(logs.some((l) => l.includes("IBIS DAE Lowering")));
      assert.ok(logs.some((l) => l.includes("DAE Variables:")));
      assert.ok(logs.some((l) => l.includes("DAE Equations:")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx ibis to-modelica", async () => {
    const outModelica = path.join(tmpDir, "buffer.mo");
    try {
      await (IbisCommand.handler as any)({
        action: "to-modelica",
        files: [ibsFile],
        out: outModelica,
      });
      assert.ok(fs.existsSync(outModelica));
      const moContent = fs.readFileSync(outModelica, "utf-8");
      assert.ok(moContent.includes("model LVCMOS_OUT"));
      assert.ok(moContent.includes("PositivePin pad"));
    } finally {
      // Keep tmpDir for cleanup at end
    }
  });

  await t.test("msx ibis eval", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (IbisCommand.handler as any)({
        action: "eval",
        files: [ibsFile],
      });
      assert.ok(logs.some((l) => l.includes("IBIS Buffer Evaluation")));
      assert.ok(logs.some((l) => l.includes("R_on (Low):")));
    } finally {
      console.log = origLog;
    }
  });

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
