// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { TouchstoneCommand } from "../src/commands/touchstone.js";

const CLI_TOUCHSTONE_S2P = `! 2-Port Bandpass Chebyshev Filter CLI Test
# MHz S DB R 50
100.00  -25.0   15.0    -1.2   -30.0   -1.2   -30.0   -25.0   15.0
200.00  -22.0   -10.0   -1.5   -70.0   -1.5   -70.0   -22.0   -10.0
300.00  -2.1    -160.0  -18.0  -150.0  -18.0  -150.0  -2.1    -160.0
`;

test("Touchstone CLI Commands (msx touchstone inspect, lint, passivity, to-dae, to-modelica, fit)", async (t) => {
  const tmpDir = path.resolve(process.cwd(), "data/scratch_touchstone_cli");
  fs.mkdirSync(tmpDir, { recursive: true });

  const tsFile = path.join(tmpDir, "filter.s2p");
  fs.writeFileSync(tsFile, CLI_TOUCHSTONE_S2P, "utf-8");

  await t.test("msx touchstone inspect / summary", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (TouchstoneCommand.handler as any)({
        action: "inspect",
        files: [tsFile],
      });
      assert.ok(logs.some((l) => l.includes("Touchstone Network Summary")));
      assert.ok(logs.some((l) => l.includes("Port Count:    2")));
      assert.ok(logs.some((l) => l.includes("Ref Impedance: 50 Ω")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx touchstone lint", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (TouchstoneCommand.handler as any)({
        action: "lint",
        files: [tsFile],
      });
      assert.ok(logs.some((l) => l.includes("0 diagnostics") || l.includes("Lint Results")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx touchstone passivity", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (TouchstoneCommand.handler as any)({
        action: "passivity",
        files: [tsFile],
      });
      assert.ok(logs.some((l) => l.includes("Passivity Report")));
      assert.ok(logs.some((l) => l.includes("PASSIVE")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx touchstone to-dae", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (TouchstoneCommand.handler as any)({
        action: "to-dae",
        files: [tsFile],
        order: 2,
      });
      assert.ok(logs.some((l) => l.includes("Touchstone DAE Lowering")));
      assert.ok(logs.some((l) => l.includes("DAE Variables:")));
      assert.ok(logs.some((l) => l.includes("DAE Equations:")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx touchstone to-modelica", async () => {
    const outModelica = path.join(tmpDir, "filter.mo");
    try {
      await (TouchstoneCommand.handler as any)({
        action: "to-modelica",
        files: [tsFile],
        out: outModelica,
      });
      assert.ok(fs.existsSync(outModelica));
      const moContent = fs.readFileSync(outModelica, "utf-8");
      assert.ok(moContent.includes("model TouchstoneNPort"));
      assert.ok(moContent.includes("PositivePin p[2]"));
    } finally {
      // Keep tmpDir for cleanup at end
    }
  });

  await t.test("msx touchstone fit", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (TouchstoneCommand.handler as any)({
        action: "fit",
        files: [tsFile],
        order: 2,
      });
      assert.ok(logs.some((l) => l.includes("Vector Fitting State Space Model")));
      assert.ok(logs.some((l) => l.includes("Stable Poles Count: 2")));
    } finally {
      console.log = origLog;
    }
  });

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
