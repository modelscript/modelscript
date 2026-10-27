// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { AspenCommand } from "../src/commands/aspen.js";

const CLI_TEST_ASPEN = `TITLE 'CLI ETHANOL PURIFICATION'
IN-UNITS MET
DEF-STREAMS CONV ALL

COMPONENTS
    ETHANOL C2H6O
    WATER   H2O

FLOWSHEET
    BLOCK FLASH1 IN=FEED OUT=VAP1 LIQ1
    BLOCK PUMP1 IN=LIQ1 OUT=BOTT_PROD

PROPERTIES NRTL

STREAM FEED
    SUBSTREAM MIXED TEMP=60.0 PRES=1.5 MOLE-FLOW=120.0
    MOLE-FRAC ETHANOL 0.4 / WATER 0.6

BLOCK FLASH1 FLASH2
    PARAM TEMP=78.0 PRES=1.0

BLOCK PUMP1 PUMP
    PARAM PRES=2.5
`;

test("Aspen CLI Commands (msx aspen inspect, lint, to-dae, to-modelica, solve-flash)", async (t) => {
  const tmpDir = path.resolve(process.cwd(), "data/scratch_aspen_cli");
  fs.mkdirSync(tmpDir, { recursive: true });

  const aspenFile = path.join(tmpDir, "plant.in");
  fs.writeFileSync(aspenFile, CLI_TEST_ASPEN, "utf-8");

  await t.test("msx aspen inspect / summary", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (AspenCommand.handler as any)({
        action: "inspect",
        files: [aspenFile],
      });
      assert.ok(logs.some((l) => l.includes("Aspen Plus Flowsheet: CLI ETHANOL PURIFICATION")));
      assert.ok(logs.some((l) => l.includes("Property Method:  NRTL")));
      assert.ok(logs.some((l) => l.includes("FLASH1")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx aspen lint", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (AspenCommand.handler as any)({
        action: "lint",
        files: [aspenFile],
      });
      assert.ok(logs.some((l) => l.includes("No chemical process or parameter diagnostics found")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx aspen to-dae", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (AspenCommand.handler as any)({
        action: "to-dae",
        files: [aspenFile],
      });
      assert.ok(logs.some((l) => l.includes("Lowered flowsheet to DAE arena:")));
      assert.ok(logs.some((l) => l.includes("Variables:")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx aspen to-modelica", async () => {
    const outFile = path.join(tmpDir, "plant.mo");
    await (AspenCommand.handler as any)({
      action: "to-modelica",
      files: [aspenFile],
      out: outFile,
    });
    assert.ok(fs.existsSync(outFile));
    const content = fs.readFileSync(outFile, "utf-8");
    assert.match(content, /model CLI_ETHANOL_PURIFICATION/);
    assert.match(content, /import Modelica\.Units\.SI;/);
  });

  await t.test("msx aspen solve-flash", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (AspenCommand.handler as any)({
        action: "solve-flash",
        files: [aspenFile],
      });
      assert.ok(logs.some((l) => l.includes("Flash VLE Solution for Stream 'FEED'")));
      assert.ok(logs.some((l) => l.includes("Vapor Fraction:")));
    } finally {
      console.log = origLog;
    }
  });
});
