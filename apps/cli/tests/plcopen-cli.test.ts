// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { PlcopenCommand } from "../src/commands/plcopen.js";

const PUMP_ST = `
PROGRAM PumpControl
  VAR_INPUT
    StartBtn : BOOL := FALSE;
    StopBtn : BOOL := FALSE;
  END_VAR
  VAR_OUTPUT
    PumpRunning : BOOL := FALSE;
    Cycles : INT := 0;
  END_VAR

  IF StartBtn AND NOT StopBtn THEN
    PumpRunning := TRUE;
  ELSIF StopBtn THEN
    PumpRunning := FALSE;
  END_IF;

  Cycles := Cycles + 1;
END_PROGRAM
`;

test("PLCopen CLI Commands (msx plcopen inspect, lint, run-scan, to-modelica, to-sysml, to-dae)", async (t) => {
  const tmpDir = path.resolve(process.cwd(), "data/scratch_plcopen_cli");
  fs.mkdirSync(tmpDir, { recursive: true });

  const stFile = path.join(tmpDir, "pump.st");
  fs.writeFileSync(stFile, PUMP_ST, "utf-8");

  await t.test("msx plcopen inspect", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (PlcopenCommand.handler as any)({
        action: "inspect",
        files: [stFile],
      });
      assert.ok(logs.some((l) => l.includes("PumpControl (program)")));
      assert.ok(logs.some((l) => l.includes("4 vars")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx plcopen lint", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (PlcopenCommand.handler as any)({
        action: "lint",
        files: [stFile],
      });
      assert.ok(logs.some((l) => l.includes("[PASS]") && l.includes("0 diagnostics detected.")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx plcopen run-scan", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (PlcopenCommand.handler as any)({
        action: "run-scan",
        files: [stFile],
        cycles: 5,
        dt: 10,
      });
      assert.ok(logs.some((l) => l.includes("Executed 5 scan cycles")));
      assert.ok(logs.some((l) => l.includes('"Cycles": 5')));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx plcopen to-modelica", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (PlcopenCommand.handler as any)({
        action: "to-modelica",
        files: [stFile],
      });
      assert.ok(logs.some((l) => l.includes("block PumpControl")));
      assert.ok(logs.some((l) => l.includes("Modelica.Blocks.Interfaces.BooleanInput StartBtn")));
      assert.ok(logs.some((l) => l.includes("end PumpControl;")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx plcopen to-sysml", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (PlcopenCommand.handler as any)({
        action: "to-sysml",
        files: [stFile],
      });
      assert.ok(logs.some((l) => l.includes("action def PumpControl")));
      assert.ok(logs.some((l) => l.includes("in item StartBtn;")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx plcopen to-dae", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (PlcopenCommand.handler as any)({
        action: "to-dae",
        files: [stFile],
      });
      assert.ok(logs.some((l) => l.includes("Lowered to DAE Arena:")));
      assert.ok(logs.some((l) => l.includes("Variables:")));
    } finally {
      console.log = origLog;
    }
  });

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
